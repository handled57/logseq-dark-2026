/* Claudseq's timeline model: what the pane draws, derived from what Claude
 * Code says.
 *
 * Two sources feed it the same way. A live session streams stream-json events
 * through the bridge — partial chunks, then each complete assistant content
 * block, tool results as user messages, permission requests as control
 * requests, and a result at the end of every turn. A past session is read
 * back from its transcript, whose user and assistant records carry the same
 * messages; a subagent's records are fed with its Agent call's id as their
 * parent, which is how a live stream marks them too.
 *
 * The model knows nothing about the DOM. Each row carries a `rev` that changes
 * whenever the row does, so the view redraws exactly the rows that moved.
 *
 * Row kinds: user, thinking, text, tool, notice, permission and footer.
 */

var ClaudseqTimeline = (function () {
  const INTERRUPTED = /^\[Request interrupted/

  /* A path inside the working directory, relative to it; any other path as
   * it is. On Windows one folder is written with either slash and any case
   * of letter: Logseq names a graph's folder with forward slashes, and
   * Claude Code writes the paths it works on with backslashes. */
  function relativePath(path, cwd) {
    if (typeof path !== 'string' || typeof cwd !== 'string' || !cwd) return path
    const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(cwd)
    const base = cwd.replace(windows ? /(?<=[^\\/:])[\\/]+$/ : /(?<=[^/])\/+$/, '')
    const fold = (text) => windows ? text.replace(/\//g, '\\').toLowerCase() : text
    const separator = path.charAt(base.length)
    if (fold(path.slice(0, base.length)) !== fold(base)) return path
    if (separator !== '/' && !(windows && separator === '\\')) return path
    return path.slice(base.length + 1)
  }

  /* The part of a tool's input worth a line in the timeline. */
  function summarize(name, input, cwd) {
    const value = input && typeof input === 'object' ? input : {}
    const relative = (path) => typeof path === 'string' ? relativePath(path, cwd) : ''
    const first = (text) => String(text ?? '').split('\n')[0]
    switch (name) {
      case 'Agent':
      case 'Task':
        return value.description ?? value.subagent_type ?? ''
      case 'Bash':
        return first(value.command)
      case 'Read':
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
      case 'NotebookEdit':
        return relative(value.file_path ?? value.notebook_path)
      case 'Grep':
      case 'Glob':
        return value.pattern ?? ''
      case 'WebFetch':
        return value.url ?? ''
      case 'WebSearch':
        return value.query ?? ''
      case 'TodoWrite':
        return Array.isArray(value.todos) ? `${value.todos.length} todos` : ''
      case 'Skill':
        return value.skill ?? value.command ?? ''
      default: {
        const text = Object.values(value).find((entry) => typeof entry === 'string')
        return text ? first(text) : ''
      }
    }
  }

  /* The IN box: what the tool was asked to do, the way a person would read
   * it — the command, the content, the change — before falling back to the
   * raw input. */
  function describeInput(name, input) {
    const value = input && typeof input === 'object' ? input : {}
    if (name === 'Bash' && typeof value.command === 'string') return value.command
    if (name === 'Write' && typeof value.content === 'string') return value.content
    if (name === 'Edit' && typeof value.old_string === 'string') {
      const lines = (text, mark) => String(text).split('\n').map((line) => `${mark} ${line}`).join('\n')
      return `${lines(value.old_string, '-')}\n${lines(value.new_string ?? '', '+')}`
    }
    if ((name === 'Agent' || name === 'Task') && typeof value.prompt === 'string') return value.prompt
    if (name === 'Read' && typeof value.file_path === 'string') return value.file_path
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return ''
    }
  }

  function resultText(content) {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content.map((part) => part?.type === 'text' ? part.text ?? '' : `[${part?.type ?? 'content'}]`).join('\n')
  }

  function userText(content) {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content.filter((block) => block?.type === 'text').map((block) => block.text ?? '').join('\n')
  }

  /* The prompt a person typed, without the markup Claude Code wraps around
   * slash commands and reminders; null when nothing is left to show. */
  function promptText(raw) {
    const command = /<command-name>([^<]*)<\/command-name>/.exec(raw)
    if (command) {
      const args = /<command-args>([^<]*)<\/command-args>/.exec(raw)?.[1]?.trim()
      return [command[1].trim(), args].filter(Boolean).join(' ')
    }
    const text = raw
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .replace(/<local-command-(?:stdout|stderr|caveat)>[\s\S]*?<\/local-command-(?:stdout|stderr|caveat)>/g, '')
      .trim()
    return text || null
  }

  function create({ cwd = '' } = {}) {
    const rows = []
    const byKey = new Map()
    const tools = new Map()
    const tasks = new Map()
    const blockCounts = new Map()
    const currentMessage = new Map()
    const state = {
      sessionId: null,
      model: null,
      mode: null,
      slashCommands: [],
      agents: 0,
      busy: false,
      firstPrompt: null,
      rev: 0
    }
    let rev = 0
    let serial = 0

    const touch = (row) => {
      row.rev = ++rev
      state.rev = rev
      return row
    }

    function container(parentId) {
      if (!parentId) return rows
      const tool = tools.get(parentId)
      if (!tool) return rows
      touch(tool)
      return tool.children
    }

    function add(row, parentId) {
      row.key = row.key ?? `row-${++serial}`
      row.parentId = parentId && tools.has(parentId) ? parentId : null
      byKey.set(row.key, row)
      container(row.parentId).push(touch(row))
      return row
    }

    function toolRow(block, parentId, key) {
      let row = tools.get(block.id)
      if (!row) {
        row = add({
          key,
          kind: 'tool',
          id: block.id,
          name: block.name,
          input: block.input ?? null,
          partialInput: '',
          output: null,
          status: 'pending',
          children: [],
          agent: block.name === 'Agent' || block.name === 'Task'
        }, parentId)
        tools.set(block.id, row)
      } else {
        if (block.name) row.name = block.name
        if (block.input && Object.keys(block.input).length) row.input = block.input
        touch(row)
      }
      if (key) byKey.set(key, row)
      row.summary = summarize(row.name, row.input, cwd)
      return row
    }

    /* A complete content block, whether it arrived live or from a
     * transcript. The k-th complete block of a message is the one its k-th
     * streamed block started, so a row begun from partial chunks is finished
     * in place rather than drawn twice. */
    function contentBlock(block, messageId, parentId) {
      const n = messageId ? blockCounts.get(messageId) ?? 0 : 0
      if (messageId) blockCounts.set(messageId, n + 1)
      const key = messageId ? `${messageId}:${n}` : undefined
      const existing = key ? byKey.get(key) : undefined

      if (block?.type === 'tool_use') return toolRow(block, parentId, key)
      if (block?.type === 'text') {
        if (existing?.kind === 'text') {
          existing.text = block.text ?? ''
          existing.streaming = false
          return touch(existing)
        }
        if (!block.text) return null
        return add({ key, kind: 'text', text: block.text, streaming: false }, parentId)
      }
      if (block?.type === 'thinking') {
        if (existing?.kind === 'thinking') {
          existing.text = block.thinking ?? existing.text
          existing.streaming = false
          return touch(existing)
        }
        return add({ key, kind: 'thinking', text: block.thinking ?? '', streaming: false }, parentId)
      }
      return null
    }

    function streamEvent(event, parentId) {
      const inner = event?.event
      if (!inner) return
      const lane = parentId ?? ''
      if (inner.type === 'message_start') {
        currentMessage.set(lane, inner.message?.id ?? null)
        return
      }
      const messageId = currentMessage.get(lane)
      if (!messageId) return
      const key = `${messageId}:${inner.index}`
      if (inner.type === 'content_block_start') {
        const block = inner.content_block ?? {}
        if (byKey.has(key)) return
        if (block.type === 'text') add({ key, kind: 'text', text: block.text ?? '', streaming: true }, parentId)
        else if (block.type === 'thinking') add({ key, kind: 'thinking', text: block.thinking ?? '', streaming: true }, parentId)
        else if (block.type === 'tool_use') toolRow({ id: block.id, name: block.name, input: null }, parentId, key)
        return
      }
      if (inner.type === 'content_block_delta') {
        const row = byKey.get(key)
        const delta = inner.delta ?? {}
        if (!row) return
        if (delta.type === 'text_delta' && row.kind === 'text') row.text += delta.text ?? ''
        else if (delta.type === 'thinking_delta' && row.kind === 'thinking') row.text += delta.thinking ?? ''
        else if (delta.type === 'input_json_delta' && row.kind === 'tool') row.partialInput += delta.partial_json ?? ''
        else return
        touch(row)
      }
    }

    function userMessage(event, parentId) {
      const content = event.message?.content
      if (Array.isArray(content) && content.some((block) => block?.type === 'tool_result')) {
        for (const block of content) {
          if (block?.type !== 'tool_result') continue
          const tool = tools.get(block.tool_use_id)
          if (!tool) continue
          if (tool.agent && !block.is_error && tasks.has(tool.id)) {
            /* A background agent's first result only says it started, in
             * words meant for the model; the row stays pending, with no OUT,
             * until its notification arrives. */
            touch(tool)
            continue
          }
          tool.output = resultText(block.content)
          tool.status = block.is_error ? 'error' : 'ok'
          touch(tool)
        }
        return
      }
      const raw = userText(content)
      if (INTERRUPTED.test(raw)) {
        /* The turn ends here, live or read back from a transcript, which
         * keeps this record but no result event. An agent cut short gets a
         * note inside its own row instead. */
        if (parentId) add({ kind: 'notice', text: 'Interrupted' }, parentId)
        else add({ kind: 'footer', error: false, text: 'Interrupted' })
        return
      }
      if (event.isCompactSummary) {
        add({ kind: 'notice', text: 'Conversation compacted' }, parentId)
        return
      }
      /* A subagent's own prompt is already the IN of its Agent row. */
      if (parentId) return
      const text = promptText(raw)
      if (!text) return
      if (!state.firstPrompt) state.firstPrompt = text
      add({ kind: 'user', text })
    }

    function systemEvent(event) {
      if (event.subtype === 'init') {
        if (typeof event.session_id === 'string') state.sessionId = event.session_id
        if (typeof event.model === 'string') state.model = event.model
        if (typeof event.permissionMode === 'string') state.mode = event.permissionMode
        if (Array.isArray(event.slash_commands)) state.slashCommands = event.slash_commands.filter((name) => typeof name === 'string')
        state.rev = ++rev
        return
      }
      if (event.subtype === 'status' && typeof event.permissionMode === 'string') {
        state.mode = event.permissionMode
        state.rev = ++rev
        return
      }
      if (event.subtype === 'task_started' && event.tool_use_id) {
        tasks.set(event.tool_use_id, { taskId: event.task_id, description: event.description ?? '' })
        const tool = tools.get(event.tool_use_id)
        if (tool) {
          tool.agent = true
          tool.status = 'pending'
          touch(tool)
        }
        return
      }
      if (event.subtype === 'background_tasks_changed' && Array.isArray(event.tasks)) {
        state.agents = event.tasks.filter((task) => task?.task_type === 'local_agent' || task?.task_type === undefined).length
        state.rev = ++rev
        return
      }
      if (event.subtype === 'task_notification') {
        const tool = tools.get(event.tool_use_id)
        const description = event.summary || tasks.get(event.tool_use_id)?.description || tool?.summary || 'Agent'
        const finished = event.status === 'completed'
        if (tool) {
          tool.status = finished ? 'ok' : 'error'
          touch(tool)
        }
        const verb = finished ? 'finished' : event.status === 'failed' ? 'failed' : 'stopped'
        add({ kind: 'notice', text: `Agent "${description}" ${verb}` })
      }
    }

    function resolvePending(behavior) {
      for (const row of rows) {
        if (row.kind === 'permission' && !row.resolved) {
          row.resolved = behavior
          touch(row)
        }
      }
    }

    function apply(event) {
      if (!event || typeof event !== 'object') return
      const parentId = typeof event.parent_tool_use_id === 'string' ? event.parent_tool_use_id : null
      switch (event.type) {
        case 'system':
          systemEvent(event)
          return
        case 'stream_event':
          streamEvent(event, parentId)
          return
        case 'assistant': {
          const message = event.message ?? {}
          const content = Array.isArray(message.content) ? message.content : []
          for (const block of content) contentBlock(block, message.id, parentId)
          return
        }
        case 'user':
          if (event.claudseq === 'echo') {
            state.busy = true
            state.rev = ++rev
          }
          userMessage(event, parentId)
          return
        case 'control_request':
          if (event.request?.subtype !== 'can_use_tool') return
          add({
            key: `permission:${event.request_id}`,
            kind: 'permission',
            requestId: event.request_id,
            toolName: event.request.tool_name ?? 'Tool',
            displayName: event.request.display_name ?? event.request.tool_name ?? 'Tool',
            description: event.request.description ?? '',
            input: event.request.input ?? {},
            preview: describeInput(event.request.tool_name, event.request.input),
            canAlways: Array.isArray(event.request.permission_suggestions) && event.request.permission_suggestions.length > 0,
            resolved: null
          })
          return
        case 'control_cancel_request': {
          const row = byKey.get(`permission:${event.request_id}`)
          if (row && !row.resolved) {
            row.resolved = 'cancelled'
            touch(row)
          }
          return
        }
        case 'claudseq':
          if (event.subtype === 'permission_resolved') {
            const row = byKey.get(`permission:${event.request_id}`)
            if (row) {
              row.resolved = event.behavior
              row.always = event.always === true
              touch(row)
            }
          } else if (event.subtype === 'exited') {
            state.busy = false
            state.agents = 0
            state.rev = ++rev
            resolvePending('cancelled')
            if (event.error === 'claude_not_found') add({ kind: 'footer', error: true, text: 'claude could not be started: it was not found where the bridge expects it.' })
            else if (event.code && event.code !== 0 && event.signal !== 'SIGTERM') {
              add({ kind: 'footer', error: true, text: `Claude exited with code ${event.code}${event.stderr ? `: ${event.stderr.split('\n').pop()}` : ''}` })
            }
          }
          return
        case 'result': {
          state.busy = false
          state.rev = ++rev
          resolvePending('cancelled')
          for (const row of byKey.values()) {
            if ((row.kind === 'text' || row.kind === 'thinking') && row.streaming) {
              row.streaming = false
              touch(row)
            }
          }
          const failed = event.is_error === true || (event.subtype && event.subtype !== 'success')
          if (!failed) return
          const aborted = typeof event.terminal_reason === 'string' && event.terminal_reason.startsWith('aborted')
          const last = rows[rows.length - 1]
          if (aborted && last?.kind === 'footer' && last.text === 'Interrupted') return
          add({
            kind: 'footer',
            error: !aborted,
            text: aborted ? 'Interrupted' : (typeof event.result === 'string' && event.result.trim()) || (Array.isArray(event.errors) && event.errors.join('; ')) || `Turn failed (${event.subtype})`
          })
          return
        }
        default:
      }
    }

    /* A past session, read from its transcript. Subagent records arrive
     * separately, grouped by the Agent call that started them. */
    function loadTranscript(records, agents) {
      for (const record of Array.isArray(records) ? records : []) {
        if (record?.isSidechain) continue
        apply({ type: record.type, message: record.message, isCompactSummary: record.isCompactSummary, parent_tool_use_id: null })
      }
      for (const [toolUseId, agent] of Object.entries(agents && typeof agents === 'object' ? agents : {})) {
        const tool = tools.get(toolUseId)
        if (!tool) continue
        tool.agent = true
        if (tool.status === 'pending') tool.status = 'ok'
        for (const record of Array.isArray(agent?.records) ? agent.records : []) {
          apply({ type: record.type, message: record.message, parent_tool_use_id: toolUseId })
        }
        touch(tool)
      }
      /* Anything a transcript left pending was never going to finish. */
      for (const tool of tools.values()) {
        if (tool.status === 'pending' && tool.output !== null) {
          tool.status = 'ok'
          touch(tool)
        }
      }
    }

    return { rows, state, apply, loadTranscript }
  }

  return { create, summarize, describeInput, promptText, relativePath }
})()
