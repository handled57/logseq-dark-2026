/* Behavioral tests for the Claudseq bridge.
 *
 * The bridge runs in-process against a fake `claude` (test/fixtures/
 * fake-claude.mjs) that speaks the recorded stream-json protocol and logs
 * everything it receives. Requests go through `node:http` rather than
 * `fetch`, because `fetch` will not send a `Host` header of the caller's
 * choosing and the Host check is one of the things under test.
 *
 * Nothing here touches the real `~/.claudseq` or `~/.claude`: every
 * directory the bridge reads or writes is a temporary one handed to it. A
 * bridge that runs as a process of its own is started the way Logseq's
 * `runCli` starts it — its command line through a shell, with its stdin a
 * pipe that the test holds, as Logseq does, and closes, as quitting does.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ALLOWED_ORIGIN, ENTRYPOINT, VERSION, claudeArgs, createBridge, listHistory,
  projectDirName, readTranscript, sessionScoped, status, titleOf
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


/* ---------------------------------------------------------------- starting */

/* The command line the pane hands Logseq's `runCli`. */
function commandLine(args = '') {
  return `'${process.execPath}' '${script}' serve --until-stdin-closes ${args}`.trim()
}

function serveEnv(dir, env = {}) {
  return {
    ...process.env,
    SHELL: '/bin/sh',
    CLAUDSEQ_STATE_DIR: join(dir, 'state'),
    CLAUDSEQ_PROJECTS_DIR: join(dir, 'projects'),
    CLAUDSEQ_CLAUDE: fake,
    ...env
  }
}

/* A bridge started as Logseq's `runCli` starts one: the command line through
 * a shell, every stdio a pipe, stdout and stderr read and dropped, and stdin
 * held open and never written to. Ending `stdin` is what Logseq quitting
 * does to it. */
function launch(dir, { args = '', env = {} } = {}) {
  const child = spawn(commandLine(args), [], { shell: true, detached: false, env: serveEnv(dir, env) })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  const closed = new Promise((settle) => child.on('close', (code) => settle(code)))
  /* A bridge that never exits fails the test rather than hanging it. */
  const exited = Promise.race([closed, delay(8000).then(() => { throw new Error('the bridge did not exit') })])
  exited.catch(() => {})
  return { child, exited, stdin: child.stdin }
}

async function written(dir) {
  return JSON.parse(await readFile(join(dir, 'state', 'bridge.json'), 'utf8').catch(() => 'null'))
}

async function logOf(dir) {
  return readFile(join(dir, 'state', 'bridge.log'), 'utf8').catch(() => '')
}

async function answering(dir) {
  const config = await written(dir)
  if (!config) return null
  const health = await call(config.port, { token: config.token }).catch(() => null)
  return health?.status === 200 ? { config, health: health.json } : null
}

function stopProcess(pid) {
  if (pid && alive(pid)) process.kill(pid, 'SIGKILL')
}

test('a bridge started as runCli starts it writes a private config once it listens, and stops with Logseq, taking every claude with it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claudseq-serve-'))
  const port = await freePort()
  const bridge = launch(dir, { args: `--port ${port}` })
  let config = null
  try {
    const up = await until(() => answering(dir))
    config = up.config
    assert.equal(config.port, port)
    assert.match(config.token, /^[0-9a-f]{64}$/)
    assert.equal(config.version, VERSION)
    assert.equal(config.claudePath, fake)
    assert.equal(up.health.pid, config.pid)
    assert.equal((await stat(join(dir, 'state', 'bridge.json'))).mode & 0o777, 0o600)
    assert.equal((await stat(join(dir, 'state'))).mode & 0o777, 0o700)
    assert.match(await logOf(dir), new RegExp(`listening on 127\\.0\\.0\\.1:${port} \\(pid ${config.pid}`))

    const checked = []
    assert.equal(await status(serveEnv(dir), (line) => checked.push(line)), true)
    assert.match(checked.join('\n'), /"ok":true/)

    const created = await call(port, { method: 'POST', path: '/v1/sessions', token: config.token, body: { cwd: dir } })
    assert.equal(created.status, 201, created.text)
    const pid = created.json.pid
    assert.ok(alive(pid))

    bridge.stdin.end()
    assert.equal(await bridge.exited, 0)
    await until(() => !alive(pid))
    await until(() => !alive(config.pid))
    assert.match(await logOf(dir), /stdin closed: closing 1 session\(s\)/)
  } finally {
    stopProcess(config?.pid)
    bridge.child.kill('SIGKILL')
    await rm(dir, { recursive: true, force: true })
  }
})

test('a Logseq killed outright takes its bridge and every claude with it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claudseq-kill-'))
  const port = await freePort()
  /* A stand-in for Logseq's main process, doing what its `runCli` does. */
  const host = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process')
    const job = spawn(process.argv[1], [], { shell: true, detached: false })
    job.stdout.on('data', () => {})
    job.stderr.on('data', () => {})
    setInterval(() => {}, 1000)
  `, commandLine(`--port ${port}`)], { env: serveEnv(dir), stdio: 'ignore' })
  let config = null
  let pid = null
  try {
    config = (await until(() => answering(dir))).config
    const created = await call(port, { method: 'POST', path: '/v1/sessions', token: config.token, body: { cwd: dir } })
    assert.equal(created.status, 201, created.text)
    pid = created.json.pid
    assert.ok(alive(pid))

    host.kill('SIGKILL')
    await until(() => !alive(config.pid))
    await until(() => !alive(pid))
  } finally {
    host.kill('SIGKILL')
    stopProcess(config?.pid)
    stopProcess(pid)
    await rm(dir, { recursive: true, force: true })
  }
})

test('a bridge asked to stop kills every claude it started', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claudseq-term-'))
  const port = await freePort()
  const bridge = launch(dir, { args: `--port ${port}` })
  let config = null
  try {
    config = (await until(() => answering(dir))).config
    const created = await call(port, { method: 'POST', path: '/v1/sessions', token: config.token, body: { cwd: dir } })
    assert.equal(created.status, 201)
    const pid = created.json.pid
    process.kill(config.pid, 'SIGTERM')
    assert.equal(await bridge.exited, 0)
    await until(() => !alive(pid))
  } finally {
    stopProcess(config?.pid)
    bridge.child.kill('SIGKILL')
    await rm(dir, { recursive: true, force: true })
  }
})

test('a second start finds the running bridge and leaves it be', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claudseq-again-'))
  const port = await freePort()
  const first = launch(dir, { args: `--port ${port}` })
  let config = null
  try {
    config = (await until(() => answering(dir))).config
    const second = launch(dir)
    assert.equal(await second.exited, 0)
    assert.deepEqual(await written(dir), config, 'a second start rewrote the config')
    assert.equal((await call(port, { token: config.token })).status, 200)
    assert.match(await logOf(dir), new RegExp(`a bridge already answers on 127\\.0\\.0\\.1:${port}; this one is not needed`))
  } finally {
    first.stdin.end()
    await first.exited
    stopProcess(config?.pid)
    await rm(dir, { recursive: true, force: true })
  }
})

test('two windows starting a bridge at once end up with one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claudseq-race-'))
  const port = await freePort()
  const both = [launch(dir, { args: `--port ${port}` }), launch(dir, { args: `--port ${port}` })]
  let config = null
  try {
    const firstOut = await Promise.race(both.map((entry, index) => entry.exited.then((code) => ({ code, index }))))
    assert.equal(firstOut.code, 0)
    config = (await until(() => answering(dir))).config
    assert.equal(config.port, port)
    const survivor = both[1 - firstOut.index]
    assert.equal(survivor.child.exitCode, null, 'neither bridge kept running')
    survivor.stdin.end()
    assert.equal(await survivor.exited, 0)
  } finally {
    for (const entry of both) entry.child.kill('SIGKILL')
    stopProcess(config?.pid)
    await rm(dir, { recursive: true, force: true })
  }
})

test('a port another program holds moves the bridge to a free one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claudseq-taken-'))
  const squatter = createServer()
  const port = await new Promise((settle) => squatter.listen(0, '127.0.0.1', () => settle(squatter.address().port)))
  const bridge = launch(dir, { args: `--port ${port}` })
  let config = null
  try {
    config = (await until(() => answering(dir), { timeout: 8000 })).config
    assert.notEqual(config.port, port)
    assert.match(await logOf(dir), new RegExp(`127\\.0\\.0\\.1:${port} is taken by another program`))
    bridge.stdin.end()
    assert.equal(await bridge.exited, 0)
  } finally {
    squatter.close()
    stopProcess(config?.pid)
    bridge.child.kill('SIGKILL')
    await rm(dir, { recursive: true, force: true })
  }
})

test('a bridge that cannot start says why in its log and exits with an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claudseq-fail-'))
  try {
    const bridge = launch(dir, { args: '--port 80' })
    assert.equal(await bridge.exited, 1)
    assert.match(await logOf(dir), /could not start: --port must be between 1024 and 65535, not 80\n$/)
    assert.equal(await written(dir), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a claude installed after the bridge started is found when the pane asks', async () => {
  let located = null
  const bridge = await start({ claudePath: null, locateClaude: async () => located })
  try {
    assert.equal((await call(bridge.port)).json.claudeFound, false)
    located = fake
    const health = await call(bridge.port)
    assert.equal(health.json.claudeFound, true)
    assert.equal(health.json.claudePath, fake)
    await bridge.open()
  } finally {
    await bridge.close()
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
    assert.match(result.stderr, /^usage: claudseq-bridge\.mjs serve/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
