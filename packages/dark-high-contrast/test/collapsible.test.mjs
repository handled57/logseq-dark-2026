/* Behavioral tests for the theme's collapsible rich content.
 *
 * The entry is a classic script, so running it in a `vm` context against a
 * stub host puts its top-level declarations on that context's global object.
 * What is driven here is one pass of `paint()` over a fake page tree and the
 * document-level listeners the control is operated through.
 *
 * The fold this feature owns is the render's, never the block's: every test
 * that presses a control also asserts that Logseq's own collapse handler was
 * left alone, because the two live one element apart in the same document.
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
 * `#main-content-container`, and blocks that carry their own UUID. */
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

function load(host) {
  const unloads = []
  const collapses = []
  const documentListeners = new Map()
  const context = {
    console,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    parent: {
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
      settings: {},
      unloads,
      Editor: {
        async getBlock() {
          return null
        },
        registerBlockContextMenuItem() {},
        async setBlockCollapsed(uuid, options) {
          collapses.push({ uuid, options })
        }
      },
      App: {
        onRouteChanged() {},
        pushState() {}
      },
      beforeunload(handler) {
        unloads.push(handler)
      },
      useSettingsSchema() {},
      updateSettings() {},
      provideStyle() {},
      onSettingsChanged() {},
      ready(main) {
        return Promise.resolve(main())
      }
    }
  }

  vm.createContext(context)
  source.runInContext(context)
  context.collapses = collapses
  context.dispatchDocument = (type, event) => {
    for (const handler of documentListeners.get(type) ?? []) handler(event)
  }
  context.documentListeners = documentListeners

  return context
}

async function render(host) {
  const context = load(host)
  await Promise.resolve()
  return context
}

function control(host) {
  return host.children.find((child) => child.matches('[data-hc-collapse]')) ?? null
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

/* Every kind the feature claims, in the markup Logseq 0.10.15 renders it as:
 * the admonition row, the custom-block div a passage takes, the table's own
 * wrapper, the quote element, the fenced-code container, the latex box, the
 * asset wrapper, and the two embeds. */
const KINDS = [
  ['admonition', 'div', ['flex', 'flex-row', 'admonitionblock', 'align-items', 'tip']],
  ['passage', 'div', ['passage']],
  ['table', 'div', ['table-wrapper']],
  ['quote', 'blockquote', []],
  ['code', 'div', ['cp__fenced-code-block']],
  ['math', 'div', ['latex']],
  ['media', 'div', ['asset-container']],
  ['embed', 'div', ['color-level', 'embed-block', 'bg-base-2']],
  ['embed', 'div', ['color-level', 'embed', 'embed-page', 'bg-base-2']]
]

test('every supported kind of render is marked and given one control', async () => {
  const { host, main } = editor()
  const boxes = KINDS.map(([, tag, classes]) => {
    const { body } = block(main)
    const box = node(tag, { classes })
    body.appendChild(box)
    return box
  })

  const context = await render(host)

  for (const [index, [type]] of KINDS.entries()) {
    const box = boxes[index]
    assert.equal(box.getAttribute('data-hc-collapsible'), type, `${type} is not marked`)

    const button = control(box)
    assert.ok(button, `${type} has no control`)
    assert.equal(button.tagName, 'BUTTON')
    assert.equal(button.getAttribute('type'), 'button')
    assert.equal(button.getAttribute('aria-expanded'), 'true')
    assert.match(button.getAttribute('aria-label'), /^Collapse /)
    assert.equal(button.getAttribute('title'), button.getAttribute('aria-label'))
    // Content is expanded until the reader says otherwise.
    assert.equal(box.attributes.has('data-hc-collapsed'), false)
  }

  // A second pass finds the controls it wrote rather than writing more.
  context.paint()
  for (const box of boxes) {
    assert.equal(box.children.filter((child) => child.matches('[data-hc-collapse]')).length, 1)
  }
})

test('only the shells carry the word for what they hide', async () => {
  const { host, main } = editor()
  const boxes = KINDS.map(([, tag, classes]) => {
    const { body } = block(main)
    const box = node(tag, { classes })
    body.appendChild(box)
    return box
  })

  await render(host)

  const labels = boxes.map((box) => control(box).querySelector('[data-hc-collapse-label]')?.textContent ?? '')
  // The three kinds that fold to a line of their own content say nothing; the
  // rest name themselves, because a folded shell is all the reader can see.
  assert.deepEqual(labels, ['', '', '', 'Quote', 'Code', 'Math', 'Media', 'Embed', 'Embed'])
})

test('rich content outside the main editor is left as Logseq draws it', async () => {
  const { host, main } = editor()
  const sidebar = node('div', { id: 'right-sidebar' })
  host.appendChild(sidebar)

  const inside = node('blockquote')
  block(main).body.appendChild(inside)
  const outside = node('blockquote')
  block(sidebar).body.appendChild(outside)

  await render(host)

  assert.equal(inside.getAttribute('data-hc-collapsible'), 'quote')
  assert.equal(outside.getAttribute('data-hc-collapsible'), null)
  assert.equal(control(outside), null)
})

test('the outermost render of a nested pair is the one that carries a control', async () => {
  const { host, main } = editor()
  const { body } = block(main)

  const admonition = node('div', { classes: ['admonitionblock', 'note'] })
  const quoted = node('blockquote')
  admonition.appendChild(quoted)
  body.appendChild(admonition)

  // CodeMirror writes a `pre` for every line of a fenced code block.
  const fenced = node('div', { classes: ['cp__fenced-code-block'] })
  const line = node('pre', { classes: ['CodeMirror-line'] })
  fenced.appendChild(line)
  body.appendChild(fenced)

  // An embedded tree renders whole blocks of its own inside the embed.
  const embed = node('div', { classes: ['embed-block'] })
  const embedded = block(embed)
  embedded.body.appendChild(node('blockquote'))
  body.appendChild(embed)

  await render(host)

  assert.equal(admonition.getAttribute('data-hc-collapsible'), 'admonition')
  assert.equal(quoted.getAttribute('data-hc-collapsible'), null)
  assert.equal(fenced.getAttribute('data-hc-collapsible'), 'code')
  assert.equal(line.getAttribute('data-hc-collapsible'), null)
  assert.equal(embed.getAttribute('data-hc-collapsible'), 'embed')
  assert.equal(embedded.body.children[0].getAttribute('data-hc-collapsible'), null)
})

test('media hands its control to the box around it, and never to the block', async () => {
  const { host, main } = editor()

  // Logseq's own asset wrapper: the image inside it must not be marked twice.
  const { body: assetBody } = block(main)
  const asset = node('div', { classes: ['asset-container'] })
  const inside = node('img')
  asset.appendChild(inside)
  assetBody.appendChild(asset)

  // A remote image standing alone in a paragraph of its own.
  const { body: aloneBody } = block(main)
  const paragraph = node('div', { classes: ['is-paragraph'] })
  const alone = node('img')
  paragraph.appendChild(alone)
  aloneBody.appendChild(paragraph)

  // An image set in a line of prose is part of the line, not a box.
  const { body: proseBody } = block(main)
  const prose = node('div', { classes: ['is-paragraph'], textContent: 'see this' })
  const inline = node('img')
  prose.appendChild(inline)
  proseBody.appendChild(prose)

  // A video Logseq renders straight into the block body: the body carries the
  // block, so it is never taken over.
  const { body: bareBody } = block(main)
  const bare = node('video')
  bareBody.appendChild(bare)

  await render(host)

  assert.equal(asset.getAttribute('data-hc-collapsible'), 'media')
  assert.equal(inside.getAttribute('data-hc-collapsible'), null)
  assert.equal(paragraph.getAttribute('data-hc-collapsible'), 'media')
  assert.equal(alone.getAttribute('data-hc-collapsible'), null)
  assert.equal(prose.getAttribute('data-hc-collapsible'), null)
  assert.equal(bareBody.getAttribute('data-hc-collapsible'), null)
  assert.equal(bare.getAttribute('data-hc-collapsible'), null)
})

test('a control folds its own box and nothing else', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const first = node('blockquote')
  const second = node('blockquote')
  body.appendChild(first)
  body.appendChild(second)
  const other = node('blockquote')
  block(main).body.appendChild(other)

  const context = await render(host)
  const event = press(context, control(first))

  assert.equal(first.attributes.has('data-hc-collapsed'), true)
  assert.equal(control(first).getAttribute('aria-expanded'), 'false')
  assert.equal(control(first).getAttribute('aria-label'), 'Expand quote')
  // A second quote in the same block, and one in another block, are untouched.
  assert.equal(second.attributes.has('data-hc-collapsed'), false)
  assert.equal(other.attributes.has('data-hc-collapsed'), false)

  // Logseq's own fold, and the click that opens a block for editing, are both
  // kept out of it.
  assert.deepEqual(context.collapses, [])
  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)

  press(context, control(first))
  assert.equal(first.attributes.has('data-hc-collapsed'), false)
  assert.equal(control(first).getAttribute('aria-expanded'), 'true')
})

test('a fold survives the re-render that replaces the box', async () => {
  const { host, main } = editor()
  const { body, uuid } = block(main)
  body.appendChild(node('blockquote'))

  const context = await render(host)
  press(context, control(body.children[0]))
  assert.equal(body.children[0].attributes.has('data-hc-collapsed'), true)

  // Logseq re-renders the block: same block, a new element for the same quote.
  body.children[0].remove()
  const rendered = node('blockquote')
  body.appendChild(rendered)
  context.paint()

  assert.equal(rendered.attributes.has('data-hc-collapsed'), true)
  assert.equal(control(rendered).getAttribute('aria-expanded'), 'false')

  /* The state is kept under the block's own UUID, so a box in another block is
   * never opened or folded by it. */
  const other = block(main, uuid.replace(/1$/, '9'))
  other.body.appendChild(node('blockquote'))
  context.paint()
  assert.equal(other.body.children[0].attributes.has('data-hc-collapsed'), false)
})

test('a block being edited shows the whole of its content', async () => {
  const { host, main } = editor()
  const { wrapper, body } = block(main)
  const fenced = node('div', { classes: ['cp__fenced-code-block'] })
  body.appendChild(fenced)

  const context = await render(host)
  press(context, control(fenced))
  assert.equal(fenced.attributes.has('data-hc-collapsed'), true)

  // Clicking into the block puts a textarea over its raw content.
  const editing = node('textarea', { classes: ['block-editor'] })
  wrapper.appendChild(editing)
  context.paint()
  assert.equal(fenced.attributes.has('data-hc-collapsed'), false)

  // Leaving the editor returns the block to the state the reader left it in.
  editing.remove()
  context.paint()
  assert.equal(fenced.attributes.has('data-hc-collapsed'), true)
})

test('the control is operated from the keyboard and takes focus with it', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const quote = node('blockquote')
  body.appendChild(quote)

  const context = await render(host)
  const button = control(quote)

  for (const name of ['Enter', ' ']) {
    const event = key(context, button, name)
    assert.equal(quote.attributes.has('data-hc-collapsed'), true, name)
    assert.equal(event.prevented, true, name)
    assert.equal(event.stopped, true, name)
    key(context, button, name)
    assert.equal(quote.attributes.has('data-hc-collapsed'), false, name)
  }

  assert.equal(button.focused, true)

  // Every other key belongs to Logseq.
  const ignored = key(context, button, 'ArrowDown')
  assert.equal(ignored.prevented, false)
  assert.equal(ignored.stopped, false)
})

test('a press outside a control is left to Logseq', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const quote = node('blockquote')
  body.appendChild(quote)

  const context = await render(host)
  const event = press(context, quote)

  assert.equal(event.prevented, false)
  assert.equal(event.stopped, false)
  assert.equal(quote.attributes.has('data-hc-collapsed'), false)
})

test('a render that stops being a box gives its control back', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const quote = node('blockquote')
  body.appendChild(quote)

  const context = await render(host)
  assert.ok(control(quote))

  quote.classList.add('was-a-quote')
  quote.tagName = 'DIV'
  context.paint()

  assert.equal(quote.getAttribute('data-hc-collapsible'), null)
  assert.equal(quote.attributes.has('data-hc-collapsed'), false)
  assert.equal(control(quote), null)
})

test('unloading returns every box to Logseq', async () => {
  const { host, main } = editor()
  const { body } = block(main)
  const quote = node('blockquote')
  body.appendChild(quote)

  const context = await render(host)
  press(context, control(quote))

  const [unload] = context.logseq.unloads
  await unload()

  assert.equal(quote.getAttribute('data-hc-collapsible'), null)
  assert.equal(quote.attributes.has('data-hc-collapsed'), false)
  assert.equal(host.querySelectorAll('[data-hc-collapse]').length, 0)
  assert.deepEqual(context.documentListeners.get('mousedown'), [])
  assert.deepEqual(context.documentListeners.get('keydown'), [])

  // The listener that folds a block from its bullet goes with it.
  assert.deepEqual(context.documentListeners.get('click'), [])
})
