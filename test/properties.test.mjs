/* Behavioral tests for the property-hiding entry script.
 *
 * `index.js` is a classic script, not a module, so it exports nothing. Running
 * it in a `vm` context against a stub host puts its top-level function
 * declarations on that context's global object, which is enough to drive
 * `paint()` over a fake block tree and read the attributes it writes.
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

function load(settings, blocks = []) {
  const provided = []
  const context = {
    console,
    MutationObserver: class {
      observe() {}
    },
    parent: {
      requestAnimationFrame(callback) {
        callback()
      },
      document: {
        body: element(),
        getElementById: () => element(),
        querySelectorAll: (selector) =>
          selector === '.block-properties' ? blocks.map(({ table }) => table) : []
      }
    },
    logseq: {
      settings,
      provided,
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
  const blocks = [block({ type: 'foo' }), block({ type: 'bar' })]
  const context = await render({}, blocks)

  assert.equal(context.logseq.settings.hiddenProperties, 'type: foo')
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
  assert.equal(disabled.logseq.settings.hiddenProperties, 'type: foo')
})

test('an already-configured graph is not overwritten by migration', async () => {
  const context = await render(
    { hiddenProperties: 'status: done', hiddenPropertyKey: 'type', hiddenPropertyValues: 'foo' },
    []
  )

  assert.equal(context.logseq.settings.hiddenProperties, 'status: done')
})

test('the entry provides the one style rule that does the hiding', async () => {
  const context = await render({}, [])

  // Structural, not deep-equal: the object crosses out of the vm realm, so it
  // has that realm's Object prototype.
  assert.equal(context.logseq.provided.length, 1)
  assert.equal(context.logseq.provided[0].key, 'hc-hidden-properties')
  assert.equal(
    context.logseq.provided[0].style,
    '.block-properties[data-hc-hidden] { display: none; }'
  )
})

function bulletBlock({ raw = '', text = '', special = false } = {}) {
  const wrapper = {
    textContent: text,
    querySelector(selector) {
      if (selector === 'textarea.block-editor, textarea') return raw ? { value: raw } : null
      return special ? {} : null
    },
    cloneNode() {
      return {
        textContent: text,
        querySelectorAll: () => []
      }
    }
  }

  return {
    querySelector: () => wrapper
  }
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
    'prompt #card'
  ]

  for (const raw of special) {
    assert.equal(context.shouldHideBullet(bulletBlock({ raw })), true, raw)
  }
  assert.equal(context.shouldHideBullet(bulletBlock({ raw: 'ordinary prose' })), false)
})
