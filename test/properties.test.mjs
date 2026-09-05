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
/* `index.html` loads the reference parser ahead of the entry script, and they
 * share one global scope; the context below is built the same way. */
const parser = new vm.Script(await readFile(resolve(root, 'bible.js'), 'utf8'))
const source = new vm.Script(await readFile(resolve(root, 'index.js'), 'utf8'))
const BIBLE_MANIFEST = JSON.parse(
  await readFile(resolve(root, 'resources', 'bible.books.json'), 'utf8')
)

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

/* A stand-in for the parts of the host document the command path touches: the
 * `<` command popup, the editing textarea, and the reference dialog. Only the
 * selector forms `index.js` actually uses are supported — a compound of tag,
 * id, class and attribute-presence tokens, optionally in a comma list. */
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

const PASSAGE_UUID = '65f00000-0000-0000-0000-00000000000a'
const PASSAGE_SOURCE = '#+BEGIN_PASSAGE\n**John 3:16**\n\n#+END_PASSAGE'
/* What the commands actually write: the block's property drawer, then the
 * markup. The drawer belongs at the top of the block, not beside the marker. */
const PASSAGE_PROPERTIES = 'tags:: \ntype:: Passage'
const PASSAGE_BLOCK = `${PASSAGE_PROPERTIES}\n${PASSAGE_SOURCE}`
/* The blank line under the bold reference: the writing line. */
const WRITING_LINE = PASSAGE_BLOCK.indexOf('\n\n') + 1

function editingArea({ value = '', cursor = value.length, uuid = PASSAGE_UUID } = {}) {
  return node('textarea', {
    id: `edit-block-1-${uuid}`,
    classes: ['block-editor'],
    value,
    selectionStart: cursor
  })
}

function commandPopup(labels = ['Query']) {
  const menu = node('div', { id: 'ui__ac' })
  for (const label of labels) {
    const item = node('a', { classes: ['menu-link'] })
    item.textContent = label
    menu.appendChild(item)
  }
  return menu
}

/* `insertPassage` awaits the invocation capture before the dialog is built, so
 * the dialog exists only after the microtask queue has drained. */
const flush = () => new Promise((resolve) => setImmediate(resolve))

const dialogOf = (context) => context.parent.document.querySelector('[data-hc-passage-dialog]')

function control(dialog, tag, label) {
  return dialog.querySelectorAll(tag).find((candidate) => candidate.textContent === label)
}

function fill(dialog, reference) {
  const input = dialog.querySelector('input')
  input.value = reference
  input.dispatch('input')
  return input
}

/* The Bible files as the loader finds them, by either of the two routes that
 * can answer: `fetch`, which is what a sandbox served over http has, and the
 * host's own `readFile` action, which is what the desktop app has because
 * `fetch` cannot read `file://`. A test that names no files leaves every route
 * failing, which is the Marketplace install with no Bible data present. */
const PLUGIN_ROOT = 'file:///plugins/logseq-dark-high-contrast-theme'

function bibleRoutes({ files, via = 'fetch' }) {
  if (via === 'fetch') {
    return {
      fetch: async (path) => ({
        ok: path in files,
        async text() {
          return JSON.stringify(files[path])
        }
      })
    }
  }

  const read = (path) => {
    const name = path.replace(`${PLUGIN_ROOT.replace('file://', '')}/`, '')
    if (!(name in files)) throw new Error(`no such file: ${path}`)
    return JSON.stringify(files[name])
  }

  return {
    lsr: PLUGIN_ROOT,
    apis: {
      async doAction([action, path]) {
        assert.equal(action, 'readFile')
        return read(path)
      }
    }
  }
}

function load(settings, blocks = [], storedBlocks = {}, host = node('body'), bible = null) {
  const routes = bible ? bibleRoutes(bible) : {}
  const provided = []
  const observers = []
  const commands = []
  const updates = []
  const edits = []
  const unloads = []
  let blockReads = 0
  const messages = []
  const context = {
    console,
    setImmediate,
    messages,
    ...(routes.fetch ? { fetch: routes.fetch } : {}),
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
      ...(routes.apis ? { apis: routes.apis } : {}),
      requestAnimationFrame(callback) {
        callback()
      },
      document: {
        body: host,
        getElementById: () => element(),
        createElement: (tag) => node(tag),
        /* The two block collections keep their purpose-built stubs; everything
         * else — the popup, the editor, the dialog — is served by the host
         * stand-in. */
        querySelector: (selector) => host.querySelector(selector),
        querySelectorAll: (selector) =>
          selector === '.block-properties' ? blocks.map(({ table }) => table)
            : selector === '.ls-block' ? []
              : host.querySelectorAll(selector)
      }
    },
    logseq: {
      settings,
      ...(routes.lsr ? { baseInfo: { lsr: routes.lsr } } : {}),
      provided,
      observers,
      unloads,
      Editor: {
        commands,
        updates,
        edits,
        async getBlock(uuid) {
          blockReads += 1
          return storedBlocks[uuid] ?? null
        },
        async getCurrentBlock() {
          return storedBlocks[PASSAGE_UUID] ?? null
        },
        registerSlashCommand(name, action) {
          commands.push({ name, action })
        },
        async updateBlock(uuid, content) {
          updates.push({ uuid, content })
        },
        async editBlock(uuid, options) {
          edits.push({ uuid, ...options })
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
      UI: {
        showMsg(text, status) {
          messages.push({ text, status })
        }
      },
      App: { onRouteChanged() {} },
      ready(main) {
        return Promise.resolve(main())
      }
    }
  }

  vm.createContext(context)
  parser.runInContext(context)
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

test('the entry provides the one style rule that does the hiding', async () => {
  const context = await render({}, [])

  // Structural, not deep-equal: the object crosses out of the vm realm, so it
  // has that realm's Object prototype.
  const hiding = context.logseq.provided.find(({ key }) => key === 'hc-hidden-properties')
  assert.equal(hiding.style, '.block-properties[data-hc-hidden] { display: none; }')

  // The reference dialog is chrome the plugin owns, so it is styled here rather
  // than in theme.css, which only applies while this theme is the selected one.
  const dialog = context.logseq.provided.find(({ key }) => key === 'hc-passage-dialog')
  assert.match(dialog.style, /\[data-hc-passage-dialog\]/)
  assert.equal(context.logseq.provided.length, 2)
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
  await context.refreshBulletFromStoredSource(centered)
  assert.equal(centered.attributes.has('data-hc-hide-bullet'), true)
})

test('stored ordinary prose does not become bulletless', async () => {
  const uuid = '65f00000-0000-0000-0000-000000000001'
  const context = load({}, [], { [uuid]: { content: 'ordinary prose' } })
  const prose = bulletBlock({ text: 'ordinary prose', uuid })

  await context.refreshBulletFromStoredSource(prose)
  assert.equal(prose.attributes.has('data-hc-hide-bullet'), false)
})

test('stored source reads are cached per block UUID', async () => {
  const uuid = '65f00000-0000-0000-0000-000000000002'
  const context = load({}, [], { [uuid]: { content: 'ordinary prose' } })
  const prose = bulletBlock({ text: 'ordinary prose', uuid })

  await context.refreshBulletFromStoredSource(prose)
  await context.refreshBulletFromStoredSource(prose)
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
  await context.refreshBulletFromStoredSource(passage)
  assert.equal(passage.attributes.has('data-hc-hide-bullet'), true)
})

/* Drives one insertion from invocation to the reference being submitted. */
async function invoke(context, run, reference = 'John 3:16') {
  const invocation = run()
  await flush()

  const dialog = dialogOf(context)
  fill(dialog, reference)
  dialog.querySelector('form').dispatch('submit')
  await invocation
  await flush()

  return dialog
}

function commandContext({ value = '', cursor, menu = null, bible = null } = {}) {
  const host = node('body')
  if (menu) host.appendChild(menu)
  host.appendChild(editingArea({ value, cursor }))
  return { host, context: load({}, [], {}, host, bible) }
}

test('the slash command writes the passage source and leaves the cursor on the writing line', async () => {
  const { context } = commandContext()
  await Promise.resolve()

  const [command] = context.logseq.Editor.commands
  assert.equal(command.name, 'Passage')

  await invoke(context, () => command.action())

  assert.deepEqual(context.logseq.Editor.updates, [{ uuid: PASSAGE_UUID, content: PASSAGE_BLOCK }])
  assert.deepEqual(context.logseq.Editor.edits, [{ uuid: PASSAGE_UUID, pos: WRITING_LINE }])
  // The cursor sits at the start of the blank line, with the terminator below.
  assert.equal(PASSAGE_BLOCK.slice(WRITING_LINE), '\n#+END_PASSAGE')
})

test('the passage properties join the drawer the block already has', async () => {
  // A block holds one property drawer, so a key the user already wrote is left
  // exactly as it stands and only the missing one is added beneath it.
  const value = 'type:: Note\n'
  const { context } = commandContext({ value })
  await Promise.resolve()

  await invoke(context, () => context.logseq.Editor.commands[0].action())

  assert.equal(
    context.logseq.Editor.updates[0].content,
    `type:: Note\ntags:: \n${PASSAGE_SOURCE}`
  )
  // The cursor still lands on the writing line, one 'tags:: ' line further down.
  const [edit] = context.logseq.Editor.edits
  assert.equal(
    context.logseq.Editor.updates[0].content.slice(edit.pos),
    '\n#+END_PASSAGE'
  )
})

test('only the invocation text is removed, and the text around it is kept', async () => {
  const { context } = commandContext({ value: 'see /pass then', cursor: 9 })
  await Promise.resolve()

  await invoke(context, () => context.logseq.Editor.commands[0].action())

  assert.equal(
    context.logseq.Editor.updates[0].content,
    `${PASSAGE_PROPERTIES}\nsee \n${PASSAGE_SOURCE}\n then`
  )
})

test('a slash that belongs to the prose is never eaten', async () => {
  // Logseq's own `editor/clear-current-slash` has already removed the
  // invocation by the time the hook runs, so a bare trailing slash is text.
  const { context } = commandContext({ value: 'and/or ' })
  await Promise.resolve()

  await invoke(context, () => context.logseq.Editor.commands[0].action())

  assert.equal(
    context.logseq.Editor.updates[0].content,
    `${PASSAGE_PROPERTIES}\nand/or \n${PASSAGE_SOURCE}`
  )
})

test('the reference dialog autofocuses, and stays open until it has a reference', async () => {
  const { context } = commandContext()
  await Promise.resolve()

  const invocation = context.logseq.Editor.commands[0].action()
  await flush()

  const dialog = dialogOf(context)
  const input = dialog.querySelector('input')
  assert.equal(input.focused, true)

  const insert = control(dialog, 'button', 'Insert')
  assert.equal(insert.disabled, true, 'an empty reference is not submittable')

  fill(dialog, '   ')
  assert.equal(insert.disabled, true, 'whitespace is not a reference')
  dialog.querySelector('form').dispatch('submit')
  await flush()
  assert.ok(dialogOf(context), 'the dialog closed on a blank reference')
  assert.deepEqual(context.logseq.Editor.updates, [])

  fill(dialog, 'John 3:16')
  assert.equal(insert.disabled, false)
  // Enter submits.
  dialog.dispatch('keydown', { key: 'Enter' })
  await invocation

  assert.equal(context.logseq.Editor.updates[0].content, PASSAGE_BLOCK)
  assert.equal(dialogOf(context), null, 'the dialog outlived the insertion')
})

test('Escape and Cancel dismiss the dialog without touching the block', async () => {
  for (const dismiss of [
    (dialog) => dialog.dispatch('keydown', { key: 'Escape' }),
    (dialog) => control(dialog, 'button', 'Cancel').dispatch('click')
  ]) {
    const { context } = commandContext({ value: 'untouched' })
    await Promise.resolve()

    const invocation = context.logseq.Editor.commands[0].action()
    await flush()

    const dialog = dialogOf(context)
    fill(dialog, 'John 3:16')
    dismiss(dialog)
    await invocation

    assert.deepEqual(context.logseq.Editor.updates, [])
    assert.deepEqual(context.logseq.Editor.edits, [])
    assert.equal(dialogOf(context), null)
  }
})

test('the angle-bracket picker gains exactly one Passage entry, however often it repaints', async () => {
  const menu = commandPopup(['Query', 'Embed'])
  const { context } = commandContext({ value: 'note <pas', menu })
  await Promise.resolve()

  const entries = () => menu.querySelectorAll('[data-hc-command]')
  assert.equal(entries().length, 1)
  assert.equal(entries()[0].textContent, 'Passage')
  // Cloned from the host's own entry, so it inherits the popup's markup.
  assert.equal(entries()[0].classList.has('menu-link'), true)

  // Repainting is what the childList observer does after the injection, so the
  // bridge has to recognize its own node and settle.
  context.paint()
  context.paint()
  assert.equal(entries().length, 1)

  // Unrelated entries are left exactly as the host wrote them.
  assert.deepEqual(menu.children.slice(0, 2).map(({ textContent }) => textContent), ['Query', 'Embed'])
})

test('the Passage entry is withdrawn once the trigger no longer matches', async () => {
  const menu = commandPopup()
  const { context, host } = commandContext({ value: 'note <pas', menu })
  await Promise.resolve()

  assert.equal(menu.querySelectorAll('[data-hc-command]').length, 1)

  // A filter Passage cannot match, then no editor at all: a route change.
  const editor = host.querySelector('textarea')
  editor.value = 'note <query'
  editor.selectionStart = editor.value.length
  context.paint()
  assert.equal(menu.querySelectorAll('[data-hc-command]').length, 0)

  editor.remove()
  context.paint()
  assert.equal(host.querySelectorAll('[data-hc-command]').length, 0)
})

test('the picker entry routes through the same insertion path as the slash command', async () => {
  const menu = commandPopup()
  const { context } = commandContext({ value: 'note <pas', menu })
  await Promise.resolve()

  const [entry] = menu.querySelectorAll('[data-hc-command]')
  await invoke(context, () => entry.dispatch('mousedown'))

  // The `<` picker clears nothing itself, so the bridge removes the trigger.
  assert.equal(
    context.logseq.Editor.updates[0].content,
    `${PASSAGE_PROPERTIES}\nnote \n${PASSAGE_SOURCE}`
  )
  assert.deepEqual(context.logseq.Editor.edits, [{ uuid: PASSAGE_UUID, pos: 5 + 1 + WRITING_LINE }])
})

test('a popup that is not the angle-bracket picker is left alone', async () => {
  const menu = commandPopup()
  // The `/` menu renders in the same popup, and has its own plugin API.
  const { context } = commandContext({ value: 'note /pas', menu })
  await Promise.resolve()

  assert.equal(menu.querySelectorAll('[data-hc-command]').length, 0)
  assert.equal(context.logseq.Editor.commands.length, 1)
})

test('unloading leaves no injected node or written attribute behind', async () => {
  const menu = commandPopup()
  const { context, host } = commandContext({ value: 'note <pas', menu })
  await Promise.resolve()

  const painted = node('div', {
    classes: ['ls-block'],
    attributes: { 'data-hc-hide-bullet': '', 'data-hc-block-type': 'foo' }
  })
  const table = node('div', { classes: ['block-properties'], attributes: { 'data-hc-hidden': '' } })
  host.appendChild(painted)
  host.appendChild(table)

  const invocation = context.logseq.Editor.commands[0].action()
  await flush()
  assert.ok(dialogOf(context))

  const [unload] = context.logseq.unloads
  await unload()

  assert.equal(host.querySelectorAll('[data-hc-command]').length, 0)
  assert.equal(dialogOf(context), null)
  assert.equal(painted.attributes.has('data-hc-hide-bullet'), false)
  assert.equal(painted.attributes.has('data-hc-block-type'), false)
  assert.equal(table.attributes.has('data-hc-hidden'), false)
  assert.equal(context.logseq.observers[0].connected, false)

  // The prompt that was open when the plugin unloaded settles as a
  // cancellation rather than hanging, and writes nothing.
  await invocation
  assert.deepEqual(context.logseq.Editor.updates, [])
})

/* The Bible files the loader reads, keyed by the paths `index.js` asks for. */
const MANIFEST_FILE = 'resources/bible.books.json'
const TEXT_FILE = 'resources/bible.text.json'
const TEXT_SETTING = 'biblePassageText'

const TEXT_INDEX = {
  books: {
    John: {
      3: {
        verses: ['For God so loved the world.', 'Indeed, God did not send the Son.'],
        numbers: [16, 17],
        paragraphs: [16]
      }
    }
  }
}

/* The dialog is only reached once the manifest has been read, and the read is a
 * promise chain, so the whole queue is drained before the invocation starts. */
async function bibleContext(options) {
  const { context, host } = commandContext(options)
  await flush()
  return { context, host }
}

test('a resolved reference is written canonically, with its chapter tags and text', async () => {
  const { context } = await bibleContext({
    bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST, [TEXT_FILE]: TEXT_INDEX } }
  })

  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'jn 3:16-17')

  const [{ content }] = context.logseq.Editor.updates
  assert.equal(
    content,
    'tags:: John/3\ntype:: Passage\n' +
      '#+BEGIN_PASSAGE\n**John 3:16–17**\n\n' +
      'For God so loved the world. Indeed, God did not send the Son.\n' +
      '#+END_PASSAGE'
  )
  // The cursor lands at the end of the text that was written, ready to continue.
  const [edit] = context.logseq.Editor.edits
  assert.equal(content.slice(edit.pos), '\n#+END_PASSAGE')
  assert.deepEqual(context.messages, [])
})

test('a passage spanning books is tagged with every chapter it covers', async () => {
  const { context } = await bibleContext({ bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST } } })

  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'Gen 50 - Ex 2')

  assert.equal(
    context.logseq.Editor.updates[0].content,
    'tags:: Gen/50, Ex/1, Ex/2\ntype:: Passage\n' +
      '#+BEGIN_PASSAGE\n**Gen 50–Ex 2**\n\n#+END_PASSAGE'
  )
})

test('a reference that does not resolve keeps the dialog open with the reason', async () => {
  const { context } = await bibleContext({ bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST } } })

  const invocation = context.logseq.Editor.commands[0].action()
  await flush()
  const dialog = dialogOf(context)
  const reason = () => dialog.querySelector('p').textContent

  for (const [reference, expected] of [
    ['Ex 2-Gen 50', /backwards/],
    ['Gen 51', /50 chapters/],
    ['John 3:37', /no verse 37/],
    ['Habbakuk 1', /No book named/],
    ['nonsense', /not a passage reference/]
  ]) {
    fill(dialog, reference)
    dialog.querySelector('form').dispatch('submit')
    await flush()

    assert.ok(dialogOf(context), `the dialog closed on ${reference}`)
    assert.match(reason(), expected)
    assert.deepEqual(context.logseq.Editor.updates, [], reference)
  }

  // Typing again clears the message, and a reference that resolves is written.
  fill(dialog, 'John 3:16')
  assert.equal(reason(), '')
  dialog.querySelector('form').dispatch('submit')
  await invocation
  await flush()

  assert.equal(context.logseq.Editor.updates.length, 1)
  assert.match(context.logseq.Editor.updates[0].content, /\*\*John 3:16\*\*/)
  assert.equal(dialogOf(context), null)
})

test('without the text index the reference and tags are still written, with a notice', async () => {
  const { context } = await bibleContext({ bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST } } })

  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'Psalms 23')

  assert.equal(
    context.logseq.Editor.updates[0].content,
    `tags:: Ps/23\ntype:: Passage\n#+BEGIN_PASSAGE\n**Ps 23**\n\n#+END_PASSAGE`
  )
  assert.equal(context.messages.length, 1)
  assert.match(context.messages[0].text, /build-bible-index/)

  // The notice is a standing condition, not something to repeat per passage.
  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'Ps 24')
  assert.equal(context.messages.length, 1)
})

test('with no Bible data at all the reference is written exactly as it was typed', async () => {
  // A Marketplace install carries the manifest, but a graph that cannot read it
  // still has a working command: the theme never depends on the Bible files.
  const { context } = await bibleContext({})

  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'my own note')

  assert.equal(
    context.logseq.Editor.updates[0].content,
    `${PASSAGE_PROPERTIES}\n#+BEGIN_PASSAGE\n**my own note**\n\n#+END_PASSAGE`
  )
  assert.deepEqual(context.messages, [])
})

test('the desktop route reads the Bible files through the host, not through fetch', async () => {
  // `fetch` cannot read `file://`, and the sandbox runs from `file://` on the
  // desktop, so the files are read with the host's own action against a path
  // built from the plugin root. No `fetch` exists in this context at all.
  const { context } = await bibleContext({
    bible: {
      via: 'file',
      files: { [MANIFEST_FILE]: BIBLE_MANIFEST, [TEXT_FILE]: TEXT_INDEX }
    }
  })

  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'John 3:16')

  assert.equal(
    context.logseq.Editor.updates[0].content,
    'tags:: John/3\ntype:: Passage\n' +
      '#+BEGIN_PASSAGE\n**John 3:16**\n\nFor God so loved the world.\n#+END_PASSAGE'
  )
})

test('a configured text index is read from its own path, not from the theme folder', async () => {
  const host = node('body')
  host.appendChild(editingArea())
  const context = load(
    { [TEXT_SETTING]: '/graph/bible.text.json' },
    [],
    {},
    host,
    { via: 'file', files: { [MANIFEST_FILE]: BIBLE_MANIFEST } }
  )
  // The host answers for the configured path alone: an absolute path is never
  // joined to the plugin root.
  context.parent.apis.doAction = async ([, path]) => {
    if (path === '/graph/bible.text.json') return JSON.stringify(TEXT_INDEX)
    if (path.endsWith(MANIFEST_FILE)) return JSON.stringify(BIBLE_MANIFEST)
    throw new Error(`no such file: ${path}`)
  }
  await flush()

  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'John 3:17')

  assert.match(context.logseq.Editor.updates[0].content, /Indeed, God did not send the Son\./)
  assert.deepEqual(context.messages, [])
})
