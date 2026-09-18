#!/usr/bin/env node
/* A stand-in for the `claude` CLI in headless stream-json mode.
 *
 * It speaks the shapes a real `claude -p --input-format stream-json
 * --output-format stream-json --permission-prompt-tool stdio` session was
 * recorded speaking: an init per turn, complete assistant messages, a
 * `can_use_tool` control request that waits for its answer, and a result.
 * Everything it is given — its argv, the environment variables the bridge
 * sets or clears, and every stdin line — is appended to FAKE_CLAUDE_LOG as
 * JSON, so a test can assert on exactly what reached the process.
 *
 * What a turn does depends on the prompt: one that mentions "permission" asks
 * to use Write and waits; one that mentions "slow" streams a chunk and waits
 * for an interrupt; anything else is echoed back.
 */

import { appendFileSync } from 'node:fs'

const log = process.env.FAKE_CLAUDE_LOG
const record = (entry) => { if (log) appendFileSync(log, JSON.stringify(entry) + '\n') }
const out = (message) => process.stdout.write(JSON.stringify(message) + '\n')

const argv = process.argv.slice(2)
const after = (flag) => { const index = argv.indexOf(flag); return index === -1 ? null : argv[index + 1] }
const sessionId = after('--resume') ?? after('--session-id') ?? '00000000-0000-4000-8000-000000000000'

record({
  argv,
  cwd: process.cwd(),
  pid: process.pid,
  env: { entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null, claudecode: process.env.CLAUDECODE ?? null }
})

let waiting = null
let slow = false
let turn = 0

function init() {
  out({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    cwd: process.cwd(),
    model: 'claude-test-1',
    permissionMode: 'default',
    tools: ['Agent', 'Bash', 'Read', 'Write'],
    slash_commands: ['review', 'compact']
  })
}

function result(subtype = 'success', extra = {}) {
  out({ type: 'result', subtype, is_error: subtype !== 'success', session_id: sessionId, num_turns: 1, result: '', ...extra })
}

function assistant(content) {
  turn += 1
  out({
    type: 'assistant',
    message: { id: `msg_fake_${turn}`, type: 'message', role: 'assistant', content: [content] },
    parent_tool_use_id: null,
    session_id: sessionId
  })
}

function prompt(text) {
  init()
  if (text.includes('permission')) {
    assistant({ type: 'tool_use', id: 'toolu_fake_write', name: 'Write', input: { file_path: '/tmp/claudseq-fake/out.txt', content: 'hi' } })
    waiting = 'fake-permission-1'
    out({
      type: 'control_request',
      request_id: waiting,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Write',
        display_name: 'Write',
        input: { file_path: '/tmp/claudseq-fake/out.txt', content: 'hi' },
        description: 'out.txt',
        permission_suggestions: [
          { type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'localSettings' },
          { type: 'setMode', mode: 'acceptEdits', destination: 'projectSettings' },
          { type: 'setMode', mode: 'bypassPermissions', destination: 'session' }
        ],
        tool_use_id: 'toolu_fake_write'
      }
    })
    return
  }
  if (text.includes('slow')) {
    slow = true
    out({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_fake_slow', role: 'assistant', content: [] } }, parent_tool_use_id: null, session_id: sessionId })
    out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null, session_id: sessionId })
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Tide pools are' } }, parent_tool_use_id: null, session_id: sessionId })
    return
  }
  assistant({ type: 'text', text: `echo: ${text}` })
  result()
}

function control(message) {
  const request = message.request ?? {}
  const response = request.subtype === 'set_permission_mode'
    ? { mode: request.mode === 'manual' ? 'default' : request.mode }
    : request.subtype === 'interrupt' ? { still_queued: [] } : {}
  out({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } })
  if (request.subtype === 'interrupt' && slow) {
    slow = false
    out({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, parent_tool_use_id: null, session_id: sessionId })
    result('error_during_execution', { terminal_reason: 'aborted_streaming' })
  }
}

function answered(message) {
  const answer = message.response ?? {}
  if (answer.request_id !== waiting) return
  waiting = null
  const allowed = answer.response?.behavior === 'allow'
  out({
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'toolu_fake_write',
        is_error: !allowed,
        content: allowed ? 'File created successfully' : answer.response?.message ?? 'denied'
      }]
    },
    parent_tool_use_id: null,
    session_id: sessionId
  })
  assistant({ type: 'text', text: allowed ? 'Wrote it.' : 'Left it alone.' })
  result()
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newline
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (!line.trim()) continue
    record({ stdin: line })
    const message = JSON.parse(line)
    if (message.type === 'user') prompt(message.message.content.map((block) => block.text).join(''))
    else if (message.type === 'control_request') control(message)
    else if (message.type === 'control_response') answered(message)
  }
})
process.stdin.on('end', () => process.exit(0))
