/* Behavioral tests for the Able Table entry script.
 *
 * The entry is a classic script, so running it in a `vm` context against a
 * stub host puts its top-level declarations on that context's global object.
 * What is driven here is one pass over a fake page tree — marking, releasing,
 * and re-finding a table across a simulated re-render — the settings control
 * and its panel, full table search, and the lifecycle: the style key, the
 * observer, the document listeners, and teardown.
 *
 * Every test that presses a control also asserts what the press did to the
 * event, because the control sits inside rendered block content where a click
 * of Logseq's own opens the block for editing.
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

/* Logseq renders a Markdown table with a head and a body. `textContent` on the
 * stub is the node's own text rather than its descendants', so each row is
 * given the text the browser would read off its cells. */
function table(parent, rows = [], { head = 'Name Role' } = {}) {
  const wrapper = node('div', { classes: ['table-wrapper'] })
  const el = node('table')
  const body = node('tbody')

  if (head !== null) {
    const thead = node('thead')
    const headRow = node('tr')
    headRow.textContent = head
    thead.appendChild(headRow)
    el.appendChild(thead)
  }

  const cells = rows.map((text) => {
    const row = node('tr')
    row.textContent = text
    body.appendChild(row)
    return row
  })

  el.appendChild(body)
  wrapper.appendChild(el)
  parent.appendChild(wrapper)
  return { wrapper, table: el, rows: cells }
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
  const documentListeners = new Map()

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
        addEventListener(type, handler) {
          documentListeners.set(type, [...(documentListeners.get(type) ?? []), handler])
        },
        removeEventListener(type, handler) {
          documentListeners.set(
            type,
            (documentListeners.get(type) ?? []).filter((entry) => entry !== handler)
          )
        },
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
  context.documentListeners = documentListeners
  context.dispatchDocument = (type, event) => {
    for (const handler of documentListeners.get(type) ?? []) handler(event)
  }

  return context
}

/* The chrome the runtime hangs, found the way a reader would: the control
 * inside the wrapper, the panel and the field beside it. */
function settings(wrapper) {
  return wrapper.children.find((child) => child.matches('[data-able-settings]')) ?? null
}

function siblings(wrapper) {
  return wrapper.parentElement.children
}

/* Matched on the key as well as the attribute: two tables in one block put
 * their chrome among the same siblings. */
function besideWith(wrapper, attribute) {
  const key = wrapper.getAttribute('data-able-table')
  return siblings(wrapper).find((child) => child.matches(`[${attribute}]`) && child.getAttribute('data-able-key') === key) ?? null
}

function panelOf(wrapper) {
  return besideWith(wrapper, 'data-able-panel')
}

function searchOf(wrapper) {
  return besideWith(wrapper, 'data-able-search')
}

function within(row, attribute) {
  return row?.children.find((child) => child.matches(`[${attribute}]`)) ?? null
}

function visible(rows) {
  return rows.filter((row) => !row.attributes.has('data-able-filtered')).map((row) => row.textContent)
}

function press(context, target, event = {}) {
  const record = {
    target,
    prevented: false,
    stopped: false,
    preventDefault() {
      record.prevented = true
    },
    stopPropagation() {
      record.stopped = true
    },
    ...event
  }

  context.dispatchDocument('mousedown', { ...record, type: 'mousedown' })
  context.dispatchDocument('click', { ...record, type: 'click' })
  return record
}

function key(context, target, name) {
  const record = {
    target,
    key: name,
    prevented: false,
    stopped: false,
    preventDefault() {
      record.prevented = true
    },
    stopPropagation() {
      record.stopped = true
    }
  }

  context.dispatchDocument('keydown', record)
  return record
}

/* Typing, as the host delivers it: the field holds what was typed by the time
 * the `input` event reaches the document. */
function type(context, field, value) {
  field.value = value
  const record = {
    target: field,
    stopped: false,
    preventDefault() {},
    stopPropagation() {
      record.stopped = true
    }
  }

  context.dispatchDocument('input', record)
  return record
}

/* Open the panel and turn full table search on, which is how every search test
 * starts. */
function openSearch(context, wrapper) {
  press(context, settings(wrapper))
  press(context, within(panelOf(wrapper), 'data-able-toggle'))
  return within(searchOf(wrapper), 'data-able-field')
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

test('every rendered table carries one settings control, inside its wrapper and named for it', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const first = table(body, ['Ada'])
  const { body: otherBody } = block(main)
  const second = table(otherBody, ['Grace'])

  const context = await render(host)

  for (const [index, { wrapper }] of [first, second].entries()) {
    const control = settings(wrapper)
    assert.ok(control, 'the table has no settings control')
    assert.equal(control.tagName, 'BUTTON')
    assert.equal(control.getAttribute('type'), 'button')
    assert.equal(control.getAttribute('aria-expanded'), 'false')
    // The name says which table it belongs to, counting up the page.
    assert.equal(control.getAttribute('aria-label'), `Search options for table ${index + 1}`)
    assert.equal(control.getAttribute('title'), control.getAttribute('aria-label'))
    assert.equal(control.getAttribute('data-able-key'), wrapper.getAttribute('data-able-table'))
  }

  // A second pass finds the control it wrote rather than writing another.
  context.markTables()
  assert.equal(first.wrapper.children.filter((child) => child.matches('[data-able-settings]')).length, 1)
})

test('the control steps left of the theme’s collapse control, and stands alone without it', async () => {
  const { host } = editor()
  const context = await render(host)
  const [{ style }] = context.provided

  /* The one thing Able Table knows about Dark High Contrast, read in CSS and
   * never written: docs/contracts/table-controls-v1.md. */
  assert.match(
    style,
    /div\.table-wrapper:has\(> \[data-hc-collapse\]\) > \[data-able-settings\] \{\s*right: calc\(var\(--hc-collapse-control-size, 1\.25rem\) \+ 0\.5rem\);/
  )

  // With no theme declaring the variable, the control takes the corner itself
  // and is sized by Able Table's own fallback.
  const base = style.match(/\[data-able-settings\] \{[^}]+\}/)[0]
  assert.match(base, /position: absolute;/)
  assert.match(base, /top: 0;/)
  assert.match(base, /right: 0;/)
  assert.match(base, /width: var\(--hc-collapse-control-size, 1\.25rem\);/)
  assert.match(base, /height: var\(--hc-collapse-control-size, 1\.25rem\);/)

  // A hidden row is hidden by one declaration, so dropping the mark restores it.
  assert.match(style, /\[data-able-filtered\] \{\s*display: none !important;\s*\}/)
})

test('pressing the control opens a panel beside the wrapper rather than inside it', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, ['Ada'])

  const context = await render(host)
  assert.equal(panelOf(wrapper), null)

  const record = press(context, settings(wrapper))
  // Neither the press nor the click reaches Logseq's own handlers.
  assert.equal(record.stopped, true)
  assert.equal(record.prevented, true)

  const panel = panelOf(wrapper)
  assert.ok(panel, 'no panel was opened')
  // Outside the wrapper, which is an overflow scroller, and after it.
  assert.equal(panel.parentElement, wrapper.parentElement)
  assert.equal(wrapper.nextElementSibling, panel)
  assert.equal(wrapper.children.some((child) => child.matches('[data-able-panel]')), false)
  assert.equal(wrapper.parentElement.getAttribute('data-able-anchor'), '')

  const toggle = within(panel, 'data-able-toggle')
  assert.ok(toggle, 'the panel holds no toggle')
  assert.equal(toggle.textContent, 'Full table search')
  assert.equal(toggle.getAttribute('role'), 'switch')
  assert.equal(toggle.getAttribute('aria-checked'), 'false')
  assert.equal(settings(wrapper).getAttribute('aria-expanded'), 'true')
})

test('the panel is dismissed by a second press, by Escape, and by a click outside it', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, ['Ada'])

  const context = await render(host)
  const control = settings(wrapper)

  // A second press.
  press(context, control)
  control.focused = false
  press(context, control)
  assert.equal(panelOf(wrapper), null)
  assert.equal(control.getAttribute('aria-expanded'), 'false')
  assert.equal(control.focused, true, 'focus was not handed back to the control')

  // Escape, from inside the panel.
  press(context, control)
  control.focused = false
  const record = key(context, within(panelOf(wrapper), 'data-able-toggle'), 'Escape')
  assert.equal(record.stopped, true)
  assert.equal(record.prevented, true)
  assert.equal(panelOf(wrapper), null)
  assert.equal(control.focused, true)

  // A click on the page outside the panel.
  press(context, control)
  const elsewhere = body.appendChild(node('div'))
  const outside = press(context, elsewhere)
  assert.equal(panelOf(wrapper), null)
  // The click itself is left entirely to Logseq.
  assert.equal(outside.stopped, false)
  assert.equal(outside.prevented, false)
})

test('one panel is open at a time', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const first = table(body, ['Ada'])
  const second = table(body, ['Grace'])

  const context = await render(host)

  press(context, settings(first.wrapper))
  assert.ok(panelOf(first.wrapper))

  press(context, settings(second.wrapper))
  assert.equal(first.wrapper.parentElement.children.filter((child) => child.matches('[data-able-panel]')).length, 1)
  assert.equal(settings(first.wrapper).getAttribute('aria-expanded'), 'false')
  assert.equal(settings(second.wrapper).getAttribute('aria-expanded'), 'true')
})

test('turning full table search on inserts a focused field above the table', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, ['Ada Lovelace'])

  const context = await render(host)
  const field = openSearch(context, wrapper)

  const row = searchOf(wrapper)
  assert.ok(row, 'no search field was inserted')
  // Immediately before the wrapper, in the same parent, so the table's own
  // horizontal scrolling never moves it.
  assert.equal(row.parentElement, wrapper.parentElement)
  assert.equal(row.nextElementSibling, wrapper)

  assert.equal(field.tagName, 'INPUT')
  assert.equal(field.getAttribute('type'), 'text')
  assert.equal(field.getAttribute('aria-label'), 'Search table 1')
  assert.equal(field.getAttribute('placeholder'), 'Find in table 1')
  assert.equal(field.focused, true, 'the field did not take focus')
  assert.equal(within(panelOf(wrapper), 'data-able-toggle').getAttribute('aria-checked'), 'true')
})

test('typing hides every row that does not match, and never the header row', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, table: el, rows } = table(body, ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'])

  const context = await render(host)
  const field = openSearch(context, wrapper)

  const record = type(context, field, 'grace')
  // The keystroke is kept from Logseq, so typing never opens the block.
  assert.equal(record.stopped, true)

  assert.deepEqual(visible(rows), ['Grace Hopper'])
  assert.equal(rows[0].getAttribute('data-able-filtered'), '')
  // Rows are hidden, never removed or reordered.
  assert.equal(el.querySelectorAll('tr').length, 4)
  assert.equal(el.querySelector('thead').children[0].attributes.has('data-able-filtered'), false)

  // Backspacing restores them.
  type(context, field, '')
  assert.deepEqual(visible(rows), ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'])
})

test('matching is a case-insensitive substring test with whitespace collapsed', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, ['Ada   Lovelace', 'Grace Hopper'])

  const context = await render(host)
  const field = openSearch(context, wrapper)

  type(context, field, 'ADA LOVELACE')
  assert.deepEqual(visible(rows), ['Ada   Lovelace'])

  // A substring, not a token or a pattern.
  type(context, field, 'ovel')
  assert.deepEqual(visible(rows), ['Ada   Lovelace'])

  type(context, field, 'a.a')
  assert.deepEqual(visible(rows), [])
})

test('the clear affordance is there only while the field holds text', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, ['Ada Lovelace', 'Grace Hopper'])

  const context = await render(host)
  const field = openSearch(context, wrapper)
  assert.equal(within(searchOf(wrapper), 'data-able-clear'), null)

  type(context, field, 'grace')
  const clear = within(searchOf(wrapper), 'data-able-clear')
  assert.ok(clear, 'no clear affordance appeared')
  assert.equal(clear.tagName, 'BUTTON')
  assert.equal(clear.getAttribute('aria-label'), 'Clear the search of table 1')

  field.focused = false
  const record = press(context, clear)
  assert.equal(record.stopped, true)
  assert.equal(record.prevented, true)

  const cleared = within(searchOf(wrapper), 'data-able-field')
  assert.equal(cleared.value, '')
  assert.equal(cleared.focused, true, 'focus did not return to the field')
  assert.deepEqual(visible(rows), ['Ada Lovelace', 'Grace Hopper'])
  assert.equal(within(searchOf(wrapper), 'data-able-clear'), null)
})

test('the field reports how many rows match, politely, and says when none do', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'])

  const context = await render(host)
  const field = openSearch(context, wrapper)

  const status = within(searchOf(wrapper), 'data-able-status')
  assert.equal(status.getAttribute('role'), 'status')
  assert.equal(status.getAttribute('aria-live'), 'polite')
  assert.equal(status.textContent, '3 rows')

  type(context, field, 'a')
  assert.equal(status.textContent, '3 of 3 rows')

  type(context, field, 'grace')
  assert.equal(status.textContent, '1 of 3 rows')

  // Zero matches leaves the header row standing, and says so; no row is
  // inserted into the table.
  type(context, field, 'nobody')
  assert.equal(status.textContent, 'No rows match; the header row is all that is left')
  assert.equal(wrapper.querySelectorAll('tr').length, 4)
})

test('turning full table search off restores every row and takes the field with it', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, ['Ada Lovelace', 'Grace Hopper'])

  const context = await render(host)
  const field = openSearch(context, wrapper)
  type(context, field, 'grace')
  assert.deepEqual(visible(rows), ['Grace Hopper'])

  const toggle = within(panelOf(wrapper), 'data-able-toggle')
  press(context, toggle)

  assert.equal(searchOf(wrapper), null)
  assert.equal(toggle.getAttribute('aria-checked'), 'false')
  // Nothing is left hidden behind the field that hid it.
  assert.deepEqual(visible(rows), ['Ada Lovelace', 'Grace Hopper'])
  assert.equal(rows.some((row) => row.attributes.has('data-able-filtered')), false)

  // And it comes back empty rather than holding a search the reader closed.
  press(context, toggle)
  assert.equal(within(searchOf(wrapper), 'data-able-field').value, '')
})

test('a control is operated from the keyboard, and the key never reaches Logseq', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, ['Ada Lovelace', 'Grace Hopper'])

  const context = await render(host)

  const opened = key(context, settings(wrapper), 'Enter')
  assert.equal(opened.prevented, true)
  assert.equal(opened.stopped, true)
  assert.ok(panelOf(wrapper))

  const switched = key(context, within(panelOf(wrapper), 'data-able-toggle'), ' ')
  assert.equal(switched.prevented, true)
  assert.equal(switched.stopped, true)
  const field = within(searchOf(wrapper), 'data-able-field')
  assert.ok(field)

  // A space typed in the field is a space, not a press of something.
  type(context, field, 'grace')
  const typed = key(context, field, ' ')
  assert.equal(typed.prevented, false)
  assert.equal(typed.stopped, true)
  assert.deepEqual(visible(rows), ['Grace Hopper'])
})

test('a key pressed anywhere else is left to Logseq', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  table(body, ['Ada Lovelace'])

  const context = await render(host)
  const record = key(context, body, 'Enter')

  assert.equal(record.prevented, false)
  assert.equal(record.stopped, false)
})

test('two tables in the same block search independently', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const first = table(body, ['Ada Lovelace', 'Grace Hopper'])
  const second = table(body, ['Ada Lovelace', 'Grace Hopper'])

  const context = await render(host)

  const field = openSearch(context, first.wrapper)
  type(context, field, 'ada')

  assert.deepEqual(visible(first.rows), ['Ada Lovelace'])
  assert.deepEqual(visible(second.rows), ['Ada Lovelace', 'Grace Hopper'])
  assert.equal(searchOf(second.wrapper), null)
})

test('a re-render of the block brings the field, its text and the filter back', async () => {
  const { host, main } = editor()
  const { body, uuid } = block(main)
  const first = table(body, ['Ada Lovelace', 'Grace Hopper'])

  const context = await render(host)
  const field = openSearch(context, first.wrapper)
  type(context, field, 'grace')

  /* Editing the block replaces the whole render: the wrapper, the control and
   * the field go with it. */
  searchOf(first.wrapper)?.remove()
  panelOf(first.wrapper)?.remove()
  first.wrapper.remove()
  context.markTables()

  const rendered = table(body, ['Ada Lovelace', 'Grace Hopper'])
  context.markTables()

  assert.equal(rendered.wrapper.getAttribute('data-able-table'), `${uuid}:0`)
  const restored = searchOf(rendered.wrapper)
  assert.ok(restored, 'the field did not come back')
  assert.equal(within(restored, 'data-able-field').value, 'grace')
  assert.deepEqual(visible(rendered.rows), ['Grace Hopper'])
})

test('a table that stops rendering gives back its control, its field and its marks', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, table: el, rows } = table(body, ['Ada Lovelace', 'Grace Hopper'])

  const context = await render(host)
  const field = openSearch(context, wrapper)
  type(context, field, 'grace')
  assert.deepEqual(visible(rows), ['Grace Hopper'])

  // The wrapper stays in the tree, but its content no longer renders a table.
  // The rows go with it, so what has to come back is the chrome beside it.
  el.remove()
  context.markTables()

  assert.equal(wrapper.getAttribute('data-able-table'), null)
  assert.equal(settings(wrapper), null)
  assert.equal(searchOf(wrapper), null)
  assert.equal(panelOf(wrapper), null)
  assert.equal(wrapper.parentElement.getAttribute('data-able-anchor'), null)
  /* The rows left with the render that held them; what matters is that nothing
   * still in the document is marked. */
  assert.equal(host.querySelectorAll('[data-able-filtered]').length, 0)
  assert.equal(el.parentElement, null, 'the fixture left the table in the document')
})

test('the runtime answers pointer, key and input events in the capture phase', async () => {
  const { host } = editor()
  const context = await render(host)

  assert.deepEqual(
    [...context.documentListeners.keys()].sort(),
    ['click', 'input', 'keydown', 'keyup', 'mousedown']
  )
})

test('a table with no head keeps its first row standing', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, ['Name Role', 'Ada Lovelace', 'Grace Hopper'], { head: null })

  const context = await render(host)
  const field = openSearch(context, wrapper)
  type(context, field, 'grace')

  assert.deepEqual(visible(rows), ['Name Role', 'Grace Hopper'])
  assert.equal(within(searchOf(wrapper), 'data-able-status').textContent, '1 of 2 rows')
})

test('unloading removes every node and mark this plugin wrote, and its listeners', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, ['Ada Lovelace', 'Grace Hopper'])
  /* A mark of the theme's, in the same wrapper, to prove teardown reads its
   * own namespace only. */
  const theirs = wrapper.appendChild(node('button', { attributes: { 'data-hc-collapse': '' } }))

  const context = await render(host)
  const field = openSearch(context, wrapper)
  type(context, field, 'grace')
  assert.ok(panelOf(wrapper), 'the panel is not open')

  const [unload] = context.unloads
  await unload()

  assert.equal(host.querySelectorAll('[data-able-table]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-settings]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-panel]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-search]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-filtered]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-anchor]').length, 0)
  assert.deepEqual(visible(rows), ['Ada Lovelace', 'Grace Hopper'])

  for (const handlers of context.documentListeners.values()) assert.deepEqual(handlers, [])

  // The theme's own control is left exactly where it was.
  assert.equal(theirs.parentElement, wrapper)
  assert.equal(theirs.getAttribute('data-hc-collapse'), '')
})
