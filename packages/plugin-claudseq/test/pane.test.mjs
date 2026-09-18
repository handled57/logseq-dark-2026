/* Behavioral tests for the Claudseq pane.
 *
 * The three classic scripts — the Markdown renderer, the timeline model and
 * the runtime — run in one `vm` context, as index.html loads them, against a
 * stub host: a left sidebar shaped like Logseq 0.10.15's, the host's file IPC
 * (`parent.apis.doAction`, which resolves null for a missing file rather than
 * rejecting), a plugin API that records what it is asked, and a fake bridge
 * behind `fetch` whose event stream is a real ReadableStream of NDJSON.
 *
 * test/fixtures/stream.ndjson is what two real `claude` 2.1.267 sessions
 * printed — a Bash call and an approved Write, then a background Agent and an
 * interrupted reply — with paths replaced and thinking signatures dropped,
 * plus the two events the bridge adds: the echo of each prompt and the
 * resolution of the permission request.
 */

import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { descendants, node } from '../../../test/support/host-document.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scripts = await Promise.all(['markdown.js', 'timeline.js', 'index.js'].map(async (name) => new vm.Script(await readFile(resolve(root, name), 'utf8'), { filename: name })))
const fixture = (await readFile(resolve(root, 'test/fixtures/stream.ndjson'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))

const GRAPH = '/Users/example/Library/Mobile Documents/iCloud~com~logseq~logseq/Documents/Logseq'
const PLUGIN_URL = 'file:///Users/example/.logseq/plugins/logseq-claudseq/index.html'
const CONFIG = JSON.stringify({ port: 47816, token: 'a'.repeat(64), claudePath: '/opt/homebrew/bin/claude' })
const SESSION = '7c04bdb7-757e-4abc-b765-618665f1172c'

const delay = (ms) => new Promise((settle) => setTimeout(settle, ms))

/* What the runtime hands back was made in the vm context, whose objects
 * compare unequal to this file's by prototype; a plain copy compares by
 * value. */
const plain = (value) => JSON.parse(JSON.stringify(value))

async function until(check, timeout = 3000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('timed out waiting for the pane')
    await delay(10)
  }
}

/* An element from the shared stub, plus the few DOM members this runtime
 * uses that the stub leaves out. */
function element(tag) {
  const self = node(tag)
  self.value = ''
  self.blur = () => { self.focused = false }
  return self
}

function textNode(text) {
  const self = node('#text')
  self.textContent = text
  return self
}

function textOf(target) {
  return target.children.length ? target.children.map(textOf).join('') : String(target.textContent ?? '')
}

function sidebar() {
  const wrap = element('div')
  wrap.classList.add('wrap')
  wrap.appendChild(element('nav'))
  const nav = wrap.appendChild(element('div'))
  nav.classList.add('nav-contents-container')
  const footer = wrap.appendChild(element('footer'))
  footer.classList.add('create')
  return { wrap, nav, footer }
}

function bridgeFake({ config = CONFIG, claudeFound = true, down = false, sessions = [], history = [], transcripts = {} } = {}) {
  const calls = []
  const streams = new Map()
  const encoder = new TextEncoder()
  const state = { config, claudeFound, down, sessions, history, transcripts, created: 0 }
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  async function fetch(url, init = {}) {
    const address = new URL(url)
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path: address.pathname, query: Object.fromEntries(address.searchParams), body, authorization: init.headers?.Authorization })
    if (state.down) throw new TypeError('Failed to fetch')
    const parts = address.pathname.split('/').filter(Boolean)
    if (address.pathname === '/v1/health') return json(200, { ok: true, version: '0.1.0', claudeFound: state.claudeFound, claudePath: '/opt/homebrew/bin/claude' })
    if (address.pathname === '/v1/history') return json(200, { cwd: address.searchParams.get('cwd'), sessions: state.history })
    if (address.pathname === '/v1/transcript') {
      const found = state.transcripts[address.searchParams.get('id')]
      return found ? json(200, found) : json(404, { error: 'no_such_session' })
    }
    if (address.pathname === '/v1/sessions' && method === 'GET') return json(200, { sessions: state.sessions })
    if (address.pathname === '/v1/sessions' && method === 'POST') {
      state.created += 1
      const created = { id: `live-${state.created}`, claudeSessionId: body.resume ?? `00000000-0000-4000-8000-00000000000${state.created}`, cwd: body.cwd, busy: false, seq: 0, turnSeq: 0 }
      state.sessions.push(created)
      return json(201, created)
    }
    if (parts[3] === 'events') {
      let controller
      const stream = new ReadableStream({ start(value) { controller = value } })
      streams.set(parts[2], { controller, seq: 0 })
      init.signal?.addEventListener('abort', () => { try { controller.close() } catch {} })
      return new Response(stream, { status: 200 })
    }
    if (method === 'POST' || method === 'DELETE') return json(202, { ok: true })
    return json(404, { error: 'not_found' })
  }

  function emit(liveId, events) {
    const stream = streams.get(liveId)
    assert.ok(stream, `no stream is open for ${liveId}`)
    for (const event of events) {
      stream.seq += 1
      stream.controller.enqueue(encoder.encode(JSON.stringify({ seq: stream.seq, event }) + '\n'))
    }
  }

  return { state, calls, fetch, emit, streams }
}

async function load({ settings = {}, bridge = bridgeFake(), graph = GRAPH } = {}) {
  const body = element('body')
  const head = element('head')
  const left = body.appendChild(element('div'))
  left.classList.add('left-sidebar-inner')
  const bar = sidebar()
  left.appendChild(bar.wrap)

  const documentListeners = []
  const doc = {
    body,
    head,
    activeElement: null,
    createElement: (tag) => element(tag),
    createElementNS: (namespace, tag) => element(tag),
    createTextNode: (text) => textNode(text),
    querySelector: (selector) => body.querySelector(selector) ?? head.querySelector(selector),
    querySelectorAll: (selector) => [...head.querySelectorAll(selector), ...body.querySelectorAll(selector)],
    addEventListener(type, handler, capture) { documentListeners.push({ type, handler, capture }) },
    removeEventListener(type, handler) {
      const index = documentListeners.findIndex((entry) => entry.type === type && entry.handler === handler)
      if (index !== -1) documentListeners.splice(index, 1)
    }
  }

  const observers = []
  class MutationObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      observers.push(this)
    }
    observe(target, options) {
      this.target = target
      this.options = options
    }
    disconnect() { this.disconnected = true }
  }

  const actions = []
  const copied = []
  const plugin = {
    settings: { ...settings },
    updates: [],
    opened: [],
    messages: [],
    currentGraph: { path: graph, name: 'notes' },
    updateSettings(patch) {
      this.updates.push(patch)
      Object.assign(this.settings, patch)
    },
    useSettingsSchema(schema) { this.schema = schema },
    provideStyle({ key, style }) {
      const tag = element('style')
      tag.setAttribute('data-injected-style', `${key}-logseq-claudseq`)
      tag.textContent = style
      head.appendChild(tag)
      this.style = { key, style }
    },
    beforeunload(handler) { this.unload = handler },
    onSettingsChanged(handler) { this.settingsChanged = handler },
    ready(handler) { return Promise.resolve().then(handler) },
    App: {
      getCurrentGraph: async () => plugin.currentGraph,
      onCurrentGraphChanged(handler) { plugin.graphChanged = handler },
      registerCommandPalette(options, handler) { plugin.command = { options, handler } },
      openExternalLink(url) { plugin.opened.push(url) }
    },
    Editor: {
      getCurrentPage: async () => ({ name: 'my page', originalName: 'My Page' }),
      getEditingCurrentBlock: async () => null,
      exitEditingMode: async () => {},
      editBlock: async () => {}
    },
    DB: { datascriptQuery: async () => [[`${graph}/pages/My Page.md`]] },
    UI: { showMsg(message) { plugin.messages.push(message) } }
  }

  const context = {
    console,
    setTimeout,
    clearTimeout,
    TextDecoder,
    AbortController,
    URL,
    location: { href: PLUGIN_URL },
    MutationObserver,
    fetch: bridge.fetch,
    logseq: plugin,
    parent: {
      document: doc,
      innerHeight: 1000,
      setTimeout,
      clearTimeout,
      navigator: { clipboard: { writeText: async (text) => { copied.push(text) } } },
      apis: {
        async doAction(call) {
          actions.push(call)
          const [action, path] = call
          if (action === 'getLogseqDotDirRoot') return '/Users/example/.logseq'
          if (action === 'readFile') return path === '/Users/example/.claudseq/bridge.json' ? bridge.state.config : null
          return null
        }
      }
    }
  }
  vm.createContext(context)
  for (const script of scripts) script.runInContext(context)

  const pane = await until(() => body.querySelector('#claudseq-pane'))
  const part = (name) => pane.querySelector(`[data-claudseq-part="${name}"]`)
  const rows = () => part('timeline').children.filter((child) => child.attributes.has('data-claudseq-row'))
  const click = (target) => pane.dispatch('click', { target })
  const action = (name, scope = pane) => scope.querySelector(`[data-claudseq-action="${name}"]`)
  const idle = async () => { await delay(80) }

  return { context, plugin, doc, body, head, bar, pane, part, rows, click, action, idle, bridge, observers, actions, copied, documentListeners }
}

async function ready(pane) {
  await until(() => pane.part('status').attributes.has('data-claudseq-hidden') && !pane.part('timeline').attributes.has('data-claudseq-hidden'))
}

/* ------------------------------------------------------------------ mount */

test('the pane mounts right after Favorites and Recent, and again after Logseq redraws the sidebar', async () => {
  const pane = await load()
  assert.equal(pane.bar.nav.nextElementSibling, pane.pane)
  assert.equal(pane.pane.nextElementSibling, pane.bar.footer)
  assert.ok(pane.pane.attributes.has('data-claudseq-pane'))

  const [observer] = pane.observers
  assert.equal(observer.target, pane.body)
  assert.deepEqual(plain(observer.options), { childList: true, subtree: true })

  /* Logseq replaces the sidebar's column; the same pane, with its state, is
   * put back beside the new Favorites and Recent. */
  const left = pane.bar.wrap.parentElement
  pane.bar.wrap.remove()
  const redrawn = sidebar()
  left.appendChild(redrawn.wrap)
  observer.callback([])
  assert.equal(redrawn.nav.nextElementSibling, pane.pane)
  assert.equal(pane.body.querySelectorAll('#claudseq-pane').length, 1)

  observer.callback([])
  assert.equal(redrawn.wrap.children.filter((child) => child === pane.pane).length, 1, 'the pane was inserted twice')
})

test('unloading leaves no node, attribute or style of Claudseq behind', async () => {
  const pane = await load({ settings: { openSession: SESSION }, bridge: bridgeFake({ sessions: [{ id: 'live-1', claudeSessionId: SESSION, cwd: GRAPH, busy: false, seq: 0, turnSeq: 0 }] }) })
  await ready(pane)
  await until(() => pane.bridge.streams.has('live-1'))
  pane.bridge.emit('live-1', fixture.slice(0, 40))
  await pane.idle()
  assert.ok(pane.head.querySelector('style'))
  assert.ok(pane.documentListeners.length > 0)

  await pane.plugin.unload()

  const everything = [...descendants(pane.body), ...descendants(pane.head)]
  assert.equal(pane.body.querySelector('#claudseq-pane'), null)
  assert.deepEqual(everything.filter((entry) => [...entry.attributes.keys()].some((name) => name.startsWith('data-claudseq'))), [])
  assert.deepEqual(everything.filter((entry) => [...entry.classList].some((name) => name.startsWith('claudseq'))), [])
  assert.deepEqual(everything.filter((entry) => entry.tagName === 'STYLE'), [])
  assert.deepEqual(pane.documentListeners, [])
  assert.ok(pane.observers.every((observer) => observer.disconnected))
})

/* --------------------------------------------------------------- timeline */

test('a recorded session renders every row type, in order', async () => {
  /* The recording was made in /Users/example/notes, so that is the graph. */
  const notes = '/Users/example/notes'
  const pane = await load({ graph: notes, settings: { openSession: SESSION }, bridge: bridgeFake({ sessions: [{ id: 'live-1', claudeSessionId: SESSION, cwd: notes, busy: false, seq: 0, turnSeq: 0 }] }) })
  await ready(pane)
  await until(() => pane.bridge.streams.has('live-1'))
  pane.bridge.emit('live-1', fixture)
  await until(() => pane.rows().length === 17)

  assert.deepEqual(pane.rows().map((row) => row.getAttribute('data-claudseq-row')), [
    'user', 'thinking', 'tool', 'tool', 'permission', 'thinking', 'text',
    'user', 'thinking', 'tool', 'thinking', 'text',
    'user', 'thinking', 'text', 'notice', 'footer'
  ])
  const [prompt, thinking, bash, write, permission, , done, , , agent] = pane.rows()

  assert.equal(textOf(prompt), 'First use the Bash tool to run exactly: echo sidecar-probe . Then use the Write tool to create out.txt containing hi. Do nothing else.')
  assert.equal(textOf(thinking), 'Thinking', 'a thinking row starts folded')
  pane.click(thinking.querySelector('[data-claudseq-action="expand"]'))
  await pane.idle()
  assert.match(textOf(pane.rows()[1]), /^ThinkingThe user wants me to:/)

  assert.equal(textOf(bash.querySelector('.claudseq-tool-name')), 'Bash')
  assert.equal(textOf(bash.querySelector('.claudseq-tool-summary')), 'echo sidecar-probe')
  assert.deepEqual(bash.querySelectorAll('.claudseq-io-label').map(textOf), ['IN', 'OUT'])
  assert.deepEqual(bash.querySelectorAll('.claudseq-io-text').map(textOf), ['echo sidecar-probe', 'sidecar-probe'])
  assert.equal(bash.getAttribute('data-claudseq-status'), 'ok')
  assert.equal(textOf(write.querySelector('.claudseq-tool-summary')), 'out.txt', 'a path in the working directory is shown relative to it')
  assert.equal(textOf(permission), 'Allowed Write for this session')
  assert.equal(textOf(done), 'Done.')

  assert.equal(textOf(agent.querySelector('.claudseq-tool-name')), 'Agent:', 'an agent is named the way the extension names it')
  assert.equal(textOf(agent.querySelector('.claudseq-tool-summary')), 'Read notes')
  assert.equal(agent.getAttribute('data-claudseq-status'), 'error', 'the interrupted agent ends red')
  assert.equal(agent.querySelectorAll('.claudseq-io-label').map(textOf).join(), 'IN', 'the launch notice meant for the model is not shown as OUT')
  assert.equal(textOf(agent.querySelector('.claudseq-steps-toggle')), 'Show 1 agent step')

  assert.equal(textOf(pane.rows()[14]), 'Tide pools are capt')
  assert.equal(textOf(pane.rows()[15]), 'Agent "Read notes" stopped')
  assert.equal(textOf(pane.rows()[16]), 'Interrupted')

  assert.equal(textOf(pane.part('model')), 'Haiku 4.5')
  assert.equal(textOf(pane.part('title')), 'First use the Bash tool to run exactly: echo sidecar-probe . Then use the Write tool to create out.txt containing hi. Do nothing else.')
  assert.equal(pane.part('send').getAttribute('data-claudseq-state'), 'send')

  pane.click(pane.action('slash'))
  await pane.idle()
  assert.deepEqual(pane.part('menu').querySelectorAll('.claudseq-menu-item').map(textOf), ['/compact', '/review', '/init', '/security-review'])
})

test('a pending permission offers Allow, Allow for this session and Deny, and each answers the bridge', async () => {
  const pane = await load({ settings: { openSession: SESSION }, bridge: bridgeFake({ sessions: [{ id: 'live-1', claudeSessionId: SESSION, cwd: GRAPH, busy: true, seq: 0, turnSeq: 1, turnStartedAt: '2026-09-18T02:35:24Z' }] }) })
  await ready(pane)
  await until(() => pane.bridge.streams.has('live-1'))
  const asked = fixture.findIndex((event) => event.type === 'control_request')
  pane.bridge.emit('live-1', fixture.slice(0, asked + 1))
  const card = await until(() => pane.rows().find((row) => row.getAttribute('data-claudseq-row') === 'permission'))

  assert.equal(card.getAttribute('data-claudseq-state'), 'pending')
  assert.equal(textOf(card.querySelector('.claudseq-permission-title')), 'Allow Write?')
  assert.equal(textOf(card.querySelector('.claudseq-permission-description')), 'out.txt')
  assert.equal(textOf(card.querySelector('.claudseq-permission-preview')), 'hi')
  assert.deepEqual(card.querySelectorAll('.claudseq-button').map(textOf), ['Allow', 'Allow for this session', 'Deny'])
  assert.equal(pane.part('send').getAttribute('data-claudseq-state'), 'stop', 'a turn waiting on a permission can be stopped')

  const requestId = fixture[asked].request_id
  pane.click(pane.action('allow', card))
  pane.click(pane.action('allow-session', card))
  card.querySelector('[data-claudseq-part="reason"]').value = 'Not in my notes folder.'
  pane.click(pane.action('deny', card))
  await pane.idle()
  const answers = pane.bridge.calls.filter((call) => call.path === '/v1/sessions/live-1/permissions').map((call) => call.body)
  assert.deepEqual(answers, [
    { requestId, behavior: 'allow', always: false },
    { requestId, behavior: 'allow', always: true },
    { requestId, behavior: 'deny', always: false, message: 'Not in my notes folder.' }
  ])

  pane.click(pane.part('send'))
  await pane.idle()
  assert.ok(pane.bridge.calls.some((call) => call.method === 'POST' && call.path === '/v1/sessions/live-1/interrupt'), 'Stop did not interrupt')

  pane.bridge.emit('live-1', [{ type: 'claudseq', subtype: 'permission_resolved', request_id: requestId, behavior: 'deny', always: false }])
  await until(() => textOf(pane.rows().find((row) => row.getAttribute('data-claudseq-row') === 'permission')) === 'Denied Write')
})

/* --------------------------------------------------------------- markdown */

test('Markdown is built from nodes, so markup in a reply stays text', async () => {
  const { context, doc, plugin } = await load()
  const opened = []
  const rendered = context.ClaudseqMarkdown.render(doc, [
    '<img src=x onerror=alert(1)>',
    '',
    'Some **bold**, *italic*, ~~gone~~ and `<b>code</b>`, [evil](javascript:alert(1)) and [docs](https://example.com/a).',
    '',
    '```html',
    '<script>alert(1)</script>',
    '```',
    '',
    '> <iframe src="https://example.com"></iframe>'
  ].join('\n'), { onLink: (url) => opened.push(url) })

  const all = descendants(rendered)
  for (const tag of ['IMG', 'SCRIPT', 'IFRAME', 'B']) {
    assert.deepEqual(all.filter((entry) => entry.tagName === tag), [], `a ${tag} element was created`)
  }
  const text = textOf(rendered)
  assert.ok(text.includes('<img src=x onerror=alert(1)>'))
  assert.ok(text.includes('<script>alert(1)</script>'))
  assert.ok(text.includes('<b>code</b>'))
  assert.ok(text.includes('[evil](javascript:alert(1))'), 'an unsafe link was not left as text')

  /* The quoted iframe stays text; only the https URL inside it is linked,
   * as a bare URL anywhere else would be. */
  assert.ok(text.includes('<iframe src="https://example.com"></iframe>'))
  const links = all.filter((entry) => entry.tagName === 'A')
  assert.deepEqual(links.map((link) => link.getAttribute('href')), ['https://example.com/a', 'https://example.com'])
  links[0].dispatch('click')
  assert.deepEqual(opened, ['https://example.com/a'])
  assert.deepEqual(all.filter((entry) => entry.tagName === 'STRONG').map(textOf), ['bold'])
  assert.deepEqual(all.filter((entry) => entry.tagName === 'EM').map(textOf), ['italic'])
  assert.deepEqual(all.filter((entry) => entry.tagName === 'DEL').map(textOf), ['gone'])
  assert.equal(all.find((entry) => entry.tagName === 'PRE').getAttribute('data-claudseq-lang'), 'html')
  assert.equal(plugin.opened.length, 0)
})

test('Markdown covers headings, nested and task lists, tables, quotes and rules', async () => {
  const { context, doc } = await load()
  const rendered = context.ClaudseqMarkdown.render(doc, [
    '## Plan',
    '1. First step',
    '   - nested *point*',
    '2. Second step',
    '',
    '- [x] done',
    '- [ ] open',
    '',
    '| Page | Blocks |',
    '| :--- | ---: |',
    '| journals | 12 |',
    '| pipe \\| cell | 3 |',
    '',
    '> quoted **text**',
    '',
    '---',
    'Visit https://example.com/x, then stop.'
  ].join('\n'), {})
  const all = descendants(rendered)
  const tags = (name) => all.filter((entry) => entry.tagName === name)

  assert.equal(textOf(tags('H2')[0]), 'Plan')
  const [ordered] = tags('OL')
  assert.equal(ordered.children.length, 2)
  assert.equal(textOf(ordered.children[0].querySelector('ul')), 'nested point')
  assert.deepEqual(tags('LI').filter((item) => item.attributes.has('data-claudseq-task')).map((item) => item.getAttribute('data-claudseq-task')), ['done', 'open'])
  assert.deepEqual(tags('TH').map(textOf), ['Page', 'Blocks'])
  assert.deepEqual(tags('TD').map(textOf), ['journals', '12', 'pipe | cell', '3'])
  assert.equal(tags('TD')[1].getAttribute('data-claudseq-align'), 'right')
  assert.equal(textOf(tags('BLOCKQUOTE')[0]), 'quoted text')
  assert.equal(tags('HR').length, 1)
  assert.deepEqual(tags('A').map((link) => link.getAttribute('href')), ['https://example.com/x'])
})

/* --------------------------------------------------------------- settings */

test('settings that are missing, mistyped or hand-edited fall back to the defaults', async () => {
  const { context } = await load()
  const defaults = {
    paneCollapsed: false,
    paneHeight: 440,
    openSession: '',
    model: 'default',
    effort: 'default',
    permissionMode: 'default',
    workingDirectory: ''
  }
  for (const raw of [null, undefined, 'nonsense', 42, [], {}]) {
    assert.deepEqual({ ...context.readSettings(raw) }, defaults, JSON.stringify(raw))
  }
  assert.deepEqual({ ...context.readSettings({
    paneCollapsed: 'yes',
    paneHeight: '900',
    openSession: '../../etc/passwd',
    model: '--dangerously-skip-permissions',
    effort: 'ultra',
    permissionMode: 'bypassPermissions',
    workingDirectory: 'relative/path'
  }) }, defaults)
  assert.deepEqual({ ...context.readSettings({
    paneCollapsed: true,
    paneHeight: 12,
    openSession: SESSION,
    model: 'opus',
    effort: 'xhigh',
    permissionMode: 'plan',
    workingDirectory: ' /Users/example/code '
  }) }, {
    paneCollapsed: true,
    paneHeight: 240,
    openSession: SESSION,
    model: 'opus',
    effort: 'xhigh',
    permissionMode: 'plan',
    workingDirectory: '/Users/example/code'
  })
})

test('a pane loaded with malformed settings still opens at its defaults', async () => {
  const pane = await load({ settings: { paneHeight: 'tall', paneCollapsed: 1, permissionMode: 'bypassPermissions', model: 7, openSession: 'nope' } })
  await ready(pane)
  assert.equal(pane.pane.style.getPropertyValue('--claudseq-height'), '440px')
  assert.ok(!pane.pane.attributes.has('data-claudseq-collapsed'))
  assert.equal(textOf(pane.part('mode')), 'Manual')
  assert.equal(textOf(pane.part('model')), 'Default')
  assert.ok(!pane.bridge.calls.some((call) => call.path === '/v1/transcript'), 'a malformed session id was opened')
  assert.equal(pane.part('input').getAttribute('placeholder'), '⌘ Esc to focus or unfocus Claude')
})

/* ----------------------------------------------------------------- bridge */

test('without a bridge the pane shows the exact install command, and Retry connects', async () => {
  const bridge = bridgeFake({ config: null })
  const pane = await load({ bridge })
  const status = await until(() => pane.part('status').getAttribute('data-claudseq-state') === 'missing' && pane.part('status'))
  assert.ok(pane.part('timeline').attributes.has('data-claudseq-hidden'))
  assert.equal(textOf(status.querySelector('[data-claudseq-part="install-command"]')), "node '/Users/example/.logseq/plugins/logseq-claudseq/bridge/claudseq-bridge.mjs' install")
  assert.deepEqual(plain(pane.actions.filter(([action]) => action === 'readFile')), [['readFile', '/Users/example/.claudseq/bridge.json']])

  bridge.state.config = CONFIG
  pane.click(pane.action('retry', status))
  await ready(pane)
  assert.equal(pane.bridge.calls.find((call) => call.path === '/v1/health').authorization, `Bearer ${'a'.repeat(64)}`)
})

test('an older bridge keeps working, and the pane says how to update it', async () => {
  const pane = await load()
  await ready(pane)
  pane.plugin.baseInfo = { version: '0.2.0' }
  pane.click(pane.action('new'))
  pane.plugin.graphChanged()
  pane.plugin.currentGraph = { path: '/Users/example/Other', name: 'other' }
  pane.plugin.graphChanged()
  const status = await until(() => !pane.part('status').attributes.has('data-claudseq-hidden') && pane.part('status').getAttribute('data-claudseq-state') === 'ready' && pane.part('status'))
  assert.match(textOf(status), /The bridge is version 0\.1\.0 and Claudseq is 0\.2\.0/)
  assert.match(textOf(status.querySelector('[data-claudseq-part="install-command"]')), /claudseq-bridge\.mjs' install$/)
  assert.ok(!pane.part('timeline').attributes.has('data-claudseq-hidden'), 'an older bridge blocked the pane')
})

test('a bridge that is down, or that cannot find claude, says so', async () => {
  const down = await load({ bridge: bridgeFake({ down: true }) })
  await until(() => down.part('status').getAttribute('data-claudseq-state') === 'down')
  assert.match(textOf(down.part('status')), /not answering on 127\.0\.0\.1:47816/)

  const missing = await load({ bridge: bridgeFake({ claudeFound: false }) })
  await until(() => missing.part('status').getAttribute('data-claudseq-state') === 'noclaude')
  assert.match(textOf(missing.part('status')), /could not find claude at \/opt\/homebrew\/bin\/claude/)
})

/* ---------------------------------------------------------------- session */

test('sending starts a session in the graph folder, with the chosen mode, and posts the prompt', async () => {
  const pane = await load({ settings: { permissionMode: 'acceptEdits', model: 'sonnet', effort: 'high' } })
  await ready(pane)
  const input = pane.part('input')

  input.value = 'Draft a page about tide pools'
  pane.pane.dispatch('keydown', { target: input, key: 'Enter', shiftKey: true })
  await pane.idle()
  assert.ok(!pane.bridge.calls.some((call) => call.method === 'POST'), 'Shift+Enter sent the prompt')

  pane.pane.dispatch('keydown', { target: input, key: 'Enter' })
  await until(() => pane.bridge.calls.some((call) => call.path === '/v1/sessions/live-1/messages'))
  const posts = pane.bridge.calls.filter((call) => call.method === 'POST')
  assert.deepEqual(posts.map((call) => call.path), ['/v1/sessions', '/v1/sessions/live-1/messages'])
  assert.deepEqual(posts[0].body, { cwd: GRAPH, model: 'sonnet', effort: 'high', mode: 'acceptEdits' })
  assert.deepEqual(posts[1].body, { text: 'Draft a page about tide pools' })
  await until(() => input.value === '')
  assert.equal(pane.plugin.settings.openSession, '00000000-0000-4000-8000-000000000001')
  assert.equal(textOf(pane.part('model')), 'Sonnet High')

  assert.equal(pane.part('send').getAttribute('data-claudseq-state'), 'stop')
  pane.bridge.emit('live-1', [{ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Draft a page about tide pools' }] }, parent_tool_use_id: null, session_id: '', claudseq: 'echo' }])
  await until(() => textOf(pane.part('title')) === 'Draft a page about tide pools')
  assert.deepEqual(pane.rows().map((row) => row.getAttribute('data-claudseq-row')), ['user'])

  pane.bridge.emit('live-1', [{ type: 'result', subtype: 'success', is_error: false }])
  await until(() => pane.part('send').getAttribute('data-claudseq-state') === 'send')
})

test('the toolbar counts running agents, names the model, effort and mode, and says when there is nothing to send', async () => {
  const notes = '/Users/example/notes'
  const pane = await load({ graph: notes, settings: { openSession: SESSION, effort: 'xhigh' }, bridge: bridgeFake({ sessions: [{ id: 'live-1', claudeSessionId: SESSION, cwd: notes, busy: false, seq: 0, turnSeq: 0 }] }) })
  await ready(pane)
  await until(() => pane.bridge.streams.has('live-1'))
  const agentTurn = fixture.findIndex((event) => event.type === 'user' && event.claudseq === 'echo' && /Agent tool/.test(event.message.content[0].text))
  const launched = fixture.findIndex((event, index) => index > agentTurn && event.subtype === 'background_tasks_changed')
  pane.bridge.emit('live-1', fixture.slice(0, launched + 1))
  await until(() => !pane.part('agents').attributes.has('data-claudseq-hidden'))

  assert.equal(textOf(pane.part('agents')), '1 agent')
  assert.equal(pane.part('agents').getAttribute('title'), '1 background agent running')
  assert.equal(textOf(pane.part('model')), 'Haiku 4.5 Extra high')
  assert.equal(pane.part('model').getAttribute('title'), 'Model and effort: Haiku 4.5 Extra high')
  assert.equal(pane.part('mode').getAttribute('aria-label'), 'Permission mode: Manual', 'the mode is named even where a narrow pane shows only the hand')
  assert.equal(pane.part('send').getAttribute('data-claudseq-state'), 'stop')
  assert.equal(pane.part('send').getAttribute('aria-disabled'), null, 'Stop is always live')

  const finished = fixture.findIndex((event, index) => index > launched && event.type === 'result')
  pane.bridge.emit('live-1', fixture.slice(launched + 1, finished + 1))
  await until(() => pane.part('send').getAttribute('data-claudseq-state') === 'send')
  assert.equal(pane.part('send').getAttribute('aria-disabled'), 'true', 'an empty composer has nothing to send')
  pane.part('input').value = 'Write about tide pools'
  pane.pane.dispatch('input', { target: pane.part('input') })
  assert.equal(pane.part('send').getAttribute('aria-disabled'), null)

  const cleared = fixture.findIndex((event, index) => index > finished && event.subtype === 'background_tasks_changed')
  pane.bridge.emit('live-1', fixture.slice(finished + 1, cleared + 1))
  await until(() => pane.part('agents').attributes.has('data-claudseq-hidden'))
})

test('dragging the top edge resizes the pane, never past 60% of the window', async () => {
  const pane = await load()
  await ready(pane)
  const drag = (from, to) => {
    pane.pane.dispatch('mousedown', { target: pane.part('resize'), clientY: from })
    const listener = (type) => pane.documentListeners.find((entry) => entry.type === type).handler
    listener('mousemove')({ clientY: to })
    listener('mouseup')({})
    return pane.plugin.updates.at(-1)
  }
  assert.deepEqual(plain(drag(500, 400)), { paneHeight: 540 })
  assert.equal(pane.pane.style.getPropertyValue('--claudseq-height'), '540px')
  assert.deepEqual(plain(drag(500, -2000)), { paneHeight: 600 }, 'the window is 1000px tall')
  assert.deepEqual(plain(drag(500, 3000)), { paneHeight: 240 })
  assert.ok(!pane.documentListeners.some((entry) => entry.type === 'mousemove'), 'the drag let go of the document')
})

test('the + button mentions the current page by its path in the graph folder', async () => {
  const pane = await load()
  await ready(pane)
  pane.part('input').value = 'Summarise'
  pane.click(pane.action('mention'))
  await until(() => pane.part('input').value !== 'Summarise')
  assert.equal(pane.part('input').value, 'Summarise @"pages/My Page.md" ')
})

test('the mode button cycles Manual, Accept edits, Plan and Auto, and tells a live session', async () => {
  const pane = await load({ settings: { openSession: SESSION }, bridge: bridgeFake({ sessions: [{ id: 'live-1', claudeSessionId: SESSION, cwd: GRAPH, busy: false, seq: 0, turnSeq: 0 }] }) })
  await ready(pane)
  await until(() => pane.bridge.streams.has('live-1'))
  const labels = []
  for (let step = 0; step < 4; step += 1) {
    pane.click(pane.part('mode'))
    await pane.idle()
    labels.push(textOf(pane.part('mode')))
  }
  assert.deepEqual(labels, ['Accept edits', 'Plan', 'Auto', 'Manual'])
  assert.equal(pane.plugin.settings.permissionMode, 'default')
  assert.deepEqual(pane.bridge.calls.filter((call) => call.path === '/v1/sessions/live-1/settings').map((call) => call.body.mode), ['acceptEdits', 'plan', 'auto', 'default'])

  pane.click(pane.part('model'))
  await pane.idle()
  pane.click(pane.part('menu').querySelector('[data-claudseq-value="opus"]'))
  await pane.idle()
  assert.equal(pane.plugin.settings.model, 'opus')
  assert.deepEqual(pane.bridge.calls.filter((call) => call.path === '/v1/sessions/live-1/settings').pop().body, { model: 'opus' })
})

/* ---------------------------------------------------------------- history */

test('history lists this folder\'s sessions, filters them, and reopens one', async () => {
  const id = '8a0c7d0e-5d51-4a4e-9a57-3f3c1b0f9e21'
  const history = [
    { id, title: 'Tidy the journal template', updated: Date.now() - 5 * 60_000, entrypoint: 'claude-vscode' },
    { id: '11111111-1111-4111-8111-111111111111', title: 'Rename tags', updated: Date.now() - 3 * 3_600_000, entrypoint: 'logseq-claudseq' }
  ]
  const transcripts = {
    [id]: {
      id,
      cwd: GRAPH,
      title: 'Tidy the journal template',
      records: [
        { type: 'user', message: { role: 'user', content: 'Tidy the journal template' } },
        { type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { description: 'Read templates', prompt: 'Read them' } }] } },
        { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'Two templates.' }] }] } },
        { type: 'assistant', message: { id: 'msg_2', role: 'assistant', content: [{ type: 'text', text: 'Done — **two** templates tidied.' }] } }
      ],
      agents: {
        toolu_1: { description: 'Read templates', records: [{ type: 'assistant', message: { id: 'msg_s', role: 'assistant', content: [{ type: 'text', text: 'Found two.' }] } }] }
      }
    }
  }
  const pane = await load({ bridge: bridgeFake({ history, transcripts }) })
  await ready(pane)

  pane.click(pane.action('history'))
  await until(() => pane.part('history-list').querySelectorAll('.claudseq-history-item').length === 2)
  assert.equal(pane.bridge.calls.find((call) => call.path === '/v1/history').query.cwd, GRAPH)
  const items = pane.part('history-list').querySelectorAll('.claudseq-history-item')
  assert.deepEqual(items.map((item) => textOf(item.querySelector('.claudseq-history-title'))), ['Tidy the journal template', 'Rename tags'])
  assert.deepEqual(items.map((item) => textOf(item.querySelector('.claudseq-badge'))), ['VS Code', 'Claudseq'])
  assert.equal(textOf(items[0].querySelector('.claudseq-history-meta').children[0]), '5m ago')

  const search = pane.part('search')
  search.value = 'rename'
  pane.pane.dispatch('input', { target: search })
  assert.deepEqual(pane.part('history-list').querySelectorAll('.claudseq-history-title').map(textOf), ['Rename tags'])
  assert.equal(pane.part('search'), search, 'filtering replaced the search field and lost its focus')
  search.value = ''
  pane.pane.dispatch('input', { target: search })

  const first = pane.part('history-list').querySelectorAll('.claudseq-history-item')[0]
  pane.click(pane.action('session-menu', first))
  await pane.idle()
  const refreshed = pane.part('history-list').querySelectorAll('.claudseq-history-item')[0]
  pane.click(pane.action('copy-resume', refreshed))
  await until(() => pane.copied.length)
  assert.deepEqual(pane.copied, [`claude --resume ${id}`])

  pane.click(pane.part('history-list').querySelectorAll('.claudseq-history-item')[0])
  await until(() => pane.rows().length === 3)
  assert.equal(pane.pane.getAttribute('data-claudseq-view'), 'timeline')
  assert.deepEqual(pane.rows().map((row) => row.getAttribute('data-claudseq-row')), ['user', 'tool', 'text'])
  assert.equal(textOf(pane.part('title')), 'Tidy the journal template')
  assert.equal(pane.plugin.settings.openSession, id)
  assert.equal(pane.rows()[1].getAttribute('data-claudseq-status'), 'ok')
  assert.equal(textOf(pane.rows()[1].querySelector('.claudseq-steps-toggle')), 'Show 1 agent step')

  /* The next message resumes that session rather than starting another. */
  pane.part('input').value = 'And the weekly one?'
  pane.pane.dispatch('keydown', { target: pane.part('input'), key: 'Enter' })
  await until(() => pane.bridge.calls.some((call) => call.method === 'POST' && call.path === '/v1/sessions'))
  assert.equal(pane.bridge.calls.find((call) => call.method === 'POST' && call.path === '/v1/sessions').body.resume, id)
})

test('opening a different graph switches the pane to that folder', async () => {
  const pane = await load()
  await ready(pane)
  pane.plugin.currentGraph = { path: '/Users/example/Work', name: 'work' }
  pane.plugin.graphChanged()
  await until(() => pane.bridge.calls.filter((call) => call.path === '/v1/health').length === 2)
  await ready(pane)
  pane.click(pane.action('history'))
  await until(() => pane.bridge.calls.some((call) => call.path === '/v1/history'))
  assert.equal(pane.bridge.calls.find((call) => call.path === '/v1/history').query.cwd, '/Users/example/Work')
})

test('⌘Esc is a command that moves focus to the composer and back', async () => {
  const pane = await load()
  await ready(pane)
  assert.equal(pane.plugin.command.options.key, 'claudseq-focus')
  assert.deepEqual(plain(pane.plugin.command.options.keybinding), { binding: 'mod+esc', mode: 'global' })
  await pane.plugin.command.handler()
  await until(() => pane.part('input').focused)
  pane.doc.activeElement = pane.part('input')
  pane.pane.dispatch('keydown', { target: pane.part('input'), key: 'Escape', metaKey: true })
  assert.equal(pane.part('input').focused, false)
})

test('the header folds the pane, and the fold is remembered', async () => {
  const pane = await load()
  await ready(pane)
  pane.click(pane.part('title'))
  await pane.idle()
  assert.ok(pane.pane.attributes.has('data-claudseq-collapsed'))
  assert.deepEqual(plain(pane.plugin.updates.at(-1)), { paneCollapsed: true })
  pane.click(pane.part('header'))
  await pane.idle()
  assert.ok(!pane.pane.attributes.has('data-claudseq-collapsed'))
})
