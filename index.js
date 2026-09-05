/* Behavior half of the Dark High Contrast theme.
 *
 * Hides a block's rendered property table when the block matches any one of
 * the configured `key: value` pairs, so a tagged block renders as bare
 * content. Editing needs no special handling: Logseq replaces the whole
 * rendered block (`.block-content-wrapper`, which is what holds
 * `.block-properties`) with a textarea over the raw `:block/content`, and
 * custom properties are part of that content. Clicking into the block
 * therefore already shows the content and its properties as source.
 *
 * `parent.document` is reachable because package.json declares `effect: true`.
 * That flag keeps the plugin entry on the host's own `file://` origin;
 * side-effect-free packages are rewritten to `lsp://logseq.io/`, which is a
 * different origin and would make the host document unreadable.
 */

const doc = parent.document

const STYLE_KEY = 'hc-hidden-properties'
const HIDDEN_ATTR = 'data-hc-hidden'
const TYPE_ATTR = 'data-hc-block-type'
const BULLET_ATTR = 'data-hc-hide-bullet'
const sourceCache = new Map()

const SPECIAL_CONTENT_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  '.multiline-block.h1', '.multiline-block.h2', '.multiline-block.h3',
  '.multiline-block.h4', '.multiline-block.h5', '.multiline-block.h6',
  '.uniline-block.h1', '.uniline-block.h2', '.uniline-block.h3',
  '.uniline-block.h4', '.uniline-block.h5', '.uniline-block.h6',
  '.block-ref', '.block-reference',
  '.embed', '.embed-block', '.embed-page', '.block-embed', '.page-embed',
  '.macro', '.macro-renderer', '[data-macro-name]', '[data-slot-id]',
  '.custom-query', '.query-result', '.references-blocks',
  '.asset-container', '.asset-ref', 'audio', 'video', 'img', 'iframe',
  'pre', '.src', '.org-src-container', '.cp__fenced-code-block', '.extensions__code', '.extensions__code-calc',
  'center', '.center', '.CENTER', '.org-center', '[style*="text-align: center"]', '[style*="text-align:center"]',
  '.verse', '.VERSE', '.org-verse',
  '.passage',
  '.katex-display', '.slides', '.reveal', '.cards-review',
  '.zotero-search', 'blockquote', '.admonitionblock'
].join(', ')

const RULES_SETTING = 'hiddenProperties'
const DEFAULT_RULES = 'type: passage'
const ANY_VALUE = '*'

/* The manifest ships with the theme; the verse text does not, and cannot — it
 * is a licensed edition. This setting is where a reader who has built the text
 * index points the Passage command at it. */
const TEXT_SETTING = 'biblePassageText'
const BIBLE_MANIFEST_PATH = 'resources/bible.books.json'
const BIBLE_TEXT_PATH = 'resources/bible.text.json'

const settingsSchema = [
  {
    key: RULES_SETTING,
    type: 'string',
    default: DEFAULT_RULES,
    title: 'Properties that hide the property table',
    description:
      'Any number of key:value pairs, separated by commas, semicolons or newlines — for example ' +
      '"type: foo, type: bar, status: done". A block whose properties match any one pair renders ' +
      'bare. Write "key: *", or the bare key, to match every value of that key. Leave empty to ' +
      'render every block normally.'
  },
  {
    key: TEXT_SETTING,
    type: 'string',
    default: '',
    title: 'Passage text index',
    description:
      'Full path to a bible.text.json built by scripts/build-bible-index.mjs. Leave empty to read ' +
      'the one in the theme\u2019s own resources folder. Without it the Passage command still ' +
      'writes the reference and its chapter tags, and leaves the text to you.'
  }
]

/* An absent setting means "not configured yet", so it takes the schema default.
 * An empty string is a deliberate choice and must survive as empty. */
function readSetting(key, fallback) {
  const value = logseq.settings?.[key]
  return typeof value === 'string' ? value.trim().toLowerCase() : fallback
}

/* Rules are matched against the rendered table, which is lower-cased, so both
 * halves of every pair are folded here once instead of at each comparison. A
 * pair with no `:` is a key on its own and matches any value it carries. */
function parseRules(source) {
  const rules = []

  for (const entry of source.split(/[\n,;]+/)) {
    const text = entry.trim()
    if (!text) continue

    const separator = text.indexOf(':')
    const key = (separator === -1 ? text : text.slice(0, separator)).trim()
    const value = separator === -1 ? '' : text.slice(separator + 1).trim()
    if (!key) continue

    rules.push({ key, value: value || ANY_VALUE })
  }

  return rules
}

/* 1.2.0 shipped one key plus a list of its values. Those two settings are gone
 * from the schema, but a graph upgraded in place still holds them, and
 * `useSettingsSchema` would write the new default over that choice. Fold them
 * into one rule list first; the stale keys are left in the settings file, where
 * nothing reads them. */
function legacyRules() {
  const key = readSetting('hiddenPropertyKey', '')
  if (!key) return []

  return readSetting('hiddenPropertyValues', ANY_VALUE)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => ({ key, value }))
}

function migrateLegacySettings() {
  if (typeof logseq.settings?.[RULES_SETTING] === 'string') return

  const legacy = legacyRules()
  if (!legacy.length) return

  logseq.updateSettings({
    [RULES_SETTING]: legacy.map(({ key, value }) => `${key}: ${value}`).join(', ')
  })
}

function rules() {
  return parseRules(readSetting(RULES_SETTING, DEFAULT_RULES))
}

/* Read the rendered table rather than the database: a property row is a direct
 * child of `.block-properties` holding one `.page-property-key` and one
 * `.page-property-value`, which is cheaper and synchronous. */
function propertiesOf(table) {
  const properties = {}

  for (const row of table.children) {
    const key = row.querySelector('.page-property-key')
    const value = row.querySelector('.page-property-value')
    if (key && value) properties[key.textContent.trim().toLowerCase()] = value.textContent.trim().toLowerCase()
  }

  return properties
}

function shouldHide(active, properties) {
  return active.some(
    ({ key, value }) => key in properties && (value === ANY_VALUE || properties[key] === value)
  )
}

/* The styling hook carries one value, so the first configured key the block
 * actually has wins. Configuration order is therefore precedence order. */
function blockType(active, properties) {
  for (const { key } of active) {
    if (properties[key]) return properties[key]
  }

  return ''
}

function rawBlockContent(wrapper) {
  const editor = wrapper.querySelector('textarea.block-editor, textarea')
  return typeof editor?.value === 'string' ? editor.value.trim() : ''
}

function propertyFreeText(wrapper) {
  if (typeof wrapper.cloneNode !== 'function') return wrapper.textContent?.trim() ?? ''

  const copy = wrapper.cloneNode(true)
  for (const properties of copy.querySelectorAll('.block-properties')) properties.remove()
  return copy.textContent.trim()
}

const PROPERTY_LINE = /^[\w.-]+::(?:\s|$)/

/* A block's property drawer sits at the top of its content, so a marker such as
 * `#+BEGIN_PASSAGE` only opens the block once those lines are stepped over — a
 * passage carries `type:: Passage` above its own marker. A block that is
 * nothing but properties is special in its own right. */
function specialSource(text) {
  if (!text) return true

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  let start = 0
  while (start < lines.length && PROPERTY_LINE.test(lines[start])) start += 1
  if (start === lines.length) return true

  const body = lines.slice(start).join('\n')

  return /^(?:#{1,6}\s|>|```|~~~|\$\$|#\+BEGIN_)/i.test(body) ||
    /^(?:\(\([^\n]+\)\)|\[\[[^\n]+\]\])$/.test(body) ||
    /^\{\{[\s\S]+\}\}$/.test(body) ||
    /^!\[[^\]]*\]\([^)]+\)$/.test(body) ||
    /(?:^|\s)#card(?:\s|$)|(?:^|\n)card::|zotero/i.test(text)
}

function shouldHideBullet(block) {
  const wrapper = block.querySelector(':scope > .block-main-container > .block-content-wrapper')
  if (!wrapper) return true

  const raw = rawBlockContent(wrapper)
  if (raw) return specialSource(raw)
  if (typeof wrapper.matches === 'function' && wrapper.matches(SPECIAL_CONTENT_SELECTOR)) return true
  if (wrapper.querySelector(SPECIAL_CONTENT_SELECTOR)) return true
  return propertyFreeText(wrapper) === ''
}

function blockUuid(block) {
  const wrapper = block.querySelector(':scope > .block-main-container > .block-content-wrapper')
  const candidate = block.getAttribute?.('blockid') || block.dataset?.uuid ||
    wrapper?.id?.replace(/^block-content-/, '') || ''
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(candidate) ? candidate : ''
}

function setBulletVisibility(block, hidden) {
  if (hidden) block.setAttribute(BULLET_ATTR, '')
  else block.removeAttribute(BULLET_ATTR)
}

async function refreshBulletFromStoredSource(block) {
  const uuid = blockUuid(block)
  if (!uuid || typeof logseq.Editor?.getBlock !== 'function') return

  try {
    let request = sourceCache.get(uuid)
    if (!request) {
      request = logseq.Editor.getBlock(uuid)
      sourceCache.set(uuid, request)
    }
    const stored = await request
    if (typeof stored?.content !== 'string') return
    setBulletVisibility(block, specialSource(stored.content.trim()) || shouldHideBullet(block))
  } catch (error) {
    sourceCache.delete(uuid)
    console.warn('Dark High Contrast could not classify block source', uuid, error)
  }
}

/* Passage blocks.
 *
 * `#+BEGIN_PASSAGE` is not one of the admonition names compiled into mldoc, so
 * Logseq renders it through the generic custom-block path as a bare
 * `div.passage`. theme.css styles that div to read as a sibling of the named
 * admonitions; this half inserts one.
 *
 * Two entry points, one insertion path: the `/` slash command, which has a
 * plugin API, and the `<` command picker, which has none and is reached through
 * a host-DOM bridge.
 */

const COMMAND_LABEL = 'Passage'
const COMMAND_ATTR = 'data-hc-command'
const DIALOG_ATTR = 'data-hc-passage-dialog'
const DIALOG_STYLE_KEY = 'hc-passage-dialog'
const COMMAND_MENU_SELECTORS = ['#ui__ac', '.cp__editor-commands', '#block-commands']
const COMMAND_ITEM_SELECTOR = '.menu-link, a, li'
const EDITOR_SELECTOR = 'textarea.block-editor, textarea'
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

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
 * and it ships with the theme, so references resolve out of the box. The verse
 * text is a licensed edition that cannot be redistributed here: it is built
 * locally by `scripts/build-bible-index.mjs` and read from the theme's own
 * resources folder or from wherever the setting points.
 *
 * Every read route below is optional and guarded. A route that is missing or
 * refuses is simply the next one's turn, and when all of them fail the command
 * degrades a step at a time: no text index means the reference and its tags
 * with the body left to the reader, and no manifest at all means the reference
 * exactly as it was typed. The theme stays fully usable installed from the
 * Marketplace with no Bible data present.
 */

function settingPath(key) {
  const value = logseq.settings?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

const ABSOLUTE_PATH = /^(?:[/\\]|[a-z]:[/\\])/i

/* `logseq.baseInfo.lsr` is the plugin's own root as a URL, so a path packaged
 * with the theme becomes a filesystem path through it. A path the reader
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
  'Dark High Contrast wrote the reference and its chapter tags. The passage text needs a local ' +
  'index: run scripts/build-bible-index.mjs and put bible.text.json beside the theme, or name it ' +
  'in the theme\u2019s settings.'

async function passageBody(resolved) {
  if (!resolved.tags?.length) return ''

  const body = composePassageText(resolved, await loadBibleText())

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
 * is what the property rules and `data-hc-block-type` key on, and `tags::`
 * carries one namespaced tag per chapter the passage spans. */
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

async function writePassage({ uuid, content, cursor, trigger }, resolved) {
  const reference = resolved.canonical
  const body = await passageBody(resolved)
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

  await logseq.Editor.updateBlock(uuid, written.content)
  await logseq.Editor.editBlock?.(uuid, { pos: written.cursor })
  repaint()
}

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

[${DIALOG_ATTR}] input {
  padding: 6px 8px;
  color: inherit;
  background: var(--vscode-hc-black, #000000);
  border: 1px solid var(--vscode-hc-border, #5b7e96);
  border-radius: 2px;
}

[${DIALOG_ATTR}] input:focus {
  outline: none;
  border-color: var(--vscode-hc-focus, #f38518);
}

[${DIALOG_ATTR}] div { display: flex; justify-content: flex-end; gap: 8px; }

[${DIALOG_ATTR}] button {
  padding: 6px 14px;
  color: inherit;
  background: var(--vscode-hc-black, #000000);
  border: 1px solid var(--vscode-hc-border, #5b7e96);
  border-radius: 2px;
  cursor: pointer;
}

[${DIALOG_ATTR}] button:hover:not([disabled]),
[${DIALOG_ATTR}] button:focus-visible {
  border-color: var(--vscode-hc-focus, #f38518);
}

[${DIALOG_ATTR}] button[disabled] {
  color: var(--vscode-hc-disabled, #a0a0a0);
  cursor: default;
}
`

/* Resolves with the resolved reference, or with null when the dialog is
 * dismissed — the caller writes nothing in that case, so Escape and Cancel
 * both leave the block exactly as it was. A reference that does not resolve
 * leaves the dialog open with the reason under the field, exactly as a blank
 * one does: the reader is one edit away from a reference that works. */
let dismissDialog = null
function askForReference() {
  return new Promise((resolve) => {
    const overlay = doc.createElement('div')
    const form = doc.createElement('form')
    const label = doc.createElement('label')
    const input = doc.createElement('input')
    const message = doc.createElement('p')
    const actions = doc.createElement('div')
    const cancel = doc.createElement('button')
    const insert = doc.createElement('button')

    overlay.setAttribute(DIALOG_ATTR, '')
    label.setAttribute('for', 'hc-passage-reference')
    label.textContent = 'Passage reference'
    input.id = 'hc-passage-reference'
    input.type = 'text'
    input.placeholder = 'John 3:16'
    input.setAttribute('autocomplete', 'off')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    insert.type = 'submit'
    insert.textContent = 'Insert'
    insert.disabled = true

    function close(reference) {
      dismissDialog = null
      doc.removeEventListener('keydown', keys, true)
      overlay.remove()
      resolve(reference)
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
      if (resolved.ok) close(resolved)
      else message.textContent = resolved.error
    }

    /* Insert is the dialog's default action, and Escape its cancel, for as long
     * as it is open. The host binds its own editor shortcuts on the document
     * and sees a key there before it ever reaches the dialog — Enter would open
     * a new block behind the prompt — so the dialog claims those two keys on
     * the same document in the same capturing phase, ahead of the host, and
     * lets everything else through to whatever has focus. */
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
    doc.addEventListener('keydown', keys, true)

    actions.appendChild(cancel)
    actions.appendChild(insert)
    form.appendChild(label)
    form.appendChild(input)
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

    const resolved = await askForReference()
    if (!resolved) return

    await writePassage(target, resolved)
  } catch (error) {
    console.warn('Dark High Contrast could not insert a passage block', error)
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
 * popup. The bridge stays small deliberately: it runs from the existing
 * rAF-coalesced paint instead of a second scheduler, writes at most one node,
 * and recognizes that node on the next pass, so the childList observer settles
 * after one more frame rather than looping. */
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
   * is not this theme's to reproduce — while dropping the copied entry's label,
   * icon and shortcut children. */
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

function paint() {
  const active = rules()

  bridgeCommandMenu()

  for (const block of doc.querySelectorAll('.ls-block')) {
    setBulletVisibility(block, shouldHideBullet(block))
    void refreshBulletFromStoredSource(block)
  }

  for (const table of doc.querySelectorAll('.block-properties')) {
    const properties = propertiesOf(table)

    if (shouldHide(active, properties)) table.setAttribute(HIDDEN_ATTR, '')
    else table.removeAttribute(HIDDEN_ATTR)

    /* Styling hook for theme.css, e.g. .ls-block[data-hc-block-type="foo"]. */
    const block = table.closest('.ls-block')
    if (!block) continue

    const type = blockType(active, properties)
    if (type) block.setAttribute(TYPE_ATTR, type)
    else block.removeAttribute(TYPE_ATTR)
  }
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
    paint()
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
  for (const table of doc.querySelectorAll(`[${HIDDEN_ATTR}]`)) table.removeAttribute(HIDDEN_ATTR)
  for (const block of doc.querySelectorAll(`[${BULLET_ATTR}]`)) block.removeAttribute(BULLET_ATTR)
  for (const block of doc.querySelectorAll(`[${TYPE_ATTR}]`)) block.removeAttribute(TYPE_ATTR)
}

function main() {
  migrateLegacySettings()
  logseq.useSettingsSchema(settingsSchema)
  /* The manifest is small and every reference needs it, so the read starts
   * here; nothing waits on it, and a passage typed before it lands is written
   * as it was typed. */
  void loadBibleManifest().catch(() => null)
  logseq.provideStyle({ key: STYLE_KEY, style: `.block-properties[${HIDDEN_ATTR}] { display: none; }` })
  logseq.provideStyle({ key: DIALOG_STYLE_KEY, style: DIALOG_STYLE })
  logseq.Editor?.registerSlashCommand?.(COMMAND_LABEL, () => insertPassage('slash'))
  /* A new text-index path is a new read, and a reason to say again that there
   * is nothing at the end of it. */
  logseq.onSettingsChanged(() => {
    bibleTextRead = null
    noticed = false
    repaint()
  })
  logseq.App.onRouteChanged(repaint)
  logseq.DB?.onChanged?.(() => {
    sourceCache.clear()
    repaint()
  })
  logseq.beforeunload?.(async () => teardown())

  /* childList/subtree only: this observer must not see its own attribute
   * writes, or every pass would schedule another one. */
  const container = doc.getElementById('app-container') ?? doc.body
  observer = new MutationObserver(repaint)
  observer.observe(container, { childList: true, subtree: true })

  repaint()
}

logseq.ready(main).catch(console.error)
