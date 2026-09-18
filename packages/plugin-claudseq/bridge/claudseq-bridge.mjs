#!/usr/bin/env node
/* Claudseq bridge: the one process that runs the local `claude` CLI for the
 * Claudseq pane in Logseq's left sidebar.
 *
 * A Logseq plugin can neither start a process nor read one's output. The
 * host's `runCli` IPC runs only commands on a user-configured allowlist,
 * through a shell, and resolves with the exit code alone, and neither
 * `logseq.Request` nor `httpRequest` can stream. So the pane talks to this
 * script over HTTP instead, and this script talks to `claude` over its
 * headless stream-json protocol — the same one the Claude Agent SDK and the
 * VS Code extension use.
 *
 * What keeps that safe is narrow on purpose:
 *
 * - The server listens on 127.0.0.1 only and answers only a request whose
 *   `Host` is exactly `127.0.0.1:<port>`, so a page that rebinds a DNS name to
 *   loopback gets nothing.
 * - Every request other than a CORS preflight carries `Authorization: Bearer
 *   <token>`. The token is 32 random bytes in `~/.claudseq/bridge.json`, which
 *   is mode 0600; the pane reads it through the host's own file IPC, and a web
 *   page cannot read it at all. It is compared in constant time.
 * - CORS admits one origin, `file://`: an `effect: true` plugin shares the
 *   Logseq window's origin, and that window is loaded from a file URL.
 * - `claude` is started from an argv array, never a shell, in the working
 *   directory the pane names. Prompt text reaches it only as a stream-json
 *   message on stdin, and `bypassPermissions` is never passed or granted.
 * - Children die when their session closes, when no pane has been attached
 *   for the idle timeout, and when this process shuts down.
 *
 * History is Claude Code's own: transcripts under `~/.claude/projects`, read
 * and never written. Sessions started here are ordinary Claude Code sessions
 * that `claude --resume` and the VS Code extension list too.
 *
 * Usage:
 *   node claudseq-bridge.mjs install [--port <n>]
 *   node claudseq-bridge.mjs uninstall
 *   node claudseq-bridge.mjs status
 *   node claudseq-bridge.mjs serve
 */

import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, copyFile, mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION = '0.1.0'
export const ALLOWED_ORIGIN = 'file://'
export const ENTRYPOINT = 'logseq-claudseq'
export const LABEL = 'io.github.handled57.logseq-claudseq'
export const DEFAULT_PORT = 47816
export const CONFIG_FILE = 'bridge.json'

/* Manual goes by two names. `--permission-mode` accepts `manual` and not
 * `default`, yet every answer the CLI gives — init, status and the reply to
 * set_permission_mode — calls it `default`. The pane speaks `default`; what
 * is sent to the CLI says `manual`. `bypassPermissions` is in neither list. */
export const MODES = ['default', 'manual', 'acceptEdits', 'plan', 'auto', 'dontAsk']

export function cliMode(mode) {
  return mode === 'default' ? 'manual' : mode
}

function paneMode(mode) {
  return mode === 'manual' ? 'default' : mode
}

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/
const MAX_BODY = 1024 * 1024
const MAX_PROMPT = 200_000
const MAX_EVENTS = 5000
const MAX_TRANSCRIPT = 64 * 1024 * 1024
const MAX_TOOL_TEXT = 20_000
const HEAD_BYTES = 64 * 1024
const TAIL_BYTES = 256 * 1024
const DENY_MESSAGE = 'The user denied this in Claudseq.'

/* Variables a parent Claude Code session leaves in the environment. A bridge
 * started from a terminal inside one must not make every child look nested:
 * a nested session is not persisted, and would never reach history. */
const INHERITED = ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SSE_PORT', 'TRACEPARENT', 'TRACESTATE', 'NODE_OPTIONS']

class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

/* ------------------------------------------------------------------ claude */

/* `--permission-prompts host` alone does not route a prompt to the host: in
 * print mode nothing answers, and the tool is denied. The SDK's own spawn adds
 * `--permission-prompt-tool stdio`, which is what sends `can_use_tool` to
 * stdout. `--thinking-display summarized` is what puts the text in a thinking
 * block; without it the block arrives empty. */
export function claudeArgs({ sessionId, resume, model, effort, mode }) {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompt-tool', 'stdio',
    '--permission-prompts', 'host',
    '--thinking-display', 'summarized',
    '--permission-mode', cliMode(mode)
  ]
  if (model) args.push('--model', model)
  if (effort) args.push('--effort', effort)
  if (resume) args.push('--resume', resume)
  else args.push('--session-id', sessionId)
  return args
}

/* Headless `-p` records its sessions as `sdk-cli`, and both the CLI's resume
 * picker and the VS Code extension hide `sdk-*` sessions from history. An
 * entrypoint of Claudseq's own keeps its sessions ordinary. */
export function childEnv(base) {
  const env = { ...base, CLAUDE_CODE_ENTRYPOINT: ENTRYPOINT }
  for (const key of INHERITED) delete env[key]
  return env
}

/* A suggestion is only ever granted for this session. `localSettings` would
 * write `.claude/settings.local.json` into the graph folder, and a suggestion
 * to switch to bypassPermissions is dropped rather than rewritten. */
export function sessionScoped(suggestions) {
  return (Array.isArray(suggestions) ? suggestions : [])
    .filter((entry) => entry && typeof entry === 'object')
    .filter((entry) => !(entry.type === 'setMode' && entry.mode === 'bypassPermissions'))
    .map((entry) => ({ ...entry, destination: 'session' }))
}

class Session {
  constructor(bridge, { cwd, resume, model, effort, mode }) {
    this.bridge = bridge
    this.id = randomUUID()
    this.claudeSessionId = resume ?? randomUUID()
    this.resumed = Boolean(resume)
    this.cwd = cwd
    this.model = model ?? null
    this.effort = effort ?? null
    this.mode = paneMode(mode)
    this.events = []
    this.seq = 0
    this.turnSeq = 0
    this.turnStartedAt = null
    this.busy = false
    this.pending = new Map()
    this.streams = new Set()
    this.stdout = ''
    this.stderr = ''
    this.closed = false
    this.idleTimer = null
    this.args = claudeArgs({ sessionId: this.claudeSessionId, resume, model, effort, mode })

    this.child = spawn(bridge.claudePath, this.args, {
      cwd,
      env: childEnv(bridge.env),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.pid = this.child.pid
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => this.onStdout(chunk))
    this.child.stderr.on('data', (chunk) => { this.stderr = (this.stderr + chunk).slice(-4096) })
    this.child.stdin.on('error', () => {})

    this.exited = new Promise((settle) => {
      let done = false
      const finish = (code, signal, error) => {
        if (done) return
        done = true
        this.closed = true
        this.busy = false
        clearTimeout(this.idleTimer)
        this.emit({ type: 'claudseq', subtype: 'exited', code, signal, error: error ?? null, stderr: this.stderr.trim() })
        for (const res of this.streams) res.end()
        this.streams.clear()
        bridge.sessions.delete(this.id)
        settle({ code, signal })
      }
      this.child.on('error', (error) => finish(null, null, error.code === 'ENOENT' ? 'claude_not_found' : error.message))
      this.child.on('exit', (code, signal) => finish(code, signal))
    })

    this.armIdle()
  }

  summary() {
    return {
      id: this.id,
      pid: this.pid,
      claudeSessionId: this.claudeSessionId,
      cwd: this.cwd,
      model: this.model,
      effort: this.effort,
      mode: this.mode,
      busy: this.busy,
      seq: this.seq,
      turnSeq: this.turnSeq,
      turnStartedAt: this.turnStartedAt,
      pending: [...this.pending.keys()]
    }
  }

  onStdout(chunk) {
    this.stdout += chunk
    let newline
    while ((newline = this.stdout.indexOf('\n')) !== -1) {
      const line = this.stdout.slice(0, newline).trim()
      this.stdout = this.stdout.slice(newline + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        this.bridge.log(`unparseable line from claude: ${line.slice(0, 200)}`)
        continue
      }
      this.receive(message)
    }
  }

  receive(message) {
    if (!message || typeof message !== 'object') return
    if (message.type === 'control_request') {
      if (message.request?.subtype === 'can_use_tool') {
        this.pending.set(message.request_id, message.request)
      } else {
        /* Nothing else is configured to ask the host anything — no hooks, no
         * SDK MCP servers — and a request left unanswered would stall the
         * turn, so anything else is refused at once. */
        this.write({
          type: 'control_response',
          response: { subtype: 'error', request_id: message.request_id, error: `Claudseq does not handle ${message.request?.subtype}` }
        })
      }
    } else if (message.type === 'control_cancel_request') {
      this.pending.delete(message.request_id)
    } else if (message.type === 'system' && message.subtype === 'init') {
      if (typeof message.session_id === 'string') this.claudeSessionId = message.session_id
      if (typeof message.permissionMode === 'string') this.mode = message.permissionMode
      if (typeof message.model === 'string') this.model = message.model
    } else if (message.type === 'system' && message.subtype === 'status' && typeof message.permissionMode === 'string') {
      this.mode = paneMode(message.permissionMode)
    } else if (message.type === 'result') {
      this.busy = false
      this.pending.clear()
      /* A finished turn's partial chunks are all repeated by the complete
       * messages that followed them; only the current turn's are worth
       * replaying to a pane that reconnects. */
      this.events = this.events.filter((entry) => entry.event?.type !== 'stream_event')
    }
    this.emit(message)
  }

  emit(event) {
    const entry = { seq: ++this.seq, event }
    this.events.push(entry)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    const line = JSON.stringify(entry) + '\n'
    for (const res of this.streams) res.write(line)
  }

  write(message) {
    if (this.closed || !this.child.stdin.writable) throw new HttpError(409, 'session_closed')
    this.child.stdin.write(JSON.stringify(message) + '\n')
  }

  send(text) {
    const message = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
      session_id: ''
    }
    this.write(message)
    this.busy = true
    this.turnStartedAt = new Date().toISOString()
    this.turnSeq = this.seq + 1
    /* The CLI does not echo what it was sent, so the bridge does: a pane that
     * reconnects mid-turn sees the prompt that started it. */
    this.emit({ ...message, claudseq: 'echo' })
  }

  answer(requestId, { behavior, message, always }) {
    const request = this.pending.get(requestId)
    if (!request) throw new HttpError(404, 'no_such_request')
    let response
    if (behavior === 'allow') {
      response = { behavior: 'allow', updatedInput: request.input ?? {} }
      if (always) {
        const updated = sessionScoped(request.permission_suggestions)
        if (updated.length) response.updatedPermissions = updated
      }
    } else {
      response = { behavior: 'deny', message: message || DENY_MESSAGE }
    }
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
    this.pending.delete(requestId)
    this.emit({ type: 'claudseq', subtype: 'permission_resolved', request_id: requestId, behavior, always: Boolean(always) })
  }

  control(request) {
    const requestId = `claudseq-${randomUUID()}`
    this.write({ type: 'control_request', request_id: requestId, request })
    return requestId
  }

  attach(res, after) {
    for (const entry of this.events) {
      if (entry.seq > after) res.write(JSON.stringify(entry) + '\n')
    }
    if (this.closed) return res.end()
    this.streams.add(res)
    clearTimeout(this.idleTimer)
    res.on('close', () => {
      this.streams.delete(res)
      this.armIdle()
    })
  }

  armIdle() {
    clearTimeout(this.idleTimer)
    if (this.closed || this.streams.size) return
    this.idleTimer = setTimeout(() => this.onIdle(), this.bridge.idleMs)
    this.idleTimer.unref?.()
  }

  onIdle() {
    if (this.streams.size) return
    /* A turn still producing output is left to finish, because what it writes
     * is the transcript the next pane will read. A turn waiting on a
     * permission nobody is there to answer never will. */
    if (this.busy && this.pending.size === 0) return this.armIdle()
    this.close()
  }

  close() {
    if (!this.closed) {
      this.closed = true
      clearTimeout(this.idleTimer)
      try { this.child.stdin.end() } catch {}
      this.child.kill('SIGTERM')
      const kill = setTimeout(() => this.child.kill('SIGKILL'), this.bridge.killGraceMs)
      kill.unref?.()
      this.exited.then(() => clearTimeout(kill))
    }
    return this.exited
  }
}

/* ----------------------------------------------------------------- history */

/* Claude Code names a project folder after its working directory with every
 * character that is not a letter or a digit replaced by `-`. Very long paths
 * are cut short and suffixed, so a folder that starts with the first 200
 * characters also counts; every transcript is checked against its own
 * recorded `cwd` either way. */
export function projectDirName(cwd) {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

async function projectDirs(projectsDir, cwd) {
  const name = projectDirName(cwd)
  const entries = await readdir(projectsDir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name === name || (name.length > 200 && entry.name.startsWith(name.slice(0, 200))))
    .map((entry) => join(projectsDir, entry.name))
}

function parseLines(text, { dropFirst = false, dropLast = false } = {}) {
  const lines = text.split('\n')
  if (dropFirst) lines.shift()
  if (dropLast) lines.pop()
  const records = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      if (record && typeof record === 'object') records.push(record)
    } catch {
      /* A torn or hand-edited line is skipped, never fatal. */
    }
  }
  return records
}

/* The prompt a person typed, without the markup Claude Code wraps around
 * slash commands and reminders. */
export function promptText(record) {
  if (record?.type !== 'user' || record.isMeta || record.isCompactSummary) return null
  const content = record.message?.content
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    if (content.some((block) => block?.type === 'tool_result')) return null
    text = content.filter((block) => block?.type === 'text').map((block) => block.text).join('\n')
  }
  const command = /<command-name>([^<]*)<\/command-name>/.exec(text)
  if (command) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim()
    return [command[1].trim(), args].filter(Boolean).join(' ')
  }
  text = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-(?:stdout|stderr|caveat)>[\s\S]*?<\/local-command-(?:stdout|stderr|caveat)>/g, '')
    .trim()
  return text || null
}

function oneLine(text, limit = 200) {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}

function lastValue(records, type, field) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const value = records[index].type === type ? records[index][field] : undefined
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/* Custom title, then the AI title, then the first prompt. A session with
 * none of them but a recorded last prompt or summary falls back to those. */
export function titleOf(records) {
  const first = records.map(promptText).find(Boolean)
  const title = lastValue(records, 'custom-title', 'customTitle') ??
    lastValue(records, 'ai-title', 'aiTitle') ??
    first ??
    lastValue(records, 'last-prompt', 'lastPrompt') ??
    lastValue(records, 'summary', 'summary')
  return title ? oneLine(title) : null
}

async function readEnds(path, size) {
  if (size <= HEAD_BYTES + TAIL_BYTES) {
    return { head: parseLines(await readFile(path, 'utf8')), tail: [] }
  }
  const handle = await open(path, 'r')
  try {
    const head = Buffer.alloc(HEAD_BYTES)
    await handle.read(head, 0, HEAD_BYTES, 0)
    const tail = Buffer.alloc(TAIL_BYTES)
    await handle.read(tail, 0, TAIL_BYTES, size - TAIL_BYTES)
    return {
      head: parseLines(head.toString('utf8'), { dropLast: true }),
      tail: parseLines(tail.toString('utf8'), { dropFirst: true })
    }
  } finally {
    await handle.close()
  }
}

async function summarize(path, id, cwd) {
  const info = await stat(path)
  const { head, tail } = await readEnds(path, info.size)
  const first = head[0]
  if (!first || first.isSidechain === true) return null
  const recordedCwd = head.find((record) => typeof record.cwd === 'string')?.cwd
  if (recordedCwd !== cwd) return null
  const records = [...head, ...tail]
  const title = titleOf(records)
  if (!title) return null
  return {
    id,
    title,
    updated: info.mtimeMs,
    entrypoint: [...head, ...tail].find((record) => typeof record.entrypoint === 'string')?.entrypoint ?? null
  }
}

export async function listHistory(projectsDir, cwd) {
  const found = []
  for (const dir of await projectDirs(projectsDir, cwd)) {
    const names = (await readdir(dir).catch(() => [])).filter((name) => UUID.test(name.replace(/\.jsonl$/, '')) && name.endsWith('.jsonl'))
    for (const name of names) {
      const summary = await summarize(join(dir, name), name.slice(0, -6), cwd).catch(() => null)
      if (summary) found.push(summary)
    }
  }
  return found.sort((a, b) => b.updated - a.updated)
}

function clip(text) {
  return text.length > MAX_TOOL_TEXT ? `${text.slice(0, MAX_TOOL_TEXT)}\n… (${text.length - MAX_TOOL_TEXT} more characters)` : text
}

/* What the pane draws from a transcript record, and nothing it does not:
 * thinking signatures, images and oversized tool output stay behind. */
function slimMessage(message) {
  if (!message || typeof message !== 'object') return null
  const content = message.content
  if (typeof content === 'string') return { role: message.role, id: message.id, content: clip(content) }
  if (!Array.isArray(content)) return null
  return {
    role: message.role,
    id: message.id,
    content: content.map((block) => {
      if (block?.type === 'thinking') return { type: 'thinking', thinking: block.thinking ?? '' }
      if (block?.type === 'tool_result') {
        const inner = typeof block.content === 'string'
          ? clip(block.content)
          : Array.isArray(block.content)
            ? block.content.map((part) => part?.type === 'text' ? { type: 'text', text: clip(part.text ?? '') } : { type: 'text', text: `[${part?.type ?? 'content'}]` })
            : ''
        return { type: 'tool_result', tool_use_id: block.tool_use_id, is_error: Boolean(block.is_error), content: inner }
      }
      if (block?.type === 'image') return { type: 'text', text: '[image]' }
      if (block?.type === 'text') return { type: 'text', text: clip(block.text ?? '') }
      return block
    })
  }
}

function slimRecords(records) {
  const seen = new Set()
  const kept = []
  for (const record of records) {
    if (record.type !== 'user' && record.type !== 'assistant') continue
    if (record.isMeta) continue
    if (record.uuid && seen.has(record.uuid)) continue
    if (record.uuid) seen.add(record.uuid)
    const message = slimMessage(record.message)
    if (!message) continue
    kept.push({
      type: record.type,
      uuid: record.uuid ?? null,
      timestamp: record.timestamp ?? null,
      isSidechain: record.isSidechain === true,
      isCompactSummary: record.isCompactSummary === true,
      message
    })
  }
  return kept
}

export async function readTranscript(projectsDir, cwd, id) {
  if (!UUID.test(id)) throw new HttpError(400, 'bad_session_id')
  for (const dir of await projectDirs(projectsDir, cwd)) {
    const path = join(dir, `${id}.jsonl`)
    const info = await stat(path).catch(() => null)
    if (!info) continue
    if (info.size > MAX_TRANSCRIPT) throw new HttpError(413, 'transcript_too_large')
    const all = parseLines(await readFile(path, 'utf8'))
    const recordedCwd = all.find((record) => typeof record.cwd === 'string')?.cwd
    if (recordedCwd !== cwd) continue

    /* Subagents keep their own transcripts beside the session's, each with a
     * small meta file naming the Agent call that started it. */
    const agents = {}
    const subagents = join(dir, id, 'subagents')
    for (const name of await readdir(subagents).catch(() => [])) {
      const match = /^agent-([A-Za-z0-9]+)\.meta\.json$/.exec(name)
      if (!match) continue
      const meta = await readFile(join(subagents, name), 'utf8').then(JSON.parse).catch(() => null)
      if (typeof meta?.toolUseId !== 'string') continue
      const agentRecords = parseLines(await readFile(join(subagents, `agent-${match[1]}.jsonl`), 'utf8').catch(() => ''))
      agents[meta.toolUseId] = {
        description: typeof meta.description === 'string' ? meta.description : null,
        agentType: typeof meta.agentType === 'string' ? meta.agentType : null,
        records: slimRecords(agentRecords)
      }
    }

    return { id, cwd, title: titleOf(all), records: slimRecords(all.filter((record) => record.isSidechain !== true)), agents }
  }
  throw new HttpError(404, 'no_such_session')
}

/* ------------------------------------------------------------------ server */

function tokenMatches(expected, header) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const digest = (value) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(header.slice(7)), digest(expected))
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  }
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new HttpError(413, 'body_too_large')
    chunks.push(chunk)
  }
  if (!size) return {}
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
    return body
  } catch {
    throw new HttpError(400, 'bad_json')
  }
}

async function checkCwd(cwd) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new HttpError(400, 'bad_cwd')
  const info = await stat(cwd).catch(() => null)
  if (!info?.isDirectory()) throw new HttpError(400, 'bad_cwd')
  return cwd
}

function checkMode(mode) {
  if (mode === undefined || mode === null || mode === '') return 'default'
  if (!MODES.includes(mode)) throw new HttpError(400, 'bad_mode')
  return mode
}

function checkModel(model) {
  if (model === undefined || model === null || model === '') return null
  if (typeof model !== 'string' || !MODEL.test(model)) throw new HttpError(400, 'bad_model')
  return model
}

function checkEffort(effort) {
  if (effort === undefined || effort === null || effort === '') return null
  if (!EFFORTS.includes(effort)) throw new HttpError(400, 'bad_effort')
  return effort
}

async function executable(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) return false
  return access(path, constants.X_OK).then(() => true, () => false)
}

export function createBridge({
  token,
  port = 0,
  claudePath,
  projectsDir,
  env = process.env,
  allowedOrigin = ALLOWED_ORIGIN,
  idleMs = 30 * 60 * 1000,
  killGraceMs = 3000,
  heartbeatMs = 20_000,
  maxSessions = 8,
  log = (line) => console.error(`${new Date().toISOString()} [claudseq] ${line}`)
}) {
  if (typeof token !== 'string' || token.length < 16) throw new Error('the bridge needs a token of at least 16 characters')

  const bridge = {
    claudePath,
    projectsDir,
    env,
    idleMs,
    killGraceMs,
    log,
    sessions: new Map(),
    expectedHost: null,
    server: null,
    listen,
    close
  }

  const session = (id) => {
    const found = bridge.sessions.get(id)
    if (!found) throw new HttpError(404, 'no_such_session')
    return found
  }

  async function route(req, res, url, cors) {
    const parts = url.pathname.split('/').filter(Boolean)
    const method = req.method
    if (parts[0] !== 'v1') throw new HttpError(404, 'not_found')

    if (parts.length === 2 && parts[1] === 'health' && method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        version: VERSION,
        pid: process.pid,
        sessions: bridge.sessions.size,
        claudePath,
        claudeFound: await executable(claudePath)
      }, cors)
    }

    if (parts.length === 2 && parts[1] === 'history' && method === 'GET') {
      const cwd = url.searchParams.get('cwd')
      if (!cwd || !isAbsolute(cwd)) throw new HttpError(400, 'bad_cwd')
      return sendJson(res, 200, { cwd, sessions: await listHistory(projectsDir, cwd) }, cors)
    }

    if (parts.length === 2 && parts[1] === 'transcript' && method === 'GET') {
      const cwd = url.searchParams.get('cwd')
      if (!cwd || !isAbsolute(cwd)) throw new HttpError(400, 'bad_cwd')
      return sendJson(res, 200, await readTranscript(projectsDir, cwd, url.searchParams.get('id') ?? ''), cors)
    }

    if (parts[1] !== 'sessions') throw new HttpError(404, 'not_found')

    if (parts.length === 2 && method === 'GET') {
      return sendJson(res, 200, { sessions: [...bridge.sessions.values()].map((entry) => entry.summary()) }, cors)
    }

    if (parts.length === 2 && method === 'POST') {
      const body = await readBody(req)
      const cwd = await checkCwd(body.cwd)
      const mode = checkMode(body.mode)
      const model = checkModel(body.model)
      const effort = checkEffort(body.effort)
      const resume = body.resume === undefined || body.resume === null || body.resume === '' ? null : body.resume
      if (resume !== null && (typeof resume !== 'string' || !UUID.test(resume))) throw new HttpError(400, 'bad_session_id')

      /* Two processes appending to one transcript would interleave it, so a
       * session already running is handed back rather than started again. */
      if (resume) {
        const running = [...bridge.sessions.values()].find((entry) => entry.claudeSessionId === resume && !entry.closed)
        if (running) return sendJson(res, 200, running.summary(), cors)
      }
      if (!(await executable(claudePath))) throw new HttpError(424, 'claude_not_found', { claudePath })
      if (bridge.sessions.size >= maxSessions) throw new HttpError(429, 'too_many_sessions')

      const created = new Session(bridge, { cwd, resume, model, effort, mode })
      bridge.sessions.set(created.id, created)
      log(`session ${created.id} started claude pid ${created.pid} (${resume ? `resume ${resume}` : `new ${created.claudeSessionId}`})`)
      return sendJson(res, 201, created.summary(), cors)
    }

    const target = session(parts[2])

    if (parts.length === 3 && method === 'DELETE') {
      await target.close()
      return sendJson(res, 200, { closed: true }, cors)
    }

    if (parts.length === 4 && parts[3] === 'events' && method === 'GET') {
      const after = Number.parseInt(url.searchParams.get('after') ?? '0', 10)
      res.writeHead(200, {
        ...cors,
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      })
      res.flushHeaders?.()
      const heartbeat = setInterval(() => res.write('{"heartbeat":true}\n'), heartbeatMs)
      heartbeat.unref?.()
      res.on('close', () => clearInterval(heartbeat))
      return target.attach(res, Number.isFinite(after) ? after : 0)
    }

    if (parts.length === 4 && method === 'POST') {
      const body = await readBody(req)
      if (parts[3] === 'messages') {
        if (typeof body.text !== 'string' || !body.text.trim()) throw new HttpError(400, 'bad_text')
        if (body.text.length > MAX_PROMPT) throw new HttpError(413, 'text_too_long')
        target.send(body.text)
        return sendJson(res, 202, { accepted: true, seq: target.seq }, cors)
      }
      if (parts[3] === 'permissions') {
        if (typeof body.requestId !== 'string') throw new HttpError(400, 'bad_request_id')
        if (body.behavior !== 'allow' && body.behavior !== 'deny') throw new HttpError(400, 'bad_behavior')
        const message = typeof body.message === 'string' ? body.message.slice(0, 2000) : ''
        target.answer(body.requestId, { behavior: body.behavior, message, always: body.always === true })
        return sendJson(res, 200, { answered: true }, cors)
      }
      if (parts[3] === 'interrupt') {
        return sendJson(res, 202, { requestId: target.control({ subtype: 'interrupt' }) }, cors)
      }
      if (parts[3] === 'settings') {
        const sent = []
        if (body.mode !== undefined) {
          const mode = checkMode(body.mode)
          sent.push(target.control({ subtype: 'set_permission_mode', mode: cliMode(mode) }))
          target.mode = paneMode(mode)
        }
        if (body.model !== undefined) {
          const model = checkModel(body.model)
          sent.push(target.control({ subtype: 'set_model', model: model ?? 'default' }))
        }
        return sendJson(res, 202, { requestIds: sent }, cors)
      }
    }

    throw new HttpError(404, 'not_found')
  }

  async function handle(req, res) {
    const origin = req.headers.origin
    if (req.headers.host !== bridge.expectedHost) {
      log(`refused a request for host ${JSON.stringify(req.headers.host ?? null)}`)
      return sendJson(res, 403, { error: 'bad_host' })
    }
    if (origin !== undefined && origin !== allowedOrigin) {
      log(`refused a request from origin ${JSON.stringify(origin)}`)
      return sendJson(res, 403, { error: 'bad_origin' })
    }
    const cors = origin === allowedOrigin ? corsHeaders(origin) : {}

    if (req.method === 'OPTIONS') {
      const privateNetwork = req.headers['access-control-request-private-network'] === 'true'
        ? { 'Access-Control-Allow-Private-Network': 'true' }
        : {}
      res.writeHead(204, { ...cors, ...privateNetwork })
      return res.end()
    }

    if (!tokenMatches(token, req.headers.authorization)) return sendJson(res, 401, { error: 'unauthorized' }, cors)

    try {
      await route(req, res, new URL(req.url, `http://${bridge.expectedHost}`), cors)
    } catch (error) {
      if (res.headersSent) return res.end()
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.code, ...error.extra }, cors)
      log(`internal error: ${error?.stack ?? error}`)
      return sendJson(res, 500, { error: 'internal' }, cors)
    }
  }

  function listen() {
    return new Promise((settle, fail) => {
      bridge.server = createServer((req, res) => { handle(req, res) })
      bridge.server.once('error', fail)
      bridge.server.listen(port, '127.0.0.1', () => {
        const actual = bridge.server.address().port
        bridge.port = actual
        bridge.expectedHost = `127.0.0.1:${actual}`
        settle(actual)
      })
    })
  }

  async function close() {
    await Promise.all([...bridge.sessions.values()].map((entry) => entry.close()))
    if (bridge.server) {
      bridge.server.closeAllConnections?.()
      await new Promise((settle) => bridge.server.close(() => settle()))
    }
  }

  return bridge
}

/* --------------------------------------------------------------- commands */

export function stateDirectory(env = process.env) {
  return env.CLAUDSEQ_STATE_DIR ?? join(homedir(), '.claudseq')
}

export function projectsDirectory(env = process.env) {
  return env.CLAUDSEQ_PROJECTS_DIR ?? join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
}

export async function readConfig(stateDir) {
  const config = JSON.parse(await readFile(join(stateDir, CONFIG_FILE), 'utf8'))
  if (!Number.isInteger(config.port) || typeof config.token !== 'string' || typeof config.claudePath !== 'string') {
    throw new Error(`${join(stateDir, CONFIG_FILE)} is not a Claudseq bridge configuration`)
  }
  return config
}

function run(file, args, options = {}) {
  return new Promise((settle, fail) => {
    execFile(file, args, { timeout: 15_000, ...options }, (error, stdout, stderr) => {
      if (error) fail(Object.assign(error, { stdout, stderr }))
      else settle(String(stdout))
    })
  })
}

function xml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function launchAgentPlist({ label, node, script, path, home, log }) {
  const strings = (values) => values.map((value) => `\t\t<string>${xml(value)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${xml(label)}</string>
\t<key>ProgramArguments</key>
\t<array>
${strings([node, script, 'serve'])}
\t</array>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>PATH</key>
\t\t<string>${xml(path)}</string>
\t\t<key>HOME</key>
\t\t<string>${xml(home)}</string>
\t</dict>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>StandardOutPath</key>
\t<string>${xml(log)}</string>
\t<key>StandardErrorPath</key>
\t<string>${xml(log)}</string>
</dict>
</plist>
`
}

/* A LaunchAgent inherits launchd's PATH, not the login shell's, and Logseq
 * launched from the Dock inherits no better. Both are asked of the shell once,
 * here, and written down. */
async function loginShell(shell, command) {
  return (await run(shell, ['-lc', command]).catch(() => '')).trim()
}

async function findClaude(shell, loginPath) {
  const named = (await loginShell(shell, 'command -v claude')).split('\n').pop()?.trim()
  const candidates = [
    named,
    ...loginPath.split(delimiter).filter(Boolean).map((dir) => join(dir, 'claude')),
    join(homedir(), '.claude', 'local', 'claude'),
    join(homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ]
  for (const candidate of candidates) {
    if (candidate && await executable(candidate)) return candidate
  }
  return null
}

async function portIsFree(port) {
  return new Promise((settle) => {
    const probe = createServer()
    probe.once('error', () => settle(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => settle(true)))
  })
}

async function anyFreePort() {
  return new Promise((settle, fail) => {
    const probe = createServer()
    probe.once('error', fail)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => settle(port))
    })
  })
}

function option(args, name) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function agentPaths(env) {
  const agentsDir = env.CLAUDSEQ_LAUNCH_AGENTS_DIR ?? join(homedir(), 'Library', 'LaunchAgents')
  return { agentsDir, plist: join(agentsDir, `${LABEL}.plist`), launchctl: env.CLAUDSEQ_LAUNCHCTL ?? '/bin/launchctl' }
}

export async function install(args = [], env = process.env, out = console.log) {
  const stateDir = stateDirectory(env)
  const { agentsDir, plist, launchctl } = agentPaths(env)
  const shell = env.SHELL || '/bin/zsh'
  const loginPath = (await loginShell(shell, 'printf %s "$PATH"')) || env.PATH || '/usr/bin:/bin'
  const claudePath = env.CLAUDSEQ_CLAUDE ?? await findClaude(shell, loginPath)
  if (!claudePath) throw new Error('claude was not found on your login PATH. Install Claude Code, then run install again.')

  const previous = await readConfig(stateDir).catch(() => null)
  const requested = option(args, '--port')
  let port = requested === undefined ? previous?.port ?? DEFAULT_PORT : Number.parseInt(requested, 10)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`--port must be between 1024 and 65535, not ${requested}`)
  if (requested === undefined && port !== previous?.port && !(await portIsFree(port))) port = await anyFreePort()

  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  await chmod(stateDir, 0o700)
  const script = join(stateDir, 'claudseq-bridge.mjs')
  if (resolve(fileURLToPath(import.meta.url)) !== resolve(script)) await copyFile(fileURLToPath(import.meta.url), script)

  const configPath = join(stateDir, CONFIG_FILE)
  const config = { port, token: randomBytes(32).toString('hex'), claudePath, version: VERSION }
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  await chmod(configPath, 0o600)

  await mkdir(agentsDir, { recursive: true })
  await writeFile(plist, launchAgentPlist({
    label: LABEL,
    node: process.execPath,
    script,
    path: loginPath,
    home: env.HOME ?? homedir(),
    log: join(stateDir, 'bridge.log')
  }))

  const domain = `gui/${process.getuid()}`
  await run(launchctl, ['bootout', `${domain}/${LABEL}`]).catch(() => {})
  await run(launchctl, ['bootstrap', domain, plist])

  out(`Claudseq bridge ${VERSION} installed.`)
  out(`  claude:  ${claudePath}`)
  out(`  listens: http://127.0.0.1:${port} (loopback only)`)
  out(`  config:  ${configPath}`)
  out(`  agent:   ${plist}`)
  out('Reload Claudseq in Logseq, or open its pane, to connect.')
  return config
}

export async function uninstall(env = process.env, out = console.log) {
  const { plist, launchctl } = agentPaths(env)
  await run(launchctl, ['bootout', `gui/${process.getuid()}/${LABEL}`]).catch(() => {})
  await rm(plist, { force: true })
  await rm(stateDirectory(env), { recursive: true, force: true })
  out('Claudseq bridge removed: the login agent is unloaded and ~/.claudseq is deleted.')
}

export async function status(env = process.env, out = console.log) {
  const config = await readConfig(stateDirectory(env))
  const health = await new Promise((settle) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: config.port,
      path: '/v1/health',
      headers: { Authorization: `Bearer ${config.token}` },
      timeout: 3000
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => settle({ status: res.statusCode, text }))
    })
    req.on('error', (error) => settle({ error: error.message }))
    req.on('timeout', () => req.destroy(new Error('timed out')))
    req.end()
  })
  if (health.error || health.status !== 200) {
    out(`Claudseq bridge is not answering on 127.0.0.1:${config.port}: ${health.error ?? `HTTP ${health.status}`}`)
    return false
  }
  out(health.text)
  return true
}

async function serve(env = process.env) {
  const stateDir = stateDirectory(env)
  const config = await readConfig(stateDir)
  const bridge = createBridge({
    token: config.token,
    port: config.port,
    claudePath: env.CLAUDSEQ_CLAUDE ?? config.claudePath,
    projectsDir: projectsDirectory(env),
    env,
    idleMs: env.CLAUDSEQ_IDLE_MS ? Number(env.CLAUDSEQ_IDLE_MS) : undefined
  })
  await bridge.listen()
  bridge.log(`bridge ${VERSION} listening on ${bridge.expectedHost} (pid ${process.pid})`)
  let stopping = false
  const stop = async (signal) => {
    if (stopping) return
    stopping = true
    bridge.log(`${signal}: closing ${bridge.sessions.size} session(s)`)
    await bridge.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invoked) {
  const [command, ...rest] = process.argv.slice(2)
  const commands = {
    install: () => install(rest),
    uninstall: () => uninstall(),
    status: async () => { if (!(await status())) process.exitCode = 1 },
    serve: () => serve()
  }
  const selected = commands[command]
  if (!selected) {
    console.error('usage: claudseq-bridge.mjs install [--port <n>] | uninstall | status | serve')
    process.exitCode = 2
  } else {
    selected().catch((error) => {
      console.error(`claudseq-bridge ${command}: ${error.message}`)
      process.exitCode = 1
    })
  }
}
