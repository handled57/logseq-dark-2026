/* Behavioral tests for the Able Table entry script.
 *
 * The entry is a classic script, so running it in a `vm` context against a
 * stub host puts its top-level declarations on that context's global object.
 * What is driven here is one pass over a fake page tree — marking, releasing,
 * and re-finding a table across a simulated re-render — and the lifecycle
 * this release owns: the style key, the observer, and teardown.
 *
 * No control, no setting and no row-hiding exists yet; those are later
 * stages' tests to write.
 */

import assert from 'node:assert/strict'
import vm from 'node:vm'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { classicScript } from '../../../test/support/classic-script.mjs'
import { node } from '../../../test/support/host-document.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = await classicScript(resolve(root, 'index.js'))

/* The main editor, as much of it as the entry reads: a page tree under
 * `#main-content-container`, blocks that carry their own UUID, and tables
 * rendered the way Logseq renders them — a wrapper div holding the `<table>`
 * as its direct child. */
function editor() {
  const host = node('body')
  const main = node('div', { id: 'main-content-container' })
  host.appendChild(main)
  return { host, main }
}

let uuids = 0
function nextUuid() {
  uuids += 1
  return `65f00000-0000-0000-0000-${String(uuids).padStart(12, '0')}`
}

function block(parent, uuid = nextUuid()) {
  const host = node('div', { classes: ['ls-block'], attributes: { blockid: uuid } })
  const wrapper = node('div', { classes: ['block-content-wrapper'] })
  const content = node('div', { classes: ['block-content'] })
  const body = node('div', { classes: ['block-body'] })

  content.appendChild(body)
  wrapper.appendChild(content)
  host.appendChild(wrapper)
  parent.appendChild(host)

  return { host, wrapper, body, uuid }
}

function table(parent) {
  const wrapper = node('div', { classes: ['table-wrapper'] })
  const el = node('table')
  wrapper.appendChild(el)
  parent.appendChild(wrapper)
  return { wrapper, table: el }
}

/* A minimal observer that records whether it was ever disconnected, so
 * teardown can be checked without reaching into the entry's own closure. */
class FakeObserver {
  constructor(callback) {
    this.callback = callback
    this.disconnected = false
    FakeObserver.instances.push(this)
  }

  observe() {}

  disconnect() {
    this.disconnected = true
  }
}
FakeObserver.instances = []

function load(host) {
  FakeObserver.instances = []
  const unloads = []
  const provided = []

  const context = {
    console,
    MutationObserver: FakeObserver,
    parent: {
      /* The sandbox iframe never paints, so its rAF never fires; the fixture
       * runs the callback immediately, the way the host window's would once
       * scheduled. */
      requestAnimationFrame(callback) {
        callback()
      },
      document: {
        body: host,
        createElement: (tag) => node(tag),
        querySelector: (selector) => host.querySelector(selector),
        querySelectorAll: (selector) => host.querySelectorAll(selector)
      }
    },
    logseq: {
      provideStyle(style) {
        provided.push(style)
      },
      beforeunload(handler) {
        unloads.push(handler)
      },
      ready(main) {
        return Promise.resolve(main())
      }
    }
  }

  vm.createContext(context)
  source.runInContext(context)
  context.provided = provided
  context.unloads = unloads
  context.observers = FakeObserver.instances

  return context
}

async function render(host) {
  const context = load(host)
  await Promise.resolve()
  return context
}

test('a rendered table is marked with its block uuid and an ordinal of zero', async () => {
  const { host, main } = editor()
  const { body, uuid } = block(main)
  const { wrapper } = table(body)

  await render(host)

  assert.equal(wrapper.getAttribute('data-able-table'), `${uuid}:0`)
})

test('a second table in the same block takes the next ordinal; another block starts again at zero', async () => {
  const { host, main } = editor()
  const { body, uuid } = block(main)
  const first = table(body)
  const second = table(body)
  const { body: otherBody, uuid: otherUuid } = block(main)
  const third = table(otherBody)

  await render(host)

  assert.equal(first.wrapper.getAttribute('data-able-table'), `${uuid}:0`)
  assert.equal(second.wrapper.getAttribute('data-able-table'), `${uuid}:1`)
  assert.equal(third.wrapper.getAttribute('data-able-table'), `${otherUuid}:0`)
})

test('a second pass finds the same wrapper again rather than marking it twice', async () => {
  const { host, main } = editor()
  const { body, uuid } = block(main)
  const { wrapper } = table(body)

  const context = await render(host)
  assert.equal(wrapper.getAttribute('data-able-table'), `${uuid}:0`)

  context.markTables()
  assert.equal(wrapper.getAttribute('data-able-table'), `${uuid}:0`)
})

test('a table rendered outside the main editor is left unmarked', async () => {
  const { host, main } = editor()
  const sidebar = node('div', { id: 'right-sidebar' })
  host.appendChild(sidebar)

  const { body } = block(main)
  const inside = table(body)
  const { body: sidebarBody } = block(sidebar)
  const outside = table(sidebarBody)

  await render(host)

  assert.ok(inside.wrapper.getAttribute('data-able-table'))
  assert.equal(outside.wrapper.getAttribute('data-able-table'), null)
})

test('a table Logseq renders without a table-wrapper parent is left unmarked', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const bare = body.appendChild(node('table'))

  await render(host)

  assert.equal(bare.getAttribute('data-able-table'), null)
})

test('a table the pass no longer finds releases its mark', async () => {
  const { host, main } = editor()
  const { body, uuid } = block(main)
  const { wrapper, table: el } = table(body)

  const context = await render(host)
  assert.equal(wrapper.getAttribute('data-able-table'), `${uuid}:0`)

  // The wrapper stays in the tree, but its content no longer renders a table.
  el.remove()
  context.markTables()

  assert.equal(wrapper.getAttribute('data-able-table'), null)
})

test('the same block re-rendered with a new table element gets its key back', async () => {
  const { host, main } = editor()
  const { body, uuid } = block(main)
  const first = table(body)

  const context = await render(host)
  assert.equal(first.wrapper.getAttribute('data-able-table'), `${uuid}:0`)

  // Logseq re-renders the block: same block, a new element for the same table.
  first.wrapper.remove()
  const rendered = table(body)
  context.markTables()

  assert.equal(rendered.wrapper.getAttribute('data-able-table'), `${uuid}:0`)

  /* The key is kept under the block's own UUID, so a table in another block
   * is never marked from it. */
  const { body: otherBody } = block(main, uuid.replace(/1$/, '9'))
  const other = table(otherBody)
  context.markTables()
  assert.notEqual(other.wrapper.getAttribute('data-able-table'), `${uuid}:0`)
})

test('the runtime registers its style under the able-table key, once', async () => {
  const { host } = editor()
  const context = await render(host)

  assert.deepEqual(context.provided.map((style) => style.key), ['able-table'])
})

test('unloading disconnects the observer and clears every data-able-table attribute', async () => {
  const { host, main } = editor()
  const { body, uuid } = block(main)
  const { wrapper } = table(body)

  const context = await render(host)
  assert.equal(wrapper.getAttribute('data-able-table'), `${uuid}:0`)

  const [unload] = context.unloads
  await unload()

  assert.equal(wrapper.getAttribute('data-able-table'), null)
  assert.equal(context.observers.length, 1)
  assert.equal(context.observers[0].disconnected, true)
})

test('unloading leaves a table released by an earlier pass untouched', async () => {
  const { host, main } = editor()
  const { body, uuid } = block(main)
  const { wrapper, table: el } = table(body)

  const context = await render(host)
  assert.equal(wrapper.getAttribute('data-able-table'), `${uuid}:0`)

  el.remove()
  context.markTables()
  assert.equal(wrapper.getAttribute('data-able-table'), null)

  const [unload] = context.unloads
  await unload()
  // Unloading after the mark was already released writes nothing back.
  assert.equal(wrapper.getAttribute('data-able-table'), null)
})
