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

function node(tag, { id = '', classes = [], attributes = {}, ...rest } = {}) {
  const self = {
    tagName: tag.toUpperCase(),
    id,
    classList: new Set(classes),
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
    appendChild(child) {
      child.parentElement = self
      self.children.push(child)
      return child
    },
    remove() {
      const siblings = self.parentElement?.children
      if (siblings) siblings.splice(siblings.indexOf(self), 1)
      self.parentElement = null
    },
    cloneNode() {
      return node(tag, {
        id: self.id,
        classes: [...self.classList],
        attributes: Object.fromEntries(self.attributes)
      })
    },
    focus() {
      self.focused = true
    },
    matches: (selector) => matchesSelector(self, selector),
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
  let blockReads = 0
  const context = {
    console,
    setImmediate,
    MutationObserver: class {
      constructor() {
        this.connected = false
        observers.push(this)
      }

      observe() {
        this.connected = true
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
        /* The two block collections keep their purpose-built stubs; anything
         * else is served by the host stand-in. */
        querySelector: (selector) => host.querySelector(selector),
        querySelectorAll: (selector) =>
          selector === '.block-properties' ? blocks.map(({ table }) => table)
            : selector === '.ls-block' ? []
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
        }
      },
      beforeunload(handler) {
        unloads.push(handler)
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
      App: { onRouteChanged() {} },
      ready(main) {
        return Promise.resolve(main())
      }
    }
  }

  vm.createContext(context)
  source.runInContext(context)
  context.blockReads = () => blockReads

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
