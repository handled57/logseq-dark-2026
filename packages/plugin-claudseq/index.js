/* Claudseq: a Claude Code pane in Logseq's left sidebar.
 *
 * The pane sits below Favorites and Recent, where Block Calendar hangs its
 * widget, and looks and behaves like the Claude Code extension for VS Code: a
 * header with the session's title, a timeline of what Claude said and did, a
 * composer, and a history of past sessions that can be reopened and resumed.
 *
 * Claude itself runs in the Claudseq bridge (bridge/claudseq-bridge.mjs), a
 * small Node process that this script starts through the host's `runCli` and
 * that stops when Logseq quits. `runCli` starts only commands on Logseq's
 * allowlist, so the pane asks once before it adds Node to that list. This
 * script finds the bridge's port and token in `~/.claudseq/bridge.json`
 * through the host's own file IPC and talks to it over loopback HTTP; the
 * bridge runs `claude` and streams its events back. History is Claude Code's
 * own transcripts, which the bridge reads; Claudseq writes nothing to the
 * graph.
 *
 * What the pane remembers — whether it is folded, how tall it is, which
 * session was open, and the model, effort, permission mode, working directory
 * and Node path — goes through `logseq.updateSettings` into this plugin's
 * settings file under Logseq's dotdir, never into the graph.
 *
 * `parent.document` and `parent.apis` are reachable because package.json
 * declares `effect: true`, which keeps this entry on the Logseq window's own
 * `file://` origin — the one origin the bridge admits.
 */

const doc = parent.document

/* Everything this plugin writes into the host document is namespaced to
 * Claudseq, and all of it lives inside the pane's own element: no host node
 * outside the pane is annotated, so removing the pane removes it all. */
const STYLE_KEY = 'claudseq'
const PANE_ID = 'claudseq-pane'
const PANE_ATTR = 'data-claudseq-pane'
const PART_ATTR = 'data-claudseq-part'
const ACTION_ATTR = 'data-claudseq-action'
const ROW_ATTR = 'data-claudseq-row'
const KEY_ATTR = 'data-claudseq-key'
const VALUE_ATTR = 'data-claudseq-value'
const STATE_ATTR = 'data-claudseq-state'
const STATUS_ATTR = 'data-claudseq-status'
const COLLAPSED_ATTR = 'data-claudseq-collapsed'
const VIEW_ATTR = 'data-claudseq-view'
const HIDDEN_ATTR = 'data-claudseq-hidden'
const SELECTED_ATTR = 'data-claudseq-selected'
const ERROR_ATTR = 'data-claudseq-error'
const FAILURE_ATTR = 'data-claudseq-failure'
const HEIGHT_PROPERTY = '--claudseq-height'
const COMMAND_KEY = 'claudseq-focus'
const LOG_PREFIX = '[claudseq]'

const NAV_SELECTOR = '.nav-contents-container'
const PLACEHOLDER = '⌘ Esc to focus or unfocus Claude'

const MIN_HEIGHT = 240
const MAX_HEIGHT = 1600
/* However tall it was dragged, the pane takes at most this share of the
 * window, so Favorites and Recent above it stay in reach. */
const MAX_SHARE = 0.6
const PREVIEW_LINES = 12
const PREVIEW_CHARS = 1500
const RENDER_DELAY = 40

const MODELS = ['default', 'fable', 'opus', 'sonnet', 'haiku']
const EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max']
/* The order the mode button cycles through. Manual is `default` on the wire. */
const MODES = ['default', 'acceptEdits', 'plan', 'auto']
const MODE_LABELS = {
  default: 'Manual',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  auto: 'Auto',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass'
}
const EFFORT_LABELS = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }
const ENTRYPOINTS = {
  cli: 'CLI',
  'claude-vscode': 'VS Code',
  'logseq-claudseq': 'Claudseq',
  'claude-desktop': 'Desktop',
  mcp: 'MCP',
  'sdk-cli': 'SDK',
  'sdk-ts': 'SDK',
  'sdk-py': 'SDK'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEFAULTS = {
  paneCollapsed: false,
  paneHeight: 440,
  openSession: '',
  model: 'default',
  effort: 'default',
  permissionMode: 'default',
  workingDirectory: '',
  nodePath: ''
}

/* ---------------------------------------------------------------- settings */

/* Whatever the settings file holds, the pane gets a usable value for every
 * key: a missing, mistyped or hand-edited entry is its default. */
function readSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const height = typeof source.paneHeight === 'number' ? source.paneHeight : Number.NaN
  const directory = typeof source.workingDirectory === 'string' ? source.workingDirectory.trim() : ''
  const node = typeof source.nodePath === 'string' ? source.nodePath.trim() : ''
  return {
    paneCollapsed: source.paneCollapsed === true,
    paneHeight: Number.isFinite(height) ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(height))) : DEFAULTS.paneHeight,
    openSession: typeof source.openSession === 'string' && UUID.test(source.openSession) ? source.openSession : '',
    model: MODELS.includes(source.model) ? source.model : DEFAULTS.model,
    effort: EFFORTS.includes(source.effort) ? source.effort : DEFAULTS.effort,
    permissionMode: MODES.includes(source.permissionMode) ? source.permissionMode : DEFAULTS.permissionMode,
    workingDirectory: directory.startsWith('/') ? directory : '',
    nodePath: node.startsWith('/') ? node : ''
  }
}

function settingsSchema() {
  return [
    {
      key: 'workingDirectory',
      type: 'string',
      title: 'Working directory',
      description: 'The folder Claude works in. Leave empty to use the current graph\'s folder.',
      default: ''
    },
    {
      key: 'model',
      type: 'enum',
      title: 'Model for new sessions',
      description: 'Default uses whatever your Claude Code configuration chooses.',
      enumChoices: MODELS,
      enumPicker: 'select',
      default: DEFAULTS.model
    },
    {
      key: 'effort',
      type: 'enum',
      title: 'Effort for new sessions',
      description: 'How hard Claude thinks. Default uses Claude Code\'s own setting.',
      enumChoices: EFFORTS,
      enumPicker: 'select',
      default: DEFAULTS.effort
    },
    {
      key: 'permissionMode',
      type: 'enum',
      title: 'Permission mode for new sessions',
      description: 'default asks before edits and commands (Manual). The pane\'s mode button changes it too.',
      enumChoices: MODES,
      enumPicker: 'select',
      default: DEFAULTS.permissionMode
    },
    {
      key: 'nodePath',
      type: 'string',
      title: 'Node path',
      description: 'The Node.js, version 20 or later, that starts Claudseq\'s bridge. Leave empty to use Homebrew\'s, Volta\'s or MacPorts\'. With nvm, fnm or asdf, give the full path `which node` prints. It cannot contain spaces.',
      default: ''
    }
  ]
}

let settings = readSettings(null)

function saveSettings(patch) {
  settings = readSettings({ ...settings, ...patch })
  try {
    logseq.updateSettings(patch)
  } catch (error) {
    console.warn(LOG_PREFIX, 'could not save settings', error)
  }
}

/* ------------------------------------------------------------------ bridge */

const bridge = { config: null, state: 'connecting', claudePath: '', outdated: '', node: '', failure: null }

/* Where Node is looked for when the Node path setting is empty: Homebrew on
 * Apple silicon and on Intel, Volta, and MacPorts. */
const NODE_PLACES = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '~/.volta/bin/node', '/opt/local/bin/node']
/* `runCli` hands Logseq's shell the command as it is, unquoted, so a Node
 * path is used only when that shell would read it as one plain word. */
const PLAIN_COMMAND = /^\/[\w.@+/-]+$/
const START_WAIT = 15000
const START_POLL = 150
const LOG_PATH = '~/.claudseq/bridge.log'
const RETRY = ['retry', 'Retry']

function bridgeError(kind, detail = '') {
  const error = new Error(detail || kind)
  error.kind = kind
  return error
}

/* `parent.apis.doAction` is the host's IPC bridge. It resolves with whatever
 * its handler returned — `readFile` hands back null for a missing file, and a
 * failed `stat` hands back its error, rather than rejecting. */
async function doAction(call) {
  const apis = parent.apis
  if (typeof apis?.doAction !== 'function') throw bridgeError('app', 'Claudseq needs the Logseq desktop app')
  return apis.doAction(call)
}

let home = ''

async function homeDirectory() {
  if (home) return home
  const dotdir = await doAction(['getLogseqDotDirRoot'])
  if (typeof dotdir !== 'string' || !dotdir) throw bridgeError('app', 'Logseq did not say where its dotdir is')
  home = dotdir.replace(/[\\/]\.logseq[\\/]?$/, '')
  return home
}

async function loadConfig() {
  const text = await doAction(['readFile', `${await homeDirectory()}/.claudseq/bridge.json`])
  if (typeof text !== 'string' || !text.trim()) throw bridgeError('missing')
  let config
  try {
    config = JSON.parse(text)
  } catch {
    throw bridgeError('missing')
  }
  if (!Number.isInteger(config?.port) || typeof config?.token !== 'string') throw bridgeError('missing')
  bridge.config = { port: config.port, token: config.token }
  return bridge.config
}

async function api(method, path, body, retry = true) {
  const config = bridge.config ?? await loadConfig()
  let response
  try {
    response = await fetch(`http://127.0.0.1:${config.port}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })
  } catch (error) {
    throw bridgeError('down', error?.message ?? String(error))
  }
  /* A bridge that started again has a new token; one reread of the file
   * picks it up. */
  if (response.status === 401) {
    if (retry) {
      bridge.config = null
      return api(method, path, body, false)
    }
    throw bridgeError('unauthorized')
  }
  let json = null
  try {
    json = await response.json()
  } catch {
    json = null
  }
  if (!response.ok) {
    const error = bridgeError(json?.error === 'claude_not_found' ? 'noclaude' : 'request', json?.error ?? `HTTP ${response.status}`)
    error.status = response.status
    error.code = json?.error ?? null
    if (json?.claudePath) bridge.claudePath = json.claudePath
    throw error
  }
  return json
}

/* The session's events, as NDJSON over one long response. */
function openStream(liveId, after, onEntry, onEnd) {
  const controller = new AbortController()
  ;(async () => {
    try {
      const config = bridge.config ?? await loadConfig()
      const response = await fetch(`http://127.0.0.1:${config.port}/v1/sessions/${liveId}/events?after=${after}`, {
        headers: { Authorization: `Bearer ${config.token}` },
        signal: controller.signal
      })
      if (!response.ok || !response.body) throw bridgeError(response.status === 404 ? 'gone' : 'down', `HTTP ${response.status}`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (!line.trim()) continue
          let entry
          try {
            entry = JSON.parse(line)
          } catch {
            continue
          }
          if (entry && typeof entry.seq === 'number') onEntry(entry)
        }
      }
      if (!controller.signal.aborted) onEnd(null)
    } catch (error) {
      if (!controller.signal.aborted) onEnd(error)
    }
  })()
  return controller
}

/* Whether the bridge answers, with the token its file holds now: a bridge
 * that has just started has written a new one. */
async function health() {
  bridge.config = null
  return api('GET', '/v1/health')
}

function pause(ms) {
  return new Promise((settle) => parent.setTimeout(settle, ms))
}

function fail(kind, detail = {}) {
  bridge.state = 'failed'
  bridge.failure = { kind, ...detail }
  renderNow()
  return null
}

/* ----------------------------------------------------------- bridge start */

/* A stat that fails resolves with its error; only a real one carries a
 * numeric size. */
async function exists(path) {
  try {
    const found = await doAction(['stat', path])
    return typeof found?.size === 'number'
  } catch {
    return false
  }
}

async function findNode() {
  const root = await homeDirectory()
  if (settings.nodePath) {
    if (!PLAIN_COMMAND.test(settings.nodePath)) return { problem: 'node-unplain', path: settings.nodePath }
    return await exists(settings.nodePath) ? { node: settings.nodePath } : { problem: 'node-missing', path: settings.nodePath }
  }
  for (const place of NODE_PLACES) {
    const path = place.replace(/^~/, root)
    if (PLAIN_COMMAND.test(path) && await exists(path)) return { node: path }
  }
  return { problem: 'no-node' }
}

/* Logseq trims and lowercases both sides before it compares a command with
 * its allowlist. */
function sameCommand(one, other) {
  return String(one).trim().toLowerCase() === String(other).trim().toLowerCase()
}

/* The user's `:commands-allowlist` from Logseq's configs.edn: an empty list
 * when there is none, and null when it holds something Claudseq cannot
 * extend without losing part of it. */
async function allowlist() {
  const value = await doAction(['userAppCfgs', 'commands-allowlist'])
  if (value === null || value === undefined) return []
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? [...value] : null
}

/* The answer to the Allow button. Logseq's setter replaces the whole list,
 * so the list goes back whole with Node added; and the setter's own reply
 * can fail to cross the IPC after the write has succeeded, so what counts is
 * reading the entry back. */
async function allowNode() {
  const node = bridge.node
  if (!node) return
  try {
    const list = await allowlist()
    if (list === null) return fail('allowlist', { node })
    if (!list.some((entry) => sameCommand(entry, node))) {
      await doAction(['userAppCfgs', 'commands-allowlist', [...list, node]]).catch(() => {})
    }
    const saved = await allowlist()
    if (!saved?.some((entry) => sameCommand(entry, node))) return fail('allowlist', { node })
  } catch (error) {
    console.warn(LOG_PREFIX, 'could not add Node to the allowlist', error)
    return fail('allowlist', { node })
  }
  return connect()
}

function shellQuote(text) {
  return `'${String(text).replace(/'/g, "'\\''")}'`
}

function bridgeScriptPath() {
  const url = new URL('bridge/claudseq-bridge.mjs', location.href)
  if (url.protocol !== 'file:') throw bridgeError('app', `Claudseq is loaded from ${url.protocol}, not from a folder`)
  return decodeURIComponent(url.pathname)
}

async function lastLogLine() {
  try {
    const text = await doAction(['readFile', `${await homeDirectory()}/.claudseq/bridge.log`])
    if (typeof text !== 'string') return ''
    const lines = text.trim().split('\n')
    return oneLine((lines[lines.length - 1] ?? '').replace(/^\S+ \[claudseq\] /, ''), 300)
  } catch {
    return ''
  }
}

/* Start the bridge the one way a plugin can: through the host's `runCli`.
 * It runs the command line through Logseq's shell, so the script's path is
 * quoted, and resolves with the exit code once the command exits — for a
 * bridge that started, when Logseq quits. Until then the bridge's health is
 * asked for; an exit before it answers is a bridge that could not start,
 * unless it exited 0, having found another already answering. */
async function launch(node) {
  bridge.state = 'starting'
  renderNow()
  let exit
  doAction(['runCli', {
    command: node,
    args: `${shellQuote(bridgeScriptPath())} serve --until-stdin-closes`,
    returnResult: false
  }]).then((code) => { exit = typeof code === 'number' ? code : null }, () => { exit = null })
  const deadline = Date.now() + START_WAIT
  while (Date.now() < deadline) {
    await pause(START_POLL)
    try {
      return await health()
    } catch {
      if (exit !== undefined && exit !== 0) break
    }
  }
  return fail('start', { node, exit, log: await lastLogLine() })
}

async function startBridge() {
  let found
  try {
    found = await findNode()
    if (!found.node) return fail(found.problem, { path: found.path ?? '' })
    bridge.node = found.node
    const list = await allowlist()
    if (!list?.some((entry) => sameCommand(entry, found.node))) {
      bridge.state = 'consent'
      renderNow()
      return null
    }
    return await launch(found.node)
  } catch (error) {
    console.warn(LOG_PREFIX, 'could not start the bridge', error)
    return fail(error?.kind === 'app' ? 'app' : 'error', { message: error?.message ?? String(error) })
  }
}

/* ------------------------------------------------------------------- state */

let cwd = ''
let current = null
let view = 'timeline'
let historyItems = null
let historyError = ''
let historyQuery = ''
let historyMenu = null
let historyDirty = true
let toolbarKey = ''
let statusKey = ''
let menu = null
let pendingSend = false
let notice = ''
let savedEditingBlock = null
let renderTimer = null
let reconnectTimer = null
let stickToBottom = true
let pane = null
let parts = {}
let observer = null
const rowCache = new Map()
const expanded = new Set()

function newSession(claudeSessionId = null, title = '') {
  return {
    claudeSessionId,
    liveId: null,
    busy: false,
    title,
    timeline: ClaudseqTimeline.create({ cwd }),
    lastSeq: 0,
    stream: null
  }
}

/* ----------------------------------------------------------------- helpers */

function h(tag, attributes = {}, children = []) {
  const node = doc.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue
    if (name === 'class') for (const token of String(value).split(/\s+/).filter(Boolean)) node.classList.add(token)
    else if (name === 'text') node.textContent = String(value)
    else if (name === 'id') node.id = String(value)
    else node.setAttribute(name, value === true ? '' : String(value))
  }
  for (const child of children) if (child) node.appendChild(child)
  return node
}

function clear(node) {
  if (typeof node.replaceChildren === 'function') node.replaceChildren()
  else for (const child of [...node.children]) child.remove()
}

function show(node, visible) {
  if (visible) node.removeAttribute(HIDDEN_ATTR)
  else node.setAttribute(HIDDEN_ATTR, '')
}

const SVG = 'http://www.w3.org/2000/svg'
const ICONS = {
  chevron: ['M9 6l6 6l-6 6'],
  clock: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M12 7v5l3 3'],
  compose: ['M3 20l1.3 -3.9c-2.3 -3.4 -1.4 -7.9 2.1 -10.4c3.5 -2.5 8.6 -2.3 11.8 .5c3.3 2.8 3.7 7.3 1 10.5c-2.7 3.2 -7.6 4.2 -11.6 2.3l-4.6 1', 'M9 12h6', 'M12 9v6'],
  plus: ['M12 5v14', 'M5 12h14'],
  slash: ['M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z', 'M14 8l-4 8'],
  hand: ['M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5', 'M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5', 'M14 5.5a1.5 1.5 0 0 1 3 0v6.5', 'M17 7.5a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1 -6 6h-2h.2a6 6 0 0 1 -5 -2.7l-.2 -.3c-.3 -.5 -1.4 -2.4 -3.3 -5.7a1.5 1.5 0 0 1 .5 -2a1.9 1.9 0 0 1 2.3 .3l1.5 1.5'],
  up: ['M12 5v14', 'M18 11l-6 -6', 'M6 11l6 -6'],
  stop: ['M7 7h10v10h-10z'],
  dots: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  back: ['M15 6l-6 6l6 6']
}

function icon(name) {
  if (typeof doc.createElementNS !== 'function') return h('span', { class: 'claudseq-icon', 'aria-hidden': 'true' })
  const svg = doc.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', 'claudseq-icon')
  for (const d of ICONS[name] ?? []) {
    const path = doc.createElementNS(SVG, 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  }
  return svg
}

function iconButton(action, name, label, extra = {}) {
  return h('button', { class: 'claudseq-icon-button', type: 'button', [ACTION_ATTR]: action, 'aria-label': label, title: label, ...extra }, [icon(name)])
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

function modelLabel(model) {
  if (!model || model === 'default') return 'Default'
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(model)
  if (match) return `${capitalize(match[1])} ${match[2]}${match[3] ? `.${match[3]}` : ''}`
  return capitalize(model)
}

function relativeTime(ms) {
  const seconds = Math.max(0, (Date.now() - ms) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`
  return new Date(ms).toLocaleDateString()
}

function oneLine(text, limit = 120) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}

function clip(text, key) {
  const value = String(text ?? '')
  if (expanded.has(key)) return { text: value, more: false }
  const lines = value.split('\n')
  let shown = lines.slice(0, PREVIEW_LINES).join('\n')
  if (shown.length > PREVIEW_CHARS) shown = shown.slice(0, PREVIEW_CHARS)
  return { text: shown, more: shown.length < value.length }
}

/* -------------------------------------------------------------------- pane */

function buildPane() {
  const title = h('span', { class: 'claudseq-title', [PART_ATTR]: 'title', text: 'New session' })
  const header = h('div', { class: 'claudseq-header', [PART_ATTR]: 'header', [ACTION_ATTR]: 'fold', role: 'button', tabindex: '0', 'aria-label': 'Fold the Claudseq pane' }, [
    h('span', { class: 'claudseq-chevron', 'aria-hidden': 'true' }, [icon('chevron')]),
    title,
    iconButton('history', 'clock', 'Session history'),
    iconButton('new', 'compose', 'New session')
  ])

  const status = h('div', { class: 'claudseq-status', [PART_ATTR]: 'status', [HIDDEN_ATTR]: '' })
  const timeline = h('div', { class: 'claudseq-timeline', [PART_ATTR]: 'timeline', role: 'log', 'aria-live': 'polite' })
  const search = h('input', {
    class: 'claudseq-search',
    type: 'search',
    [PART_ATTR]: 'search',
    placeholder: 'Search sessions',
    'aria-label': 'Search sessions'
  })
  const historyList = h('div', { class: 'claudseq-history-list', [PART_ATTR]: 'history-list', role: 'list' })
  const history = h('div', { class: 'claudseq-history', [PART_ATTR]: 'history', [HIDDEN_ATTR]: '' }, [
    h('div', { class: 'claudseq-history-head' }, [iconButton('back', 'back', 'Back to the session'), search]),
    historyList
  ])
  const scroll = h('div', { class: 'claudseq-scroll', [PART_ATTR]: 'scroll' }, [status, timeline, history])

  const input = h('textarea', {
    class: 'claudseq-input',
    [PART_ATTR]: 'input',
    rows: '1',
    placeholder: PLACEHOLDER,
    'aria-label': 'Message Claude',
    spellcheck: 'false'
  })
  const menuBox = h('div', { class: 'claudseq-menu', [PART_ATTR]: 'menu', role: 'menu', [HIDDEN_ATTR]: '' })
  const agents = h('span', { class: 'claudseq-agents', [PART_ATTR]: 'agents', [HIDDEN_ATTR]: '' })
  const modelPill = h('button', { class: 'claudseq-pill', type: 'button', [ACTION_ATTR]: 'model', [PART_ATTR]: 'model', title: 'Model and effort' })
  const modeButton = h('button', { class: 'claudseq-pill claudseq-mode', type: 'button', [ACTION_ATTR]: 'mode', [PART_ATTR]: 'mode', title: 'Permission mode' })
  const send = h('button', { class: 'claudseq-send', type: 'button', [ACTION_ATTR]: 'send', [PART_ATTR]: 'send', [STATE_ATTR]: 'send', 'aria-label': 'Send', title: 'Send (Enter)' }, [icon('up')])
  const toolbar = h('div', { class: 'claudseq-toolbar', [PART_ATTR]: 'toolbar' }, [
    iconButton('mention', 'plus', 'Mention the current page'),
    iconButton('slash', 'slash', 'Slash commands'),
    agents,
    h('span', { class: 'claudseq-spacer' }),
    modelPill,
    modeButton,
    send
  ])
  const composer = h('div', { class: 'claudseq-composer', [PART_ATTR]: 'composer' }, [menuBox, input, toolbar])
  const resize = h('div', { class: 'claudseq-resize', [PART_ATTR]: 'resize', role: 'separator', 'aria-label': 'Resize the Claudseq pane', title: 'Drag to resize' })
  const body = h('div', { class: 'claudseq-body', [PART_ATTR]: 'body' }, [resize, scroll, composer])

  const root = h('section', { id: PANE_ID, class: 'claudseq-pane', [PANE_ATTR]: '', [VIEW_ATTR]: 'timeline', 'aria-label': 'Claudseq' }, [header, body])
  parts = { root, header, title, status, timeline, history, search, historyList, scroll, input, menu: menuBox, agents, modelPill, modeButton, send, body, resize }

  root.addEventListener('click', onClick)
  root.addEventListener('keydown', onKeyDown)
  root.addEventListener('input', onInput)
  root.addEventListener('mousedown', onMouseDown)
  scroll.addEventListener('scroll', () => {
    const { scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = scroll
    stickToBottom = scrollHeight - scrollTop - clientHeight < 48
  })
  return root
}

/* The pane goes right after Favorites and Recent, inside the sidebar's own
 * column, and is put back whenever Logseq re-renders that column. */
function mount() {
  const nav = doc.querySelector(NAV_SELECTOR)
  if (!nav?.parentElement || !pane) return false
  if (nav.nextElementSibling === pane) return true
  nav.parentElement.insertBefore(pane, nav.nextElementSibling)
  return true
}

function applyLayout() {
  if (!pane) return
  if (settings.paneCollapsed) pane.setAttribute(COLLAPSED_ATTR, '')
  else pane.removeAttribute(COLLAPSED_ATTR)
  pane.style.setProperty(HEIGHT_PROPERTY, `${settings.paneHeight}px`)
}

/* --------------------------------------------------------------- rendering */

function scheduleRender() {
  if (renderTimer !== null) return
  renderTimer = parent.setTimeout(() => {
    renderTimer = null
    render()
  }, RENDER_DELAY)
}

function renderNow() {
  if (renderTimer !== null) {
    parent.clearTimeout(renderTimer)
    renderTimer = null
  }
  render()
}

function sessionTitle() {
  if (!current) return 'New session'
  return oneLine(current.title || current.timeline.state.firstPrompt || 'New session', 200)
}

function render() {
  if (!pane) return
  applyLayout()
  pane.setAttribute(VIEW_ATTR, view)
  parts.title.textContent = sessionTitle()
  parts.title.setAttribute('title', sessionTitle())

  renderStatus()
  show(parts.timeline, view === 'timeline' && bridge.state === 'ready')
  show(parts.history, view === 'history' && bridge.state === 'ready')
  if (view === 'history') {
    if (historyDirty) renderHistory()
  } else {
    renderTimeline()
  }
  renderToolbar()
  renderMenu()
}

function renderStatus() {
  const box = parts.status
  /* Rebuilt only when what it says changes, so its Retry button is not
   * swapped out from under a click while a reply streams. */
  const key = JSON.stringify([bridge.state, bridge.failure, bridge.node, notice, bridge.claudePath, bridge.outdated])
  if (key === statusKey) return
  statusKey = key
  clear(box)
  const { lines = [], code = '', after = [], button = null } = statusContent()
  if (!lines.length && !notice) {
    show(box, false)
    return
  }
  show(box, true)
  box.setAttribute(STATE_ATTR, bridge.state)
  if (bridge.state === 'failed') box.setAttribute(FAILURE_ATTR, bridge.failure?.kind ?? '')
  else box.removeAttribute(FAILURE_ATTR)
  if (notice && bridge.state === 'ready') box.appendChild(h('p', { class: 'claudseq-status-line', [ERROR_ATTR]: '', text: notice }))
  for (const line of lines) box.appendChild(h('p', { class: 'claudseq-status-line', text: line }))
  if (code) box.appendChild(h('pre', { class: 'claudseq-command', [PART_ATTR]: 'command', text: code }))
  for (const line of after) box.appendChild(h('p', { class: 'claudseq-status-line', text: line }))
  if (button) {
    const [action, label, primary] = button
    box.appendChild(h('button', { class: primary ? 'claudseq-button claudseq-primary' : 'claudseq-button', type: 'button', [ACTION_ATTR]: action, text: label }))
  }
}

/* What the status box says in each state: lines, then a path or log line
 * set in monospace, then more lines, then one button. */
function statusContent() {
  switch (bridge.state) {
    case 'connecting':
      return { lines: ['Connecting to the Claudseq bridge…'] }
    case 'starting':
      return { lines: ['Starting the Claudseq bridge…'] }
    case 'consent':
      return {
        lines: ['Claudseq runs Claude Code through a small bridge, which it starts with Node. Logseq starts only the programs on its allowlist, so Node needs adding to it, once:'],
        code: bridge.node,
        after: ['Allow adds this path to :commands-allowlist in Logseq\'s configs.edn. Logseq then lets any plugin run Node, as it already lets them run Git.'],
        button: ['allow-node', 'Allow', true]
      }
    case 'down':
      return { lines: ['The Claudseq bridge stopped answering. Claudseq will start it again in a moment.'], button: RETRY }
    case 'noclaude':
      return {
        lines: [`The bridge could not find claude${bridge.claudePath ? ` at ${bridge.claudePath}` : ' on your login shell\'s PATH'}. Install Claude Code, then press Retry.`],
        button: RETRY
      }
    case 'nograph':
      return { lines: ['Open a graph, or set a working directory in Claudseq\'s settings, to start a session.'], button: RETRY }
    case 'ready':
      return bridge.outdated
        ? { lines: [`This bridge is version ${bridge.outdated} and Claudseq is ${logseq.baseInfo?.version}. Quit and reopen Logseq to start the new one.`] }
        : {}
    case 'failed':
      return failureContent(bridge.failure ?? {})
    default:
      return {}
  }
}

function failureContent(failure) {
  switch (failure.kind) {
    case 'app':
      return { lines: ['Claudseq needs the Logseq desktop app, loaded from a folder on this Mac.'] }
    case 'no-node':
      return {
        lines: ['Claudseq starts its bridge with Node.js 20 or later, and found none in:'],
        code: NODE_PLACES.join('\n'),
        after: ['Install Node, or set Node path in Claudseq\'s settings, then press Retry.'],
        button: RETRY
      }
    case 'node-missing':
      return {
        lines: ['There is no Node at the Node path in Claudseq\'s settings:'],
        code: failure.path,
        after: ['Correct the path, or clear it to look in the usual places, then press Retry.'],
        button: RETRY
      }
    case 'node-unplain':
      return {
        lines: ['Logseq starts Node through a shell, so the Node path cannot contain spaces or shell characters:'],
        code: failure.path,
        after: ['Set a path without them in Claudseq\'s settings — a symlink to Node works — then press Retry.'],
        button: RETRY
      }
    case 'allowlist':
      return {
        lines: ['Claudseq could not add Node to Logseq\'s allowlist. Add this path to :commands-allowlist in ~/Library/Application Support/Logseq/configs.edn, then quit and reopen Logseq:'],
        code: failure.node,
        button: RETRY
      }
    case 'error':
      return { lines: ['Claudseq could not start its bridge:'], code: failure.message, button: RETRY }
    default: {
      const why = typeof failure.exit === 'number' && failure.exit !== 0
        ? `The Claudseq bridge stopped as it started (exit code ${failure.exit}).`
        : failure.exit === null
          ? `Logseq did not start the Claudseq bridge with ${failure.node}. Quitting and reopening Logseq reloads its allowlist.`
          : `The Claudseq bridge did not answer within ${START_WAIT / 1000} seconds.`
      return {
        lines: [failure.log ? `${why} Its log says:` : why],
        code: failure.log,
        after: [`Check that ${failure.node || 'Node'} is Node.js 20 or later. The bridge logs to ${LOG_PATH}.`],
        button: RETRY
      }
    }
  }
}

function renderTimeline() {
  if (!current) return
  const nearBottom = stickToBottom
  const rows = current.timeline.rows
  const seen = new Set()
  let previous = null
  for (const row of rows) {
    seen.add(row.key)
    let cached = rowCache.get(row.key)
    if (!cached || cached.rev !== row.rev) {
      const element = renderRow(row)
      if (cached) cached.element.remove()
      cached = { rev: row.rev, element }
      rowCache.set(row.key, cached)
    }
    const expectedNext = previous ? previous.nextElementSibling : parts.timeline.children[0] ?? null
    if (expectedNext !== cached.element) parts.timeline.insertBefore(cached.element, previous ? previous.nextElementSibling : parts.timeline.children[0] ?? null)
    previous = cached.element
  }
  for (const [key, cached] of rowCache) {
    if (!seen.has(key)) {
      cached.element.remove()
      rowCache.delete(key)
    }
  }
  if (!rows.length) {
    if (!parts.timeline.children.length) {
      parts.timeline.appendChild(h('p', { class: 'claudseq-empty', [PART_ATTR]: 'empty', text: 'Ask Claude about this graph. It works in the graph\'s folder and asks before it edits.' }))
    }
  } else {
    for (const empty of parts.timeline.querySelectorAll(`[${PART_ATTR}="empty"]`)) empty.remove()
  }
  if (nearBottom && typeof parts.scroll.scrollHeight === 'number') parts.scroll.scrollTop = parts.scroll.scrollHeight
}

function markdown(text) {
  return ClaudseqMarkdown.render(doc, text, {
    onLink: (url) => {
      try {
        logseq.App.openExternalLink(url)
      } catch (error) {
        console.warn(LOG_PREFIX, 'could not open link', error)
      }
    }
  })
}

function ioRow(label, text, key) {
  const shown = clip(text, key)
  const cell = h('div', { class: 'claudseq-io-body' }, [h('pre', { class: 'claudseq-io-text', text: shown.text })])
  if (shown.more || expanded.has(key)) {
    cell.appendChild(h('button', {
      class: 'claudseq-link-button',
      type: 'button',
      [ACTION_ATTR]: 'expand',
      [KEY_ATTR]: key,
      text: expanded.has(key) ? 'Show less' : 'Show more'
    }))
  }
  return h('div', { class: 'claudseq-io-row' }, [h('span', { class: 'claudseq-io-label', text: label }), cell])
}

function renderRow(row) {
  const element = h('div', { class: 'claudseq-row', [ROW_ATTR]: row.kind, [KEY_ATTR]: row.key })
  switch (row.kind) {
    case 'user':
      element.appendChild(h('div', { class: 'claudseq-user', text: row.text }))
      break
    case 'thinking': {
      const open = expanded.has(`${row.key}:thinking`)
      const label = row.streaming ? 'Thinking…' : 'Thinking'
      if (row.text) {
        element.appendChild(h('button', {
          class: 'claudseq-thinking-toggle',
          type: 'button',
          [ACTION_ATTR]: 'expand',
          [KEY_ATTR]: `${row.key}:thinking`,
          'aria-expanded': open ? 'true' : 'false',
          text: label
        }))
        if (open) element.appendChild(h('div', { class: 'claudseq-thinking-text', text: row.text }))
      } else {
        element.appendChild(h('span', { class: 'claudseq-thinking-toggle', text: label }))
      }
      break
    }
    case 'text':
      element.appendChild(markdown(row.text))
      if (row.streaming) element.setAttribute(STATE_ATTR, 'streaming')
      break
    case 'tool':
      element.setAttribute(STATUS_ATTR, row.status)
      element.appendChild(h('div', { class: 'claudseq-tool-head' }, [
        h('span', { class: 'claudseq-tool-name', text: row.agent ? `${row.name ?? 'Agent'}:` : row.name ?? 'Tool' }),
        row.summary ? h('code', { class: 'claudseq-tool-summary', title: row.summary, text: row.summary }) : null
      ]))
      {
        const input = row.input ? ClaudseqTimeline.describeInput(row.name, row.input) : row.partialInput
        const io = h('div', { class: 'claudseq-io' })
        if (input) io.appendChild(ioRow('IN', input, `${row.key}:in`))
        if (row.output !== null && row.output !== undefined) io.appendChild(ioRow('OUT', row.output || '(no output)', `${row.key}:out`))
        if (io.children.length) element.appendChild(io)
      }
      if (row.children?.length) {
        const key = `${row.key}:steps`
        const open = expanded.has(key)
        element.appendChild(h('button', {
          class: 'claudseq-link-button claudseq-steps-toggle',
          type: 'button',
          [ACTION_ATTR]: 'expand',
          [KEY_ATTR]: key,
          'aria-expanded': open ? 'true' : 'false',
          text: `${open ? 'Hide' : 'Show'} ${row.children.length} agent step${row.children.length === 1 ? '' : 's'}`
        }))
        if (open) {
          const steps = h('div', { class: 'claudseq-timeline claudseq-steps' })
          for (const child of row.children) steps.appendChild(renderRow(child))
          element.appendChild(steps)
        }
      }
      break
    case 'notice':
      element.appendChild(h('span', { class: 'claudseq-notice', text: row.text }))
      break
    case 'permission':
      renderPermission(element, row)
      break
    case 'footer':
      element.appendChild(h('span', { class: 'claudseq-footer', [ERROR_ATTR]: row.error ? '' : null, text: row.text }))
      break
    default:
  }
  return element
}

function renderPermission(element, row) {
  if (row.resolved) {
    const verdict = row.resolved === 'allow'
      ? `Allowed ${row.displayName}${row.always ? ' for this session' : ''}`
      : row.resolved === 'deny' ? `Denied ${row.displayName}` : `${row.displayName} request withdrawn`
    element.setAttribute(STATE_ATTR, row.resolved)
    element.appendChild(h('span', { class: 'claudseq-notice', text: verdict }))
    return
  }
  element.setAttribute(STATE_ATTR, 'pending')
  const card = h('div', { class: 'claudseq-permission', role: 'group', 'aria-label': `Allow ${row.displayName}?` }, [
    h('div', { class: 'claudseq-permission-title', text: `Allow ${row.displayName}?` }),
    row.description ? h('div', { class: 'claudseq-permission-description', text: row.description }) : null,
    row.preview ? h('pre', { class: 'claudseq-io-text claudseq-permission-preview', text: clip(row.preview, `${row.key}:preview`).text }) : null,
    h('input', { class: 'claudseq-reason', type: 'text', [PART_ATTR]: 'reason', [KEY_ATTR]: row.key, placeholder: 'Reason for denying (optional)', 'aria-label': 'Reason for denying' }),
    h('div', { class: 'claudseq-permission-actions' }, [
      h('button', { class: 'claudseq-button claudseq-primary', type: 'button', [ACTION_ATTR]: 'allow', [KEY_ATTR]: row.key, text: 'Allow' }),
      row.canAlways ? h('button', { class: 'claudseq-button', type: 'button', [ACTION_ATTR]: 'allow-session', [KEY_ATTR]: row.key, text: 'Allow for this session' }) : null,
      h('button', { class: 'claudseq-button', type: 'button', [ACTION_ATTR]: 'deny', [KEY_ATTR]: row.key, text: 'Deny' })
    ])
  ])
  element.appendChild(card)
}

function renderToolbar() {
  const state = current?.timeline.state
  const busy = Boolean(current?.busy || state?.busy || pendingSend)
  const agents = state?.agents ?? 0
  const model = modelLabel(state?.model ?? settings.model)
  const effort = EFFORT_LABELS[settings.effort]
  const mode = state?.mode && current?.liveId ? state.mode : settings.permissionMode
  /* Rebuilt only when something on it changes: a Stop button replaced
   * between mousedown and mouseup would never be clicked. */
  const key = JSON.stringify([busy, agents, model, effort ?? null, mode])
  if (key === toolbarKey) return
  toolbarKey = key

  parts.send.setAttribute(STATE_ATTR, busy ? 'stop' : 'send')
  parts.send.setAttribute('aria-label', busy ? 'Stop' : 'Send')
  parts.send.setAttribute('title', busy ? 'Stop' : 'Send (Enter)')
  clear(parts.send)
  parts.send.appendChild(icon(busy ? 'stop' : 'up'))
  renderSendReady()

  show(parts.agents, agents > 0)
  clear(parts.agents)
  parts.agents.setAttribute('title', `${agents} background agent${agents === 1 ? '' : 's'} running`)
  parts.agents.appendChild(h('span', { class: 'claudseq-agents-dot', 'aria-hidden': 'true' }))
  parts.agents.appendChild(doc.createTextNode(String(agents)))
  parts.agents.appendChild(doc.createTextNode(' '))
  parts.agents.appendChild(h('span', { class: 'claudseq-agents-word', text: `agent${agents === 1 ? '' : 's'}` }))

  clear(parts.modelPill)
  parts.modelPill.setAttribute('title', `Model and effort: ${effort ? `${model} ${effort}` : model}`)
  parts.modelPill.appendChild(h('span', { text: model }))
  if (effort) {
    parts.modelPill.appendChild(doc.createTextNode(' '))
    parts.modelPill.appendChild(h('span', { class: 'claudseq-effort', text: effort }))
  }

  const modeLabel = MODE_LABELS[mode] ?? mode
  clear(parts.modeButton)
  parts.modeButton.appendChild(icon('hand'))
  parts.modeButton.appendChild(h('span', { class: 'claudseq-mode-label', text: modeLabel }))
  /* A narrow pane shows the hand alone; the mode is still named. */
  parts.modeButton.setAttribute('title', `Permission mode: ${modeLabel}`)
  parts.modeButton.setAttribute('aria-label', `Permission mode: ${modeLabel}`)
  parts.modeButton.setAttribute(VALUE_ATTR, mode)
}

/* Send has nothing to do while the composer is empty, and says so; Stop is
 * always live. */
function renderSendReady() {
  if (parts.send.getAttribute(STATE_ATTR) === 'send' && !(parts.input.value ?? '').trim()) parts.send.setAttribute('aria-disabled', 'true')
  else parts.send.removeAttribute('aria-disabled')
}

function renderMenu() {
  const box = parts.menu
  clear(box)
  if (!menu) {
    show(box, false)
    return
  }
  show(box, true)
  box.setAttribute(VALUE_ATTR, menu)
  if (menu === 'slash') {
    const commands = current?.timeline.state.slashCommands ?? []
    const filter = parts.input.value?.startsWith('/') ? parts.input.value.slice(1).split(/\s/)[0].toLowerCase() : ''
    const matches = commands.filter((name) => name.toLowerCase().includes(filter))
    if (!matches.length) {
      box.appendChild(h('div', { class: 'claudseq-menu-note', text: commands.length ? 'No matching commands' : 'Commands appear once a session has started.' }))
    }
    for (const name of matches.slice(0, 50)) {
      box.appendChild(h('button', { class: 'claudseq-menu-item', type: 'button', role: 'menuitem', [ACTION_ATTR]: 'slash-pick', [VALUE_ATTR]: name, text: `/${name}` }))
    }
    return
  }
  if (menu === 'model') {
    box.appendChild(h('div', { class: 'claudseq-menu-heading', text: 'Model' }))
    for (const model of MODELS) {
      box.appendChild(h('button', {
        class: 'claudseq-menu-item',
        type: 'button',
        role: 'menuitemradio',
        [ACTION_ATTR]: 'model-pick',
        [VALUE_ATTR]: model,
        [SELECTED_ATTR]: settings.model === model ? '' : null,
        'aria-checked': settings.model === model ? 'true' : 'false',
        text: modelLabel(model)
      }))
    }
    box.appendChild(h('div', { class: 'claudseq-menu-heading', text: 'Effort' }))
    for (const effort of EFFORTS) {
      box.appendChild(h('button', {
        class: 'claudseq-menu-item',
        type: 'button',
        role: 'menuitemradio',
        [ACTION_ATTR]: 'effort-pick',
        [VALUE_ATTR]: effort,
        [SELECTED_ATTR]: settings.effort === effort ? '' : null,
        'aria-checked': settings.effort === effort ? 'true' : 'false',
        text: EFFORT_LABELS[effort] ?? 'Default'
      }))
    }
    if (current?.liveId) box.appendChild(h('div', { class: 'claudseq-menu-note', text: 'A new effort applies from the next session.' }))
  }
}

function renderHistory() {
  historyDirty = false
  if (parts.search.value !== historyQuery) parts.search.value = historyQuery
  const list = parts.historyList
  clear(list)
  if (historyError) {
    list.appendChild(h('p', { class: 'claudseq-empty', [ERROR_ATTR]: '', text: historyError }))
    return
  }
  if (historyItems === null) {
    list.appendChild(h('p', { class: 'claudseq-empty', text: 'Loading sessions…' }))
    return
  }
  const query = historyQuery.trim().toLowerCase()
  const matches = historyItems.filter((item) => !query || item.title.toLowerCase().includes(query))
  if (!matches.length) {
    list.appendChild(h('p', { class: 'claudseq-empty', text: historyItems.length ? 'No sessions match.' : 'No sessions in this folder yet.' }))
    return
  }
  for (const item of matches) {
    const badge = ENTRYPOINTS[item.entrypoint] ?? (item.entrypoint ? item.entrypoint : null)
    const entry = h('div', {
      class: 'claudseq-history-item',
      role: 'listitem',
      [ACTION_ATTR]: 'open-session',
      [VALUE_ATTR]: item.id,
      [SELECTED_ATTR]: current?.claudeSessionId === item.id ? '' : null,
      tabindex: '0'
    }, [
      h('div', { class: 'claudseq-history-title', title: item.title, text: item.title }),
      h('div', { class: 'claudseq-history-meta' }, [
        h('span', { text: relativeTime(item.updated) }),
        badge ? h('span', { class: 'claudseq-badge', text: badge }) : null
      ]),
      iconButton('session-menu', 'dots', 'Session actions', { [VALUE_ATTR]: item.id })
    ])
    if (historyMenu === item.id) {
      entry.appendChild(h('div', { class: 'claudseq-menu claudseq-row-menu', role: 'menu' }, [
        h('button', { class: 'claudseq-menu-item', type: 'button', role: 'menuitem', [ACTION_ATTR]: 'copy-resume', [VALUE_ATTR]: item.id, text: 'Copy resume command' })
      ]))
    }
    list.appendChild(entry)
  }
}

/* ---------------------------------------------------------------- sessions */

function resetTimelineView() {
  for (const cached of rowCache.values()) cached.element.remove()
  rowCache.clear()
  expanded.clear()
  clear(parts.timeline)
  stickToBottom = true
}

/* Leaving a session stops listening to it. A session with nothing running is
 * closed; one mid-turn is left to finish, and the bridge closes it once it is
 * idle with nobody attached. */
function leaveSession() {
  if (!current) return
  parent.clearTimeout(reconnectTimer)
  current.stream?.abort()
  current.stream = null
  if (current.liveId && !(current.busy || current.timeline.state.busy)) {
    api('DELETE', `/v1/sessions/${current.liveId}`).catch(() => {})
  }
  current.liveId = null
}

function startNewSession() {
  leaveSession()
  current = newSession()
  notice = ''
  resetTimelineView()
  saveSettings({ openSession: '' })
  view = 'timeline'
  renderNow()
}

function attach(liveId, after) {
  const session = current
  session.liveId = liveId
  session.lastSeq = after
  session.stream = openStream(liveId, after, (entry) => {
    if (current !== session) return
    session.lastSeq = entry.seq
    session.timeline.apply(entry.event)
    const event = entry.event
    if (event?.type === 'user' && event.claudseq === 'echo') session.busy = true
    if (event?.type === 'result') {
      session.busy = false
      refreshTitle()
    }
    if (event?.type === 'claudseq' && event.subtype === 'exited') {
      session.busy = false
      session.liveId = null
    }
    scheduleRender()
  }, (error) => {
    if (current !== session) return
    session.stream = null
    if (!error || error.kind === 'gone') {
      /* The bridge ended the stream: the session is over. Its transcript is
       * still there, and the next message resumes it. */
      session.liveId = null
      session.busy = false
      scheduleRender()
      return
    }
    lost()
  })
}

/* The bridge went away mid-session — it crashed, or was stopped. The pane
 * starts it again in a moment; the session's transcript is still there, and
 * the next message resumes it. */
function lost() {
  bridge.state = 'down'
  scheduleRender()
  parent.clearTimeout(reconnectTimer)
  reconnectTimer = parent.setTimeout(() => connect().catch(() => {}), 3000)
}

async function refreshTitle() {
  const session = current
  if (!session?.claudeSessionId) return
  try {
    const found = (await api('GET', `/v1/history?cwd=${encodeURIComponent(cwd)}`)).sessions
    const item = found.find((entry) => entry.id === session.claudeSessionId)
    if (item && current === session) {
      session.title = item.title
      scheduleRender()
    }
  } catch {
    /* The title is a nicety; the prompt stands in for it. */
  }
}

/* Open a session by its Claude Code id: its transcript first, then — if the
 * bridge is still running it — the live events since. A turn in progress is
 * replayed from its start rather than read back from the transcript. */
async function openSession(claudeSessionId, title = '') {
  leaveSession()
  current = newSession(claudeSessionId, title)
  resetTimelineView()
  view = 'timeline'
  notice = ''
  saveSettings({ openSession: claudeSessionId })
  const session = current
  renderNow()

  const [live, transcript] = await Promise.all([
    api('GET', '/v1/sessions').then((body) => body.sessions.find((entry) => entry.claudeSessionId === claudeSessionId && entry.cwd === cwd) ?? null).catch(() => null),
    api('GET', `/v1/transcript?cwd=${encodeURIComponent(cwd)}&id=${claudeSessionId}`).catch((error) => {
      if (error.status === 404) return null
      throw error
    })
  ])
  if (current !== session) return
  if (transcript) {
    const cutoff = live?.busy && live.turnStartedAt ? live.turnStartedAt : null
    const records = cutoff ? transcript.records.filter((record) => !record.timestamp || record.timestamp < cutoff) : transcript.records
    session.timeline.loadTranscript(records, transcript.agents)
    if (transcript.title && !session.title) session.title = transcript.title
  }
  if (live) {
    session.busy = live.busy
    attach(live.id, live.busy ? Math.max(0, live.turnSeq - 1) : live.seq)
  }
  renderNow()
}

async function ensureLive() {
  const session = current
  if (session.liveId) return session.liveId
  const created = await api('POST', '/v1/sessions', {
    cwd,
    resume: session.claudeSessionId ?? undefined,
    model: settings.model === 'default' ? undefined : settings.model,
    effort: settings.effort === 'default' ? undefined : settings.effort,
    mode: settings.permissionMode
  })
  if (current !== session) return null
  session.claudeSessionId = created.claudeSessionId
  saveSettings({ openSession: created.claudeSessionId })
  attach(created.id, created.seq ?? 0)
  return created.id
}

async function send() {
  const text = parts.input.value ?? ''
  if (!text.trim() || pendingSend || !current || bridge.state !== 'ready') return
  if (current.busy || current.timeline.state.busy) return
  pendingSend = true
  notice = ''
  menu = null
  renderNow()
  try {
    const liveId = await ensureLive()
    if (!liveId) return
    await api('POST', `/v1/sessions/${liveId}/messages`, { text })
    parts.input.value = ''
    autosize()
    current.busy = true
  } catch (error) {
    failed(error)
  } finally {
    pendingSend = false
    renderNow()
  }
}

async function stop() {
  if (!current?.liveId) return
  try {
    await api('POST', `/v1/sessions/${current.liveId}/interrupt`)
  } catch (error) {
    failed(error)
  }
}

async function answer(key, behavior, always = false) {
  const row = current?.timeline.rows.find((entry) => entry.key === key)
  if (!row || row.resolved || !current.liveId) return
  const reason = parts.timeline.querySelector(`[${PART_ATTR}="reason"][${KEY_ATTR}="${key}"]`)?.value ?? ''
  try {
    await api('POST', `/v1/sessions/${current.liveId}/permissions`, {
      requestId: row.requestId,
      behavior,
      always,
      message: behavior === 'deny' && reason.trim() ? reason.trim() : undefined
    })
  } catch (error) {
    failed(error)
  }
}

async function cycleMode() {
  const live = current?.liveId ? current.timeline.state.mode : null
  const from = MODES.includes(live) ? live : settings.permissionMode
  const next = MODES[(MODES.indexOf(from) + 1) % MODES.length]
  saveSettings({ permissionMode: next })
  if (current?.liveId) {
    current.timeline.state.mode = next
    try {
      await api('POST', `/v1/sessions/${current.liveId}/settings`, { mode: next })
    } catch (error) {
      failed(error)
    }
  }
  renderNow()
}

async function pickModel(model) {
  saveSettings({ model })
  menu = null
  if (current?.liveId) {
    current.timeline.state.model = model === 'default' ? null : model
    try {
      await api('POST', `/v1/sessions/${current.liveId}/settings`, { model: model === 'default' ? 'default' : model })
    } catch (error) {
      failed(error)
    }
  }
  renderNow()
}

function failed(error) {
  if (error?.kind === 'noclaude') {
    bridge.state = 'noclaude'
  } else if (['missing', 'down', 'unauthorized'].includes(error?.kind)) {
    lost()
  } else {
    notice = `Claudseq could not reach Claude: ${error?.code ?? error?.message ?? error}`
  }
  console.warn(LOG_PREFIX, error)
  scheduleRender()
}

async function loadHistory() {
  historyItems = null
  historyError = ''
  historyMenu = null
  historyDirty = true
  renderNow()
  try {
    historyItems = (await api('GET', `/v1/history?cwd=${encodeURIComponent(cwd)}`)).sessions
  } catch (error) {
    historyError = `Could not read history: ${error?.code ?? error?.message ?? error}`
  }
  historyDirty = true
  renderNow()
}

async function copyText(text) {
  try {
    await parent.navigator.clipboard.writeText(text)
  } catch {
    const field = h('textarea', { class: 'claudseq-offscreen' })
    field.value = text
    doc.body.appendChild(field)
    field.select?.()
    doc.execCommand?.('copy')
    field.remove()
  }
  logseq.UI?.showMsg?.(`Copied: ${text}`)
}

/* An @-mention of the page being read, as a path relative to the working
 * directory — the form Claude Code resolves. */
async function mentionPage() {
  try {
    const page = await logseq.Editor.getCurrentPage()
    const name = page?.name ?? page?.originalName?.toLowerCase()
    if (!name) {
      logseq.UI?.showMsg?.('Open a page to mention it.', 'warning')
      return
    }
    const found = await logseq.DB.datascriptQuery(`[:find ?path :where [?p :block/name ${JSON.stringify(name)}] [?p :block/file ?f] [?f :file/path ?path]]`)
    let path = found?.[0]?.[0]
    if (typeof path !== 'string') {
      logseq.UI?.showMsg?.('This page has no file yet.', 'warning')
      return
    }
    if (path.startsWith(`${cwd}/`)) path = path.slice(cwd.length + 1)
    insertText(/\s/.test(path) ? `@"${path}" ` : `@${path} `)
  } catch (error) {
    console.warn(LOG_PREFIX, 'could not mention the page', error)
  }
}

function insertText(text) {
  const input = parts.input
  const value = input.value ?? ''
  const start = typeof input.selectionStart === 'number' ? input.selectionStart : value.length
  const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : value.length
  const before = value.slice(0, start)
  const spacer = before && !/\s$/.test(before) ? ' ' : ''
  input.value = `${before}${spacer}${text}${value.slice(end)}`
  const caret = before.length + spacer.length + text.length
  input.setSelectionRange?.(caret, caret)
  input.focus()
  autosize()
}

function autosize() {
  const input = parts.input
  input.style.setProperty('height', 'auto')
  const height = Math.min(200, Math.max(20, input.scrollHeight || 20))
  input.style.setProperty('height', `${height}px`)
  renderSendReady()
}

/* --------------------------------------------------------------- handlers */

function onClick(event) {
  const target = event.target?.closest?.(`[${ACTION_ATTR}]`)
  if (!target) return
  const action = target.getAttribute(ACTION_ATTR)
  const key = target.getAttribute(KEY_ATTR)
  const value = target.getAttribute(VALUE_ATTR)
  switch (action) {
    case 'fold':
      saveSettings({ paneCollapsed: !settings.paneCollapsed })
      renderNow()
      break
    case 'history':
      event.stopPropagation?.()
      if (settings.paneCollapsed) saveSettings({ paneCollapsed: false })
      view = view === 'history' ? 'timeline' : 'history'
      menu = null
      historyQuery = ''
      if (view === 'history') loadHistory()
      else renderNow()
      break
    case 'back':
      view = 'timeline'
      renderNow()
      break
    case 'new':
      event.stopPropagation?.()
      if (settings.paneCollapsed) saveSettings({ paneCollapsed: false })
      startNewSession()
      parts.input.focus()
      break
    case 'retry':
      connect().catch(() => {})
      break
    case 'allow-node':
      allowNode().catch((error) => console.warn(LOG_PREFIX, error))
      break
    case 'send':
      if (current?.busy || current?.timeline.state.busy) stop()
      else send()
      break
    case 'mention':
      mentionPage()
      break
    case 'slash':
      menu = menu === 'slash' ? null : 'slash'
      renderNow()
      break
    case 'slash-pick':
      menu = null
      parts.input.value = ''
      insertText(`/${value} `)
      renderNow()
      break
    case 'model':
      menu = menu === 'model' ? null : 'model'
      renderNow()
      break
    case 'model-pick':
      pickModel(value)
      break
    case 'effort-pick':
      saveSettings({ effort: value })
      menu = null
      renderNow()
      break
    case 'mode':
      cycleMode()
      break
    case 'expand': {
      if (expanded.has(key)) expanded.delete(key)
      else expanded.add(key)
      /* The row that holds the toggle is drawn again; an agent's step is
       * drawn inside its Agent row, so that is the one to redraw. */
      const rowKey = key.slice(0, key.lastIndexOf(':'))
      const owner = current?.timeline.rows.find((row) => row.key === rowKey || row.children?.some((child) => child.key === rowKey))
      const cached = owner ? rowCache.get(owner.key) : null
      if (cached) cached.rev = null
      renderNow()
      break
    }
    case 'allow':
      answer(key, 'allow')
      break
    case 'allow-session':
      answer(key, 'allow', true)
      break
    case 'deny':
      answer(key, 'deny')
      break
    case 'open-session':
      openSession(value).catch(failed)
      break
    case 'session-menu':
      event.stopPropagation?.()
      historyMenu = historyMenu === value ? null : value
      historyDirty = true
      renderNow()
      break
    case 'copy-resume':
      event.stopPropagation?.()
      historyMenu = null
      historyDirty = true
      copyText(`claude --resume ${value}`)
      renderNow()
      break
    default:
  }
}

function onKeyDown(event) {
  const part = event.target?.getAttribute?.(PART_ATTR)
  if (part === 'input') {
    if (event.key === 'Escape' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      event.stopPropagation?.()
      unfocus()
      return
    }
    if (event.key === 'Escape' && menu) {
      event.preventDefault()
      menu = null
      renderNow()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      send()
    }
    return
  }
  if (part === 'reason' && event.key === 'Enter') {
    event.preventDefault()
    answer(event.target.getAttribute(KEY_ATTR), 'deny')
    return
  }
  const action = event.target?.getAttribute?.(ACTION_ATTR)
  if ((event.key === 'Enter' || event.key === ' ') && action === 'fold') {
    event.preventDefault()
    saveSettings({ paneCollapsed: !settings.paneCollapsed })
    renderNow()
    return
  }
  if (event.key === 'Enter' && action === 'open-session') {
    openSession(event.target.getAttribute(VALUE_ATTR)).catch(failed)
  }
}

function onInput(event) {
  const part = event.target?.getAttribute?.(PART_ATTR)
  if (part === 'input') {
    autosize()
    const value = parts.input.value ?? ''
    if (value.startsWith('/') && !/\s/.test(value)) menu = 'slash'
    else if (menu === 'slash') menu = null
    renderMenu()
    return
  }
  if (part === 'search') {
    historyQuery = parts.search.value ?? ''
    renderHistory()
  }
}

/* Dragging the pane's top edge makes it taller or shorter. */
function onMouseDown(event) {
  if (event.target?.getAttribute?.(PART_ATTR) !== 'resize') return
  event.preventDefault()
  const startY = event.clientY
  const viewport = Number(parent.innerHeight)
  const limit = viewport > 0 ? Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(viewport * MAX_SHARE))) : MAX_HEIGHT
  const startHeight = Math.min(limit, settings.paneHeight)
  const move = (moved) => {
    const height = Math.min(limit, Math.max(MIN_HEIGHT, startHeight + (startY - moved.clientY)))
    settings.paneHeight = Math.round(height)
    applyLayout()
  }
  const up = () => {
    doc.removeEventListener('mousemove', move, true)
    doc.removeEventListener('mouseup', up, true)
    saveSettings({ paneHeight: settings.paneHeight })
  }
  doc.addEventListener('mousemove', move, true)
  doc.addEventListener('mouseup', up, true)
}

/* A click outside an open menu closes it. */
function onDocumentMouseDown(event) {
  if (!menu && !historyMenu) return
  if (event.target?.closest?.(`#${PANE_ID} [${PART_ATTR}="menu"], #${PANE_ID} .claudseq-row-menu, #${PANE_ID} [${ACTION_ATTR}="model"], #${PANE_ID} [${ACTION_ATTR}="slash"], #${PANE_ID} [${ACTION_ATTR}="session-menu"]`)) return
  menu = null
  if (historyMenu) historyDirty = true
  historyMenu = null
  scheduleRender()
}

async function focusComposer() {
  if (settings.paneCollapsed) {
    saveSettings({ paneCollapsed: false })
    renderNow()
  }
  try {
    const editing = await logseq.Editor.getEditingCurrentBlock?.()
    savedEditingBlock = editing?.uuid ?? null
    if (savedEditingBlock) await logseq.Editor.exitEditingMode?.()
  } catch {
    savedEditingBlock = null
  }
  parts.input.focus()
}

function unfocus() {
  parts.input.blur?.()
  const block = savedEditingBlock
  savedEditingBlock = null
  if (block) logseq.Editor.editBlock?.(block)?.catch?.(() => {})
}

function toggleFocus() {
  if (doc.activeElement && doc.activeElement === parts.input) unfocus()
  else focusComposer()
}

/* ------------------------------------------------------------- connection */

async function resolveCwd() {
  if (settings.workingDirectory) return settings.workingDirectory
  try {
    const graph = await logseq.App.getCurrentGraph()
    return typeof graph?.path === 'string' ? graph.path : ''
  } catch {
    return ''
  }
}

let connecting = null

/* One attempt at a time: Retry, a lost stream and a changed setting can each
 * ask for one while a bridge is still starting. */
function connect() {
  connecting ??= reach().finally(() => { connecting = null })
  return connecting
}

/* Reach the bridge that is running, or start one. */
async function reach() {
  parent.clearTimeout(reconnectTimer)
  bridge.state = 'connecting'
  bridge.failure = null
  renderNow()
  cwd = await resolveCwd()
  let found
  try {
    found = await health()
  } catch {
    found = await startBridge()
    if (!found) return
  }
  bridge.claudePath = found.claudePath ?? ''
  /* A plugin updated while Logseq runs finds the older bridge still running.
   * It keeps working; the pane says how to start the new one. */
  const version = logseq.baseInfo?.version
  bridge.outdated = found.version && version && found.version !== version ? found.version : ''
  if (!found.claudeFound) {
    bridge.state = 'noclaude'
    renderNow()
    return
  }
  if (!cwd) {
    bridge.state = 'nograph'
    renderNow()
    return
  }
  bridge.state = 'ready'
  const wanted = current?.claudeSessionId ?? settings.openSession
  if (current?.liveId && current.stream) {
    renderNow()
  } else if (wanted) {
    await openSession(wanted, current?.title ?? '').catch((error) => {
      console.warn(LOG_PREFIX, 'could not reopen the last session', error)
      startNewSession()
    })
  } else {
    if (!current) current = newSession()
    renderNow()
  }
}

/* A different graph is a different folder, with its own history. */
async function switchDirectory() {
  const next = await resolveCwd()
  if (next === cwd) return
  leaveSession()
  cwd = next
  current = newSession()
  resetTimelineView()
  historyItems = null
  historyDirty = true
  saveSettings({ openSession: '' })
  if (view === 'history') loadHistory()
  await connect()
}

/* -------------------------------------------------------------- lifecycle */

function teardown() {
  observer?.disconnect()
  observer = null
  if (renderTimer !== null) parent.clearTimeout(renderTimer)
  renderTimer = null
  parent.clearTimeout(reconnectTimer)
  if (current) {
    current.stream?.abort()
    current.stream = null
  }
  doc.removeEventListener('mousedown', onDocumentMouseDown, true)
  pane?.remove()
  pane = null
  rowCache.clear()
  /* Logseq removes a provided style when a plugin unloads; this makes sure. */
  for (const style of doc.querySelectorAll('style')) {
    if ((style.getAttribute('data-injected-style') ?? '').startsWith(STYLE_KEY)) style.remove()
  }
}

function main() {
  settings = readSettings(logseq.settings)
  logseq.useSettingsSchema(settingsSchema())
  logseq.provideStyle({ key: STYLE_KEY, style: STYLE })
  logseq.beforeunload?.(async () => teardown())

  pane = buildPane()
  applyLayout()
  mount()
  render()

  doc.addEventListener('mousedown', onDocumentMouseDown, true)
  observer = new MutationObserver(() => mount())
  observer.observe(doc.body, { childList: true, subtree: true })

  logseq.App.registerCommandPalette({
    key: COMMAND_KEY,
    label: 'Claudseq: Focus or unfocus Claude',
    keybinding: { binding: 'mod+esc', mode: 'global' }
  }, () => toggleFocus())

  logseq.App.onCurrentGraphChanged?.(() => {
    switchDirectory().catch((error) => console.warn(LOG_PREFIX, error))
  })
  logseq.onSettingsChanged?.((next) => {
    const before = settings
    settings = readSettings(next)
    if (settings.workingDirectory !== before.workingDirectory) switchDirectory().catch((error) => console.warn(LOG_PREFIX, error))
    else if (settings.nodePath !== before.nodePath && bridge.state !== 'ready') connect().catch(() => {})
    else scheduleRender()
  })

  connect().catch((error) => console.warn(LOG_PREFIX, error))
}

const STYLE = `
#${PANE_ID} {
  --claudseq-border: var(--ls-border-color, var(--ls-secondary-border-color, #444));
  --claudseq-accent: var(--ls-active-primary-color, #f38518);
  --claudseq-text: var(--ls-primary-text-color, inherit);
  --claudseq-dim: var(--ls-secondary-text-color, #999);
  --claudseq-surface: var(--ls-secondary-background-color, transparent);
  --claudseq-subtle: var(--ls-tertiary-background-color, rgba(127, 127, 127, .15));
  --claudseq-code-bg: var(--ls-page-inline-code-bg-color, var(--ls-tertiary-background-color, rgba(127, 127, 127, .15)));
  --claudseq-ok: var(--ls-success-text-color, #89d185);
  --claudseq-error: var(--ls-error-text-color, #f48771);
  --claudseq-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
  container: claudseq / inline-size;
  margin: 4px 12px 8px;
  color: var(--claudseq-text);
  font-size: 13px;
  line-height: 1.45;
}
#${PANE_ID} [${HIDDEN_ATTR}] { display: none !important; }
#${PANE_ID} button { font: inherit; color: inherit; }
#${PANE_ID} .claudseq-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: 0 0 auto; }
#${PANE_ID} .claudseq-header { display: flex; align-items: center; gap: 4px; min-height: 28px; border-bottom: 1px solid var(--claudseq-border); cursor: pointer; user-select: none; }
#${PANE_ID} .claudseq-chevron { display: inline-flex; color: var(--claudseq-dim); transform: rotate(90deg); transition: transform .15s; }
#${PANE_ID}[${COLLAPSED_ATTR}] .claudseq-chevron { transform: none; }
#${PANE_ID} .claudseq-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
#${PANE_ID} .claudseq-icon-button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--claudseq-dim); cursor: pointer; flex: 0 0 auto; }
#${PANE_ID} .claudseq-icon-button:hover { color: var(--claudseq-text); background: var(--claudseq-subtle); }
#${PANE_ID} button:focus-visible, #${PANE_ID} [tabindex]:focus-visible { outline: 1px solid var(--claudseq-accent); outline-offset: 1px; }
#${PANE_ID}[${COLLAPSED_ATTR}] .claudseq-body { display: none; }
#${PANE_ID} .claudseq-body { display: flex; flex-direction: column; height: min(var(${HEIGHT_PROPERTY}, 440px), ${MAX_SHARE * 100}vh); min-height: 0; }
#${PANE_ID} .claudseq-resize { flex: 0 0 6px; cursor: ns-resize; }
#${PANE_ID} .claudseq-scroll { flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto; padding: 2px 2px 10px; }
#${PANE_ID} .claudseq-status { margin: 4px 0 10px; padding: 8px 10px; border: 1px dashed var(--claudseq-border); border-radius: 6px; }
#${PANE_ID} .claudseq-status-line { margin: 0 0 6px; }
#${PANE_ID} .claudseq-status-line[${ERROR_ATTR}] { color: var(--claudseq-error); }
#${PANE_ID} .claudseq-command { margin: 0 0 8px; padding: 6px 8px; border: 1px solid var(--claudseq-border); border-radius: 4px; background: var(--claudseq-code-bg); font-family: var(--claudseq-mono); font-size: 11.5px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: all; }
#${PANE_ID} .claudseq-timeline { --claudseq-gap: 10px; position: relative; display: flex; flex-direction: column; gap: var(--claudseq-gap); padding: 6px 0 0 16px; }
#${PANE_ID} .claudseq-row { position: relative; min-width: 0; overflow-wrap: anywhere; }
#${PANE_ID} .claudseq-row::before { content: ''; position: absolute; left: -15px; top: .5em; width: 7px; height: 7px; border-radius: 50%; background: var(--claudseq-dim); }
/* One line joins each dot to the next. A message, a notice or a footer has
 * no dot, sits out at the left edge and breaks the line. */
#${PANE_ID} .claudseq-row:not([${ROW_ATTR}="user"], [${ROW_ATTR}="notice"], [${ROW_ATTR}="footer"]):has(+ .claudseq-row:not([${ROW_ATTR}="user"], [${ROW_ATTR}="notice"], [${ROW_ATTR}="footer"]))::after { content: ''; position: absolute; left: -12px; top: calc(.5em + 7px); bottom: calc(-1 * var(--claudseq-gap) - .5em); width: 1px; background: var(--claudseq-dim); opacity: .6; }
#${PANE_ID} .claudseq-row:is([${ROW_ATTR}="user"], [${ROW_ATTR}="notice"], [${ROW_ATTR}="footer"]) { margin-left: -16px; }
#${PANE_ID} .claudseq-row:is([${ROW_ATTR}="user"], [${ROW_ATTR}="notice"], [${ROW_ATTR}="footer"])::before { display: none; }
#${PANE_ID} .claudseq-user { padding: 6px 10px; border: 1px solid var(--claudseq-border); border-radius: 8px; background: transparent; white-space: pre-wrap; }
#${PANE_ID} .claudseq-row[${STATUS_ATTR}="pending"]::before { background: transparent; border: 1px solid var(--claudseq-dim); box-sizing: border-box; }
#${PANE_ID} .claudseq-row[${STATUS_ATTR}="ok"]::before { background: var(--claudseq-ok); }
#${PANE_ID} .claudseq-row[${STATUS_ATTR}="error"]::before { background: var(--claudseq-error); }
#${PANE_ID} .claudseq-row[${ROW_ATTR}="permission"][${STATE_ATTR}="pending"]::before { background: var(--claudseq-accent); }
#${PANE_ID} .claudseq-thinking-toggle { padding: 0; border: 0; background: none; color: var(--claudseq-dim); cursor: pointer; }
#${PANE_ID} span.claudseq-thinking-toggle { cursor: default; }
#${PANE_ID} .claudseq-thinking-text { margin-top: 4px; color: var(--claudseq-dim); white-space: pre-wrap; }
#${PANE_ID} .claudseq-tool-head { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
#${PANE_ID} .claudseq-tool-name { font-weight: 700; flex: 0 0 auto; }
#${PANE_ID} .claudseq-tool-summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--claudseq-mono); font-size: 12px; color: var(--claudseq-text); background: none; border: 0; padding: 0; }
#${PANE_ID} .claudseq-io { margin-top: 4px; border: 1px solid var(--claudseq-border); border-radius: 6px; overflow: hidden; }
#${PANE_ID} .claudseq-io-row { display: grid; grid-template-columns: 34px minmax(0, 1fr); }
#${PANE_ID} .claudseq-io-row + .claudseq-io-row { border-top: 1px solid var(--claudseq-border); }
#${PANE_ID} .claudseq-io-label { padding: 4px 0 0 6px; color: var(--claudseq-dim); font-size: 10.5px; letter-spacing: .04em; }
#${PANE_ID} .claudseq-io-body { min-width: 0; padding: 4px 6px 4px 0; }
#${PANE_ID} .claudseq-io-text { margin: 0; padding: 0; border: 0; font-family: var(--claudseq-mono); font-size: 11.5px; white-space: pre-wrap; word-break: break-word; background: none; }
#${PANE_ID} .claudseq-link-button { padding: 0; border: 0; background: none; color: var(--ls-link-text-color, var(--claudseq-accent)); font-size: 12px; cursor: pointer; }
#${PANE_ID} .claudseq-steps { margin-top: 6px; gap: 6px; }
#${PANE_ID} .claudseq-notice { color: var(--claudseq-dim); font-style: italic; }
#${PANE_ID} .claudseq-footer { color: var(--claudseq-dim); }
#${PANE_ID} .claudseq-footer[${ERROR_ATTR}] { color: var(--claudseq-error); }
#${PANE_ID} .claudseq-permission { padding: 8px 10px; border: 1px solid var(--claudseq-accent); border-radius: 8px; background: var(--claudseq-surface); }
#${PANE_ID} .claudseq-permission-title { font-weight: 600; }
#${PANE_ID} .claudseq-permission-description { color: var(--claudseq-dim); font-family: var(--claudseq-mono); font-size: 12px; }
#${PANE_ID} .claudseq-permission-preview { margin: 6px 0; padding: 6px; border: 1px solid var(--claudseq-border); border-radius: 4px; max-height: 180px; overflow: auto; }
#${PANE_ID} .claudseq-reason { box-sizing: border-box; width: 100%; margin: 2px 0 6px; padding: 3px 6px; border: 1px solid var(--claudseq-border); border-radius: 4px; background: transparent; color: inherit; font: inherit; font-size: 12px; }
#${PANE_ID} .claudseq-permission-actions { display: flex; flex-wrap: wrap; gap: 6px; }
#${PANE_ID} .claudseq-button { padding: 3px 10px; border: 1px solid var(--claudseq-border); border-radius: 4px; background: transparent; cursor: pointer; }
#${PANE_ID} .claudseq-button:hover { border-color: var(--claudseq-accent); }
#${PANE_ID} .claudseq-primary { border-color: var(--claudseq-accent); background: var(--claudseq-accent); color: var(--ls-primary-background-color, #000); }
#${PANE_ID} .claudseq-empty { margin: 8px 0; color: var(--claudseq-dim); }
#${PANE_ID} .claudseq-empty[${ERROR_ATTR}] { color: var(--claudseq-error); }
#${PANE_ID} .claudseq-md > :first-child { margin-top: 0; }
#${PANE_ID} .claudseq-md > :last-child { margin-bottom: 0; }
#${PANE_ID} .claudseq-md p { margin: .45em 0; }
#${PANE_ID} .claudseq-md-heading { margin: .7em 0 .35em; font-size: 1.05em; font-weight: 700; line-height: 1.3; }
#${PANE_ID} h1.claudseq-md-heading { font-size: 1.2em; }
#${PANE_ID} .claudseq-md-code { padding: 0 .3em; border: 0; border-radius: 3px; background: var(--claudseq-code-bg); color: inherit; font-family: var(--claudseq-mono); font-size: .92em; }
#${PANE_ID} .claudseq-md-pre { margin: .5em 0; padding: 4px 8px; border: 0; border-radius: 6px; background: transparent; overflow-x: auto; font-family: var(--claudseq-mono); font-size: 11.5px; line-height: 1.4; }
#${PANE_ID} .claudseq-md-pre code { font-family: inherit; background: none; border: 0; padding: 0; color: inherit; white-space: pre; }
#${PANE_ID} .claudseq-md-list { margin: .35em 0; padding-left: 1.4em; }
#${PANE_ID} .claudseq-md-list li { margin: .15em 0; }
#${PANE_ID} li[data-claudseq-task] { list-style: none; margin-left: -1.2em; }
#${PANE_ID} .claudseq-md-quote { margin: .5em 0; padding-left: 8px; border-left: 2px solid var(--claudseq-border); color: var(--claudseq-dim); }
#${PANE_ID} .claudseq-md-table { margin: .5em 0; overflow-x: auto; }
#${PANE_ID} .claudseq-md-table table { border-collapse: collapse; font-size: 12px; }
#${PANE_ID} .claudseq-md-table th, #${PANE_ID} .claudseq-md-table td { padding: 2px 6px; border: 1px solid var(--claudseq-border); text-align: left; }
#${PANE_ID} [data-claudseq-align="right"] { text-align: right !important; }
#${PANE_ID} [data-claudseq-align="center"] { text-align: center !important; }
#${PANE_ID} .claudseq-md-link { color: var(--ls-link-text-color, var(--claudseq-accent)); text-decoration: underline; cursor: pointer; }
#${PANE_ID} .claudseq-md hr { border: 0; border-top: 1px solid var(--claudseq-border); margin: .7em 0; }
#${PANE_ID} .claudseq-composer { position: relative; flex: 0 0 auto; padding: 6px 6px 4px 8px; border: 1px solid var(--claudseq-border); border-radius: 8px; background: transparent; }
#${PANE_ID} .claudseq-composer:focus-within { border-color: var(--claudseq-accent); }
/* The composer draws the box and its focus; a theme's rules for every
 * textarea would draw a second one inside it. */
#${PANE_ID} .claudseq-input, #${PANE_ID} .claudseq-input:focus, #${PANE_ID} .claudseq-input:focus-visible { display: block; box-sizing: border-box; width: 100%; min-height: 20px; max-height: 200px; margin: 0; padding: 0; border: 0; outline: 0 !important; box-shadow: none !important; resize: none; overflow-y: auto; background: transparent !important; color: inherit; font: inherit; line-height: 1.45; }
#${PANE_ID} .claudseq-input::placeholder { color: var(--claudseq-dim); }
#${PANE_ID} .claudseq-toolbar { display: flex; align-items: center; gap: 4px; margin: 6px -6px 0 -8px; padding: 4px 6px 0 8px; border-top: 1px solid var(--claudseq-border); min-width: 0; }
#${PANE_ID} .claudseq-spacer { flex: 1 1 auto; }
#${PANE_ID} .claudseq-agents { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; padding: 1px 8px; border-radius: 999px; background: var(--claudseq-subtle); color: var(--claudseq-text); font-size: 12px; white-space: nowrap; }
#${PANE_ID} .claudseq-agents-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--claudseq-dim); }
#${PANE_ID} .claudseq-pill { display: inline-block; min-width: 0; max-width: 50%; padding: 1px 8px; border: 1px solid transparent; border-radius: 999px; background: var(--claudseq-subtle); color: var(--claudseq-text); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
#${PANE_ID} .claudseq-pill:hover { border-color: var(--claudseq-border); }
#${PANE_ID} .claudseq-effort { color: var(--claudseq-dim); }
#${PANE_ID} .claudseq-mode { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; background: transparent; }
/* The toolbar fits the sidebar's narrowest widths by dropping words, never
 * controls: the mode's name, then the word beside the agent count. */
@container claudseq (max-width: 360px) {
  #${PANE_ID} .claudseq-toolbar:has(> .claudseq-agents:not([${HIDDEN_ATTR}])) .claudseq-mode-label { display: none; }
}
@container claudseq (max-width: 280px) {
  #${PANE_ID} .claudseq-mode-label { display: none; }
}
@container claudseq (max-width: 250px) {
  #${PANE_ID} .claudseq-agents-word { display: none; }
}
#${PANE_ID} .claudseq-mode .claudseq-icon { width: 14px; height: 14px; }
#${PANE_ID} .claudseq-send { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 1px solid var(--claudseq-accent); border-radius: 6px; background: var(--claudseq-accent); color: var(--ls-primary-background-color, #000); cursor: pointer; flex: 0 0 auto; }
#${PANE_ID} .claudseq-send[aria-disabled="true"] { opacity: .45; cursor: default; }
#${PANE_ID} .claudseq-send[${STATE_ATTR}="stop"] .claudseq-icon { fill: currentColor; }
#${PANE_ID} .claudseq-menu { position: absolute; left: 0; right: 0; bottom: calc(100% + 4px); z-index: 20; max-height: 260px; overflow-y: auto; padding: 4px; border: 1px solid var(--claudseq-border); border-radius: 6px; background: var(--ls-primary-background-color, #000); }
#${PANE_ID} .claudseq-menu-heading { padding: 4px 6px 2px; color: var(--claudseq-dim); font-size: 11px; }
#${PANE_ID} .claudseq-menu-item { display: block; width: 100%; padding: 3px 6px; border: 0; border-radius: 4px; background: transparent; text-align: left; cursor: pointer; }
#${PANE_ID} .claudseq-menu-item:hover, #${PANE_ID} .claudseq-menu-item[${SELECTED_ATTR}] { background: var(--claudseq-subtle); }
#${PANE_ID} .claudseq-menu-item[${SELECTED_ATTR}]::after { content: ' ✓'; color: var(--claudseq-accent); }
#${PANE_ID} .claudseq-menu-note { padding: 4px 6px; color: var(--claudseq-dim); font-size: 12px; }
#${PANE_ID} .claudseq-history-head { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
#${PANE_ID} .claudseq-search { flex: 1 1 auto; min-width: 0; padding: 3px 8px; border: 1px solid var(--claudseq-border); border-radius: 6px; background: transparent; color: inherit; font: inherit; }
#${PANE_ID} .claudseq-search:focus { outline: 0; border-color: var(--claudseq-accent); }
#${PANE_ID} .claudseq-history-item { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 4px; padding: 6px 4px 6px 8px; border-radius: 6px; cursor: pointer; }
#${PANE_ID} .claudseq-history-item:hover, #${PANE_ID} .claudseq-history-item[${SELECTED_ATTR}] { background: var(--claudseq-subtle); }
#${PANE_ID} .claudseq-history-title { grid-column: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${PANE_ID} .claudseq-history-meta { grid-column: 1; display: flex; gap: 6px; align-items: center; color: var(--claudseq-dim); font-size: 11.5px; }
#${PANE_ID} .claudseq-history-item > .claudseq-icon-button { grid-column: 2; grid-row: 1 / span 2; align-self: center; }
#${PANE_ID} .claudseq-badge { padding: 0 5px; border: 1px solid var(--claudseq-border); border-radius: 3px; font-size: 10.5px; }
#${PANE_ID} .claudseq-row-menu { top: 100%; bottom: auto; left: auto; right: 4px; width: max-content; }
.claudseq-offscreen { position: fixed; left: -9999px; top: 0; }
`

logseq.ready(main).catch(console.error)
