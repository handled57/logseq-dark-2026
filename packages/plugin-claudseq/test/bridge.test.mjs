/* Behavioral tests for the Claudseq bridge.
 *
 * The bridge runs in-process against a fake `claude` (test/fixtures/
 * fake-claude.mjs) that speaks the recorded stream-json protocol and logs
 * everything it receives. Requests go through `node:http` rather than
 * `fetch`, because `fetch` will not send a `Host` header of the caller's
 * choosing and the Host check is one of the things under test.
 *
 * Nothing here touches the real `~/.claudseq`, `~/.claude` or
 * `~/Library/LaunchAgents`: every directory the bridge reads or writes is a
 * temporary one handed to it, and `launchctl` is a script that records its
 * arguments and starts the installed bridge on a free port, as launchd would.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ALLOWED_ORIGIN, ENTRYPOINT, LABEL, claudeArgs, createBridge, install, listHistory,
  projectDirName, readTranscript, sessionScoped, status, titleOf, uninstall
} from '../bridge/claudseq-bridge.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = resolve(root, 'bridge/claudseq-bridge.mjs')
const fake = resolve(root, 'test/fixtures/fake-claude.mjs')
const TOKEN = 'test-token-0123456789abcdef0123456789'

const delay = (ms) => new Promise((settle) => setTimeout(settle, ms))

async function until(check, { timeout = 5000, step = 20 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('timed out waiting for a condition')
    await delay(step)
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function call(port, { method = 'GET', path = '/v1/health', token = TOKEN, host = `127.0.0.1:${port}`, origin, body, headers = {} } = {}) {
  return new Promise((settle, fail) => {
    const req = request({
      host: '127.0.0.1',
      port,
      method,
      path,
      setHost: false,
      headers: {
        Host: host,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      }
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(text) } catch {}
        settle({ status: res.statusCode, headers: res.headers, json, text })
      })
    })
    req.on('error', fail)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

/* An NDJSON event stream, collected as it arrives. */
function stream(port, id, after = 0) {
  const events = []
  let res = null
  const req = request({
    host: '127.0.0.1',
    port,
    path: `/v1/sessions/${id}/events?after=${after}`,
    headers: { Authorization: `Bearer ${TOKEN}` }
  }, (response) => {
    res = response
    let buffer = ''
    response.setEncoding('utf8')
    response.on('data', (chunk) => {
      buffer += chunk
      let newline
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const entry = JSON.parse(line)
        if (entry.seq) events.push(entry)
      }
    })
  })
  req.on('error', () => {})
  req.end()
  return {
    events,
    find: (predicate) => until(() => events.find((entry) => predicate(entry.event))),
    close: () => { req.destroy(); res?.destroy() }
  }
}

async function start(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'claudseq-bridge-'))
  const log = join(dir, 'fake.log')
  const cwd = join(dir, 'graph with spaces ~')
  await mkdir(cwd)
  const bridge = createBridge({
    token: TOKEN,
    claudePath: fake,
    projectsDir: join(dir, 'projects'),
    env: { ...process.env, FAKE_CLAUDE_LOG: log, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
    killGraceMs: 500,
    log: () => {},
    ...options
  })
  const port = await bridge.listen()
  const fakeLog = async () => (await readFile(log, 'utf8').catch(() => ''))
    .split('\n').filter(Boolean).map((line) => JSON.parse(line))
  return {
    bridge,
    port,
    dir,
    cwd,
    fakeLog,
    async open(body = {}) {
      const created = await call(port, { method: 'POST', path: '/v1/sessions', body: { cwd, ...body } })
      assert.equal(created.status, 201, created.text)
      return created.json
    },
    async close() {
      await bridge.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

test('a request without the token, or with a wrong one, is refused', async () => {
  const bridge = await start()
  try {
    assert.equal((await call(bridge.port, { token: null })).status, 401)
    assert.equal((await call(bridge.port, { token: 'wrong-token-0123456789abcdef0123456789' })).status, 401)
    assert.equal((await call(bridge.port, { token: TOKEN.slice(0, -1) })).status, 401)
    assert.equal((await call(bridge.port, { headers: { Authorization: TOKEN } })).status, 401)
    const health = await call(bridge.port)
    assert.equal(health.status, 200)
    assert.equal(health.json.ok, true)
    assert.equal(health.json.claudeFound, true)
  } finally {
    await bridge.close()
  }
})

test('a request for any other Host is refused, so a rebound name reaches nothing', async () => {
  const bridge = await start()
  try {
    for (const host of [`localhost:${bridge.port}`, 'evil.example', `127.0.0.1:${bridge.port + 1}`, `127.0.0.1`]) {
      const refused = await call(bridge.port, { host })
      assert.equal(refused.status, 403, host)
      assert.equal(refused.json.error, 'bad_host')
    }
  } finally {
    await bridge.close()
  }
})

test('CORS admits only the plugin origin, and the token still decides', async () => {
  const bridge = await start()
  try {
    const preflight = await call(bridge.port, {
      method: 'OPTIONS',
      token: null,
      origin: ALLOWED_ORIGIN,
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
        'Access-Control-Request-Private-Network': 'true'
      }
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers['access-control-allow-origin'], 'file://')
    assert.match(preflight.headers['access-control-allow-headers'], /authorization/)
    assert.equal(preflight.headers['access-control-allow-private-network'], 'true')

    const allowed = await call(bridge.port, { origin: ALLOWED_ORIGIN })
    assert.equal(allowed.status, 200)
    assert.equal(allowed.headers['access-control-allow-origin'], 'file://')

    /* A 401 still carries CORS headers, so the pane can tell a stale token
     * from a bridge that is not running. */
    const stale = await call(bridge.port, { origin: ALLOWED_ORIGIN, token: 'stale-token-0123456789abcdef0123456789' })
    assert.equal(stale.status, 401)
    assert.equal(stale.headers['access-control-allow-origin'], 'file://')

    for (const origin of ['null', 'https://evil.example', 'http://127.0.0.1:3000']) {
      const refused = await call(bridge.port, { origin })
      assert.equal(refused.status, 403, origin)
      assert.equal(refused.headers['access-control-allow-origin'], undefined)
      const preflightRefused = await call(bridge.port, { method: 'OPTIONS', token: null, origin })
      assert.equal(preflightRefused.status, 403, origin)
    }
  } finally {
    await bridge.close()
  }
})

test('a prompt reaches claude on stdin unchanged, and never through a shell', async () => {
  const bridge = await start()
  try {
    const session = await bridge.open()
    const events = stream(bridge.port, session.id)
    const text = '$(touch pwned) `touch pwned2`; rm -rf x && echo "quoted" \'single\'\n\\n'
    const sent = await call(bridge.port, { method: 'POST', path: `/v1/sessions/${session.id}/messages`, body: { text } })
    assert.equal(sent.status, 202)
    await events.find((event) => event.type === 'result')
    events.close()

    const log = await bridge.fakeLog()
    const received = log.filter((entry) => entry.stdin).map((entry) => JSON.parse(entry.stdin))
    assert.deepEqual(received, [{
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
      session_id: ''
    }])
    assert.ok(!log[0].argv.some((arg) => arg.includes('touch')), 'the prompt reached argv')
    for (const name of ['pwned', 'pwned2']) {
      await assert.rejects(access(join(bridge.cwd, name), constants.F_OK), `${name} was created`)
      await assert.rejects(access(join(root, name), constants.F_OK), `${name} was created`)
    }
    assert.equal(log[0].cwd, await import('node:fs/promises').then(({ realpath }) => realpath(bridge.cwd)))
  } finally {
    await bridge.close()
  }
})

test('claude starts with the host protocol, an entrypoint of its own and no bypass', async () => {
  const bridge = await start()
  try {
    const fresh = await bridge.open({ model: 'opus', effort: 'high', mode: 'default' })
    await until(async () => (await bridge.fakeLog()).length)
    const [first] = await bridge.fakeLog()
    assert.deepEqual(first.argv, claudeArgs({ sessionId: fresh.claudeSessionId, model: 'opus', effort: 'high', mode: 'default' }))
    assert.deepEqual(first.argv.slice(0, 2), ['-p', '--input-format'])
    for (const [flag, value] of [
      ['--input-format', 'stream-json'],
      ['--output-format', 'stream-json'],
      ['--permission-prompt-tool', 'stdio'],
      ['--permission-prompts', 'host'],
      ['--thinking-display', 'summarized'],
      ['--permission-mode', 'manual'],
      ['--model', 'opus'],
      ['--effort', 'high'],
      ['--session-id', fresh.claudeSessionId]
    ]) {
      assert.equal(first.argv[first.argv.indexOf(flag) + 1], value, flag)
    }
    assert.ok(!first.argv.includes('--resume'))
    assert.ok(!first.argv.some((arg) => /bypass|dangerously/i.test(arg)))
    /* A bridge started from inside a Claude Code terminal still spawns
     * ordinary, persisted sessions. */
    assert.deepEqual(first.env, { entrypoint: ENTRYPOINT, claudecode: null })

    const refused = await call(bridge.port, { method: 'POST', path: '/v1/sessions', body: { cwd: bridge.cwd, mode: 'bypassPermissions' } })
    assert.equal(refused.status, 400)
    assert.equal(refused.json.error, 'bad_mode')
    for (const body of [{ cwd: 'relative/path' }, { cwd: join(bridge.cwd, 'missing') }, { cwd: bridge.cwd, model: '--dangerously-skip-permissions' }, { cwd: bridge.cwd, effort: 'ultra' }, { cwd: bridge.cwd, resume: '../../etc' }]) {
      const bad = await call(bridge.port, { method: 'POST', path: '/v1/sessions', body })
      assert.equal(bad.status, 400, JSON.stringify(body))
    }
  } finally {
    await bridge.close()
  }
})

test('resuming passes --resume with the session id, and a running session is reused', async () => {
  const bridge = await start()
  try {
    const id = '8a0c7d0e-5d51-4a4e-9a57-3f3c1b0f9e21'
    const resumed = await bridge.open({ resume: id })
    assert.equal(resumed.claudeSessionId, id)
    await until(async () => (await bridge.fakeLog()).length)
    const [first] = await bridge.fakeLog()
    assert.equal(first.argv[first.argv.indexOf('--resume') + 1], id)
    assert.ok(!first.argv.includes('--session-id'))

    const again = await call(bridge.port, { method: 'POST', path: '/v1/sessions', body: { cwd: bridge.cwd, resume: id } })
    assert.equal(again.status, 200)
    assert.equal(again.json.id, resumed.id)
    assert.equal((await bridge.fakeLog()).filter((entry) => entry.argv).length, 1, 'a second claude was started')
  } finally {
    await bridge.close()
  }
})

test('a permission request round-trips as allow, scoped to this session only', async () => {
  const bridge = await start()
  try {
    const session = await bridge.open()
    const events = stream(bridge.port, session.id)
    await call(bridge.port, { method: 'POST', path: `/v1/sessions/${session.id}/messages`, body: { text: 'needs permission' } })
    const asked = await events.find((event) => event.type === 'control_request')
    assert.equal(asked.event.request.subtype, 'can_use_tool')

    const listed = await call(bridge.port, { path: '/v1/sessions' })
    assert.deepEqual(listed.json.sessions[0].pending, [asked.event.request_id])

    const answered = await call(bridge.port, {
      method: 'POST',
      path: `/v1/sessions/${session.id}/permissions`,
      body: { requestId: asked.event.request_id, behavior: 'allow', always: true }
    })
    assert.equal(answered.status, 200)
    await events.find((event) => event.type === 'result')
    const resolved = events.events.find((entry) => entry.event.type === 'claudseq' && entry.event.subtype === 'permission_resolved')
    assert.deepEqual(resolved.event, { type: 'claudseq', subtype: 'permission_resolved', request_id: asked.event.request_id, behavior: 'allow', always: true })
    events.close()

    const reply = (await bridge.fakeLog()).map((entry) => entry.stdin && JSON.parse(entry.stdin)).find((message) => message?.type === 'control_response')
    assert.deepEqual(reply, {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: asked.event.request_id,
        response: {
          behavior: 'allow',
          updatedInput: { file_path: '/tmp/claudseq-fake/out.txt', content: 'hi' },
          updatedPermissions: [
            { type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'session' },
            { type: 'setMode', mode: 'acceptEdits', destination: 'session' }
          ]
        }
      }
    })

    const again = await call(bridge.port, {
      method: 'POST',
      path: `/v1/sessions/${session.id}/permissions`,
      body: { requestId: asked.event.request_id, behavior: 'allow' }
    })
    assert.equal(again.status, 404, 'a request can be answered once')
  } finally {
    await bridge.close()
  }
})

test('a permission request round-trips as deny, with the reason given', async () => {
  const bridge = await start()
  try {
    const session = await bridge.open()
    const events = stream(bridge.port, session.id)
    await call(bridge.port, { method: 'POST', path: `/v1/sessions/${session.id}/messages`, body: { text: 'needs permission' } })
    const asked = await events.find((event) => event.type === 'control_request')
    await call(bridge.port, {
      method: 'POST',
      path: `/v1/sessions/${session.id}/permissions`,
      body: { requestId: asked.event.request_id, behavior: 'deny', message: 'Not in my notes folder.' }
    })
    const failed = await events.find((event) => event.type === 'user' && event.message.content[0]?.type === 'tool_result')
    assert.equal(failed.event.message.content[0].is_error, true)
    events.close()

    const reply = (await bridge.fakeLog()).map((entry) => entry.stdin && JSON.parse(entry.stdin)).find((message) => message?.type === 'control_response')
    assert.deepEqual(reply.response.response, { behavior: 'deny', message: 'Not in my notes folder.' })
    assert.equal(reply.response.response.updatedPermissions, undefined)
  } finally {
    await bridge.close()
  }
})

test('every suggestion is rewritten to the session, and bypass is never granted', () => {
  assert.deepEqual(sessionScoped([
    { type: 'addRules', destination: 'localSettings' },
    { type: 'addDirectories', directories: ['/x'], destination: 'userSettings' },
    { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
    null,
    'nonsense'
  ]), [
    { type: 'addRules', destination: 'session' },
    { type: 'addDirectories', directories: ['/x'], destination: 'session' }
  ])
  assert.deepEqual(sessionScoped(undefined), [])
})

test('interrupt, permission mode and model changes are forwarded as control requests', async () => {
  const bridge = await start()
  try {
    const session = await bridge.open()
    const events = stream(bridge.port, session.id)
    await call(bridge.port, { method: 'POST', path: `/v1/sessions/${session.id}/messages`, body: { text: 'be slow' } })
    await events.find((event) => event.type === 'stream_event')

    const stopped = await call(bridge.port, { method: 'POST', path: `/v1/sessions/${session.id}/interrupt` })
    assert.equal(stopped.status, 202)
    const result = await events.find((event) => event.type === 'result')
    assert.equal(result.event.subtype, 'error_during_execution')

    const mode = await call(bridge.port, { method: 'POST', path: `/v1/sessions/${session.id}/settings`, body: { mode: 'acceptEdits' } })
    assert.equal(mode.status, 202)
    const model = await call(bridge.port, { method: 'POST', path: `/v1/sessions/${session.id}/settings`, body: { model: 'sonnet' } })
    assert.equal(model.status, 202)
    const manual = await call(bridge.port, { method: 'POST', path: `/v1/sessions/${session.id}/settings`, body: { mode: 'default' } })
    assert.equal(manual.status, 202)
    const bypass = await call(bridge.port, { method: 'POST', path: `/v1/sessions/${session.id}/settings`, body: { mode: 'bypassPermissions' } })
    assert.equal(bypass.status, 400)
    await until(async () => (await bridge.fakeLog()).filter((entry) => entry.stdin?.includes('control_request')).length === 4)
    events.close()

    const requests = (await bridge.fakeLog())
      .map((entry) => entry.stdin && JSON.parse(entry.stdin))
      .filter((message) => message?.type === 'control_request')
      .map((message) => message.request)
    assert.deepEqual(requests, [
      { subtype: 'interrupt' },
      { subtype: 'set_permission_mode', mode: 'acceptEdits' },
      { subtype: 'set_model', model: 'sonnet' },
      { subtype: 'set_permission_mode', mode: 'manual' }
    ])
  } finally {
    await bridge.close()
  }
})

test('a pane that reconnects replays the session, and a finished turn drops its chunks', async () => {
  const bridge = await start()
  try {
    const session = await bridge.open()
    const first = stream(bridge.port, session.id)
    await call(bridge.port, { method: 'POST', path: `/v1/sessions/${session.id}/messages`, body: { text: 'be slow' } })
    await first.find((event) => event.type === 'stream_event')
    first.close()

    /* Mid-turn: the prompt and its partial chunks are all there. */
    const midTurn = stream(bridge.port, session.id)
    await midTurn.find((event) => event.type === 'stream_event' && event.event.delta?.text === 'Tide pools are')
    assert.equal(midTurn.events[0].event.claudseq, 'echo')
    await call(bridge.port, { method: 'POST', path: `/v1/sessions/${session.id}/interrupt` })
    const ended = await midTurn.find((event) => event.type === 'result')
    midTurn.close()

    const replay = stream(bridge.port, session.id)
    await replay.find((event) => event.type === 'result')
    assert.ok(!replay.events.some((entry) => entry.event.type === 'stream_event'), 'finished chunks were replayed')
    assert.equal(replay.events[0].event.claudseq, 'echo')
    replay.close()

    const later = stream(bridge.port, session.id, ended.seq)
    await delay(100)
    assert.deepEqual(later.events, [])
    later.close()
  } finally {
    await bridge.close()
  }
})

test('a closed session kills its claude', async () => {
  const bridge = await start()
  try {
    const session = await bridge.open()
    assert.ok(alive(session.pid))
    const closed = await call(bridge.port, { method: 'DELETE', path: `/v1/sessions/${session.id}` })
    assert.equal(closed.status, 200)
    await until(() => !alive(session.pid))
    assert.equal((await call(bridge.port, { path: `/v1/sessions/${session.id}/events` })).status, 404)
  } finally {
    await bridge.close()
  }
})

test('a session no pane is attached to is closed after the idle timeout', async () => {
  const bridge = await start({ idleMs: 200 })
  try {
    const watched = await bridge.open()
    const events = stream(bridge.port, watched.id)
    const idle = await bridge.open({ cwd: bridge.cwd })
    await until(() => !alive(idle.pid))
    assert.ok(alive(watched.pid), 'an attached session was closed')
    events.close()
    await until(() => !alive(watched.pid))
    assert.equal(bridge.bridge.sessions.size, 0)
  } finally {
    await bridge.close()
  }
})

test('a missing claude is reported rather than spawned', async () => {
  const bridge = await start({ claudePath: '/nonexistent/claude' })
  try {
    assert.equal((await call(bridge.port)).json.claudeFound, false)
    const refused = await call(bridge.port, { method: 'POST', path: '/v1/sessions', body: { cwd: bridge.cwd } })
    assert.equal(refused.status, 424)
    assert.equal(refused.json.error, 'claude_not_found')
  } finally {
    await bridge.close()
  }
})

async function freePort() {
  return new Promise((settle) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => settle(port))
    })
  })
}

test('shutting the bridge down kills every claude it started', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claudseq-serve-'))
  const port = await freePort()
  await writeFile(join(dir, 'bridge.json'), JSON.stringify({ port, token: TOKEN, claudePath: fake }), { mode: 0o600 })
  const server = spawn(process.execPath, [script, 'serve'], {
    env: { ...process.env, CLAUDSEQ_STATE_DIR: dir, CLAUDSEQ_PROJECTS_DIR: join(dir, 'projects') },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  try {
    await until(async () => (await call(port).catch(() => ({}))).status === 200)
    const created = await call(port, { method: 'POST', path: '/v1/sessions', body: { cwd: dir } })
    assert.equal(created.status, 201)
    const pid = created.json.pid
    assert.ok(alive(pid))

    const exited = new Promise((settle) => server.on('exit', (code) => settle(code)))
    server.kill('SIGTERM')
    assert.equal(await exited, 0)
    await until(() => !alive(pid))
  } finally {
    if (server.exitCode === null) server.kill('SIGKILL')
    await rm(dir, { recursive: true, force: true })
  }
})

/* ----------------------------------------------------------------- history */

async function writeSession(projects, cwdDir, id, lines, mtime) {
  await mkdir(join(projects, cwdDir), { recursive: true })
  const path = join(projects, cwdDir, `${id}.jsonl`)
  await writeFile(path, lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n')
  if (mtime) await utimes(path, mtime, mtime)
  return path
}

const user = (cwd, text, extra = {}) => ({ type: 'user', cwd, entrypoint: 'cli', message: { role: 'user', content: text }, ...extra })

test('history lists only this folder, newest first, with titles in the stated order', async () => {
  const projects = await mkdtemp(join(tmpdir(), 'claudseq-projects-'))
  const cwd = '/Users/example/Library/Mobile Documents/iCloud~com~logseq~logseq/Documents/Logseq'
  const folder = projectDirName(cwd)
  assert.equal(folder, '-Users-example-Library-Mobile-Documents-iCloud-com-logseq-logseq-Documents-Logseq')
  const ids = {
    custom: '11111111-1111-4111-8111-111111111111',
    ai: '22222222-2222-4222-8222-222222222222',
    prompt: '33333333-3333-4333-8333-333333333333',
    elsewhere: '44444444-4444-4444-8444-444444444444',
    sidechain: '55555555-5555-4555-8555-555555555555',
    empty: '66666666-6666-4666-8666-666666666666'
  }
  try {
    await writeSession(projects, folder, ids.custom, [
      user(cwd, 'first prompt', { entrypoint: 'claude-vscode' }),
      { type: 'ai-title', aiTitle: 'An AI title' },
      { type: 'custom-title', customTitle: 'My own title' },
      { type: 'last-prompt', lastPrompt: 'a later prompt' }
    ], new Date('2026-09-10T10:00:00Z'))
    await writeSession(projects, folder, ids.ai, [
      user(cwd, 'the first prompt', { entrypoint: ENTRYPOINT }),
      '{"type":"assistant", this line is torn',
      { type: 'ai-title', aiTitle: 'First AI title' },
      { type: 'ai-title', aiTitle: 'Latest AI title' }
    ], new Date('2026-09-12T10:00:00Z'))
    await writeSession(projects, folder, ids.prompt, [
      user(cwd, '<local-command-caveat>Caveat: ignore this</local-command-caveat>', { isMeta: true }),
      user(cwd, [{ type: 'text', text: 'What does   this\nblock do?' }]),
      { type: 'last-prompt', lastPrompt: 'a later prompt' },
      'not json at all'
    ], new Date('2026-09-11T10:00:00Z'))
    await writeSession(projects, folder, ids.elsewhere, [user('/Users/example/other', 'elsewhere')], new Date('2026-09-13T10:00:00Z'))
    await writeSession(projects, folder, ids.sidechain, [user(cwd, 'agent work', { isSidechain: true })], new Date('2026-09-14T10:00:00Z'))
    await writeSession(projects, folder, ids.empty, [{ type: 'summary', cwd }], new Date('2026-09-15T10:00:00Z'))
    await writeFile(join(projects, folder, 'not-a-session.jsonl'), JSON.stringify(user(cwd, 'x')))
    await writeSession(projects, projectDirName('/Users/example/other'), ids.elsewhere, [user('/Users/example/other', 'elsewhere')])

    const sessions = await listHistory(projects, cwd)
    assert.deepEqual(sessions.map(({ id, title, entrypoint }) => ({ id, title, entrypoint })), [
      { id: ids.ai, title: 'Latest AI title', entrypoint: ENTRYPOINT },
      { id: ids.prompt, title: 'What does this block do?', entrypoint: 'cli' },
      { id: ids.custom, title: 'My own title', entrypoint: 'claude-vscode' }
    ])
    assert.ok(sessions.every((session) => typeof session.updated === 'number'))
    assert.deepEqual(await listHistory(projects, '/Users/example/nowhere'), [])
  } finally {
    await rm(projects, { recursive: true, force: true })
  }
})

test('a title falls back from custom title to AI title to the first prompt', () => {
  const cwd = '/x'
  assert.equal(titleOf([user(cwd, 'first'), { type: 'ai-title', aiTitle: 'AI' }, { type: 'custom-title', customTitle: 'Mine' }]), 'Mine')
  assert.equal(titleOf([user(cwd, 'first'), { type: 'ai-title', aiTitle: 'AI' }]), 'AI')
  assert.equal(titleOf([user(cwd, 'first'), { type: 'last-prompt', lastPrompt: 'last' }]), 'first')
  assert.equal(titleOf([user(cwd, '<command-name>/compact</command-name><command-args></command-args>')]), '/compact')
  assert.equal(titleOf([{ type: 'last-prompt', lastPrompt: 'only the last' }]), 'only the last')
  assert.equal(titleOf([]), null)
  assert.equal(titleOf([user(cwd, 'x'.repeat(500))]).length, 200)
})

test('a transcript is read with its subagents grouped under the Agent call', async () => {
  const projects = await mkdtemp(join(tmpdir(), 'claudseq-projects-'))
  const cwd = '/Users/example/notes'
  const id = '77777777-7777-4777-8777-777777777777'
  const folder = projectDirName(cwd)
  try {
    await writeSession(projects, folder, id, [
      { type: 'queue-operation', operation: 'enqueue' },
      user(cwd, 'Summarise my notes', { uuid: 'u1' }),
      { type: 'assistant', cwd, uuid: 'a1', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'thinking', thinking: 'Plan it', signature: 'SIGNATURE' }] } },
      { type: 'assistant', cwd, uuid: 'a2', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: { description: 'Read notes', prompt: 'Read them' } }] } },
      { type: 'assistant', cwd, uuid: 'a2', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: {} }] } },
      user(cwd, [{ type: 'tool_result', tool_use_id: 'toolu_agent', content: [{ type: 'text', text: 'x'.repeat(30_000) }, { type: 'image' }] }], { uuid: 'u2' }),
      user(cwd, 'hidden', { isMeta: true, uuid: 'u3' }),
      { type: 'attachment', attachment: {} },
      { type: 'ai-title', aiTitle: 'Notes summary' }
    ])
    await mkdir(join(projects, folder, id, 'subagents'), { recursive: true })
    await writeFile(join(projects, folder, id, 'subagents', 'agent-abc123.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Read notes', toolUseId: 'toolu_agent' }))
    await writeFile(join(projects, folder, id, 'subagents', 'agent-abc123.jsonl'), [
      JSON.stringify({ type: 'user', isSidechain: true, uuid: 's1', message: { role: 'user', content: 'Read them' } }),
      JSON.stringify({ type: 'assistant', isSidechain: true, uuid: 's2', message: { id: 'msg_s', role: 'assistant', content: [{ type: 'text', text: 'Found two notes.' }] } })
    ].join('\n'))

    const transcript = await readTranscript(projects, cwd, id)
    assert.equal(transcript.title, 'Notes summary')
    assert.deepEqual(transcript.records.map((record) => record.uuid), ['u1', 'a1', 'a2', 'u2'])
    assert.equal(transcript.records[1].message.content[0].signature, undefined)
    const result = transcript.records[3].message.content[0]
    assert.equal(result.type, 'tool_result')
    assert.ok(result.content[0].text.length < 20_100)
    assert.deepEqual(result.content[1], { type: 'text', text: '[image]' })
    assert.deepEqual(Object.keys(transcript.agents), ['toolu_agent'])
    assert.equal(transcript.agents.toolu_agent.description, 'Read notes')
    assert.deepEqual(transcript.agents.toolu_agent.records.map((record) => record.uuid), ['s1', 's2'])

    await assert.rejects(readTranscript(projects, cwd, '../../../etc/passwd'), /bad_session_id/)
    await assert.rejects(readTranscript(projects, cwd, '88888888-8888-4888-8888-888888888888'), /no_such_session/)
    await assert.rejects(readTranscript(projects, '/Users/example/elsewhere', id), /no_such_session/)
  } finally {
    await rm(projects, { recursive: true, force: true })
  }
})

test('history and transcripts are served over the authenticated API', async () => {
  const bridge = await start()
  try {
    const id = '99999999-9999-4999-8999-999999999999'
    await writeSession(join(bridge.dir, 'projects'), projectDirName(bridge.cwd), id, [user(bridge.cwd, 'hello there')])
    const history = await call(bridge.port, { path: `/v1/history?cwd=${encodeURIComponent(bridge.cwd)}` })
    assert.equal(history.status, 200)
    assert.deepEqual(history.json.sessions.map((session) => session.title), ['hello there'])
    const transcript = await call(bridge.port, { path: `/v1/transcript?cwd=${encodeURIComponent(bridge.cwd)}&id=${id}` })
    assert.equal(transcript.status, 200)
    assert.equal(transcript.json.records.length, 1)
    assert.equal((await call(bridge.port, { path: '/v1/history?cwd=relative' })).status, 400)
    assert.equal((await call(bridge.port, { path: `/v1/transcript?cwd=${encodeURIComponent(bridge.cwd)}&id=nope` })).status, 400)
    assert.equal((await call(bridge.port, { path: `/v1/history?cwd=${encodeURIComponent(bridge.cwd)}`, token: null })).status, 401)
  } finally {
    await bridge.close()
  }
})

/* ----------------------------------------------------------------- install */

/* A stand-in for `launchctl` that records its arguments. With `serve`, it
 * also does what launchd does with the agent: `bootstrap` starts the
 * installed bridge in the background, a moment later, and `bootout` stops it
 * and waits for it to exit. Its output goes to a file, never to the pipes
 * `install` reads, or `install` would wait on them for as long as it runs. */
async function fakeLaunchctl(dir, { serve = false } = {}) {
  const launchctl = join(dir, 'launchctl')
  const calls = join(dir, 'launchctl.log')
  const pidFile = join(dir, 'serve.pid')
  const lines = ['#!/bin/sh', `echo "$@" >> '${calls}'`]
  if (serve) {
    lines.push(
      'case "$1" in',
      `  bootout) if [ -f '${pidFile}' ]; then pid="$(cat '${pidFile}')"; kill "$pid" 2>/dev/null; while kill -0 "$pid" 2>/dev/null; do sleep 0.05; done; rm -f '${pidFile}'; fi ;;`,
      `  bootstrap) (sleep 0.3; exec env CLAUDSEQ_STATE_DIR='${join(dir, 'state')}' '${process.execPath}' '${join(dir, 'state', 'claudseq-bridge.mjs')}' serve) </dev/null >>'${join(dir, 'serve.log')}' 2>&1 & echo $! > '${pidFile}' ;;`,
      'esac'
    )
  }
  await writeFile(launchctl, lines.join('\n') + '\n')
  await chmod(launchctl, 0o755)
  return { launchctl, calls, pidFile }
}

test('install writes a private config and a login agent, waits for the bridge to answer, and uninstall removes both', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claudseq-install-'))
  const { launchctl, calls, pidFile } = await fakeLaunchctl(dir, { serve: true })
  const port = await freePort()
  const env = {
    ...process.env,
    SHELL: '/bin/sh',
    CLAUDSEQ_STATE_DIR: join(dir, 'state'),
    CLAUDSEQ_LAUNCH_AGENTS_DIR: join(dir, 'agents'),
    CLAUDSEQ_LAUNCHCTL: launchctl,
    CLAUDSEQ_CLAUDE: fake
  }
  try {
    const said = []
    const config = await install(['--port', String(port)], env, (line) => said.push(line))
    /* Answering means the bridge started from the agent is up with the token
     * this install wrote. */
    const running = said.find((line) => line.includes('running: pid'))
    assert.ok(running, `install did not say the bridge is running:\n${said.join('\n')}`)
    const health = await call(port, { token: config.token })
    assert.equal(health.status, 200)
    assert.equal(running.trim(), `running: pid ${health.json.pid}`)
    const checked = []
    assert.equal(await status(env, (line) => checked.push(line)), true)
    assert.match(checked.join('\n'), /"ok":true/)

    const written = JSON.parse(await readFile(join(dir, 'state', 'bridge.json'), 'utf8'))
    assert.deepEqual(written, config)
    assert.equal(written.port, port)
    assert.equal(written.claudePath, fake)
    assert.match(written.token, /^[0-9a-f]{64}$/)
    assert.equal((await stat(join(dir, 'state', 'bridge.json'))).mode & 0o777, 0o600)
    assert.equal((await stat(join(dir, 'state'))).mode & 0o777, 0o700)
    assert.deepEqual(await readFile(join(dir, 'state', 'claudseq-bridge.mjs')), await readFile(script))

    const plist = await readFile(join(dir, 'agents', `${LABEL}.plist`), 'utf8')
    assert.ok(plist.includes(`<string>${process.execPath}</string>`))
    assert.ok(plist.includes(`<string>${join(dir, 'state', 'claudseq-bridge.mjs')}</string>`))
    assert.ok(plist.includes('<string>serve</string>'))
    assert.ok(!plist.includes(written.token), 'the token leaked into the plist')

    const uid = process.getuid()
    assert.deepEqual((await readFile(calls, 'utf8')).trim().split('\n'), [
      `bootout gui/${uid}/${LABEL}`,
      `bootstrap gui/${uid} ${join(dir, 'agents', `${LABEL}.plist`)}`
    ])

    /* A reinstall replaces the running bridge: the old token stops working
     * and the new one is answered before install returns. */
    const firstPid = health.json.pid
    const second = await install([], env, () => {})
    assert.equal(second.port, port, 'a reinstall moved the port')
    assert.notEqual(second.token, config.token, 'a reinstall kept the old token')
    assert.equal((await call(port, { token: second.token })).status, 200)
    assert.equal((await call(port, { token: config.token })).status, 401)
    assert.equal(alive(firstPid), false, 'the first bridge outlived its reinstall')

    await uninstall(env, () => {})
    await assert.rejects(access(join(dir, 'agents', `${LABEL}.plist`), constants.F_OK))
    await assert.rejects(access(join(dir, 'state'), constants.F_OK))
    await assert.rejects(access(pidFile, constants.F_OK))
    await assert.rejects(call(port, { token: second.token }), 'a bridge still answers after uninstall')
  } finally {
    const pid = Number(await readFile(pidFile, 'utf8').catch(() => ''))
    if (pid && alive(pid)) process.kill(pid)
    await rm(dir, { recursive: true, force: true })
  }
})

test('the bridge runs its command when it is started through a symlink', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claudseq-link-'))
  const link = join(dir, 'linked', 'claudseq-bridge.mjs')
  try {
    await mkdir(join(dir, 'real'))
    await writeFile(join(dir, 'real', 'claudseq-bridge.mjs'), await readFile(script))
    await symlink(join(dir, 'real'), join(dir, 'linked'))
    /* No command is a usage error: exiting quietly would mean nothing ran. */
    const result = await new Promise((settle) => {
      const child = spawn(process.execPath, [link], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.on('close', (code) => settle({ code, stderr }))
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /^usage: claudseq-bridge\.mjs install/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('install says so, and fails, when the bridge it loaded never answers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claudseq-install-'))
  const { launchctl } = await fakeLaunchctl(dir)
  const port = await freePort()
  const env = {
    ...process.env,
    SHELL: '/bin/sh',
    CLAUDSEQ_STATE_DIR: join(dir, 'state'),
    CLAUDSEQ_LAUNCH_AGENTS_DIR: join(dir, 'agents'),
    CLAUDSEQ_LAUNCHCTL: launchctl,
    CLAUDSEQ_CLAUDE: fake,
    CLAUDSEQ_START_WAIT_MS: '400'
  }
  try {
    const said = []
    const started = Date.now()
    await assert.rejects(install(['--port', String(port)], env, (line) => said.push(line)), (error) => {
      assert.match(error.message, new RegExp(`did not answer on 127\\.0\\.0\\.1:${port} within 0\\.4 s \\(connect ECONNREFUSED`))
      assert.ok(error.message.includes(join(dir, 'state', 'bridge.log')), 'the error does not point at the log')
      return true
    })
    assert.ok(Date.now() - started >= 400, 'install gave up before its wait was over')
    assert.ok(said.some((line) => line.includes(`listens: http://127.0.0.1:${port}`)), 'install did not say what it wrote')
    assert.ok(!said.some((line) => line.includes('running:')), 'install said a silent bridge is running')

    const checked = []
    assert.equal(await status(env, (line) => checked.push(line)), false)
    assert.match(checked.join('\n'), new RegExp(`not answering on 127\\.0\\.0\\.1:${port}: connect ECONNREFUSED.*bridge\\.log`))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
