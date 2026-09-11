/* Behavioral tests for the theme's entry script.
 *
 * `index.js` is a classic script, not a module, so it exports nothing. Running
 * it in a `vm` context against a stub host puts its top-level function
 * declarations on that context's global object, which is enough to drive
 * `paint()` over a fake block tree and read the attributes it writes.
 *
 * Everything the theme annotates is a block that already exists. Writing a
 * passage belongs to the Passage package and is tested there; what is tested
 * here is that the theme reads a passage block correctly, from the content
 * shape both sides agree on in `docs/contracts/passage-v1.md`.
 */

import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = new vm.Script(await readFile(resolve(root, 'index.js'), 'utf8'))
function element() {
  const attributes = new Map()

  return {
    attributes,
    setAttribute(name, value) {
      attributes.set(name, value)
    },
    removeAttribute(name) {
      attributes.delete(name)
    }
  }
}

/* One rendered block: a `.ls-block` host wrapping a `.block-properties` table
 * whose rows each hold a key cell and a value cell. */
function block(properties) {
  const host = element()
  const table = Object.assign(element(), {
    children: Object.entries(properties).map(([key, value]) => ({
      querySelector(selector) {
        if (selector === '.page-property-key') return { textContent: `  ${key}  ` }
        if (selector === '.page-property-value') return { textContent: `  ${value}  ` }
        return null
      }
    })),
    closest: (selector) => (selector === '.ls-block' ? host : null)
  })

  return { host, table }
}

/* A stand-in for the parts of the host document `index.js` reads. Only the
 * selector forms it actually uses are supported — a compound of tag, id, class
 * and attribute-presence tokens, optionally in a comma list. */
function matchesSelector(target, selector) {
  return selector.split(',').some((part) => {
    const tokens = part.trim().match(/^[a-z]+|[.#][\w-]+|\[[^\]]+\]/gi) ?? []
    if (!tokens.length) return false

    return tokens.every((token) => {
      if (token.startsWith('.')) return target.classList.has(token.slice(1))
      if (token.startsWith('#')) return target.id === token.slice(1)
      if (token.startsWith('[')) return target.attributes.has(token.slice(1, -1))
      return target.tagName === token.toUpperCase()
    })
  })
}

function descendants(target) {
  return target.children.flatMap((child) => [child, ...descendants(child)])
}

/* The one part of `CSSStyleDeclaration` the entry uses: the custom properties
 * it writes on the host's body. */
function styleDeclaration() {
  const properties = new Map()

  return {
    properties,
    setProperty(name, value) {
      properties.set(name, value)
    },
    removeProperty(name) {
      properties.delete(name)
    },
    getPropertyValue(name) {
      return properties.get(name) ?? ''
    }
  }
}

function node(tag, { id = '', classes = [], attributes = {}, ...rest } = {}) {
  const self = {
    tagName: tag.toUpperCase(),
    id,
    classList: new Set(classes),
    style: styleDeclaration(),
    attributes: new Map(Object.entries(attributes)),
    children: [],
    listeners: new Map(),
    parentElement: null,
    textContent: '',
    focused: false,
    ...rest,
    setAttribute(name, value) {
      self.attributes.set(name, value)
    },
    getAttribute(name) {
      return self.attributes.has(name) ? self.attributes.get(name) : null
    },
    removeAttribute(name) {
      self.attributes.delete(name)
      if (name === 'id') self.id = ''
    },
    addEventListener(type, handler) {
      self.listeners.set(type, [...(self.listeners.get(type) ?? []), handler])
    },
    removeEventListener(type, handler) {
      self.listeners.set(type, (self.listeners.get(type) ?? []).filter((entry) => entry !== handler))
    },
    appendChild(child) {
      child.parentElement = self
      self.children.push(child)
      return child
    },
    insertBefore(child, before) {
      const previous = child.parentElement?.children
      if (previous) previous.splice(previous.indexOf(child), 1)
      child.parentElement = self
      self.children.splice(self.children.indexOf(before), 0, child)
      return child
    },
    remove() {
      const siblings = self.parentElement?.children
      if (siblings) siblings.splice(siblings.indexOf(self), 1)
      self.parentElement = null
    },
    cloneNode(deep = false) {
      const copy = node(tag, {
        id: self.id,
        classes: [...self.classList],
        attributes: Object.fromEntries(self.attributes)
      })
      copy.textContent = self.textContent
      if (deep) for (const child of self.children) copy.appendChild(child.cloneNode(true))
      return copy
    },
    focus() {
      self.focused = true
    },
    matches: (selector) => matchesSelector(self, selector),
    closest(selector) {
      for (let current = self; current; current = current.parentElement) {
        if (matchesSelector(current, selector)) return current
      }
      return null
    },
    querySelector: (selector) =>
      descendants(self).find((child) => matchesSelector(child, selector)) ?? null,
    querySelectorAll: (selector) =>
      descendants(self).filter((child) => matchesSelector(child, selector)),
    /* Listeners are invoked directly rather than bubbled: every handler
     * `index.js` registers sits on the node the host would deliver to. */
    dispatch(type, event = {}) {
      for (const handler of self.listeners.get(type) ?? []) {
        handler({ target: self, preventDefault() {}, stopPropagation() {}, ...event })
      }
    }
  }

  return self
}

const PASSAGE_SOURCE = '#+BEGIN_PASSAGE\n**John 3:16**\n\n#+END_PASSAGE'
/* What the Passage v1 contract says a passage block holds: the block's property
 * drawer, then the markup. The drawer belongs at the top of the block, not
 * beside the marker. */
const PASSAGE_PROPERTIES = 'tags:: \ntype:: Passage'
const PASSAGE_BLOCK = `${PASSAGE_PROPERTIES}\n${PASSAGE_SOURCE}`
function load(settings, blocks = [], storedBlocks = {}, host = node('body')) {
  const provided = []
  const observers = []
  const unloads = []
  const blockMenuItems = []
  const collapses = []
  const blockWrites = []
  let blockReads = 0
  const navigations = []
  const documentListeners = new Map()
  const context = {
    console,
    setImmediate,
    MutationObserver: class {
      constructor() {
        this.connected = false
        observers.push(this)
      }

      observe(target, options) {
        this.connected = true
        this.target = target
        this.options = options
      }

      disconnect() {
        this.connected = false
      }
    },
    parent: {
      requestAnimationFrame(callback) {
        callback()
      },
      document: {
        body: host,
        getElementById: () => element(),
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
        /* The property tables keep their purpose-built stubs, which stand
         * outside the host tree; everything else, blocks included, is served by
         * the host stand-in. */
        querySelector: (selector) => host.querySelector(selector),
        querySelectorAll: (selector) =>
          selector === '.block-properties' ? blocks.map(({ table }) => table)
            : host.querySelectorAll(selector)
      }
    },
    logseq: {
      settings,
      provided,
      observers,
      unloads,
      Editor: {
        async getBlock(uuid) {
          blockReads += 1
          return storedBlocks[uuid] ?? null
        },
        /* Nothing this entry does may reach the graph. These record the calls
         * that would, so a test can assert none was made. */
        async updateBlock(...args) {
          blockWrites.push(args)
        },
        async insertBlock(...args) {
          blockWrites.push(args)
        },
        registerBlockContextMenuItem(label, action) {
          blockMenuItems.push({ label, action })
        },
        async setBlockCollapsed(uuid, options) {
          collapses.push({ uuid, options })
        }
      },
      beforeunload(handler) {
        unloads.push(handler)
      },
      App: {
        onRouteChanged() {},
        pushState(route, parameters) {
          navigations.push({ route, parameters })
        }
      },
      useSettingsSchema(schema) {
        for (const entry of schema) {
          if (!(entry.key in this.settings)) this.settings[entry.key] = entry.default
        }
        this.schema = schema
      },
      updateSettings(patch) {
        Object.assign(this.settings, patch)
      },
      provideStyle(style) {
        provided.push(style)
      },
      onSettingsChanged() {},
      ready(main) {
        return Promise.resolve(main())
      }
    }
  }

  vm.createContext(context)
  source.runInContext(context)
  context.blockReads = () => blockReads
  context.blockWrites = blockWrites
  context.navigations = navigations
  context.blockMenuItems = blockMenuItems
  context.collapses = collapses
  context.dispatchDocument = (type, event) => {
    for (const handler of documentListeners.get(type) ?? []) handler(event)
  }
  context.documentListeners = documentListeners
  context.hostStyle = host.style

  return context
}

/* `logseq.ready` resolves a promise, so the first paint lands a microtask after
 * the script runs. */
async function render(settings, blocks) {
  const context = load(settings, blocks)
  await Promise.resolve()
  return context
}

function hidden(blocks) {
  return blocks.map(({ table }) => table.attributes.has('data-hc-hidden'))
}

function types(blocks) {
  return blocks.map(({ host }) => host.attributes.get('data-hc-block-type'))
}

function propertyRailBlock(uuid, properties, { mainClasses = [], contentClasses = [], blockClasses = [] } = {}) {
  const host = node('body')
  const main = host.appendChild(node('main', { classes: mainClasses }))
  const editor = main.appendChild(node('div', { id: 'main-content-container' }))
  const page = editor.appendChild(node('div', { classes: ['page-blocks-inner'] }))
  const content = page.appendChild(node('div', { classes: ['content', ...contentClasses] }))
  const blockHost = content.appendChild(node('div', {
    classes: ['ls-block', ...blockClasses],
    attributes: { blockid: uuid }
  }))
  const blockMain = blockHost.appendChild(node('div', { classes: ['block-main-container'] }))
  const controls = blockMain.appendChild(node('div', { classes: ['block-control-wrap'] }))
  const bullet = controls.appendChild(node('a', { classes: ['bullet-link-wrap'] }))
  bullet.appendChild(node('span', { classes: ['bullet-container'] }))
  const wrapper = blockMain.appendChild(node('div', { classes: ['block-content-wrapper'] }))
  const table = wrapper.appendChild(node('div', { classes: ['block-properties'] }))

  for (const [key, value] of Object.entries(properties)) {
    const row = table.appendChild(node('div'))
    const keyCell = row.appendChild(node('span', { classes: ['page-property-key'] }))
    const valueCell = row.appendChild(node('span', { classes: ['page-property-value'] }))
    keyCell.textContent = key
    valueCell.textContent = value
  }

  return { host, block: blockHost, controls, table }
}

function railTree() {
  const host = node('body')
  const main = host.appendChild(node('main'))
  const editor = main.appendChild(node('div', { id: 'main-content-container' }))
  const page = editor.appendChild(node('div', { classes: ['page-blocks-inner'] }))
  const content = page.appendChild(node('div', { classes: ['content'] }))

  function appendBlock(group, { visible = true } = {}) {
    const block = group.appendChild(node('div', {
      classes: ['ls-block'],
      getClientRects: () => visible ? [{}] : []
    }))
    const mainContainer = block.appendChild(node('div', { classes: ['block-main-container'] }))
    mainContainer.appendChild(node('div', { classes: ['block-control-wrap'] }))
    const wrapper = mainContainer.appendChild(node('div', { classes: ['block-content-wrapper'] }))
    wrapper.textContent = 'Block'
    return block
  }

  function childrenOf(block) {
    const container = block.appendChild(node('div', { classes: ['block-children-container'] }))
    return container.appendChild(node('div', { classes: ['block-children'] }))
  }

  return { host, content, appendBlock, childrenOf }
}

test('property buttons toggle either initial state and keep accessibility in sync', async () => {
  const hiddenFixture = propertyRailBlock('65f00000-0000-0000-0000-000000000040', { type: 'passage' })
  const hiddenContext = load({ hiddenProperties: 'type: passage' }, [
    { host: hiddenFixture.block, table: hiddenFixture.table }
  ], {}, hiddenFixture.host)
  await Promise.resolve()

  const hiddenControl = hiddenFixture.controls.querySelector('[data-hc-property-toggle]')
  assert.ok(hiddenControl)
  assert.equal(hiddenFixture.table.attributes.has('data-hc-hidden'), true)
  assert.equal(hiddenControl.getAttribute('aria-expanded'), 'false')
  assert.equal(hiddenControl.getAttribute('aria-label'), 'Show block properties')

  hiddenContext.dispatchDocument('click', {
    type: 'click',
    target: hiddenControl,
    button: 0,
    preventDefault() {},
    stopPropagation() {}
  })
  assert.equal(hiddenFixture.table.attributes.has('data-hc-hidden'), false)
  assert.equal(hiddenControl.getAttribute('aria-expanded'), 'true')
  assert.equal(hiddenControl.getAttribute('title'), 'Hide block properties')
  assert.equal(hiddenControl.focused, true)

  const visibleFixture = propertyRailBlock('65f00000-0000-0000-0000-000000000041', { status: 'open' })
  const visibleContext = load({ hiddenProperties: 'type: passage' }, [
    { host: visibleFixture.block, table: visibleFixture.table }
  ], {}, visibleFixture.host)
  await Promise.resolve()
  const visibleControl = visibleFixture.controls.querySelector('[data-hc-property-toggle]')

  visibleContext.dispatchDocument('keydown', {
    target: visibleControl,
    key: ' ',
    preventDefault() {},
    stopPropagation() {}
  })
  assert.equal(visibleFixture.table.attributes.has('data-hc-hidden'), true)
  assert.equal(visibleControl.getAttribute('aria-expanded'), 'false')
})

test('a property override survives repaint and settings changes for its UUID', async () => {
  const uuid = '65f00000-0000-0000-0000-000000000042'
  const fixture = propertyRailBlock(uuid, { type: 'passage' })
  const context = load({ hiddenProperties: 'type: passage' }, [
    { host: fixture.block, table: fixture.table }
  ], {}, fixture.host)
  await Promise.resolve()
  const control = fixture.controls.querySelector('[data-hc-property-toggle]')

  context.togglePropertyVisibility(control)
  context.paint()
  assert.equal(fixture.table.attributes.has('data-hc-hidden'), false)
  assert.equal(fixture.controls.querySelectorAll('[data-hc-property-toggle]').length, 1)

  context.logseq.settings.hiddenProperties = 'status: open'
  context.paint()
  assert.equal(fixture.table.attributes.has('data-hc-hidden'), false)
})

test('property buttons stay out of excluded layouts and teardown restores the host', async () => {
  const fixtures = [
    propertyRailBlock('65f00000-0000-0000-0000-000000000043', { type: 'passage' }, { blockClasses: ['pre-block'] }),
    propertyRailBlock('65f00000-0000-0000-0000-000000000044', { type: 'passage' }, { contentClasses: ['doc-mode'] }),
    propertyRailBlock('65f00000-0000-0000-0000-000000000045', { type: 'passage' }, { mainClasses: ['ls-fold-button-on-right'] })
  ]

  for (const fixture of fixtures) {
    load(
      { hiddenProperties: 'type: passage' },
      [{ host: fixture.block, table: fixture.table }],
      {},
      fixture.host
    )
    await Promise.resolve()
    assert.equal(fixture.controls.querySelector('[data-hc-property-toggle]'), null)
  }

  const fixture = propertyRailBlock('65f00000-0000-0000-0000-000000000046', { type: 'passage' })
  const context = load({ hiddenProperties: 'type: passage' }, [
    { host: fixture.block, table: fixture.table }
  ], {}, fixture.host)
  await Promise.resolve()
  context.togglePropertyVisibility(fixture.controls.querySelector('[data-hc-property-toggle]'))
  context.teardown()

  assert.equal(fixture.controls.querySelector('[data-hc-property-toggle]'), null)
  assert.equal(fixture.table.attributes.has('data-hc-hidden'), false)
})

test('a block matching any one configured pair is hidden', async () => {
  const blocks = [
    block({ type: 'foo' }),
    block({ status: 'done' }),
    block({ type: 'bar' }),
    block({ type: 'other', status: 'open' }),
    block({ author: 'foo' })
  ]

  await render({ hiddenProperties: 'type: foo, status: done, type: bar' }, blocks)

  assert.deepEqual(hidden(blocks), [true, true, true, false, false])
})

test('a pair only matches when both halves match', async () => {
  const blocks = [block({ type: 'foo' }), block({ type: 'foobar' }), block({ kind: 'foo' })]

  await render({ hiddenProperties: 'type: foo' }, blocks)

  assert.deepEqual(hidden(blocks), [true, false, false])
})

test('pairs may be separated by commas, semicolons or newlines, and are trimmed', async () => {
  const blocks = [block({ type: 'foo' }), block({ status: 'done' }), block({ kind: 'note' })]

  await render({ hiddenProperties: '  type:foo ;\n  status :  done  \n\n,, kind: note ,' }, blocks)

  assert.deepEqual(hidden(blocks), [true, true, true])
})

test('matching ignores case on both halves of a pair', async () => {
  const blocks = [block({ Type: 'Foo' }), block({ STATUS: 'DONE' })]

  await render({ hiddenProperties: 'TYPE: foo, status: Done' }, blocks)

  assert.deepEqual(hidden(blocks), [true, true])
})

test('a wildcard or bare key matches every value of that key', async () => {
  const blocks = [block({ type: 'anything' }), block({ kind: 'anything' }), block({ other: 'x' })]

  await render({ hiddenProperties: 'type: *, kind' }, blocks)

  assert.deepEqual(hidden(blocks), [true, true, false])
})

test('an empty rule list hides nothing and clears both attributes', async () => {
  const blocks = [block({ type: 'foo' })]
  const context = await render({ hiddenProperties: 'type: foo' }, blocks)

  assert.deepEqual(hidden(blocks), [true])

  context.logseq.settings.hiddenProperties = '   '
  context.paint()

  assert.deepEqual(hidden(blocks), [false])
  assert.deepEqual(types(blocks), [undefined])
})

test('re-painting after a settings change reverses a previous hide', async () => {
  const blocks = [block({ type: 'foo' }), block({ type: 'bar' })]
  const context = await render({ hiddenProperties: 'type: foo' }, blocks)

  assert.deepEqual(hidden(blocks), [true, false])

  context.logseq.settings.hiddenProperties = 'type: bar'
  context.paint()

  assert.deepEqual(hidden(blocks), [false, true])
})

test('the block type hook follows the first configured key the block carries', async () => {
  const blocks = [
    block({ status: 'open', type: 'foo' }),
    block({ status: 'done' }),
    block({ author: 'nobody' })
  ]

  await render({ hiddenProperties: 'type: *, status: done' }, blocks)

  // Configuration order is precedence order, not the order of the rendered rows.
  assert.deepEqual(types(blocks), ['foo', 'done', undefined])
})

test('an unconfigured graph takes the schema default', async () => {
  // The default hides the drawer on the one block type this theme writes.
  const blocks = [block({ type: 'Passage' }), block({ type: 'bar' })]
  const context = await render({}, blocks)

  assert.equal(context.logseq.settings.hiddenProperties, 'type: passage')
  assert.deepEqual(hidden(blocks), [true, false])
})

test('the 1.2.0 key-and-values settings migrate to one rule list', async () => {
  const blocks = [block({ type: 'foo' }), block({ type: 'bar' }), block({ type: 'baz' })]
  const context = await render(
    { hiddenPropertyKey: 'type', hiddenPropertyValues: 'foo, bar' },
    blocks
  )

  assert.equal(context.logseq.settings.hiddenProperties, 'type: foo, type: bar')
  assert.deepEqual(hidden(blocks), [true, true, false])
})

test('a migrated wildcard and an emptied legacy key both survive', async () => {
  const wildcard = await render({ hiddenPropertyKey: 'type', hiddenPropertyValues: '*' }, [])
  assert.equal(wildcard.logseq.settings.hiddenProperties, 'type: *')

  // An empty legacy key was the 1.2.0 way to disable hiding; it must not
  // migrate into a rule, and the new default applies instead.
  const disabled = await render({ hiddenPropertyKey: '', hiddenPropertyValues: 'foo' }, [])
  assert.equal(disabled.logseq.settings.hiddenProperties, 'type: passage')
})

test('an already-configured graph is not overwritten by migration', async () => {
  const context = await render(
    { hiddenProperties: 'status: done', hiddenPropertyKey: 'type', hiddenPropertyValues: 'foo' },
    []
  )

  assert.equal(context.logseq.settings.hiddenProperties, 'status: done')
})

test('the entry provides the one style rule that does the hiding, and only that', async () => {
  const context = await render({}, [])

  // Structural, not deep-equal: the object crosses out of the vm realm, so it
  // has that realm's Object prototype.
  const hiding = context.logseq.provided.find(({ key }) => key === 'hc-hidden-properties')
  assert.equal(hiding.style, '.block-properties[data-hc-hidden] { display: none; }')

  // The entry provides no other style: everything the theme paints is in
  // theme.css, and the Passage dialog is styled by the plugin that owns it.
  assert.equal(context.logseq.provided.length, 1)
})

/* The bullet rail's base line. theme.css declares the same default, so the two
 * agree whether or not the entry is running; what the setting adds is an inline
 * custom property on the host's body, which out-ranks the stylesheet without
 * depending on the order the theme and the plugin are loaded in. The body is
 * the element rather than the root because theme.css declares the palette on a
 * selector list that includes `html[data-theme][data-color]:root body`, which
 * would otherwise re-declare this variable below anything set on `html`. */
const RAIL_PROPERTY = '--hc-rail-default-color'

test('the rail color setting is offered with the structural border as its default', async () => {
  const context = await render({}, [])
  const setting = context.logseq.schema.find(({ key }) => key === 'defaultRailColor')

  assert.ok(setting, 'the theme offers no rail color setting')
  assert.equal(setting.type, 'string')
  assert.equal(setting.inputAs, 'color')
  assert.equal(setting.title, 'Rail color')
  assert.equal(setting.default, '#5B7E96')

  // An unconfigured graph takes that default and paints the rail with it.
  assert.equal(context.hostStyle.getPropertyValue(RAIL_PROPERTY), '#5b7e96')
})

test('a chosen rail color is written to the host root and nothing else is', async () => {
  const context = await render({ defaultRailColor: '#8A2BE2' }, [])

  assert.equal(context.hostStyle.getPropertyValue(RAIL_PROPERTY), '#8a2be2')

  // The eight hierarchy colors are theme.css's own and the setting never
  // reaches them: the root carries this one property and no other.
  assert.deepEqual([...context.hostStyle.properties.keys()], [RAIL_PROPERTY])
})

test('an emptied rail color hands the line back to the stylesheet', async () => {
  const context = await render({ defaultRailColor: '   ' }, [])

  assert.equal(context.hostStyle.properties.has(RAIL_PROPERTY), false)
})

test('changing the rail color repaints it', async () => {
  const context = await render({ defaultRailColor: '#8a2be2' }, [])

  context.logseq.settings.defaultRailColor = '#40b0a6'
  context.paint()

  assert.equal(context.hostStyle.getPropertyValue(RAIL_PROPERTY), '#40b0a6')
})

test('unloading takes the rail color back off the host root', async () => {
  const context = await render({ defaultRailColor: '#8a2be2' }, [])
  for (const handler of context.logseq.unloads) await handler()

  assert.equal(context.hostStyle.properties.has(RAIL_PROPERTY), false)
})

test('the rail layout setting offers Flat by default and Branched as an alternative', async () => {
  const context = await render({}, [])
  const setting = context.logseq.schema.find(({ key }) => key === 'railLayout')

  assert.ok(setting, 'the theme offers no rail layout setting')
  assert.equal(setting.type, 'enum')
  assert.equal(setting.enumPicker, 'select')
  assert.deepEqual([...setting.enumChoices], ['Flat', 'Branched'])
  assert.equal(setting.default, 'Flat')
  assert.equal(setting.title, 'Rail layout')
  assert.equal(context.parent.document.body.getAttribute('data-hc-rail-layout'), 'flat')
})

test('choosing Branched updates the host layout marker on repaint', async () => {
  const context = await render({ railLayout: 'Branched' }, [])

  assert.equal(context.parent.document.body.getAttribute('data-hc-rail-layout'), 'branched')

  context.logseq.settings.railLayout = 'Flat'
  context.paint()
  assert.equal(context.parent.document.body.getAttribute('data-hc-rail-layout'), 'flat')
})

test('Branched marks only the rows where one traversal rail changes depth', async () => {
  const fixture = railTree()
  const a = fixture.appendBlock(fixture.content)
  const b = fixture.appendBlock(fixture.content)
  const bChildren = fixture.childrenOf(b)
  const b1 = fixture.appendBlock(bChildren)
  const b2 = fixture.appendBlock(bChildren)
  const c = fixture.appendBlock(fixture.content)
  const cChildren = fixture.childrenOf(c)
  const c1 = fixture.appendBlock(cChildren)
  const d = fixture.appendBlock(fixture.content)
  const context = load({ railLayout: 'Branched' }, [], {}, fixture.host)
  await Promise.resolve()

  const turn = (block) => block.getAttribute('data-hc-rail-turn')
  const distance = (block) => block.style.getPropertyValue('--hc-rail-turn-distance')

  assert.deepEqual(
    [a, b, b1, b2, c, c1, d].map(turn),
    [null, null, 'deeper', null, 'shallower', 'deeper', 'shallower']
  )
  assert.deepEqual(
    [a, b, b1, b2, c, c1, d].map(distance),
    ['', '', '29px', '', '29px', '29px', '29px']
  )

  context.logseq.settings.railLayout = 'Flat'
  context.paint()
  assert.deepEqual([a, b, b1, b2, c, c1, d].map(turn), Array(7).fill(null))
  assert.deepEqual([a, b, b1, b2, c, c1, d].map(distance), Array(7).fill(''))
})

test('Branched returns several nesting levels in one turn and skips collapsed descendants', async () => {
  const fixture = railTree()
  const a = fixture.appendBlock(fixture.content)
  const aChildren = fixture.childrenOf(a)
  const a1 = fixture.appendBlock(aChildren)
  const a1Children = fixture.childrenOf(a1)
  const a11 = fixture.appendBlock(a1Children)
  const b = fixture.appendBlock(fixture.content)
  const hiddenChildren = fixture.childrenOf(b)
  const hidden = fixture.appendBlock(hiddenChildren, { visible: false })
  const c = fixture.appendBlock(fixture.content)
  const context = load({ railLayout: 'Branched' }, [], {}, fixture.host)
  await Promise.resolve()

  assert.equal(a1.getAttribute('data-hc-rail-turn'), 'deeper')
  assert.equal(a11.getAttribute('data-hc-rail-turn'), 'deeper')
  assert.equal(b.getAttribute('data-hc-rail-turn'), 'shallower')
  assert.equal(b.style.getPropertyValue('--hc-rail-turn-distance'), '58px')
  assert.equal(hidden.getAttribute('data-hc-rail-turn'), null)
  assert.equal(c.getAttribute('data-hc-rail-turn'), null)

  for (const handler of context.logseq.unloads) await handler()
  assert.equal(a1.getAttribute('data-hc-rail-turn'), null)
  assert.equal(a1.style.getPropertyValue('--hc-rail-turn-distance'), '')
})

test('an unknown rail layout falls back to Flat and unloading removes the marker', async () => {
  const context = await render({ railLayout: 'diagonal' }, [])

  assert.equal(context.parent.document.body.getAttribute('data-hc-rail-layout'), 'flat')

  for (const handler of context.logseq.unloads) await handler()
  assert.equal(context.parent.document.body.getAttribute('data-hc-rail-layout'), null)
})

function bulletBlock({ raw = '', text = '', special = false, renderedSelector = '', wrapperSelector = '', uuid = '' } = {}) {
  const wrapper = {
    textContent: text,
    matches(selector) {
      return wrapperSelector && selector.includes(wrapperSelector)
    },
    querySelector(selector) {
      if (selector === 'textarea.block-editor, textarea') return raw ? { value: raw } : null
      return special || (renderedSelector && selector.includes(renderedSelector)) ? {} : null
    },
    cloneNode() {
      return {
        textContent: text,
        querySelectorAll: () => []
      }
    }
  }

  const host = Object.assign(element(), {
    dataset: {},
    getAttribute(name) {
      return name === 'blockid' ? uuid : null
    },
    querySelector: () => wrapper
  })

  return host
}

test('only ordinary prose keeps its bullet', async () => {
  const context = await render({}, [])

  assert.equal(context.shouldHideBullet(bulletBlock({ text: 'ordinary prose' })), false)
  assert.equal(context.shouldHideBullet(bulletBlock()), true)
  assert.equal(context.shouldHideBullet(bulletBlock({ special: true })), true)
})

test('special source forms remain bulletless while editing', async () => {
  const context = await render({}, [])
  const special = [
    '# Heading',
    'type:: source',
    '((65f00000-0000-0000-0000-000000000000))',
    '[[Reference]]',
    '{{embed [[Page]]}}',
    '{{query (property :status "done")}}',
    '{{namespace [[Parent]]}}',
    '{{eval (+ 1 2)}}',
    '{{renderer :slide, [[Deck]]}}',
    '{{zotero-imported-file item}}',
    '```clojure\n(+ 1 2)\n```',
    '$$x^2$$',
    '> quotation',
    '#+BEGIN_QUOTE\nquotation\n#+END_QUOTE',
    '#+BEGIN_SRC clojure\n(+ 1 2)\n#+END_SRC',
    '#+BEGIN_CENTER\ncentered text\n#+END_CENTER',
    '#+BEGIN_VERSE\na line of verse\n#+END_VERSE',
    '#+BEGIN_PASSAGE\n**John 3:16**\n\n#+END_PASSAGE',
    // A property drawer sits above the marker, so the marker is only the first
    // line once the drawer is stepped over.
    PASSAGE_BLOCK,
    'prompt #card'
  ]

  for (const raw of special) {
    assert.equal(context.shouldHideBullet(bulletBlock({ raw })), true, raw)
  }
  assert.equal(context.shouldHideBullet(bulletBlock({ raw: 'ordinary prose' })), false)
  // Properties alone do not make a block special enough to lose its bullet.
  assert.equal(
    context.shouldHideBullet(bulletBlock({ raw: 'tags:: study\nordinary prose' })),
    false
  )
})

test('rendered src, center, and verse blocks remain bulletless regardless of custom-block case', async () => {
  const context = await render({}, [])

  for (const renderedSelector of [
    '.org-src-container', '.center', '.CENTER', '.org-center', '[style*="text-align: center"]',
    '[style*="text-align:center"]', '.verse', '.VERSE', '.org-verse'
  ]) {
    assert.equal(
      context.shouldHideBullet(bulletBlock({ text: 'rendered content', renderedSelector })),
      true,
      renderedSelector
    )
  }

  for (const wrapperSelector of ['[style*="text-align: center"]', '[style*="text-align:center"]']) {
    assert.equal(
      context.shouldHideBullet(bulletBlock({ text: 'center', wrapperSelector })),
      true,
      `wrapper ${wrapperSelector}`
    )
  }
})

test('stored source keeps a rendered BEGIN_CENTER block bulletless without DOM markers', async () => {
  const uuid = '65f00000-0000-0000-0000-000000000000'
  const context = load({}, [], {
    [uuid]: { content: '#+BEGIN_CENTER\ncenter\n#+END_CENTER' }
  })
  const centered = bulletBlock({ text: 'center', uuid })

  assert.equal(context.shouldHideBullet(centered), false)
  await context.refreshFromStoredSource(centered)
  assert.equal(centered.attributes.has('data-hc-hide-bullet'), true)
})

test('stored ordinary prose does not become bulletless', async () => {
  const uuid = '65f00000-0000-0000-0000-000000000001'
  const context = load({}, [], { [uuid]: { content: 'ordinary prose' } })
  const prose = bulletBlock({ text: 'ordinary prose', uuid })

  await context.refreshFromStoredSource(prose)
  assert.equal(prose.attributes.has('data-hc-hide-bullet'), false)
})

test('stored source reads are cached per block UUID', async () => {
  const uuid = '65f00000-0000-0000-0000-000000000002'
  const context = load({}, [], { [uuid]: { content: 'ordinary prose' } })
  const prose = bulletBlock({ text: 'ordinary prose', uuid })

  await context.refreshFromStoredSource(prose)
  await context.refreshFromStoredSource(prose)
  assert.equal(context.blockReads(), 1)
})

test('a rendered passage block is bulletless without waiting on the stored source', async () => {
  const context = await render({}, [])

  // The synchronous path: `.passage` is in the rendered-DOM selector list, so
  // the attribute lands on the first paint rather than on the async lookup.
  assert.equal(
    context.shouldHideBullet(bulletBlock({ text: 'John 3:16', renderedSelector: '.passage' })),
    true
  )
})

test('stored source keeps a passage block bulletless when the render carries no marker', async () => {
  const uuid = '65f00000-0000-0000-0000-00000000000b'
  const context = load({}, [], { [uuid]: { content: PASSAGE_SOURCE } })
  const passage = bulletBlock({ text: 'John 3:16', uuid })

  assert.equal(context.shouldHideBullet(passage), false)
  await context.refreshFromStoredSource(passage)
  assert.equal(passage.attributes.has('data-hc-hide-bullet'), true)
})

/* theme.css hangs a verse number in a gutter of its own only where the block's
 * source says every number opens a line, which is the passage written one verse
 * per line. These are the sources that do and do not earn that. */
const HANGING_PASSAGE =
  '#+BEGIN_PASSAGE\n**John 3:16\u201317**\n\n' +
  '^^\u00b9\u2076^^For God so loved the world.\n' +
  '^^\u00b9\u2077^^Indeed, God did not send the Son.\n#+END_PASSAGE'
const PROSE_PASSAGE =
  '#+BEGIN_PASSAGE\n**John 3:16\u201317**\n\n' +
  '^^\u00b9\u2076^^For God so loved the world. ^^\u00b9\u2077^^Indeed, God did not send the Son.' +
  '\n#+END_PASSAGE'

test('a passage written one verse per line asks the theme for a verse gutter', async () => {
  const uuid = '65f00000-0000-0000-0000-00000000000c'
  const context = load({}, [], { [uuid]: { content: `${PASSAGE_PROPERTIES}\n${HANGING_PASSAGE}` } })
  const passage = bulletBlock({ text: 'John 3:16', uuid })

  await context.refreshFromStoredSource(passage)
  assert.equal(passage.attributes.has('data-hc-verse-lines'), true)
})

test('a passage that runs its verses together keeps its numbers where they are', async () => {
  const sources = {
    // Numbers inside a paragraph: pulling one into a gutter would land it on the
    // words before it.
    prose: PROSE_PASSAGE,
    // No verse numbers at all: there is nothing to hang.
    plain: PASSAGE_SOURCE,
    // One passage per line beside one in prose, in a single block: the block
    // carries one answer, so the prose settles it.
    both: `${HANGING_PASSAGE}\n${PROSE_PASSAGE}`,
    // A highlight of the reader's own is not a verse number.
    highlighted: HANGING_PASSAGE.replace('the world.', 'the ^^world^^.')
  }

  for (const [position, [name, content]] of Object.entries(sources).entries()) {
    const uuid = `65f00000-0000-0000-0000-00000000000${position}`
    const context = load({}, [], { [uuid]: { content } })
    const passage = bulletBlock({ text: 'John 3:16', uuid })
    // Set to begin with, so that a passage rewritten as prose is also seen to
    // give the gutter back rather than merely never asking for it.
    passage.setAttribute('data-hc-verse-lines', '')

    await context.refreshFromStoredSource(passage)
    assert.equal(passage.attributes.has('data-hc-verse-lines'), false, name)
  }
})

/* Leading emoji as a block icon.
 *
 * `index.js` reads the block's own source, so what is asserted here is which
 * blocks earn the mark and what the mark holds — one whole emoji as a reader
 * sees it, however many code points it is written with. theme.css draws the
 * gutter; nothing here moves a character of the block.
 */
const ICON_ATTR = 'data-hc-block-icon'

let iconUuids = 0
async function iconBlock(content, settings = {}, rendered = {}) {
  iconUuids += 1
  const uuid = `65f00000-0000-0000-0000-1${String(iconUuids).padStart(11, '0')}`
  const context = load(settings, [], { [uuid]: { content } })
  const block = bulletBlock({ text: content, uuid, ...rendered })

  await context.refreshFromStoredSource(block)
  return { context, block, icon: block.attributes.get(ICON_ATTR) }
}

test('the block-icon setting is offered as a toggle that is on to begin with', async () => {
  const context = await render({}, [])
  const setting = context.logseq.schema.find(({ key }) => key === 'blockIcons')

  assert.ok(setting, 'the theme offers no block-icon setting')
  assert.equal(setting.type, 'boolean')
  assert.equal(setting.default, true)
  assert.equal(setting.title, 'Leading emoji as a block icon')
})

test('a block opening with one emoji is marked with that emoji', async () => {
  const { icon } = await iconBlock('\u{1F4CC} Important note')

  assert.equal(icon, '\u{1F4CC}')
})

test('an emoji written from several code points is marked whole', async () => {
  // Each of these is one emoji to a reader and more than one code point to a
  // string: a variation selector, a skin-tone modifier, a flag, a keycap, a
  // zero-width-joined family, a joined flag, and a tag sequence.
  const sequences = [
    '\u2764\uFE0F',
    '\u{1F44D}\u{1F3FD}',
    '\u{1F1EC}\u{1F1E7}',
    '1\uFE0F\u20E3',
    '\u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}',
    '\u{1F3F3}\uFE0F\u200D\u{1F308}',
    '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}'
  ]

  for (const sequence of sequences) {
    const { icon } = await iconBlock(`${sequence} a note`)
    assert.equal(icon, sequence, JSON.stringify(sequence))
  }
})

test('the whitespace after a leading emoji is not part of the icon', async () => {
  const { icon } = await iconBlock('   \u{1F4CC}   Important note')

  assert.equal(icon, '\u{1F4CC}')
})

test('a property drawer above the emoji is stepped over', async () => {
  const { icon } = await iconBlock('tags:: study\ntype:: note\n\u{1F4CC} Important note')

  assert.equal(icon, '\u{1F4CC}')
})

test('an emoji anywhere but the front of the block is left in the line', async () => {
  for (const content of [
    'Important note \u{1F4CC}',
    'An \u{1F4CC} in the middle',
    'Plain prose with no emoji at all',
    // Symbols that render as text rather than as emoji are text.
    '\u00A9 2026 Someone',
    '\u2764 without a variation selector',
    ''
  ]) {
    const { block } = await iconBlock(content)
    assert.equal(block.attributes.has(ICON_ATTR), false, JSON.stringify(content))
  }
})

test('a leading emoji inside a special block leaves that block its own layout', async () => {
  // Every one of these opens with its own marker, so the emoji is inside the
  // structure rather than in front of the block.
  for (const content of [
    '## \u{1F4CC} A heading',
    '> \u{1F4CC} a quotation',
    '```\n\u{1F4CC} code\n```',
    '$$\u{1F4CC}$$',
    '#+BEGIN_QUOTE\n\u{1F4CC} quoted\n#+END_QUOTE',
    '#+BEGIN_PASSAGE\n**John 3:16**\n#+END_PASSAGE',
    '{{query (property :status "done")}}',
    '{{embed [[Page]]}}',
    '![\u{1F4CC}](../assets/pin.png)',
    '\u{1F4CC} a prompt #card'
  ]) {
    const { block } = await iconBlock(content)
    assert.equal(block.attributes.has(ICON_ATTR), false, JSON.stringify(content))
  }
})

test('a rendered structure keeps its own icon even where the source opens with an emoji', async () => {
  // The source alone cannot tell: a block written as `📌 {{embed …}}` opens
  // with the emoji, and what it holds is only visible in the render.
  for (const renderedSelector of ['.embed', '.custom-query', '.admonitionblock', '.passage', 'img', 'pre']) {
    const { block } = await iconBlock('\u{1F4CC} an embedded page', {}, { renderedSelector })
    assert.equal(block.attributes.has(ICON_ATTR), false, renderedSelector)
  }
})

test('turning the setting off puts the emoji back in the line', async () => {
  const { block } = await iconBlock('\u{1F4CC} Important note', { blockIcons: false })

  assert.equal(block.attributes.has(ICON_ATTR), false)
})

test('a mark already written is given back when the setting is turned off', async () => {
  const uuid = '65f00000-0000-0000-0000-1f0000000000'
  const context = load({ blockIcons: true }, [], { [uuid]: { content: '\u{1F4CC} Important note' } })
  const block = bulletBlock({ text: '\u{1F4CC} Important note', uuid })

  await context.refreshFromStoredSource(block)
  assert.equal(block.attributes.get(ICON_ATTR), '\u{1F4CC}')

  context.logseq.settings.blockIcons = false
  await context.refreshFromStoredSource(block)
  assert.equal(block.attributes.has(ICON_ATTR), false)
})

test('a repaint gives every mark back the moment the setting is turned off', async () => {
  // The synchronous pass answers too, so a block whose stored source cannot be
  // read back still loses its mark.
  const host = node('body')
  const block = node('div', { classes: ['ls-block'], attributes: { [ICON_ATTR]: '\u{1F4CC}' } })
  host.appendChild(block)

  const context = load({ blockIcons: false }, [], {}, host)
  await Promise.resolve()

  assert.equal(block.attributes.has(ICON_ATTR), false)
})

test('marking a block writes nothing to the graph and leaves its source alone', async () => {
  const content = '\u{1F4CC} Important note'
  const uuid = '65f00000-0000-0000-0000-1e0000000000'
  const stored = { [uuid]: { content } }
  const context = load({}, [], stored)
  const block = bulletBlock({ text: content, uuid })

  await context.refreshFromStoredSource(block)

  assert.equal(block.attributes.get(ICON_ATTR), '\u{1F4CC}')
  assert.deepEqual(context.blockWrites, [])
  assert.equal(stored[uuid].content, content)
})

test('unloading takes every block-icon mark back off the host document', async () => {
  const host = node('body')
  const block = node('div', { classes: ['ls-block'], attributes: { [ICON_ATTR]: '\u{1F4CC}' } })
  host.appendChild(block)

  const context = load({}, [], {}, host)
  await Promise.resolve()
  for (const handler of context.logseq.unloads) await handler()

  assert.equal(block.attributes.has(ICON_ATTR), false)
})

function menuLink(label) {
  const link = node('a', { classes: ['flex', 'justify-between', 'menu-link'] })
  const text = node('span', { classes: ['flex-1'] })
  text.textContent = label
  link.appendChild(text)
  return link
}

function menuLabel(item) {
  return item.querySelector('.flex-1')?.textContent ?? ''
}

function bulletMenuHost(uuid) {
  const host = node('body')
  const block = node('div', { classes: ['ls-block'], attributes: { blockid: uuid } })
  const main = node('div', { classes: ['block-main-container'] })
  const wrapper = node('div', { classes: ['block-content-wrapper'] })
  const control = node('div', { classes: ['block-control-wrap'] })
  const bullet = node('span', { classes: ['bullet-container'] })
  const menu = node('div', { classes: ['menu-links-wrapper'] })

  main.appendChild(wrapper)
  control.appendChild(bullet)
  main.appendChild(control)
  block.appendChild(main)
  host.appendChild(block)
  for (const label of ['Heading', 'Open in sidebar', 'Copy block ref']) menu.appendChild(menuLink(label))
  host.appendChild(menu)

  return { host, block, bullet, menu }
}

test('the native block menu puts one Open action immediately above Open in sidebar', async () => {
  const uuid = '65f00000-0000-0000-0000-000000000020'
  const fixture = bulletMenuHost(uuid)
  const context = load({}, [], {}, fixture.host)
  await Promise.resolve()

  assert.equal(context.blockMenuItems.length, 1)
  assert.equal(context.blockMenuItems[0].label, 'Open')
  assert.equal(context.logseq.observers[0].target, fixture.host)
  assert.equal(context.logseq.observers[0].options.childList, true)
  assert.equal(context.logseq.observers[0].options.subtree, true)
  fixture.menu.appendChild(menuLink(context.blockMenuItems[0].label))
  context.paint()
  context.paint()

  const labels = fixture.menu.children.filter((child) => child.matches('.menu-link')).map(menuLabel)
  assert.deepEqual(labels, ['Heading', 'Open', 'Open in sidebar', 'Copy block ref'])
  assert.equal(fixture.menu.querySelectorAll('[data-hc-open-block]').length, 1)

  context.blockMenuItems[0].action({ uuid })
  assert.equal(context.navigations.length, 1)
  assert.equal(context.navigations[0].route, 'page')
  assert.equal(context.navigations[0].parameters.name, uuid)
})

test('Open uses the UUID Logseq supplies for every block, including a nested block', async () => {
  const outerUuid = '65f00000-0000-0000-0000-000000000021'
  const innerUuid = '65f00000-0000-0000-0000-000000000022'
  const fixture = bulletMenuHost(outerUuid)
  const inner = node('div', { classes: ['ls-block'], attributes: { blockid: innerUuid } })
  const control = node('div', { classes: ['block-control-wrap'] })
  const bullet = node('span', { classes: ['bullet-container'] })
  control.appendChild(bullet)
  inner.appendChild(control)
  fixture.block.appendChild(inner)

  const context = load({}, [], {}, fixture.host)
  await Promise.resolve()
  fixture.menu.appendChild(menuLink('Open'))
  context.paint()
  context.blockMenuItems[0].action({ uuid: innerUuid })

  assert.equal(context.navigations.length, 1)
  assert.equal(context.navigations[0].route, 'page')
  assert.equal(context.navigations[0].parameters.name, innerUuid)
})

test('a non-block menu is left alone and unload clears the placement marker', async () => {
  const fixture = bulletMenuHost('65f00000-0000-0000-0000-000000000023')
  const context = load({}, [], {}, fixture.host)
  await Promise.resolve()

  fixture.menu.appendChild(menuLink('Unrelated action'))
  context.paint()
  assert.equal(fixture.menu.querySelector('[data-hc-open-block]'), null)

  fixture.menu.appendChild(menuLink('Open'))
  context.paint()
  assert.ok(fixture.menu.querySelector('[data-hc-open-block]'))

  const [unload] = context.logseq.unloads
  await unload()
  assert.equal(fixture.menu.querySelector('[data-hc-open-block]'), null)
})

/* One block bullet as Logseq renders it: an anchor inside the control column,
 * wrapping the halo the dot sits in. `haschild` is Logseq's own marker, and is
 * the one signal that survives collapsing, which removes the children from the
 * DOM. */
function bulletHost({ uuid, hasChild = true, whiteboard = false } = {}) {
  const host = node('body')
  const page = node('div', { classes: whiteboard ? ['whiteboard-page'] : ['page-blocks-inner'] })
  const block = node('div', {
    classes: ['ls-block'],
    attributes: { blockid: uuid, haschild: String(hasChild) }
  })
  const main = node('div', { classes: ['block-main-container'] })
  const control = node('div', { classes: ['block-control-wrap'] })
  const link = node('a', { classes: ['bullet-link-wrap'] })
  const bullet = node('span', { classes: ['bullet-container'] })
  const dot = node('span', { classes: ['bullet'] })

  bullet.appendChild(dot)
  link.appendChild(bullet)
  control.appendChild(link)
  main.appendChild(control)
  block.appendChild(main)
  page.appendChild(block)
  host.appendChild(page)

  return { host, block, bullet, dot }
}

function click(target, modifiers = {}) {
  const event = {
    target,
    button: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    prevented: false,
    stopped: false,
    preventDefault() {
      event.prevented = true
    },
    stopPropagation() {
      event.stopped = true
    },
    ...modifiers
  }

  return event
}

test('a plain left click on a bullet folds its block instead of opening it', async () => {
  const uuid = '65f00000-0000-0000-0000-000000000030'
  const fixture = bulletHost({ uuid })
  const context = load({}, [], {}, fixture.host)
  await Promise.resolve()

  const event = click(fixture.dot)
  context.dispatchDocument('click', event)

  assert.equal(context.collapses.length, 1)
  assert.equal(context.collapses[0].uuid, uuid)
  assert.equal(context.collapses[0].options.flag, 'toggle')
  assert.equal(context.navigations.length, 0)
  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
})

test('a click anywhere on the bullet, including its halo, folds the block', async () => {
  const uuid = '65f00000-0000-0000-0000-000000000031'
  const fixture = bulletHost({ uuid })
  const context = load({}, [], {}, fixture.host)
  await Promise.resolve()

  context.dispatchDocument('click', click(fixture.bullet))
  context.dispatchDocument('click', click(fixture.dot))

  assert.deepEqual(
    context.collapses.map((entry) => entry.uuid),
    [uuid, uuid]
  )
})

test('a nested block folds itself rather than the block holding it', async () => {
  const outerUuid = '65f00000-0000-0000-0000-000000000032'
  const innerUuid = '65f00000-0000-0000-0000-000000000033'
  const fixture = bulletHost({ uuid: outerUuid })
  const inner = bulletHost({ uuid: innerUuid })
  fixture.block.appendChild(inner.block)

  const context = load({}, [], {}, fixture.host)
  await Promise.resolve()

  context.dispatchDocument('click', click(inner.dot))

  assert.equal(context.collapses.length, 1)
  assert.equal(context.collapses[0].uuid, innerUuid)
})

test('a modified or secondary click is left to Logseq', async () => {
  const fixture = bulletHost({ uuid: '65f00000-0000-0000-0000-000000000034' })
  const context = load({}, [], {}, fixture.host)
  await Promise.resolve()

  for (const modifiers of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }, { button: 1 }]) {
    const event = click(fixture.dot, modifiers)
    context.dispatchDocument('click', event)
    assert.equal(event.prevented, false)
    assert.equal(event.stopped, false)
  }

  assert.deepEqual(context.collapses, [])
})

test('a click outside a bullet, and a whiteboard bullet, are left alone', async () => {
  const fixture = bulletHost({ uuid: '65f00000-0000-0000-0000-000000000035' })
  const board = bulletHost({ uuid: '65f00000-0000-0000-0000-000000000036', whiteboard: true })
  fixture.host.appendChild(board.host.children[0])

  const context = load({}, [], {}, fixture.host)
  await Promise.resolve()

  for (const target of [fixture.block, board.dot]) {
    const event = click(target)
    context.dispatchDocument('click', event)
    assert.equal(event.prevented, false)
  }

  assert.deepEqual(context.collapses, [])
})

test('a block with no children swallows the click without folding or opening', async () => {
  const fixture = bulletHost({ uuid: '65f00000-0000-0000-0000-000000000037', hasChild: false })
  const context = load({}, [], {}, fixture.host)
  await Promise.resolve()

  const event = click(fixture.dot)
  context.dispatchDocument('click', event)

  assert.deepEqual(context.collapses, [])
  assert.equal(context.navigations.length, 0)
  assert.equal(event.prevented, true)
})

test('unloading returns the bullet to Logseq', async () => {
  const fixture = bulletHost({ uuid: '65f00000-0000-0000-0000-000000000038' })
  const context = load({}, [], {}, fixture.host)
  await Promise.resolve()

  const [unload] = context.logseq.unloads
  await unload()

  assert.deepEqual(context.documentListeners.get('click'), [])

  const event = click(fixture.dot)
  context.dispatchDocument('click', event)
  assert.deepEqual(context.collapses, [])
  assert.equal(event.prevented, false)
})

test('unloading clears every attribute the theme wrote and stops observing', async () => {
  const host = node('body')
  const context = load({}, [], {}, host)
  await Promise.resolve()

  const painted = node('div', {
    classes: ['ls-block'],
    attributes: {
      'data-hc-hide-bullet': '',
      'data-hc-block-type': 'foo',
      'data-hc-verse-lines': ''
    }
  })
  const table = node('div', { classes: ['block-properties'], attributes: { 'data-hc-hidden': '' } })
  host.appendChild(painted)
  host.appendChild(table)

  const [unload] = context.logseq.unloads
  await unload()

  assert.equal(painted.attributes.has('data-hc-hide-bullet'), false)
  assert.equal(painted.attributes.has('data-hc-block-type'), false)
  assert.equal(painted.attributes.has('data-hc-verse-lines'), false)
  assert.equal(table.attributes.has('data-hc-hidden'), false)
  assert.equal(context.logseq.observers[0].connected, false)
})

/* The theme owns `data-hc-*` and nothing else. Passage writes its own
 * `data-passage-*` nodes into the same host document, and a teardown that
 * reached for those would clear a sibling plugin's UI out from under it. */
test('the theme neither writes nor clears a node another plugin owns', async () => {
  const host = node('body')
  const context = load({}, [], {}, host)
  await Promise.resolve()

  const foreign = node('div', { attributes: { 'data-passage-command': 'passage' } })
  host.appendChild(foreign)

  const [unload] = context.logseq.unloads
  await unload()

  assert.equal(host.querySelectorAll('[data-passage-command]').length, 1)
  assert.deepEqual(
    context.logseq.provided.map(({ key }) => key),
    ['hc-hidden-properties'],
    'the theme provides one style key, and it is namespaced to the theme'
  )
})
