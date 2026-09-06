/* Behavioral tests for the Anno entry script.
 *
 * `index.js` is a classic script, not a module, so it exports nothing. Running
 * it in a `vm` context against a stub host puts its top-level declarations on
 * that context's global object, which is enough to drive one import from the
 * command that starts it to the asset and the page that come out of it.
 *
 * The stub host is deliberately literal about the two things Logseq really
 * does here: `parent.apis.doAction` is the host's IPC bridge, where `stat`
 * throws for a path that is not there and `writeFile` takes the repo, the
 * absolute path and the bytes; and the plugin API creates or returns a page and
 * appends blocks to it.
 */

import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { node } from '../../../test/support/host-document.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = new vm.Script(await readFile(resolve(root, 'index.js'), 'utf8'))

const GRAPH = { url: 'logseq_local_/graphs/notes', name: 'notes', path: '/graphs/notes' }
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer

const flush = () => new Promise((resolve) => setImmediate(resolve))

function pdf(name, bytes = PDF_BYTES) {
  return { name, type: 'application/pdf', async arrayBuffer() { return bytes } }
}

function load({ graph = GRAPH, onDisk = [], pages = {} } = {}) {
  const host = node('body')
  const windowListeners = []
  const listeners = []
  const provided = []
  const commands = []
  const palette = []
  const unloads = []
  const messages = []
  const actions = []
  const created = []
  const appended = []
  const files = new Set(onDisk)
  const blocks = { ...pages }

  const context = {
    console,
    setImmediate,
    TextEncoder,
    parent: {
      apis: {
        /* One array per call, its head naming the action — the shape the host
         * bridge really takes. */
        async doAction(call) {
          const [action, ...rest] = call
          actions.push({ action, args: rest })
          if (action === 'stat') {
            if (!files.has(rest[0])) throw new Error(`ENOENT: ${rest[0]}`)
            return { size: 4 }
          }
          if (action === 'writeFile') {
            files.add(rest[1])
            return { size: 4 }
          }
          return null
        }
      },
      addEventListener(type, handler, capture) {
        if (capture) windowListeners.push({ type, handler })
      },
      removeEventListener(type, handler) {
        const index = windowListeners.findIndex(
          (entry) => entry.type === type && entry.handler === handler
        )
        if (index !== -1) windowListeners.splice(index, 1)
      },
      document: {
        body: host,
        createElement: (tag) => node(tag),
        /* Logseq's own shortcuts are bound here, which is why the prompt claims
         * its keys on the window instead; only the capturing phase is
         * recorded, because that is the only phase it uses. */
        addEventListener(type, handler, capture) {
          if (capture) listeners.push({ type, handler })
        },
        removeEventListener(type, handler) {
          const index = listeners.findIndex(
            (entry) => entry.type === type && entry.handler === handler
          )
          if (index !== -1) listeners.splice(index, 1)
        },
        querySelector: (selector) => host.querySelector(selector),
        querySelectorAll: (selector) => host.querySelectorAll(selector)
      }
    },
    logseq: {
      provided,
      unloads,
      Editor: {
        commands,
        registerSlashCommand(label, action) {
          commands.push({ label, action })
        },
        async createPage(title, properties, options) {
          created.push({ title, properties, options })
          blocks[title] ??= []
          return { uuid: `page-${title}`, name: title.toLowerCase(), originalName: title }
        },
        async getPageBlocksTree(page) {
          const title = String(page).replace(/^page-/, '')
          return blocks[title] ?? []
        },
        async appendBlockInPage(page, content) {
          const title = String(page).replace(/^page-/, '')
          appended.push({ page: title, content })
          blocks[title] = [...(blocks[title] ?? []), { content }]
        }
      },
      App: {
        palette,
        registerCommandPalette(command, action) {
          palette.push({ ...command, action })
        },
        async getCurrentGraph() {
          return graph
        }
      },
      UI: {
        showMsg(text, status) {
          messages.push({ text, status })
        }
      },
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

  /* A key as the browser delivers it: window capture first, then document
   * capture. Logseq's shortcut is already on the document before the prompt
   * opens, so only the window can stop the key ahead of the host. */
  context.press = (key) => {
    let stopped = false
    const event = {
      key,
      preventDefault() {},
      stopPropagation() { stopped = true },
      stopImmediatePropagation() { stopped = true }
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

  /* The host moving the focus, as the document sees it: `focusin` bubbles, so a
   * capturing listener on the document is told wherever it lands. */
  context.focusOn = (target) => {
    for (const { type, handler } of [...listeners]) if (type === 'focusin') handler({ target })
  }

  context.bound = (type) =>
    [...windowListeners, ...listeners].filter((entry) => entry.type === type).length

  Object.assign(context, {
    host,
    actions,
    created,
    appended,
    messages,
    files,
    blocks,
    writes: () => actions.filter((entry) => entry.action === 'writeFile'),
    slash: () => commands[0],
    command: () => palette[0]
  })

  vm.createContext(context)
  source.runInContext(context)

  return context
}

const dialogOf = (context) => context.parent.document.querySelector('[data-anno-dialog]')

function control(dialog, tag, label) {
  return dialog.querySelectorAll(tag).find((candidate) => candidate.textContent === label)
}

const chooserOf = (dialog) => dialog.querySelector('[data-anno-chooser]')
const titleOf = (dialog) => dialog.querySelector('#anno-page-title')
const messageOf = (dialog) => dialog.querySelector('p')
const importOf = (dialog) => control(dialog, 'button', 'Import')

/* Choosing a file in the system dialog, as the host reports it back. */
function choose(dialog, name) {
  const chooser = chooserOf(dialog)
  chooser.files = [pdf(name)]
  chooser.dispatch('change')
  return chooser
}

function rename(dialog, title) {
  const field = titleOf(dialog)
  field.value = title
  field.dispatch('input')
  return field
}

/* Opens the prompt from whichever entry point is named and returns it. */
async function open(context, from = 'slash') {
  const invocation = from === 'slash' ? context.slash().action() : context.command().action()
  await flush()
  return { dialog: dialogOf(context), invocation }
}

/* Drives one import from the command through to the page it writes. */
async function importPdf(context, { file = 'Moby Dick.pdf', title = null, from = 'slash' } = {}) {
  const { dialog, invocation } = await open(context, from)
  choose(dialog, file)
  if (title !== null) rename(dialog, title)
  dialog.querySelector('form').dispatch('submit')
  await invocation
  await flush()
  return dialog
}

test('both entry points invoke the same import under one label', async () => {
  const context = load()
  await flush()

  assert.equal(context.slash().label, 'Upload PDF for annotation')
  assert.equal(context.command().label, 'Upload PDF for annotation')
  assert.equal(context.command().key, 'anno-upload-pdf')
  assert.deepEqual(context.logseq.provided.map((style) => style.key), ['anno-dialog'])
})

test('the prompt opens the file chooser with it, and the button reopens it', async () => {
  const context = load()
  await flush()

  const { dialog } = await open(context)
  assert.ok(dialog, 'the command opened no prompt')

  const chooser = chooserOf(dialog)
  assert.equal(chooser.type, 'file')
  assert.match(chooser.accept, /pdf/i)
  assert.equal(chooser.clicks, 1, 'the chooser did not open with the prompt')

  control(dialog, 'button', 'Choose PDF…').dispatch('click')
  assert.equal(chooser.clicks, 2, 'the button did not reopen the chooser')
})

test('the command palette opens the same prompt', async () => {
  const context = load()
  await flush()

  const { dialog } = await open(context, 'palette')
  assert.ok(dialog)
  assert.equal(chooserOf(dialog).clicks, 1)
})

test('a chosen PDF names the page, and the name stays editable', async () => {
  const context = load()
  await flush()

  const { dialog } = await open(context)
  assert.equal(importOf(dialog).disabled, true, 'Import is offered before a PDF is chosen')

  choose(dialog, 'Moby Dick.pdf')
  assert.equal(titleOf(dialog).value, 'Moby Dick')
  assert.equal(importOf(dialog).disabled, false)

  /* A second choice re-defaults a title nobody has written. */
  choose(dialog, 'Billy Budd.PDF')
  assert.equal(titleOf(dialog).value, 'Billy Budd')

  /* One that has been written is left alone. */
  rename(dialog, 'Whaling notes')
  choose(dialog, 'Moby Dick.pdf')
  assert.equal(titleOf(dialog).value, 'Whaling notes')

  rename(dialog, '   ')
  assert.equal(importOf(dialog).disabled, true, 'a blank title can be imported')
})

test('importing writes the asset, then opens the page linked to it', async () => {
  const context = load()
  await flush()

  await importPdf(context)

  assert.deepEqual(
    context.actions.map((entry) => entry.action),
    ['stat', 'mkdir-recur', 'writeFile'],
    'the import did not check, create and write in that order'
  )
  const [write] = context.writes()
  assert.deepEqual(write.args.slice(0, 2), [GRAPH.url, '/graphs/notes/assets/Moby Dick.pdf'])
  assert.equal(write.args[2], PDF_BYTES, 'the PDF was not written byte for byte')

  /* The page is created only when it is missing, and the reader is taken to
   * it; its first block is the PDF rather than an empty one. */
  assert.equal(context.created.length, 1)
  assert.equal(context.created[0].title, 'Moby Dick')
  assert.equal(context.created[0].options.redirect, true)
  assert.equal(context.created[0].options.createFirstBlock, false)
  assert.deepEqual(context.appended, [
    { page: 'Moby Dick', content: '![Moby Dick](../assets/Moby Dick.pdf)' }
  ])
  assert.equal(dialogOf(context), null, 'the prompt stayed open after importing')

  /* Logseq collects every highlight made in that PDF on the page its asset
   * name gives it, so the notice says where they will be. */
  const [notice] = context.messages
  assert.equal(notice.status, 'success')
  assert.match(notice.text, /hls__Moby Dick/)
})

test('a character no filename can hold becomes a space in the asset name', async () => {
  const context = load()
  await flush()

  await importPdf(context, { title: 'Reading/Moby Dick: a log' })

  const [write] = context.writes()
  assert.equal(write.args[1], '/graphs/notes/assets/Reading Moby Dick a log.pdf')
  /* The page keeps the title exactly as it was written — `/` and all, which
   * Logseq reads as a namespace — and only the asset is renamed. */
  assert.equal(context.created[0].title, 'Reading/Moby Dick: a log')
  assert.deepEqual(context.appended, [
    {
      page: 'Reading/Moby Dick: a log',
      content: '![Reading/Moby Dick: a log](../assets/Reading Moby Dick a log.pdf)'
    }
  ])
  assert.match(context.messages[0].text, /hls__Reading Moby Dick a log/)
})

test('a title that leaves no filename keeps the prompt open and writes nothing', async () => {
  const context = load()
  await flush()

  const { dialog } = await open(context)
  choose(dialog, 'Moby Dick.pdf')
  rename(dialog, '..')
  dialog.querySelector('form').dispatch('submit')
  await flush()

  assert.equal(dialogOf(context), dialog, 'the prompt closed on a title it cannot name a file after')
  assert.match(messageOf(dialog).textContent, /filename/i)
  assert.deepEqual(context.writes(), [])
  assert.deepEqual(context.created, [])
})

test('a PDF already in the graph is never overwritten', async () => {
  const context = load({ onDisk: ['/graphs/notes/assets/Moby Dick.pdf'] })
  await flush()

  const { dialog } = await open(context)
  choose(dialog, 'Moby Dick.pdf')
  dialog.querySelector('form').dispatch('submit')
  await flush()

  assert.equal(dialogOf(context), dialog, 'the prompt closed over an asset it would overwrite')
  assert.match(messageOf(dialog).textContent, /already in this graph/i)
  assert.deepEqual(context.writes(), [])
  assert.deepEqual(context.created, [])

  /* The reader is one edit away from a title that works. */
  rename(dialog, 'Moby Dick (annotated)')
  dialog.querySelector('form').dispatch('submit')
  await flush()

  assert.equal(dialogOf(context), null)
  assert.equal(context.writes()[0].args[1], '/graphs/notes/assets/Moby Dick (annotated).pdf')
})

test('an existing page is used rather than replaced, and its link not doubled', async () => {
  const context = load({
    pages: { 'Moby Dick': [{ content: 'Started this on the ferry.' }] }
  })
  await flush()

  await importPdf(context)
  assert.deepEqual(context.appended, [
    { page: 'Moby Dick', content: '![Moby Dick](../assets/Moby Dick.pdf)' }
  ])
  assert.equal(context.blocks['Moby Dick'].length, 2, 'the page lost what was already on it')

  /* The same PDF imported again onto the page it is already linked from adds
   * no second link. */
  context.files.delete('/graphs/notes/assets/Moby Dick.pdf')
  await importPdf(context)
  assert.equal(context.appended.length, 1, 'the page carries the same link twice')
})

test('submitting with no PDF chosen asks for one and writes nothing', async () => {
  const context = load()
  await flush()

  const { dialog } = await open(context)
  rename(dialog, 'Moby Dick')
  dialog.querySelector('form').dispatch('submit')
  await flush()

  assert.equal(dialogOf(context), dialog)
  assert.match(messageOf(dialog).textContent, /choose a pdf/i)
  assert.deepEqual(context.actions, [])
})

test('with no graph open nothing is imported', async () => {
  const context = load({ graph: null })
  await flush()

  const { dialog } = await open(context)
  choose(dialog, 'Moby Dick.pdf')
  dialog.querySelector('form').dispatch('submit')
  await flush()

  assert.equal(dialogOf(context), dialog)
  assert.match(messageOf(dialog).textContent, /file graph/i)
  assert.deepEqual(context.writes(), [])
  assert.deepEqual(context.created, [])
})

test('Cancel, Escape and a click outside all leave the graph untouched', async () => {
  for (const dismiss of ['cancel', 'escape', 'outside']) {
    const context = load()
    await flush()

    const { dialog, invocation } = await open(context)
    choose(dialog, 'Moby Dick.pdf')

    if (dismiss === 'cancel') control(dialog, 'button', 'Cancel').dispatch('click')
    if (dismiss === 'escape') assert.equal(context.press('Escape'), true, 'Escape reached the host')
    if (dismiss === 'outside') dialog.dispatch('mousedown', { target: dialog })

    await invocation
    await flush()

    assert.equal(dialogOf(context), null, `${dismiss} left the prompt open`)
    assert.deepEqual(context.writes(), [], `${dismiss} imported a PDF`)
    assert.deepEqual(context.created, [], `${dismiss} created a page`)
    assert.deepEqual(context.messages, [], `${dismiss} reported an import`)
    assert.equal(context.bound('keydown'), 0, `${dismiss} left a key bound`)
    assert.equal(context.bound('focusin'), 0, `${dismiss} left the focus held`)
  }
})

test('cancelling the file chooser leaves a usable prompt and imports nothing', async () => {
  const context = load()
  await flush()

  /* A cancelled system dialog reports nothing back at all. */
  const { dialog } = await open(context)
  assert.equal(dialogOf(context), dialog)
  assert.equal(importOf(dialog).disabled, true)
  assert.deepEqual(context.actions, [])

  /* The button is the way back to it. */
  control(dialog, 'button', 'Choose PDF…').dispatch('click')
  assert.equal(chooserOf(dialog).clicks, 2)
})

test('Enter imports before the host sees the key', async () => {
  const context = load()
  await flush()

  const { dialog, invocation } = await open(context)
  choose(dialog, 'Moby Dick.pdf')

  assert.equal(context.press('Enter'), true, 'Enter reached the host behind the prompt')
  await invocation
  await flush()

  assert.equal(context.writes().length, 1)
  assert.equal(context.appended.length, 1)
})

test('the prompt holds the focus while it is open', async () => {
  const context = load()
  await flush()

  const { dialog } = await open(context)
  const title = titleOf(dialog)
  assert.equal(title.focused, true)

  /* Logseq putting the caret back into its own editor is handed straight back
   * to the prompt. */
  const editor = context.host.appendChild(node('textarea'))
  editor.focused = false
  title.focused = false
  context.focusOn(editor)
  assert.equal(title.focused, true, 'the focus was left outside the prompt')

  /* A control inside it keeps the focus it was given. */
  const button = importOf(dialog)
  context.focusOn(button)
  title.focused = false
  context.focusOn(editor)
  assert.equal(button.focused, true)
  assert.equal(title.focused, false)
})

test('unloading settles an open prompt and removes it from the host', async () => {
  const context = load()
  await flush()

  const { dialog, invocation } = await open(context)
  choose(dialog, 'Moby Dick.pdf')

  for (const unload of context.logseq.unloads) await unload()
  await invocation
  await flush()

  assert.equal(dialogOf(context), null, 'unloading left the prompt in the host document')
  assert.equal(context.bound('keydown'), 0)
  assert.equal(context.bound('focusin'), 0)
  assert.deepEqual(context.writes(), [])
  assert.deepEqual(context.created, [])
})

test('a second invocation while the prompt is open opens no second prompt', async () => {
  const context = load()
  await flush()

  const { invocation } = await open(context)
  await context.slash().action()
  await flush()

  assert.equal(context.parent.document.querySelectorAll('[data-anno-dialog]').length, 1)

  context.press('Escape')
  await invocation
})
