/* Passage: writes a Bible passage into the block being edited.
 *
 * `#+BEGIN_PASSAGE` is not one of the admonition names compiled into mldoc, so
 * Logseq renders it through the generic custom-block path as a bare
 * `div.passage`. This plugin inserts one; styling it is a theme's business, and
 * the shape both sides agree on is written down in
 * `docs/contracts/passage-v1.md`. Nothing here needs a theme installed: the
 * block it writes is ordinary Logseq markup that renders readably on its own.
 *
 * Two entry points, one insertion path: the `/` slash command, which has a
 * plugin API, and the `<` command picker, which has none and is reached through
 * a host-DOM bridge.
 *
 * `parent.document` is reachable because package.json declares `effect: true`.
 * That flag keeps the plugin entry on the host's own `file://` origin;
 * side-effect-free packages are rewritten to `lsp://logseq.io/`, which is a
 * different origin and would make the host document unreadable.
 */

const doc = parent.document

const COMMAND_LABEL = 'Passage'
/* Every attribute, style key and element id this plugin writes is namespaced to
 * Passage, so a theme that annotates the same host document — Dark High
 * Contrast writes `data-hc-*` — never reads or clears one of these by mistake,
 * and neither plugin's teardown touches the other's nodes. */
const COMMAND_ATTR = 'data-passage-command'
const DIALOG_ATTR = 'data-passage-dialog'
const OPTIONS_ATTR = 'data-passage-options'
const ACTIONS_ATTR = 'data-passage-actions'
const DIALOG_STYLE_KEY = 'passage-dialog'
const COMMAND_MENU_SELECTORS = ['#ui__ac', '.cp__editor-commands', '#block-commands']
const COMMAND_ITEM_SELECTOR = '.menu-link, a, li'
const EDITOR_SELECTOR = 'textarea.block-editor, textarea'
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/* The manifest ships with the plugin. This setting is where a reader points
 * the command at a text index. */
const TEXT_SETTING = 'biblePassageText'
const BIBLE_MANIFEST_PATH = 'resources/bible.books.json'
const BIBLE_TEXT_PATH = 'resources/bible.text.json'

const settingsSchema = [
  {
    key: TEXT_SETTING,
    type: 'string',
    default: '',
    title: 'Passage text index',
    description:
      'Full path to a bible.text.json built by scripts/build-bible-index.mjs. Leave empty to read ' +
      'the one in this plugin’s own resources folder. Without it the Passage command still ' +
      'writes the reference and its chapter tags, and leaves the text to you.'
  }
]

const PROPERTY_LINE = /^[\w.-]+::(?:\s|$)/

/* `/pa` and `<pas` invoke the command as surely as the whole word does, so the
 * trigger has to match the label's own prefixes — and nothing beyond them, so a
 * slash or angle bracket that belongs to the surrounding prose is never eaten.
 * The slash form requires at least one letter because Logseq's own
 * `editor/clear-current-slash` has already removed the invocation by the time
 * the hook runs; a bare `/` left at the cursor is therefore the user's text.
 * The `<` picker clears nothing, so its bare trigger is ours to remove. */
function invocationPattern(trigger, literal) {
  const label = COMMAND_LABEL.toLowerCase()
  let body = ''

  for (let index = label.length - 1; index >= literal; index -= 1) body = `(?:${label[index]}${body})?`
  for (let index = literal - 1; index >= 0; index -= 1) body = `${label[index]}${body}`

  return new RegExp(`${trigger}${body}$`, 'i')
}

const INVOCATIONS = {
  slash: invocationPattern('/', 1),
  angle: invocationPattern('<', 0)
}

function editingArea() {
  return doc.querySelector(EDITOR_SELECTOR)
}

function cursorIn(editor, content) {
  return Number.isInteger(editor?.selectionStart) ? editor.selectionStart : content.length
}

function editorFor(uuid) {
  const editor = editingArea()
  return UUID_PATTERN.exec(editor?.id ?? '')?.[0] === uuid ? editor : null
}

/* updateBlock renders a new value into the textarea asynchronously. Restore
 * the caret there after that render rather than calling editBlock on a block
 * which is already being edited: editBlock reads the database copy and can
 * replace the new live value before the current session has saved it. */
async function restoreLiveCursor(uuid, position) {
  await new Promise((resolve) => parent.requestAnimationFrame(resolve))
  const editor = editorFor(uuid)
  if (!editor) return false

  editor.setSelectionRange?.(position, position)
  editor.focus?.()
  return true
}

/* The invocation has to be measured before the dialog takes focus, because
 * leaving the editor ends the edit session and discards the selection. */
async function captureInvocation(trigger) {
  const editor = editingArea()
  const live = typeof editor?.value === 'string'
  const inline = live ? UUID_PATTERN.exec(editor.id ?? '')?.[0] ?? '' : ''
  /* One host round-trip, and only when the editing DOM cannot answer alone. */
  const stored = inline ? null : await logseq.Editor?.getCurrentBlock?.()
  const uuid = inline || stored?.uuid || ''

  if (!uuid) return null

  const content = live ? editor.value : (stored?.content ?? '')
  return { uuid, content, cursor: live ? cursorIn(editor, content) : content.length, trigger }
}

/* Reading the Bible data.
 *
 * Two files, and neither one is required. `resources/bible.books.json` is the
 * manifest — book names, chapter counts and verse-id offsets, no verse text —
 * and it ships with the plugin, so references resolve out of the box. The verse
 * text index is read from the plugin's own resources folder or from wherever
 * the setting points.
 *
 * Every read route below is optional and guarded. A route that is missing or
 * refuses is simply the next one's turn, and when all of them fail the command
 * degrades a step at a time: no text index means the reference and its tags
 * with the body left to the reader, and no manifest at all means the reference
 * exactly as it was typed. The plugin stays fully usable installed from the
 * Marketplace with no Bible data present.
 */

function settingPath(key) {
  const value = logseq.settings?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

const ABSOLUTE_PATH = /^(?:[/\\]|[a-z]:[/\\])/i

/* `logseq.baseInfo.lsr` is the plugin's own root as a URL, so a path packaged
 * with the plugin becomes a filesystem path through it. A path the reader
 * configured is already one. */
function pluginPath(path) {
  if (ABSOLUTE_PATH.test(path)) return path

  const root = logseq.baseInfo?.lsr ?? ''
  return root ? `${String(root).replace(/\/+$/, '')}/${path}` : ''
}

/* What the SDK's own loader does: `fetch` for an http(s) URL, and the host's
 * `readFile` action for anything else, because `fetch` cannot read `file://`.
 * `parent` is reachable at all only because the package declares `effect`. */
function readUrl(url) {
  if (!url) return ''
  if (/^https?:/i.test(url)) return fetch(url).then((response) => (response.ok ? response.text() : ''))

  return parent.apis?.doAction?.(['readFile', decodeURI(url.replace(/^file:\/\//, ''))]) ?? ''
}

async function readSource(path) {
  const routes = [
    /* `resolveResourceFullUrl` joins the plugin root itself, but it takes a
     * packaged path, not one of the reader's own. */
    () => (ABSOLUTE_PATH.test(path) ? '' : readUrl(logseq.resolveResourceFullUrl?.(path) ?? '')),
    () => readUrl(pluginPath(path)),
    /* A relative fetch answers wherever the sandbox is served over http: a
     * development host, or a browser fixture. */
    () => fetch(path).then((response) => (response.ok ? response.text() : '')),
    () => logseq.Assets?.makeSandboxStorage?.()?.getItem?.(path.split('/').pop())
  ]

  for (const route of routes) {
    try {
      const text = await route()
      if (typeof text === 'string' && text.trim()) return JSON.parse(text)
    } catch (error) {
      /* A route that cannot answer is not a failure; the next one may. */
    }
  }

  return null
}

let bibleManifest = null
let bibleTextRead = null
let noticed = false

async function loadBibleManifest() {
  bibleManifest = await readSource(BIBLE_MANIFEST_PATH)
  return bibleManifest
}

/* The text index is several megabytes, so it is read on the first passage
 * rather than at startup, and the read is remembered either way. */
function loadBibleText() {
  if (!bibleTextRead) {
    const configured = settingPath(TEXT_SETTING)
    bibleTextRead = (async () => {
      for (const path of configured ? [configured, BIBLE_TEXT_PATH] : [BIBLE_TEXT_PATH]) {
        const loaded = await readSource(path)
        if (loaded?.books) return loaded
      }
      return null
    })()
  }

  return bibleTextRead
}

const MISSING_TEXT_NOTICE =
  'Passage wrote the reference and its chapter tags. The passage text needs a local index: run ' +
  'scripts/build-bible-index.mjs and put bible.text.json beside the plugin, or name it in the ' +
  'plugin’s settings.'

async function passageBody(resolved, display) {
  if (!resolved.tags?.length) return ''

  const body = composePassageText(resolved, await loadBibleText(), display)

  if (!body && !noticed) {
    noticed = true
    logseq.UI?.showMsg?.(MISSING_TEXT_NOTICE, 'warning')
  }

  return body
}

/* Without the manifest there is nothing to resolve against, so the reference is
 * taken exactly as typed and carries no tags. */
function resolveReference(reference) {
  if (!bibleManifest) return { ok: true, canonical: reference, tags: [], chapters: [] }
  return parsePassageReference(reference, bibleManifest)
}

/* The reference is bold on the first line and the passage follows it a line
 * below. With no text to write, that line is left empty and the cursor lands on
 * it; with text, the cursor lands at the end of what was written. */
function passageSource(reference, body) {
  return `#+BEGIN_PASSAGE\n**${reference}**\n\n${body ? `${body}\n` : ''}#+END_PASSAGE`
}

/* Every passage the commands write is also typed and taggable: `type:: Passage`
 * is the key a theme's property rules and block-type annotations read, and
 * `tags::` carries one namespaced tag per chapter the passage spans. */
function passageProperties(tags) {
  return [['tags', tags.join(', ')], ['type', 'Passage']]
}

/* A block holds one property drawer, at the very top of its content, so these
 * lines go there rather than beside the `#+BEGIN_PASSAGE` the cursor sits on —
 * and a key the block already declares is left exactly as the user wrote it,
 * because a second copy would only be dropped. */
function withPassageProperties(content, cursor, tags) {
  const lines = content.split('\n')
  let drawer = 0
  while (drawer < lines.length && PROPERTY_LINE.test(lines[drawer])) drawer += 1

  const declared = new Set(
    lines.slice(0, drawer).map((line) => line.slice(0, line.indexOf(':')).toLowerCase())
  )
  const added = passageProperties(tags)
    .filter(([key]) => !declared.has(key))
    .map(([key, value]) => `${key}:: ${value}`)

  if (!added.length) return { content, cursor }

  /* Each drawer line ends in a newline, so that sum is the offset the new lines
   * are spliced in at; a cursor above it does not move. */
  const offset = lines.slice(0, drawer).reduce((total, line) => total + line.length + 1, 0)
  const written = added.join('\n').length + 1

  return {
    content: [...lines.slice(0, drawer), ...added, ...lines.slice(drawer)].join('\n'),
    cursor: cursor >= offset ? cursor + written : cursor
  }
}

async function writePassage({ uuid, content, cursor, trigger }, resolved, display) {
  const reference = resolved.canonical
  const body = await passageBody(resolved, display)
  const head = content.slice(0, cursor).replace(INVOCATIONS[trigger], '')
  const tail = content.slice(cursor)
  /* `#+BEGIN_PASSAGE` only parses on a line of its own, so surrounding text is
   * pushed onto its own line rather than dropped. */
  const lead = head && !head.endsWith('\n') ? '\n' : ''
  const trail = tail && !tail.startsWith('\n') ? '\n' : ''
  const opening = `#+BEGIN_PASSAGE\n**${reference}**\n`
  const written = withPassageProperties(
    `${head}${lead}${passageSource(reference, body)}${trail}${tail}`,
    head.length + lead.length + opening.length + (body ? 1 + body.length : 0),
    resolved.tags ?? []
  )

  /* Keep the existing edit session alive. For the block currently being
   * edited, Logseq's updateBlock writes into its live editor state; the
   * textarea and the save performed when that session eventually ends then
   * contain the passage too. Do not re-enter that same block through editBlock:
   * it reads the still-old database copy and can reset the live editor before
   * its save. */
  await logseq.Editor.updateBlock(uuid, written.content)
  if (!(await restoreLiveCursor(uuid, written.cursor))) {
    await logseq.Editor.editBlock?.(uuid, { pos: written.cursor })
  }
}

/* The dialog is this plugin's own chrome, whichever theme is selected, so it
 * paints itself: the colors fall back to plain black and white where the Dark
 * High Contrast variables are not defined. */
const DIALOG_STYLE = `
[${DIALOG_ATTR}] {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.72);
}

[${DIALOG_ATTR}] form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 320px;
  padding: 20px;
  color: var(--vscode-hc-white, #ffffff);
  background: var(--vscode-hc-black, #000000);
  border: 1px solid var(--vscode-hc-border, #5b7e96);
  border-radius: 2px;
  font-size: 14px;
}

[${DIALOG_ATTR}] label { font-weight: 600; }

[${DIALOG_ATTR}] p {
  margin: 0;
  max-width: 42ch;
  color: var(--vscode-hc-error, #f48771);
}

[${DIALOG_ATTR}] input[type="text"] {
  padding: 6px 8px;
  color: inherit;
  background: var(--vscode-hc-black, #000000);
  border: 1px solid var(--vscode-hc-border, #5b7e96);
  border-radius: 2px;
}

[${DIALOG_ATTR}] input[type="text"]:focus {
  outline: none;
  border-color: var(--vscode-hc-focus, #f38518);
}

/* The display options: one checkbox to a row, each label beside its own box and
 * in the body weight, so only the field above them reads as a heading. */
[${DIALOG_ATTR}] [${OPTIONS_ATTR}] {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

[${DIALOG_ATTR}] [${OPTIONS_ATTR}] label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 400;
  cursor: pointer;
}

[${DIALOG_ATTR}] input[type="checkbox"] {
  margin: 0;
  accent-color: var(--vscode-hc-white, #ffffff);
}

/* A box is too small to carry the focus on its border, so it rings its own. */
[${DIALOG_ATTR}] input[type="checkbox"]:focus-visible {
  outline: 2px solid var(--vscode-hc-focus, #f38518);
  outline-offset: 2px;
}

[${DIALOG_ATTR}] [${ACTIONS_ATTR}] { display: flex; justify-content: flex-end; gap: 8px; }

[${DIALOG_ATTR}] button {
  padding: 6px 14px;
  border: 1px solid var(--vscode-hc-border, #5b7e96);
  border-radius: 2px;
  cursor: pointer;
}

/* A button is black with white text in every state it has: hover, focus, and
 * the press between them. Only the border answers to focus, which keeps the
 * orange a ring around the button rather than a fill inside it. The
 * declarations carry weight because a theme's own button rules do, and those
 * would otherwise repaint a hovered button from underneath. */
[${DIALOG_ATTR}] button,
[${DIALOG_ATTR}] button:hover,
[${DIALOG_ATTR}] button:focus,
[${DIALOG_ATTR}] button:focus-visible,
[${DIALOG_ATTR}] button:active {
  color: var(--vscode-hc-white, #ffffff) !important;
  background: var(--vscode-hc-black, #000000) !important;
}

[${DIALOG_ATTR}] button:hover:not([disabled]),
[${DIALOG_ATTR}] button:focus,
[${DIALOG_ATTR}] button:focus-visible {
  border-color: var(--vscode-hc-focus, #f38518);
}

[${DIALOG_ATTR}] button[disabled] {
  color: var(--vscode-hc-disabled, #a0a0a0) !important;
  border-color: var(--vscode-hc-disabled, #a0a0a0);
  cursor: default;
}
`

/* The passage display options, in the order they are offered under the field.
 * Each one is a choice about this passage alone, so all three open unchecked
 * however the last passage was written; everything unchecked is the plain prose
 * the command has always inserted. */
const DISPLAY_OPTIONS = [
  { key: 'headings', id: 'passage-headings', label: 'View chapter headings' },
  { key: 'numbers', id: 'passage-numbers', label: 'View verse numbers' },
  { key: 'perLine', id: 'passage-lines', label: 'One verse per line' }
]

/* Resolves with the resolved reference and the display options chosen beside
 * it, or with null when the dialog is dismissed — the caller writes nothing in
 * that case, so Escape and Cancel both leave the block exactly as it was. A
 * reference that does not resolve leaves the dialog open with the reason under
 * the field, exactly as a blank one does: the reader is one edit away from a
 * reference that works. */
let dismissDialog = null
function askForReference() {
  return new Promise((resolve) => {
    const overlay = doc.createElement('div')
    const form = doc.createElement('form')
    const label = doc.createElement('label')
    const input = doc.createElement('input')
    const options = doc.createElement('div')
    const message = doc.createElement('p')
    const actions = doc.createElement('div')
    const cancel = doc.createElement('button')
    const insert = doc.createElement('button')

    overlay.setAttribute(DIALOG_ATTR, '')
    label.setAttribute('for', 'passage-reference')
    label.textContent = 'Passage reference'
    input.id = 'passage-reference'
    input.type = 'text'
    input.placeholder = 'John 3:16'
    input.setAttribute('autocomplete', 'off')
    options.setAttribute(OPTIONS_ATTR, '')
    actions.setAttribute(ACTIONS_ATTR, '')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    insert.type = 'submit'
    insert.textContent = 'Insert'
    insert.disabled = true

    /* One row per option: the box, then its name, inside the label that both
     * describes the box and toggles it. The name is a child of the label rather
     * than its text, because writing text onto the label would replace the box
     * it already holds. */
    const boxes = DISPLAY_OPTIONS.map(({ key, id, label: title }) => {
      const row = doc.createElement('label')
      const box = doc.createElement('input')
      const name = doc.createElement('span')

      box.type = 'checkbox'
      box.id = id
      box.checked = false
      row.setAttribute('for', id)
      name.textContent = title
      row.appendChild(box)
      row.appendChild(name)
      options.appendChild(row)

      return { key, box }
    })

    const display = () =>
      Object.fromEntries(boxes.map(({ key, box }) => [key, box.checked === true]))

    function close(choice) {
      dismissDialog = null
      parent.removeEventListener('keydown', keys, true)
      doc.removeEventListener('focusin', holdFocus, true)
      overlay.remove()
      resolve(choice)
    }

    /* The dialog is modal, so it holds the focus for as long as it is open.
     * The host's editor does not know the prompt exists: the block behind it is
     * still in edit mode, and Logseq puts the caret back in its textarea on its
     * own schedule once the command menu closes. Focus taken back that way is
     * silent and total — the reference is typed into the block instead of the
     * field, so the field stays empty, Insert stays disabled, and Enter reads a
     * blank reference and does nothing. Anything focused outside the dialog is
     * handed straight back to whatever inside it had the focus last. */
    let held = input
    function inside(target) {
      for (let node = target; node; node = node.parentElement) if (node === overlay) return true
      return false
    }
    function holdFocus(event) {
      if (inside(event.target)) held = event.target
      else held.focus?.()
    }

    /* Unloading mid-prompt has to settle the promise as well as remove the
     * node, or the invocation it belongs to never finishes. */
    dismissDialog = () => close(null)

    function submit(event) {
      event?.preventDefault?.()
      const reference = input.value.trim()
      /* A blank reference is not a passage, so the dialog stays open. */
      if (!reference) return

      const resolved = resolveReference(reference)
      if (resolved.ok) close({ resolved, display: display() })
      else message.textContent = resolved.error
    }

    /* Insert is the dialog's default action, and Escape its cancel, for as long
     * as it is open. The host binds its own editor shortcuts on the document
     * and sees a key there before it ever reaches the dialog — Enter would open
     * a new block behind the prompt — so the dialog claims those two keys on
     * the parent window in the capturing phase. Window capture precedes the
     * document where Logseq has already registered its shortcut, so Passage
     * can stop Enter before the host creates a block behind the prompt. */
    function keys(event) {
      if (event.key !== 'Enter' && event.key !== 'Escape') return

      event.preventDefault?.()
      event.stopPropagation()
      event.stopImmediatePropagation?.()

      if (event.key === 'Escape') close(null)
      else submit(event)
    }

    input.addEventListener('input', () => {
      insert.disabled = input.value.trim() === ''
      message.textContent = ''
    })
    form.addEventListener('submit', submit)
    cancel.addEventListener('click', () => close(null))
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close(null)
    })
    /* Nothing typed into the dialog belongs to the block behind it. */
    overlay.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Escape') close(null)
      else if (event.key === 'Enter') submit(event)
    })
    parent.addEventListener('keydown', keys, true)
    doc.addEventListener('focusin', holdFocus, true)

    actions.appendChild(cancel)
    actions.appendChild(insert)
    form.appendChild(label)
    form.appendChild(input)
    form.appendChild(options)
    form.appendChild(message)
    form.appendChild(actions)
    overlay.appendChild(form)
    doc.body.appendChild(overlay)
    input.focus?.()
  })
}

let prompting = false
async function insertPassage(trigger) {
  if (prompting) return
  prompting = true

  try {
    const target = await captureInvocation(trigger)
    if (!target) return

    const choice = await askForReference()
    if (!choice) return

    await writePassage(target, choice.resolved, choice.display)
  } catch (error) {
    console.warn('Passage could not insert a passage block', error)
  } finally {
    prompting = false
  }
}

function commandMenu() {
  for (const selector of COMMAND_MENU_SELECTORS) {
    const menu = doc.querySelector(selector)
    if (menu) return menu
  }

  return null
}

/* True only while the text before the cursor ends in a `<` trigger the label
 * still matches, which both distinguishes the `<` picker from the `/` menu and
 * withdraws the entry once the typed filter rules Passage out. */
function angleInvocation() {
  const editor = editingArea()
  if (typeof editor?.value !== 'string') return false

  return INVOCATIONS.angle.test(editor.value.slice(0, cursorIn(editor, editor.value)))
}

/* The `<` picker has no plugin API, so its entry is added to the host's own
 * popup. The bridge stays small deliberately: it runs from an rAF-coalesced
 * paint rather than on every mutation, writes at most one node, and recognizes
 * that node on the next pass, so the childList observer settles after one more
 * frame rather than looping. */
function bridgeCommandMenu() {
  const menu = angleInvocation() ? commandMenu() : null
  const injected = doc.querySelectorAll(`[${COMMAND_ATTR}]`)

  if (!menu) {
    for (const item of injected) item.remove()
    return
  }

  if (injected.length) return

  const template = menu.querySelector(COMMAND_ITEM_SELECTOR)
  if (typeof template?.cloneNode !== 'function') return

  /* A shallow clone inherits the host's own item classes — the popup's markup
   * is not this plugin's to reproduce — while dropping the copied entry's
   * label, icon and shortcut children. */
  const item = template.cloneNode(false)
  item.removeAttribute('id')
  item.setAttribute(COMMAND_ATTR, 'passage')
  item.textContent = COMMAND_LABEL
  /* mousedown rather than click: the editor must still hold the selection the
   * invocation is measured against when the handler reads it. */
  item.addEventListener('mousedown', (event) => {
    event.preventDefault()
    void insertPassage('angle')
  })

  ;(template.parentElement ?? menu).appendChild(item)
}

/* The sandbox is an unrendered iframe, so its own rAF never fires; the host
 * window's does. Coalescing per frame keeps a burst of edit-mode mutations
 * down to one pass. */
let queued = false
function repaint() {
  if (queued) return
  queued = true
  parent.requestAnimationFrame(() => {
    queued = false
    bridgeCommandMenu()
  })
}

/* Everything this script writes lives in the host document, which outlives the
 * plugin, so unloading has to leave none of it behind. */
let observer = null
function teardown() {
  observer?.disconnect()
  observer = null
  dismissDialog?.()

  for (const node of doc.querySelectorAll(`[${COMMAND_ATTR}], [${DIALOG_ATTR}]`)) node.remove()
}

function main() {
  logseq.useSettingsSchema(settingsSchema)
  /* The manifest is small and every reference needs it, so the read starts
   * here; nothing waits on it, and a passage typed before it lands is written
   * as it was typed. */
  void loadBibleManifest().catch(() => null)
  logseq.provideStyle({ key: DIALOG_STYLE_KEY, style: DIALOG_STYLE })
  logseq.Editor?.registerSlashCommand?.(COMMAND_LABEL, () => insertPassage('slash'))
  /* A new text-index path is a new read, and a reason to say again that there
   * is nothing at the end of it. */
  logseq.onSettingsChanged(() => {
    bibleTextRead = null
    noticed = false
  })
  logseq.beforeunload?.(async () => teardown())

  /* childList/subtree only: the `<` picker appears and disappears as a subtree
   * of the host's own popup layer, and this observer must not see the attribute
   * it writes onto its own entry, or every pass would schedule another one. */
  const container = doc.getElementById('app-container') ?? doc.body
  observer = new MutationObserver(repaint)
  observer.observe(container, { childList: true, subtree: true })

  repaint()
}

logseq.ready(main).catch(console.error)
