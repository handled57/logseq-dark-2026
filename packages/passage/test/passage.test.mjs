/* Behavioral tests for the Passage entry script.
 *
 * `index.js` is a classic script, not a module, so it exports nothing. Running
 * it in a `vm` context against a stub host puts its top-level function
 * declarations on that context's global object, which is enough to drive one
 * insertion from the invocation to the block that comes out of it. `bible.js`
 * runs into the same context first, exactly as `index.html` loads it.
 *
 * Nothing here loads a theme: what the command writes is ordinary Logseq
 * markup, and the shape of it is the Passage v1 contract in
 * `docs/contracts/passage-v1.md`.
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

function matchesSelector(target, selector) {
  return selector.split(',').some((part) => {
    const tokens = part.trim().match(/^[a-z]+|[.#][\w-]+|\[[^\]]+\]/gi) ?? []
    if (!tokens.length) return false

    return tokens.every((token) => {
      if (token.startsWith('.')) return target.classList.has(token.slice(1))
      if (token.startsWith('#')) return target.id === token.slice(1)
      if (token.startsWith('[')) {
        const [, name, value] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(token) ?? []
        if (!name) return false
        return value === undefined ? target.attributes.has(name) : target.attributes.get(name) === value
      }
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
    removeEventListener(type, handler) {
      self.listeners.set(type, (self.listeners.get(type) ?? []).filter((entry) => entry !== handler))
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
    setSelectionRange(start, end) {
      self.selectionStart = start
      self.selectionEnd = end
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

const dialogOf = (context) => context.parent.document.querySelector('[data-passage-dialog]')

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
const PLUGIN_ROOT = 'file:///plugins/logseq-passage'

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

function load(settings, storedBlocks = {}, host = node('body'), bible = null) {
  const routes = bible ? bibleRoutes(bible) : {}
  /* A command is invoked from a block being edited, so the session is open
   * until something closes it. */
  let editing = true
  const storage = new Map()
  const windowListeners = []
  const listeners = []
  const provided = []
  const observers = []
  const commands = []
  const paletteCommands = []
  const updates = []
  const edits = []
  const exits = []
  const unloads = []
  const messages = []
  const writes = []
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
      addEventListener(type, handler, capture) {
        if (capture) windowListeners.push({ type, handler })
      },
      removeEventListener(type, handler) {
        const index = windowListeners.findIndex(
          (entry) => entry.type === type && entry.handler === handler
        )
        if (index !== -1) windowListeners.splice(index, 1)
      },
      requestAnimationFrame(callback) {
        callback()
      },
      document: {
        body: host,
        listeners,
        getElementById: () => null,
        createElement: (tag) => node(tag),
        /* The host's own shortcuts are bound here, which is why the dialog
         * claims its keys here too; only the capturing phase is recorded,
         * because that is the only phase it uses. */
        addEventListener(type, handler, capture) {
          if (capture) listeners.push({ type, handler })
        },
        removeEventListener(type, handler) {
          const index = listeners.findIndex(
            (entry) => entry.type === type && entry.handler === handler
          )
          if (index !== -1) listeners.splice(index, 1)
        },
        /* Everything the command path reaches — the popup, the editor, the
         * dialog — is served by the host stand-in. */
        querySelector: (selector) => host.querySelector(selector),
        querySelectorAll: (selector) => host.querySelectorAll(selector)
      }
    },
    logseq: {
      settings,
      storage,
      /* The plugin's own storage: `makeSandboxStorage` writes into the
       * package's assets folder, and reads come back out of the same map. */
      Assets: {
        makeSandboxStorage: () => ({
          async setItem(key, value) {
            storage.set(key, value)
          },
          async getItem(key) {
            return storage.get(key) ?? ''
          }
        })
      },
      ...(routes.lsr ? { baseInfo: { lsr: routes.lsr } } : {}),
      provided,
      observers,
      unloads,
      App: {
        paletteCommands,
        registerCommandPalette(command, action) {
          paletteCommands.push({ command, action })
        }
      },
      Editor: {
        commands,
        updates,
        edits,
        exits,
        async getCurrentBlock() {
          return storedBlocks[PASSAGE_UUID] ?? null
        },
        registerSlashCommand(name, action) {
          commands.push({ name, action })
        },
        async updateBlock(uuid, content) {
          updates.push({ uuid, content })
          /* Logseq's real API routes an update of the currently edited block
           * into the live editor state instead of saving it straight to the
           * database. The textarea consequently carries that value into the
           * host's eventual session-ending save. */
          const editor = host.querySelector('textarea')
          if (editing && editor?.id.includes(uuid)) editor.value = content
          else writes.push({ source: 'passage', content })
        },
        async editBlock(uuid, options) {
          edits.push({ uuid, ...options })
          const current = host.querySelector('textarea')
          if (editing && current?.id.includes(uuid)) {
            current.selectionStart = options?.pos ?? current.value.length
            return
          }
          const content = updates.findLast((update) => update.uuid === uuid)?.content ?? ''
          host.appendChild(editingArea({ value: content, cursor: options?.pos ?? content.length, uuid }))
          editing = true
        },
        /* Ending the edit session is a write of its own: the host saves the
         * editing textarea back to the block on the way out. What matters is
         * where in the order of writes it falls. */
        async exitEditingMode() {
          exits.push({ after: updates.length })
          editing = false
          const stale = host.querySelector('textarea')?.value ?? ''
          writes.push({ source: 'host', content: stale })
          host.querySelector('textarea')?.remove()
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
      settingsListeners: [],
      onSettingsChanged(handler) {
        this.settingsListeners.push(handler)
      },
      UI: {
        showMsg(text, status) {
          messages.push({ text, status })
        }
      },
      ready(main) {
        return Promise.resolve(main())
      }
    }
  }

  /* A key as the browser delivers it: window capture first, then document
   * capture. Logseq's shortcut is already on the document before Passage opens
   * its prompt, so only the window can stop the key ahead of the host. */
  context.press = (key) => {
    let stopped = false
    const event = {
      key,
      preventDefault() {},
      stopPropagation() {
        stopped = true
      },
      stopImmediatePropagation() {
        stopped = true
      }
    }

    for (const { type, handler } of [...windowListeners]) {
      if (type === 'keydown') handler(event)
      if (stopped) break
    }
    if (!stopped) {
      for (const { type, handler } of [...listeners]) if (type === 'keydown') handler(event)
    }
    return stopped
  }

  /* The host moving the focus, as the document sees it: `focusin` bubbles, so
   * a capturing listener on the document is told wherever it lands. */
  context.focusOn = (target) => {
    for (const { type, handler } of [...listeners]) if (type === 'focusin') handler({ target })
  }

  context.bound = (type) =>
    [...windowListeners, ...listeners].filter((entry) => entry.type === type).length

  /* The host's edit session ending on its own schedule, which is whenever the
   * user leaves the block. It writes the textarea it was editing back to the
   * block, so a session still open at this point overwrites whatever the
   * plugin wrote. Returns what would be saved, or null if the session is
   * already closed and nothing is written. */
  context.endEditSession = () => {
    if (!editing) return null
    editing = false
    const content = host.querySelector('textarea')?.value ?? ''
    writes.push({ source: 'host', content })
    host.querySelector('textarea')?.remove()
    return content
  }
  context.writes = writes

  vm.createContext(context)
  parser.runInContext(context)
  source.runInContext(context)

  return context
}

/* The display options, by the id each checkbox carries. */
const DISPLAY_BOXES = {
  headings: '#passage-headings',
  numbers: '#passage-numbers',
  perLine: '#passage-lines'
}

function choose(dialog, keys) {
  for (const key of keys) {
    const box = dialog.querySelector(DISPLAY_BOXES[key])
    assert.ok(box, `the dialog has no ${key} checkbox`)
    box.checked = true
  }
}

/* Drives one insertion from invocation to the reference being submitted, with
 * the named display options checked beside it. */
async function invoke(context, run, reference = 'John 3:16', options = []) {
  const invocation = run()
  await flush()

  const dialog = dialogOf(context)
  fill(dialog, reference)
  choose(dialog, options)
  dialog.querySelector('form').dispatch('submit')
  await invocation
  await flush()

  return dialog
}

function commandContext({ value = '', cursor, menu = null, panel = null, bible = null } = {}) {
  const host = node('body')
  if (menu) host.appendChild(menu)
  if (panel) host.appendChild(panel)
  host.appendChild(editingArea({ value, cursor }))
  return { host, context: load({}, {}, host, bible) }
}

test('the slash command writes the passage source and leaves the cursor on the writing line', async () => {
  const { context, host } = commandContext()
  await Promise.resolve()

  const [command] = context.logseq.Editor.commands
  assert.equal(command.name, 'Passage: Insert a passage')

  await invoke(context, () => command.action())

  assert.deepEqual(context.logseq.Editor.updates, [{ uuid: PASSAGE_UUID, content: PASSAGE_BLOCK }])
  assert.deepEqual(context.logseq.Editor.edits, [])
  assert.equal(host.querySelector('textarea').selectionStart, WRITING_LINE)
  // The cursor sits at the start of the blank line, with the terminator below.
  assert.equal(PASSAGE_BLOCK.slice(WRITING_LINE), '\n#+END_PASSAGE')
})

test('the command palette registers a stable Passage command and uses the insertion flow', async () => {
  const value = 'keep this text'
  const { context } = commandContext({ value })
  await Promise.resolve()

  const [palette] = context.logseq.App.paletteCommands
  assert.equal(palette.command.key, 'passage.insert-passage')
  assert.equal(palette.command.label, 'Passage: Insert a passage')

  await invoke(context, () => palette.action())

  assert.equal(
    context.logseq.Editor.updates[0].content,
    `${PASSAGE_PROPERTIES}\n${value}\n${PASSAGE_SOURCE}`
  )
  assert.equal(context.logseq.Editor.commands.length, 1, 'the slash command was replaced')
})

test('the passage becomes the value saved by the existing edit session', async () => {
  /* updateBlock has a special live-editor path for the block being edited.
   * Keep that session: when Logseq later ends it, its own save must carry the
   * passage rather than overwrite a prior database write with stale text. */
  const { context } = commandContext()
  await Promise.resolve()

  await invoke(context, () => context.logseq.Editor.commands[0].action())

  assert.deepEqual(context.logseq.Editor.exits, [], 'Passage ended the live editor session')
  assert.deepEqual(context.logseq.Editor.edits, [], 'Passage reloaded the active block from storage')
  assert.equal(
    context.endEditSession(),
    PASSAGE_BLOCK,
    'Logseq would save stale editor text over the passage'
  )
  assert.deepEqual(context.writes, [{ source: 'host', content: PASSAGE_BLOCK }])
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
  const edit = context.parent.document.querySelector('textarea')
  assert.equal(
    context.logseq.Editor.updates[0].content.slice(edit.selectionStart),
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

  const entries = () => menu.querySelectorAll('[data-passage-command]')
  assert.equal(entries().length, 1)
  assert.equal(entries()[0].textContent, 'Passage: Insert a passage')
  // Cloned from the host's own entry, so it inherits the popup's markup.
  assert.equal(entries()[0].classList.has('menu-link'), true)

  // Repainting is what the childList observer does after the injection, so the
  // bridge has to recognize its own node and settle.
  context.repaint()
  context.repaint()
  assert.equal(entries().length, 1)

  // Unrelated entries are left exactly as the host wrote them.
  assert.deepEqual(menu.children.slice(0, 2).map(({ textContent }) => textContent), ['Query', 'Embed'])
})

test('the Passage entry is withdrawn once the trigger no longer matches', async () => {
  const menu = commandPopup()
  const { context, host } = commandContext({ value: 'note <pas', menu })
  await Promise.resolve()

  assert.equal(menu.querySelectorAll('[data-passage-command]').length, 1)

  // A filter Passage cannot match, then no editor at all: a route change.
  const editor = host.querySelector('textarea')
  editor.value = 'note <query'
  editor.selectionStart = editor.value.length
  context.repaint()
  assert.equal(menu.querySelectorAll('[data-passage-command]').length, 0)

  editor.remove()
  context.repaint()
  assert.equal(host.querySelectorAll('[data-passage-command]').length, 0)
})

test('the picker entry routes through the same insertion path as the slash command', async () => {
  const menu = commandPopup()
  const { context } = commandContext({ value: 'note <pas', menu })
  await Promise.resolve()

  const [entry] = menu.querySelectorAll('[data-passage-command]')
  await invoke(context, () => entry.dispatch('mousedown'))

  // The `<` picker clears nothing itself, so the bridge removes the trigger.
  assert.equal(
    context.logseq.Editor.updates[0].content,
    `${PASSAGE_PROPERTIES}\nnote \n${PASSAGE_SOURCE}`
  )
  assert.deepEqual(context.logseq.Editor.edits, [])
  assert.equal(context.parent.document.querySelector('textarea').selectionStart, 5 + 1 + WRITING_LINE)
})

test('a popup that is not the angle-bracket picker is left alone', async () => {
  const menu = commandPopup()
  // The `/` menu renders in the same popup, and has its own plugin API.
  const { context } = commandContext({ value: 'note /pas', menu })
  await Promise.resolve()

  assert.equal(menu.querySelectorAll('[data-passage-command]').length, 0)
  assert.equal(context.logseq.Editor.commands.length, 1)
})

test('unloading leaves no injected node behind', async () => {
  const menu = commandPopup()
  const { context, host } = commandContext({ value: 'note <pas', menu })
  await Promise.resolve()

  /* A theme's own annotations sit on the same host document. Passage neither
   * writes them nor clears them: unloading it leaves the theme's page exactly
   * as the theme painted it. */
  const painted = node('div', {
    classes: ['ls-block'],
    attributes: { 'data-hc-hide-bullet': '', 'data-hc-block-type': 'passage' }
  })
  host.appendChild(painted)

  const invocation = context.logseq.Editor.commands[0].action()
  await flush()
  assert.ok(dialogOf(context))

  const [unload] = context.logseq.unloads
  await unload()

  assert.equal(host.querySelectorAll('[data-passage-command]').length, 0)
  assert.equal(dialogOf(context), null)
  assert.equal(context.logseq.observers[0].connected, false)
  assert.equal(painted.attributes.has('data-hc-hide-bullet'), true)
  assert.equal(painted.attributes.get('data-hc-block-type'), 'passage')

  // The prompt that was open when the plugin unloaded settles as a
  // cancellation rather than hanging, and writes nothing.
  await invocation
  assert.deepEqual(context.logseq.Editor.updates, [])
})

/* Passage paints no page of its own: the one style it provides is its dialog,
 * under a key of its own, so a theme's provided styles are never replaced. */
test('the plugin provides exactly one style, and it is its own dialog', async () => {
  const { context } = commandContext()
  await Promise.resolve()

  assert.deepEqual(context.logseq.provided.map(({ key }) => key), ['passage-dialog'])
  const [dialog] = context.logseq.provided
  assert.match(dialog.style, /\[data-passage-dialog\]/)
  assert.doesNotMatch(dialog.style, /data-hc-/)

  // A dialog button is black with white text in every state it has, so focus
  // shows as the orange border and never as an orange fill. Logseq's own button
  // rules are weighted, so these have to be.
  const fill = dialog.style.slice(dialog.style.indexOf('] button,')).split('}')[0]
  assert.match(fill, /--vscode-hc-white, #ffffff\) !important/)
  assert.match(fill, /--vscode-hc-black, #000000\) !important/)
  const states = fill.split('{')[0]
  for (const state of ['button', 'button:hover', 'button:focus', 'button:focus-visible', 'button:active']) {
    assert.match(states, new RegExp(`\\] ${state}\\b(?!-)`), `no black fill declared for ${state}`)
  }
  // The focus token marks an edge and never a surface: nowhere in the dialog is
  // it a fill.
  for (const declaration of dialog.style.match(/[a-z-]+:[^;{}]*--vscode-hc-focus[^;]*;/g) ?? []) {
    assert.match(declaration, /^(border-color|outline):/, declaration)
  }
  /* Every colour falls back, so the dialog is legible with no theme at all. */
  for (const use of dialog.style.match(/var\(--vscode-hc-[a-z]+[^)]*\)/g) ?? []) {
    assert.match(use, /,\s*(#[0-9a-f]{6}|rgba?\()/i, `${use} has no fallback for a themeless graph`)
  }
})

/* The Bible files the loader reads, keyed by the paths `index.js` asks for. */
const MANIFEST_FILE = 'resources/bible.books.json'
const TEXT_FILE = 'resources/nrsvue.text.json'
const TEXT_SETTING = 'biblePassageText'

/* The host's own settings panel, as Logseq renders one `inputAs: 'file'`
 * setting: the item carries the setting's key and holds a plain file input. */
function settingsPanel(key = TEXT_SETTING) {
  const item = node('div', {
    classes: ['desc-item', 'as-input'],
    attributes: { 'data-key': key }
  })
  item.appendChild(node('input', { attributes: { type: 'file' } }))
  return item
}

/* What a file input hands over: a File with a name and its contents, and no
 * path of any kind. */
function chosenFile(name, data) {
  return {
    name,
    async text() {
      return typeof data === 'string' ? data : JSON.stringify(data)
    }
  }
}

function chooseIn(panel, file, event = {}) {
  const input = panel.querySelector('input')
  assert.ok(input, 'the settings panel has no file input')
  input.files = [file]
  input.dispatch('change', event)
  return input
}

const TEXT_INDEX = {
  books: {
    John: {
      3: {
        verses: ['For God so loved the world.', 'Indeed, God did not send the Son.'],
        numbers: [16, 17],
        paragraphs: [16]
      }
    },
    Gen: {
      1: {
        verses: ['In the beginning.', 'And the earth was a formless void.'],
        paragraphs: [1, 2]
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
      '#+BEGIN_PASSAGE\n**John 3:16-17**\n\n' +
      'For God so loved the world. Indeed, God did not send the Son.\n' +
      '#+END_PASSAGE'
  )
  // The cursor lands at the end of the text that was written, ready to continue.
  const editor = context.parent.document.querySelector('textarea')
  assert.equal(content.slice(editor.selectionStart), '\n#+END_PASSAGE')
  assert.deepEqual(context.messages, [])
})

test('a passage of more than one paragraph is written with a blank line between them', async () => {
  const { context } = await bibleContext({
    bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST, [TEXT_FILE]: TEXT_INDEX } }
  })

  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'Gen 1:1-2')

  assert.equal(
    context.logseq.Editor.updates[0].content,
    'tags:: Gen/1\ntype:: Passage\n' +
      '#+BEGIN_PASSAGE\n**Genesis 1:1-2**\n\n' +
      'In the beginning.\n\nAnd the earth was a formless void.\n' +
      '#+END_PASSAGE'
  )
})

test('a passage spanning books is tagged with every chapter it covers', async () => {
  const { context } = await bibleContext({ bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST } } })

  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'Gen 50 - Ex 2')

  assert.equal(
    context.logseq.Editor.updates[0].content,
    'tags:: Gen/50, Ex/1, Ex/2\ntype:: Passage\n' +
      '#+BEGIN_PASSAGE\n**Genesis 50 - Exodus 2**\n\n#+END_PASSAGE'
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
    `tags:: Ps/23\ntype:: Passage\n#+BEGIN_PASSAGE\n**Psalms 23**\n\n#+END_PASSAGE`
  )
  assert.equal(context.messages.length, 1)
  assert.match(context.messages[0].text, /build-bible-index/)

  // The notice is a standing condition, not something to repeat per passage.
  context.parent.document.querySelector('textarea').value = ''
  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'Ps 24')
  assert.equal(context.messages.length, 1)
})

test('a settings change re-reads the text index and says again when there is none', async () => {
  const { context } = await bibleContext({ bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST } } })

  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'Ps 23')
  assert.equal(context.messages.length, 1)

  /* Naming a new path is a new read. The old read was remembered, and the
   * notice with it, so both are dropped: the passage after the change is
   * written from whatever the new path holds, and a path with nothing at the
   * end of it says so again rather than failing silently. */
  context.logseq.settings.biblePassageText = '/graph/bible.text.json'
  for (const handler of context.logseq.settingsListeners) handler(context.logseq.settings)

  context.parent.document.querySelector('textarea').value = ''
  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'Ps 24')
  assert.equal(context.messages.length, 2)
  assert.equal(context.logseq.Editor.updates.length, 2)
  assert.match(context.logseq.Editor.updates[1].content, /tags:: Ps\/24\ntype:: Passage/)
})

test('the settings schema offers a Bible JSON file chooser and nothing a theme owns', async () => {
  const { context } = commandContext()
  await Promise.resolve()

  // The schema crosses out of the vm realm, so it is compared as plain data.
  assert.deepEqual(JSON.parse(JSON.stringify(context.logseq.schema.map(({ key }) => key))), [
    'biblePassageText'
  ])
  const setting = context.logseq.schema[0]
  assert.equal(setting.type, 'string')
  assert.equal(setting.inputAs, 'file')
  assert.equal(setting.default, '')
  assert.equal(setting.title, 'Bible JSON file')
  assert.match(setting.description, /Bible JSON file/)
  assert.doesNotMatch(setting.description, /nrsvue\.text\.json/)
  /* Property hiding is a theme's setting; a graph with both installed keeps two
   * separate settings files, and neither plugin writes the other's keys. */
  assert.equal('hiddenProperties' in context.logseq.settings, false)
})

/* A file chooser is the one control Logseq offers that never reports a path:
 * the HTML spec fixes an input's value at `C:\fakepath\<name>`, and Electron
 * 32 removed the `File.path` that used to make up the difference. The contents
 * are the whole of what the chooser gives, so Passage copies them. */
test('choosing a Bible JSON file copies its contents into the plugin’s own storage', async () => {
  const panel = settingsPanel()
  const { context } = commandContext({ panel })
  await flush()

  let stopped = false
  chooseIn(panel, chosenFile('net.text.json', TEXT_INDEX), {
    stopPropagation() {
      stopped = true
    }
  })
  await flush()

  // The setting keeps the name, which is the key the contents were stored under.
  assert.equal(context.logseq.settings[TEXT_SETTING], 'net.text.json')
  assert.deepEqual(JSON.parse(context.logseq.storage.get('net.text.json')), TEXT_INDEX)
  /* Logseq's own handler stores the input's value. Left to run it would write
   * `C:\fakepath\net.text.json` straight over the name above. */
  assert.equal(stopped, true)
})

test('a passage is written from the file the chooser was given', async () => {
  const panel = settingsPanel()
  const { context } = await bibleContext({
    panel,
    bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST } }
  })

  chooseIn(panel, chosenFile('net.text.json', TEXT_INDEX))
  await flush()

  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'jn 3:16')

  assert.equal(
    context.logseq.Editor.updates[0].content,
    'tags:: John/3\ntype:: Passage\n' +
      '#+BEGIN_PASSAGE\n**John 3:16**\n\nFor God so loved the world.\n#+END_PASSAGE'
  )
  assert.deepEqual(context.messages, [])
})

test('choosing a rebuilt file under the same name is read again rather than remembered', async () => {
  const panel = settingsPanel()
  const { context } = await bibleContext({
    panel,
    bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST } }
  })

  chooseIn(panel, chosenFile('net.text.json', TEXT_INDEX))
  await flush()
  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'jn 3:16')

  /* The setting reads exactly as it did, so nothing wakes the settings
   * listener; the remembered read has to be dropped by the chooser itself. */
  const rebuilt = {
    books: { John: { 3: { verses: ['Rebuilt.'], numbers: [16], paragraphs: [16] } } }
  }
  chooseIn(panel, chosenFile('net.text.json', rebuilt))
  await flush()

  context.parent.document.querySelector('textarea').value = ''
  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'jn 3:16')

  assert.match(context.logseq.Editor.updates[1].content, /\nRebuilt\.\n/)
})

test('a file that is not a text index is refused and the previous setting kept', async () => {
  const panel = settingsPanel()
  const { context } = commandContext({ panel })
  await flush()
  context.logseq.settings[TEXT_SETTING] = 'kept.text.json'

  chooseIn(panel, chosenFile('notes.json', { notes: ['not a Bible'] }))
  await flush()

  assert.equal(context.logseq.settings[TEXT_SETTING], 'kept.text.json')
  assert.equal(context.logseq.storage.has('notes.json'), false)
  assert.equal(context.messages.length, 1)
  assert.equal(context.messages[0].status, 'warning')
})

test('a file that is not JSON at all is refused rather than thrown', async () => {
  const panel = settingsPanel()
  const { context } = commandContext({ panel })
  await flush()

  chooseIn(panel, chosenFile('bible.text.json', 'not json'))
  await flush()

  assert.equal(context.logseq.settings[TEXT_SETTING], '')
  assert.equal(context.logseq.storage.size, 0)
  assert.equal(context.messages[0].status, 'warning')
})

test('a fake path a chooser wrote is read back as the file’s own name', async () => {
  const { context } = await bibleContext({
    bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST } }
  })

  /* What Logseq stores if its own handler records the input's value — which is
   * also every value the first released chooser wrote. */
  context.logseq.settings[TEXT_SETTING] = 'C:\\fakepath\\net.text.json'
  context.logseq.storage.set('net.text.json', JSON.stringify(TEXT_INDEX))
  for (const handler of context.logseq.settingsListeners) handler(context.logseq.settings)

  await invoke(context, () => context.logseq.Editor.commands[0].action(), 'jn 3:16')

  assert.match(context.logseq.Editor.updates[0].content, /For God so loved the world\./)
})

test('a storage that cannot be written leaves the setting as it was', async () => {
  const panel = settingsPanel()
  const { context } = commandContext({ panel })
  await flush()
  context.logseq.settings[TEXT_SETTING] = 'kept.text.json'
  context.logseq.Assets.makeSandboxStorage = () => ({
    async setItem() {
      throw new Error('read-only')
    }
  })

  chooseIn(panel, chosenFile('net.text.json', TEXT_INDEX))
  await flush()

  assert.equal(context.logseq.settings[TEXT_SETTING], 'kept.text.json')
  assert.equal(context.messages[0].status, 'warning')
})

test('unloading releases the chooser in the host’s own settings panel', async () => {
  const panel = settingsPanel()
  const { context } = commandContext({ panel })
  await flush()

  const input = panel.querySelector('input')
  assert.equal(input.getAttribute('data-passage-chooser'), 'passage')

  for (const handler of context.logseq.unloads) await handler()

  /* The panel belongs to the host and outlives the plugin, so the chooser is
   * released rather than removed, and it stops answering. */
  assert.equal(input.getAttribute('data-passage-chooser'), null)
  chooseIn(panel, chosenFile('net.text.json', TEXT_INDEX))
  await flush()

  assert.equal(context.logseq.settings[TEXT_SETTING], '')
  assert.equal(context.logseq.storage.size, 0)
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

test('a configured text index is read from its own path, not from the plugin folder', async () => {
  const host = node('body')
  host.appendChild(editingArea())
  const context = load(
    { [TEXT_SETTING]: '/graph/bible.text.json' },
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

test('the display options open unchecked, and open unchecked again next time', async () => {
  const { context } = await bibleContext({
    bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST, [TEXT_FILE]: TEXT_INDEX } }
  })

  const invocation = context.logseq.Editor.commands[0].action()
  await flush()
  const dialog = dialogOf(context)

  // Three boxes, in the order the issue names them, each with its own label.
  const boxes = dialog.querySelectorAll('input').filter(({ type }) => type === 'checkbox')
  assert.deepEqual(boxes.map(({ id }) => id), [
    'passage-headings',
    'passage-numbers',
    'passage-lines'
  ])
  assert.deepEqual(boxes.map(({ checked }) => checked), [false, false, false])
  assert.deepEqual(dialog.querySelectorAll('span').map(({ textContent }) => textContent), [
    'View chapter headings',
    'View verse numbers',
    'One verse per line'
  ])

  choose(dialog, ['headings', 'numbers', 'perLine'])
  fill(dialog, 'John 3:16')
  dialog.querySelector('form').dispatch('submit')
  await invocation
  await flush()

  // A display option is a choice about the passage in front of you, not a
  // setting: the next dialog opens with all three off again.
  const second = context.logseq.Editor.commands[0].action()
  await flush()
  const reopened = dialogOf(context)
  assert.notEqual(reopened, dialog, 'the dialog was reused rather than rebuilt')
  assert.deepEqual(
    reopened.querySelectorAll('input').filter(({ type }) => type === 'checkbox')
      .map(({ checked }) => checked),
    [false, false, false]
  )

  control(reopened, 'button', 'Cancel').dispatch('click')
  await second
})

test('each display option formats the passage on its own', async () => {
  const reference = 'jn 3:16-17'
  const head = 'tags:: John/3\ntype:: Passage\n#+BEGIN_PASSAGE\n**John 3:16-17**\n\n'

  for (const [options, body] of [
    [[], 'For God so loved the world. Indeed, God did not send the Son.'],
    [['headings'], '**John 3**\n\nFor God so loved the world. Indeed, God did not send the Son.'],
    [
      ['numbers'],
      '^^\u00b9\u2076^^For God so loved the world. ^^\u00b9\u2077^^Indeed, God did not send the Son.'
    ],
    [['perLine'], 'For God so loved the world.\nIndeed, God did not send the Son.']
  ]) {
    const { context } = await bibleContext({
      bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST, [TEXT_FILE]: TEXT_INDEX } }
    })

    await invoke(context, () => context.logseq.Editor.commands[0].action(), reference, options)

    assert.equal(
      context.logseq.Editor.updates[0].content,
      `${head}${body}\n#+END_PASSAGE`,
      options.join(' + ') || 'no options'
    )
  }
})

test('the three display options are written together, and the cursor still lands after them', async () => {
  const { context } = await bibleContext({
    bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST, [TEXT_FILE]: TEXT_INDEX } }
  })

  await invoke(
    context,
    () => context.logseq.Editor.commands[0].action(),
    'jn 3:16-17',
    ['headings', 'numbers', 'perLine']
  )

  const [{ content }] = context.logseq.Editor.updates
  assert.equal(
    content,
    'tags:: John/3\ntype:: Passage\n' +
      '#+BEGIN_PASSAGE\n**John 3:16-17**\n\n' +
      '**John 3**\n\n' +
      '^^\u00b9\u2076^^For God so loved the world.\n' +
      '^^\u00b9\u2077^^Indeed, God did not send the Son.\n' +
      '#+END_PASSAGE'
  )
  const editor = context.parent.document.querySelector('textarea')
  assert.equal(content.slice(editor.selectionStart), '\n#+END_PASSAGE')
})

test('without the text index the options add nothing to an empty body', async () => {
  // The body is the reader's to write, so a heading or a verse number would be
  // metadata standing in for a passage that is not there.
  const { context } = await bibleContext({ bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST } } })

  await invoke(
    context,
    () => context.logseq.Editor.commands[0].action(),
    'Psalms 23',
    ['headings', 'numbers', 'perLine']
  )

  assert.equal(
    context.logseq.Editor.updates[0].content,
    'tags:: Ps/23\ntype:: Passage\n#+BEGIN_PASSAGE\n**Psalms 23**\n\n#+END_PASSAGE'
  )
  assert.equal(context.messages.length, 1)
  assert.match(context.messages[0].text, /build-bible-index/)
})

test('Enter inserts and Escape cancels ahead of the host, wherever the key lands', async () => {
  // Logseq binds its editor shortcuts on the document before Passage opens the
  // prompt. Passage claims Enter and Escape on the window, whose capturing
  // phase runs before the event reaches Logseq's document listener.
  const { context } = await bibleContext({ bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST } } })

  const invocation = context.logseq.Editor.commands[0].action()
  await flush()

  const dialog = dialogOf(context)
  let hostEnters = 0
  context.parent.document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') hostEnters += 1
  }, true)
  // A key the dialog does not own is left to whatever has focus.
  assert.equal(context.press('a'), false)

  fill(dialog, 'Ex 2-Gen 50')
  assert.equal(context.press('Enter'), true, 'the host still saw Enter')
  assert.equal(hostEnters, 0, 'Logseq handled Enter before Passage')
  await flush()
  assert.ok(dialogOf(context), 'a reference that does not resolve closed the dialog')
  assert.match(dialog.querySelector('p').textContent, /backwards/)

  fill(dialog, 'John 3:16')
  context.press('Enter')
  await invocation

  assert.match(context.logseq.Editor.updates[0].content, /\*\*John 3:16\*\*/)
  assert.equal(dialogOf(context), null)
  // The claim lasts exactly as long as the dialog does.
  assert.equal(context.press('Enter'), false)
  assert.equal(hostEnters, 1, 'Logseq did not regain Enter after the dialog closed')

  /* Every listener the dialog binds is released with it: the host's own
   * document listener remains, while the focus hold lasts only as long as the
   * prompt. */
  assert.equal(context.bound('keydown'), 1)
  assert.equal(context.bound('focusin'), 0)
})

test('the dialog keeps the focus the host editor tries to take back', async () => {
  /* The block behind the prompt is still in edit mode, and Logseq puts the
   * caret back in its own textarea once the command menu closes. Focus taken
   * back that way would send the reference into the block instead of the field,
   * leaving the field blank: Insert disabled, and Enter with nothing to read. */
  const { context, host } = await bibleContext({
    bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST } }
  })

  const invocation = context.logseq.Editor.commands[0].action()
  await flush()

  const dialog = dialogOf(context)
  const input = dialog.querySelector('input')
  assert.equal(input.focused, true, 'the dialog opened without the focus')

  input.focused = false
  context.focusOn(host.querySelector('textarea'))
  assert.equal(input.focused, true, 'the host took the focus out of the dialog')

  // A checkbox is the dialog's own, so it keeps what it was given — and it is
  // where the focus returns to next.
  const box = dialog.querySelector('#passage-numbers')
  context.focusOn(box)
  box.focused = false
  input.focused = false
  context.focusOn(host.querySelector('textarea'))
  assert.equal(box.focused, true, 'the focus did not return to where it was last')
  assert.equal(input.focused, false)

  fill(dialog, 'John 3:16')
  context.press('Enter')
  await invocation

  assert.match(context.logseq.Editor.updates[0].content, /\*\*John 3:16\*\*/)
})

test('the modal listeners are released however the dialog closes', async () => {
  const { context } = await bibleContext({ bible: { files: { [MANIFEST_FILE]: BIBLE_MANIFEST } } })

  for (const dismiss of [
    () => context.press('Escape'),
    () => control(dialogOf(context), 'button', 'Cancel').dispatch('click'),
    async () => (await context.logseq.unloads[0]())
  ]) {
    const invocation = context.logseq.Editor.commands[0].action()
    await flush()
    assert.equal(context.bound('keydown'), 1)
    assert.equal(context.bound('focusin'), 1)

    await dismiss()
    await invocation

    assert.equal(context.bound('keydown'), 0)
    assert.equal(context.bound('focusin'), 0)
    assert.equal(dialogOf(context), null)
  }

  assert.deepEqual(context.logseq.Editor.updates, [])
})
