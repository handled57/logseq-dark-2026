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

/* Logseq renders a Markdown table the way mldoc writes one: the head as
 * `thead > tr > th`, every body group as `tbody > tr > td`, and no `thead` at
 * all for a table that declares no header separator row.
 *
 * `textContent` on the stub is the node's own text rather than its
 * descendants', so a row is given both its cells and the text a browser would
 * read off it — which is the cells run together, with nothing between them.
 * A row written as a plain string has no cells, and stands for the shape the
 * column tests cannot read. */
function table(parent, rows = [], { head = ['Name', 'Role'] } = {}) {
  const wrapper = node('div', { classes: ['table-wrapper'] })
  const el = node('table')
  const body = node('tbody')

  if (head !== null) {
    const thead = node('thead')
    const headRow = node('tr')
    headRow.textContent = head.join('')

    for (const name of head) {
      const cell = node('th')
      cell.textContent = name
      headRow.appendChild(cell)
    }

    thead.appendChild(headRow)
    el.appendChild(thead)
  }

  const cells = rows.map((text) => {
    const row = node('tr')
    row.textContent = Array.isArray(text) ? text.join('') : text

    for (const value of Array.isArray(text) ? text : []) {
      const cell = node('td')
      cell.textContent = value
      row.appendChild(cell)
    }

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

function load(host, fonts) {
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
        fonts,
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

/* A row as a reader sees it: its cells with a space between them, which is not
 * what `textContent` gives back. */
function label(row) {
  return row.children.length ? row.children.map((cell) => cell.textContent).join(' ') : row.textContent
}

function visible(rows) {
  return rows.filter((row) => !row.attributes.has('data-able-filtered')).map(label)
}

function headCells(wrapper) {
  return wrapper.querySelectorAll('th')
}

/* The panel's switches are told apart by which option they are. */
function option(panel, name) {
  return panel?.children.find(
    (child) => child.matches('[data-able-toggle]') && child.getAttribute('data-able-option') === name
  ) ?? null
}

function controlOf(cell) {
  return within(cell, 'data-able-column-control')
}

function menuOf(wrapper) {
  return besideWith(wrapper, 'data-able-column-menu')
}

function itemIn(menu, action) {
  return menu?.children.find((child) => child.getAttribute('data-able-action') === action) ?? null
}

/* Focus leaving a field, as the host delivers it. */
function blur(context, field) {
  context.dispatchDocument('focusout', { target: field, preventDefault() {}, stopPropagation() {} })
}

/* Press one of the panel's switches, opening the panel first where something
 * else — a column menu, a click on the page — has closed it. */
function switchOption(context, wrapper, name) {
  if (!panelOf(wrapper)) press(context, settings(wrapper))
  press(context, option(panelOf(wrapper), name))
}

/* Turn a table's column menus on, the way a reader does: the settings control,
 * then the switch behind it. */
function turnColumnsOn(context, wrapper) {
  switchOption(context, wrapper, 'columns')
}

/* Open one column's filter field through its own menu. */
function openColumn(context, wrapper, index) {
  const cell = headCells(wrapper)[index]
  press(context, controlOf(cell))
  press(context, itemIn(menuOf(wrapper), 'search'))
  return within(cell, 'data-able-column-filter')
}

/* Search a column and let the field close, committing what it holds. */
function filterColumn(context, wrapper, index, value) {
  const field = openColumn(context, wrapper, index)
  type(context, field, value)
  blur(context, field)
  return within(headCells(wrapper)[index], 'data-able-column-term')
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
  switchOption(context, wrapper, 'search')
  return within(searchOf(wrapper), 'data-able-field')
}

async function render(host, fonts) {
  const context = load(host, fonts)
  await Promise.resolve()
  return context
}

/* Logseq's own font set, as much of it as the runtime asks: whether the Tabler
 * face is loaded, and a request for it. `here` is flipped by a test to stand
 * for a face that finishes loading after the first pass. */
function fontSet({ loaded = true } = {}) {
  const set = {
    here: loaded,
    requested: null,
    check: (font) => font === '1rem tabler-icons' && set.here,
    load(font) {
      set.requested = font
      return Promise.resolve([])
    }
  }

  return set
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

  /* The filter field is laid over its header cell rather than in it, so
   * opening and closing one cannot reflow the table. It stops short of the
   * strip the column control stands in. */
  const filter = style.match(/\[data-able-column-filter\] \{[^}]+\}/)[0]
  assert.match(filter, /position: absolute;/)
  assert.match(filter, /inset: 0 1\.5rem 0 0;/)
  assert.match(filter, /box-sizing: border-box;/)

  /* The control sits inside the cell's right divider, in a strip reserved for
   * it, so it never stands over the column name. */
  const head = style.match(/\[data-able-head\] \{[^}]+\}/)[0]
  assert.match(head, /position: relative;/)
  assert.match(head, /padding-right: 1\.5rem;/)

  const control = style.match(/\[data-able-column-control\] \{[^}]+\}/)[0]
  assert.match(control, /position: absolute;/)
  assert.match(control, /right: 0\.25rem;/)
  /* Cyan of its own rather than the header's text colour or the host's accent,
   * so the control reads as a control and means the same thing under a theme
   * whose accent is some other colour. Nothing fades it at rest. */
  assert.match(control, /color: #6fc3df;/)
  assert.doesNotMatch(control, /--ls-active-primary-color/)
  assert.doesNotMatch(control, /opacity:/)
  // A light host draws the header near-white, where that cyan is unreadable.
  const light = style.match(/html\[data-theme=light\] \[data-able-column-control\] \{[^}]+\}/)[0]
  assert.match(light, /color: #0f6b8a;/)
  /* It fills the 1.5rem strip the header reserves rather than standing in the
   * middle of it, so it is legible without taking any more of the column. */
  assert.match(control, /width: 1\.25rem;/)
  assert.match(control, /height: 1\.25rem;/)
  assert.match(control, /font-size: 1rem;/)

  /* The menu is positioned against the box the wrapper sits in, like the
   * panel, because the wrapper itself is a scroller that would clip it. */
  const menu = style.match(/\[data-able-column-menu\] \{[^}]+\}/)[0]
  assert.match(menu, /position: absolute;/)
  assert.match(menu, /top: var\(--able-menu-top, 0px\);/)
  assert.match(menu, /left: var\(--able-menu-left, 0px\);/)

  /* The committed filter is in flow under the name and laid out across the
   * cell rather than across its own text, so it cannot put a horizontal
   * scrollbar on a table that had none. */
  const term = style.match(/\[data-able-column-term\] \{[^}]+\}/)[0]
  assert.match(term, /display: block;/)
  assert.match(term, /width: 0;/)
  assert.match(term, /min-width: 100%;/)
  assert.match(term, /overflow-wrap: anywhere;/)
})

test('the control is drawn with the host icon font only where that face is loaded', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, STAFF)

  const context = await render(host, fontSet())
  turnColumnsOn(context, wrapper)
  const [name] = headCells(wrapper)

  /* Logseq links Tabler Icons from its own page, so the face is there to be
   * named; the mark is what the stylesheet switches the glyph on. */
  assert.equal(within(name, 'data-able-column-control').getAttribute('data-able-icon'), 'filter')

  const [{ style }] = context.provided
  assert.match(
    style,
    /\[data-able-column-control\]::after \{\s*content: "\\22ee";/,
    'the ellipsis is not what an unmarked control paints'
  )
  const icon = style.match(/\[data-able-column-control\]\[data-able-icon="filter"\]::after \{[^}]+\}/)[0]
  assert.match(icon, /content: "\\eaa5";/)
  assert.match(icon, /font-family: tabler-icons;/)
  // The face has one weight; asking for bold would have the engine fake it.
  assert.match(icon, /font-weight: 400;/)
})

test('a host whose icon face is missing keeps the ellipsis rather than a replacement box', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, STAFF)

  /* A private-use codepoint has no fallback glyph, so naming the face where it
   * is not loaded would draw a box. Both shapes of host are checked: one that
   * answers no, and one with no font set at all. */
  const missing = await render(host, fontSet({ loaded: false }))
  turnColumnsOn(missing, wrapper)
  assert.equal(within(headCells(wrapper)[0], 'data-able-column-control').getAttribute('data-able-icon'), null)

  const bare = editor()
  const { wrapper: other } = table(block(bare.main).body, STAFF)
  const context = await render(bare.host)
  turnColumnsOn(context, other)
  assert.equal(within(headCells(other)[0], 'data-able-column-control').getAttribute('data-able-icon'), null)
})

test('a face that finishes loading late reaches the controls already drawn', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, STAFF)

  /* `check` answers for a face that has finished loading, so a first pass can
   * miss one the host is still fetching. The runtime asks the host for it —
   * which is what resolves into a repaint — and re-asks each pass, so a
   * control drawn without it is not left with the ellipsis for good. */
  const fonts = fontSet({ loaded: false })
  const context = await render(host, fonts)
  assert.equal(fonts.requested, '1rem tabler-icons')

  turnColumnsOn(context, wrapper)
  const [name] = headCells(wrapper)
  const control = within(name, 'data-able-column-control')
  assert.equal(control.getAttribute('data-able-icon'), null)

  fonts.here = true
  context.markTables()
  assert.equal(control.getAttribute('data-able-icon'), 'filter')
  // The same control, not a rebuilt one: the header was never rewritten.
  assert.deepEqual(name.children.map((child) => child.getAttribute('data-able-column-control')), [''])
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
    ['click', 'focusout', 'input', 'keydown', 'keyup', 'mousedown', 'scroll']
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

/* Column menus: hung on every header cell once the table's own switch is on,
 * opened from the control beside the cell divider, and searching, committing
 * and clearing one column from the menu they open. */

const STAFF = [
  ['Ada', 'Engineer'],
  ['Grace', 'Admiral'],
  ['Alan', 'Engineer']
]

test('no header carries a control until the table’s column switch is on', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, STAFF)

  const context = await render(host)
  assert.equal(host.querySelectorAll('[data-able-head]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-column-control]').length, 0)

  press(context, settings(wrapper))
  const toggle = option(panelOf(wrapper), 'columns')
  assert.ok(toggle, 'the panel offers no column switch')
  assert.equal(toggle.textContent, 'Column menus')
  assert.equal(toggle.getAttribute('role'), 'switch')
  assert.equal(toggle.getAttribute('aria-checked'), 'false')

  press(context, toggle)
  assert.equal(toggle.getAttribute('aria-checked'), 'true')

  const key = wrapper.getAttribute('data-able-table')
  for (const [index, cell] of headCells(wrapper).entries()) {
    assert.equal(cell.getAttribute('data-able-head'), '')
    assert.equal(cell.getAttribute('data-able-key'), key)
    assert.equal(cell.getAttribute('data-able-column'), String(index))
    /* The name itself is Logseq's: nothing makes it focusable or clickable. */
    assert.equal(cell.getAttribute('tabindex'), null)

    const control = controlOf(cell)
    assert.ok(control, 'the header carries no control')
    assert.equal(control.tagName, 'BUTTON')
    assert.equal(control.getAttribute('aria-haspopup'), 'menu')
    assert.equal(control.getAttribute('aria-expanded'), 'false')
    assert.equal(control.getAttribute('data-able-column'), String(index))
  }

  assert.equal(controlOf(headCells(wrapper)[0]).getAttribute('aria-label'), 'Column options for Name')
})

test('a click on the column name itself is left to Logseq', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  const [name] = headCells(wrapper)

  const record = press(context, name)
  // The header opens the block for editing exactly as it always did.
  assert.equal(record.stopped, false)
  assert.equal(record.prevented, false)
  assert.equal(within(name, 'data-able-column-filter'), null)
  assert.equal(menuOf(wrapper), null)
})

test('pressing the control opens a menu beside the wrapper rather than inside it', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  const [name] = headCells(wrapper)

  const record = press(context, controlOf(name))
  assert.equal(record.stopped, true)
  assert.equal(record.prevented, true)

  const menu = menuOf(wrapper)
  assert.ok(menu, 'no menu was opened')
  /* Outside the wrapper, which is an overflow scroller that would clip it. */
  assert.equal(menu.parentElement, wrapper.parentElement)
  assert.equal(menu.getAttribute('role'), 'menu')
  assert.equal(menu.getAttribute('aria-label'), 'Column options for Name')
  assert.equal(menu.getAttribute('data-able-column'), '0')
  assert.equal(wrapper.children.some((child) => child.matches('[data-able-column-menu]')), false)
  assert.equal(controlOf(name).getAttribute('aria-expanded'), 'true')

  const search = itemIn(menu, 'search')
  assert.ok(search, 'the menu offers no Search column')
  assert.equal(search.textContent, 'Search column')
  assert.equal(search.getAttribute('role'), 'menuitem')
  assert.equal(search.focused, true, 'the menu did not take focus')
  // Nothing to clear yet, so nothing offers to.
  assert.equal(itemIn(menu, 'clear'), null)

  // A second press closes it and hands focus back to the control.
  controlOf(name).focused = false
  press(context, controlOf(name))
  assert.equal(menuOf(wrapper), null)
  assert.equal(controlOf(name).getAttribute('aria-expanded'), 'false')
  assert.equal(controlOf(name).focused, true)
})

test('Search column closes the menu and opens the field over the column name', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, STAFF)

  const context = await render(host)
  /* The header cell holds rendered Markdown — a link, code, emphasis — which
   * is there before this plugin hangs anything on the cell. The field is laid
   * over it rather than put in its place. */
  const [name] = headCells(wrapper)
  const link = name.appendChild(node('a'))
  turnColumnsOn(context, wrapper)

  press(context, controlOf(name))
  press(context, itemIn(menuOf(wrapper), 'search'))

  assert.equal(menuOf(wrapper), null, 'the menu stayed open')
  const field = within(name, 'data-able-column-filter')
  assert.ok(field, 'no filter field was opened')
  assert.equal(field.tagName, 'INPUT')
  assert.equal(field.getAttribute('data-able-key'), wrapper.getAttribute('data-able-table'))
  assert.equal(field.getAttribute('data-able-column'), '0')
  assert.equal(field.getAttribute('aria-label'), 'Search Name')
  assert.equal(field.getAttribute('placeholder'), 'Name')
  assert.equal(field.focused, true, 'the field did not take focus')

  // The cell's own markup is untouched, and still first.
  assert.equal(name.children[0], link)
  // The control is still there beside it, so the menu can be used again.
  assert.ok(controlOf(name))
})

test('typing narrows the table to that column alone, and backspacing restores it', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  const field = openColumn(context, wrapper, 0)

  /* A term that matches another column's cells matches nothing here: the test
   * is against the cell at this column's index, not against the row. */
  const record = type(context, field, 'engineer')
  assert.equal(record.stopped, true, 'the keystroke reached Logseq')
  assert.deepEqual(visible(rows), [])

  type(context, field, 'a')
  assert.deepEqual(visible(rows), ['Ada Engineer', 'Grace Admiral', 'Alan Engineer'])

  type(context, field, 'ADA')
  assert.deepEqual(visible(rows), ['Ada Engineer'])

  type(context, field, '')
  assert.deepEqual(visible(rows), ['Ada Engineer', 'Grace Admiral', 'Alan Engineer'])
})

test('a row with no cell at that column index matches nothing', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, [['Ada', 'Engineer'], ['Grace']])

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  filterColumn(context, wrapper, 1, 'engineer')

  assert.deepEqual(visible(rows), ['Ada Engineer'])
  assert.equal(rows[1].getAttribute('data-able-filtered'), '')
})

test('losing focus commits the filter under the column name', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, STAFF)

  const context = await render(host)
  const [name] = headCells(wrapper)
  const link = name.appendChild(node('a'))
  turnColumnsOn(context, wrapper)

  const term = filterColumn(context, wrapper, 0, 'ada')

  assert.equal(within(name, 'data-able-column-filter'), null, 'the field stayed open')
  assert.ok(term, 'nothing was committed under the column name')
  assert.equal(term.tagName, 'BUTTON')
  assert.equal(term.textContent, 'ada')
  assert.equal(term.getAttribute('data-able-key'), wrapper.getAttribute('data-able-table'))
  assert.equal(term.getAttribute('data-able-column'), '0')
  assert.equal(term.getAttribute('aria-label'), 'Clear the filter on Name')
  assert.deepEqual(visible(rows), ['Ada Engineer'])

  // The cell's own markup came back exactly as it was, and first.
  assert.equal(name.children[0], link)
})

test('a field that closes empty commits nothing and leaves the header as it was', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  const [name] = headCells(wrapper)
  const field = openColumn(context, wrapper, 0)
  blur(context, field)

  assert.equal(within(name, 'data-able-column-filter'), null)
  assert.equal(within(name, 'data-able-column-term'), null)
  // Nothing but the control this plugin hangs on every header.
  assert.deepEqual(name.children.map((child) => child.getAttribute('data-able-column-control')), [''])
  assert.deepEqual(visible(rows), ['Ada Engineer', 'Grace Admiral', 'Alan Engineer'])
})

test('Search column reopens the field holding the committed text, selected', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  const [name] = headCells(wrapper)
  filterColumn(context, wrapper, 0, 'ada')

  const field = openColumn(context, wrapper, 0)
  assert.equal(field.value, 'ada')
  assert.equal(field.focused, true)
  // Selected, so the next keystroke refines or discards it.
  assert.equal(field.selectionStart, 0)
  assert.equal(field.selectionEnd, 3)
  // The committed line is still there under the name while the field is open.
  assert.equal(within(name, 'data-able-column-term').textContent, 'ada')
})

test('Clear filter is offered only while there is one, and drops it', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  const [name] = headCells(wrapper)
  filterColumn(context, wrapper, 0, 'ada')

  press(context, controlOf(name))
  const clear = itemIn(menuOf(wrapper), 'clear')
  assert.ok(clear, 'the menu offers no Clear filter')
  assert.equal(clear.textContent, 'Clear filter')

  controlOf(name).focused = false
  press(context, clear)

  assert.equal(menuOf(wrapper), null)
  assert.equal(within(name, 'data-able-column-term'), null)
  assert.equal(within(name, 'data-able-column-filter'), null, 'clearing the filter opened the field')
  assert.deepEqual(visible(rows), ['Ada Engineer', 'Grace Admiral', 'Alan Engineer'])
  assert.equal(controlOf(name).focused, true, 'focus was not handed back to the control')
})

test('clicking the committed filter drops it, and never reopens the field', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  const [name] = headCells(wrapper)
  const term = filterColumn(context, wrapper, 0, 'ada')

  const record = press(context, term)
  assert.equal(record.stopped, true)
  assert.equal(record.prevented, true)

  assert.equal(within(name, 'data-able-column-term'), null)
  assert.equal(within(name, 'data-able-column-filter'), null, 'clearing the filter opened the field')
  assert.deepEqual(visible(rows), ['Ada Engineer', 'Grace Admiral', 'Alan Engineer'])
  assert.equal(rows.some((row) => row.attributes.has('data-able-filtered')), false)
})

test('Escape restores the last committed filter; Enter commits what the field holds', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  const [name] = headCells(wrapper)
  filterColumn(context, wrapper, 0, 'ada')

  // Escape: the draft goes, the committed filter stands.
  type(context, openColumn(context, wrapper, 0), 'grace')
  assert.deepEqual(visible(rows), ['Grace Admiral'])

  controlOf(name).focused = false
  const abandoned = key(context, within(name, 'data-able-column-filter'), 'Escape')
  assert.equal(abandoned.prevented, true)
  assert.equal(abandoned.stopped, true)
  assert.equal(within(name, 'data-able-column-filter'), null)
  assert.equal(within(name, 'data-able-column-term').textContent, 'ada')
  assert.deepEqual(visible(rows), ['Ada Engineer'])
  assert.equal(controlOf(name).focused, true, 'focus was not left on the control')

  // Enter: what the field holds is committed and the field closes.
  type(context, openColumn(context, wrapper, 0), 'grace')
  controlOf(name).focused = false
  const committed = key(context, within(name, 'data-able-column-filter'), 'Enter')
  assert.equal(committed.prevented, true)
  assert.equal(committed.stopped, true)
  assert.equal(within(name, 'data-able-column-filter'), null)
  assert.equal(within(name, 'data-able-column-term').textContent, 'grace')
  assert.deepEqual(visible(rows), ['Grace Admiral'])
  assert.equal(controlOf(name).focused, true)
})

test('the menu is dismissed by Escape, by a click outside it, and by scrolling', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  const [name] = headCells(wrapper)

  press(context, controlOf(name))
  controlOf(name).focused = false
  const escaped = key(context, itemIn(menuOf(wrapper), 'search'), 'Escape')
  assert.equal(escaped.prevented, true)
  assert.equal(escaped.stopped, true)
  assert.equal(menuOf(wrapper), null)
  assert.equal(controlOf(name).focused, true)

  // A click on the page outside the menu.
  press(context, controlOf(name))
  const elsewhere = body.appendChild(node('div'))
  const outside = press(context, elsewhere)
  assert.equal(menuOf(wrapper), null)
  assert.equal(outside.stopped, false)
  assert.equal(outside.prevented, false)

  /* The table scrolling under a menu measured against its control leaves the
   * menu pointing at nothing, so it goes. */
  press(context, controlOf(name))
  assert.ok(menuOf(wrapper))
  context.dispatchDocument('scroll', { target: wrapper })
  assert.equal(menuOf(wrapper), null)
})

test('one popup is open at a time, whichever kind it is', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const first = table(body, STAFF)
  const second = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, first.wrapper)
  turnColumnsOn(context, second.wrapper)

  // A column menu dismisses the settings panel that was left open.
  press(context, settings(first.wrapper))
  press(context, controlOf(headCells(first.wrapper)[0]))
  assert.ok(menuOf(first.wrapper))
  assert.equal(panelOf(first.wrapper), null)

  // And another column's menu dismisses it.
  press(context, controlOf(headCells(first.wrapper)[1]))
  assert.equal(menuOf(first.wrapper).getAttribute('data-able-column'), '1')
  assert.equal(
    first.wrapper.parentElement.children.filter((child) => child.matches('[data-able-column-menu]')).length,
    1
  )

  // Including another table's.
  press(context, controlOf(headCells(second.wrapper)[0]))
  assert.equal(menuOf(first.wrapper), null)
  assert.ok(menuOf(second.wrapper))
})

test('column filters combine with each other and with the full table search', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)

  filterColumn(context, wrapper, 1, 'engineer')
  assert.deepEqual(visible(rows), ['Ada Engineer', 'Alan Engineer'])

  // A second column narrows what the first left, in either order.
  filterColumn(context, wrapper, 0, 'alan')
  assert.deepEqual(visible(rows), ['Alan Engineer'])
  assert.equal(within(headCells(wrapper)[0], 'data-able-column-term').textContent, 'alan')
  assert.equal(within(headCells(wrapper)[1], 'data-able-column-term').textContent, 'engineer')

  // And the search narrows what both of them left.
  const field = openSearch(context, wrapper)
  type(context, field, 'engineer')
  assert.deepEqual(visible(rows), ['Alan Engineer'])
  type(context, field, 'ada')
  assert.deepEqual(visible(rows), [])
})

test('turning full table search off clears the search and keeps every column filter', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  filterColumn(context, wrapper, 0, 'a')

  const field = openSearch(context, wrapper)
  type(context, field, 'engineer')
  assert.deepEqual(visible(rows), ['Ada Engineer', 'Alan Engineer'])

  switchOption(context, wrapper, 'search')
  assert.equal(searchOf(wrapper), null)
  // The reader's own column filter is not the search switch's to clear.
  assert.equal(within(headCells(wrapper)[0], 'data-able-column-term').textContent, 'a')
  assert.deepEqual(visible(rows), ['Ada Engineer', 'Grace Admiral', 'Alan Engineer'])
})

test('turning the column switch off takes every control, filter and mark with it', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  const [name] = headCells(wrapper)
  filterColumn(context, wrapper, 0, 'ada')
  assert.deepEqual(visible(rows), ['Ada Engineer'])

  switchOption(context, wrapper, 'columns')

  assert.equal(host.querySelectorAll('[data-able-head]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-column-control]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-column-term]').length, 0)
  assert.equal(name.getAttribute('data-able-key'), null)
  /* Nothing may be left narrowing what the reader sees once the affordance
   * that would drop it is gone. */
  assert.deepEqual(visible(rows), ['Ada Engineer', 'Grace Admiral', 'Alan Engineer'])
  assert.equal(host.querySelectorAll('[data-able-filtered]').length, 0)

  // And it comes back unfiltered rather than holding what was dropped.
  switchOption(context, wrapper, 'columns')
  assert.equal(within(headCells(wrapper)[0], 'data-able-column-term'), null)
})

test('the search counts what the column filters leave standing', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  filterColumn(context, wrapper, 1, 'engineer')
  openSearch(context, wrapper)

  assert.equal(within(searchOf(wrapper), 'data-able-status').textContent, '2 of 3 rows')
})

test('the full table search reads a row as its cells with a space between them', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, [['Ada', 'Lovelace'], ['Grace', 'Hopper']])

  const context = await render(host)
  const field = openSearch(context, wrapper)

  /* A browser concatenates a row's cells with nothing in between, so reading
   * the row's own text would find `AdaLovelace` and never what the reader can
   * see. */
  type(context, field, 'ada lovelace')
  assert.deepEqual(visible(rows), ['Ada Lovelace'])
})

test('a table that renders no header row is offered no column switch, and the panel says so', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const headless = table(body, ['Name Role', 'Ada Lovelace'], { head: null })
  const { body: otherBody } = block(main)
  const headed = table(otherBody, STAFF)

  const context = await render(host)

  press(context, settings(headless.wrapper))
  assert.equal(option(panelOf(headless.wrapper), 'columns'), null, 'a switch that could do nothing was offered')
  assert.ok(option(panelOf(headless.wrapper), 'search'), 'the search switch went with it')
  assert.equal(
    within(panelOf(headless.wrapper), 'data-able-note').textContent,
    'This table renders no header row, so only full table search is available.'
  )

  press(context, settings(headed.wrapper))
  assert.ok(option(panelOf(headed.wrapper), 'columns'))
  assert.equal(
    within(panelOf(headed.wrapper), 'data-able-note').textContent,
    'A menu on every column header searches that column.'
  )
})

test('a column menu is operated from the keyboard', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  const [name] = headCells(wrapper)

  const opened = key(context, controlOf(name), 'Enter')
  assert.equal(opened.prevented, true)
  assert.equal(opened.stopped, true)
  const menu = menuOf(wrapper)
  assert.ok(menu, 'Enter on the control opened no menu')

  const search = itemIn(menu, 'search')
  const stepped = key(context, search, 'ArrowDown')
  assert.equal(stepped.prevented, true)
  assert.equal(stepped.stopped, true)
  // One item, so the arrow keys wrap back to it rather than leaving the menu.
  assert.equal(search.focused, true)

  key(context, search, ' ')
  const field = within(name, 'data-able-column-filter')
  assert.ok(field, 'Space on Search column opened no field')

  type(context, field, 'grace')
  key(context, field, 'Enter')
  assert.deepEqual(visible(rows), ['Grace Admiral'])

  // And the committed filter is dropped from the keyboard too.
  key(context, controlOf(name), 'Enter')
  key(context, itemIn(menuOf(wrapper), 'clear'), 'Enter')
  assert.equal(within(name, 'data-able-column-term'), null)
  assert.deepEqual(visible(rows), ['Ada Engineer', 'Grace Admiral', 'Alan Engineer'])
})

test('two tables in the same block filter their columns independently', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const first = table(body, STAFF)
  const second = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, first.wrapper)
  filterColumn(context, first.wrapper, 0, 'ada')

  assert.deepEqual(visible(first.rows), ['Ada Engineer'])
  assert.deepEqual(visible(second.rows), ['Ada Engineer', 'Grace Admiral', 'Alan Engineer'])
  // The switch is the table's own, so the second table has no controls at all.
  assert.equal(headCells(second.wrapper)[0].getAttribute('data-able-head'), null)
})

test('a re-render of the block brings every committed filter and its line back', async () => {
  const { host, main } = editor()
  const { body, uuid } = block(main)
  const first = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, first.wrapper)
  filterColumn(context, first.wrapper, 0, 'ada')

  // Editing the block replaces the whole render.
  panelOf(first.wrapper)?.remove()
  first.wrapper.remove()
  context.markTables()
  const rendered = table(body, STAFF)
  context.markTables()

  assert.equal(rendered.wrapper.getAttribute('data-able-table'), `${uuid}:0`)
  const [name] = headCells(rendered.wrapper)
  assert.ok(controlOf(name), 'the control did not come back')
  assert.equal(within(name, 'data-able-column-term').textContent, 'ada')
  assert.deepEqual(visible(rendered.rows), ['Ada Engineer'])
})

test('a block being edited commits the field that was open', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const first = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, first.wrapper)
  type(context, openColumn(context, first.wrapper, 0), 'grace')

  // The render goes while the field is still open.
  panelOf(first.wrapper)?.remove()
  first.wrapper.remove()
  context.markTables()
  const rendered = table(body, STAFF)
  context.markTables()

  const [restored] = headCells(rendered.wrapper)
  assert.equal(within(restored, 'data-able-column-filter'), null, 'the field came back open')
  assert.equal(within(restored, 'data-able-column-term').textContent, 'grace')
  assert.deepEqual(visible(rendered.rows), ['Grace Admiral'])
})

test('a table the pass no longer claims gives its header cells back unmarked', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper } = table(body, STAFF)

  const context = await render(host)
  turnColumnsOn(context, wrapper)
  const [name] = headCells(wrapper)
  filterColumn(context, wrapper, 0, 'ada')
  press(context, controlOf(name))
  assert.ok(within(name, 'data-able-column-term'))

  /* The cells stay in the document — what goes is the render this plugin was
   * reading them out of. A header cell is Logseq's own node, so what has to
   * come back is every attribute written on it. */
  wrapper.classList.delete('table-wrapper')
  context.markTables()

  for (const attribute of ['data-able-head', 'data-able-key', 'data-able-column']) {
    assert.equal(name.getAttribute(attribute), null, `${attribute} was left on the header cell`)
  }
  assert.deepEqual(name.children, [])
  assert.equal(host.querySelectorAll('[data-able-column-menu]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-column-control]').length, 0)
})


test('unloading removes every node and mark this plugin wrote, and its listeners', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const { wrapper, rows } = table(body, [['Ada', 'Lovelace'], ['Grace', 'Hopper']])
  /* A mark of the theme's, in the same wrapper, to prove teardown reads its
   * own namespace only. */
  const theirs = wrapper.appendChild(node('button', { attributes: { 'data-hc-collapse': '' } }))

  const context = await render(host)
  const field = openSearch(context, wrapper)
  type(context, field, 'grace')
  assert.ok(panelOf(wrapper), 'the panel is not open')

  const [name] = headCells(wrapper)
  turnColumnsOn(context, wrapper)
  filterColumn(context, wrapper, 0, 'grace')
  // With a menu left open over it.
  press(context, controlOf(name))

  const [unload] = context.unloads
  await unload()

  assert.equal(host.querySelectorAll('[data-able-table]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-settings]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-panel]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-search]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-filtered]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-anchor]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-head]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-column]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-column-control]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-column-menu]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-column-filter]').length, 0)
  assert.equal(host.querySelectorAll('[data-able-column-term]').length, 0)
  // The header cell is Logseq's own node, so every attribute written on it goes.
  assert.deepEqual(name.attributes.size, 0)
  assert.deepEqual(name.children, [])
  assert.deepEqual(visible(rows), ['Ada Lovelace', 'Grace Hopper'])

  for (const handlers of context.documentListeners.values()) assert.deepEqual(handlers, [])

  // The theme's own control is left exactly where it was.
  assert.equal(theirs.parentElement, wrapper)
  assert.equal(theirs.getAttribute('data-hc-collapse'), '')
})
