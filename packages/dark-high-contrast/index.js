/* Behavior half of the Dark High Contrast theme.
 *
 * Everything here is theme-owned annotation of the host document. It hides a
 * block's rendered property table when the block matches any one of the
 * configured `key: value` pairs, so a tagged block renders as bare content, and
 * it marks blocks with the `data-hc-*` attributes theme.css keys on. Editing
 * needs no special handling: Logseq replaces the whole rendered block
 * (`.block-content-wrapper`, which is what holds `.block-properties`) with a
 * textarea over the raw `:block/content`, and custom properties are part of
 * that content. Clicking into the block therefore already shows the content and
 * its properties as source.
 *
 * Writing a passage is not this theme's work: it belongs to the sibling Passage
 * plugin, which installs and unloads on its own. What the two share is a
 * content shape, `docs/contracts/passage-v1.md`, not a runtime — the theme
 * styles whatever passage blocks a graph holds, whoever wrote them.
 *
 * It also adds one host-DOM affordance that Logseq 0.10.15 does not expose
 * through its plugin API: an `Open` action immediately before `Open in
 * sidebar` in the menu opened from a block bullet. The action follows the
 * bullet's ordinary click behavior and opens that block in the main editor.
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
const VERSE_ATTR = 'data-hc-verse-lines'
const OPEN_MENU_ATTR = 'data-hc-open-block'
const sourceCache = new Map()
let pendingOpenUuid = ''

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

/* Highlight markup, and the one shape of it a passage carries: the superscript
 * verse digits of the Passage v1 content contract (`docs/contracts/passage-v1.md`)
 * wrapped in the markup that gives a verse number a `mark` element to be
 * colored through. Any plugin, or the reader's own typing, may write that
 * shape; the theme reads the block source rather than asking who wrote it. A
 * highlight of the reader's own is a `mark` too, which is why every one of them
 * is read here rather than only the numbers. */
const HIGHLIGHT = /\^\^[\s\S]+?\^\^/g
const VERSE_NUMBER = /^\^\^[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+\^\^$/

/* theme.css hangs a verse number in a gutter beside its verse, which is only
 * right where every number starts a line — the passage written one verse per
 * line. The render cannot be asked: inside `#+BEGIN_PASSAGE` mldoc parses the
 * whole body as one paragraph of inline nodes separated by line breaks, and a
 * number that merely follows a poetry break inside the verse before it is
 * indistinguishable, in CSS, from one that opens a line. The block's own source
 * says it plainly, so it is read here and answered once for the block: a block
 * that holds any number mid-line — prose, or a prose passage beside a
 * one-verse-per-line one — keeps every number where the text puts it. */
function versesOpenLines(text) {
  let seen = false

  for (const line of text.split(/\r?\n/)) {
    const marked = line.match(HIGHLIGHT)
    if (!marked) continue
    if (marked.length > 1 || !VERSE_NUMBER.test(marked[0]) || !line.startsWith(marked[0])) {
      return false
    }
    seen = true
  }

  return seen
}

function setVerseLines(block, hanging) {
  if (hanging) block.setAttribute(VERSE_ATTR, '')
  else block.removeAttribute(VERSE_ATTR)
}

async function refreshFromStoredSource(block) {
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
    const source = stored.content.trim()
    setBulletVisibility(block, specialSource(source) || shouldHideBullet(block))
    setVerseLines(block, versesOpenLines(source))
  } catch (error) {
    sourceCache.delete(uuid)
    console.warn('Dark High Contrast could not classify block source', uuid, error)
  }
}

function paint() {
  const active = rules()

  for (const block of doc.querySelectorAll('.ls-block')) {
    setBulletVisibility(block, shouldHideBullet(block))
    void refreshFromStoredSource(block)
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

  addOpenMenuItem()
}

function menuLabel(item) {
  return item.querySelector('.flex-1')?.textContent?.trim() ?? ''
}

/* Plugin block-menu commands render at the end of Logseq's menu, while this
 * action belongs beside the native navigation action. Clone only the native
 * link's presentation (DOM cloning does not copy its click handler), mark the
 * clone as ours, and give it the captured bullet's UUID. The child-list
 * observer may see this insertion, so the marker is also the idempotence
 * guard. */
function addOpenMenuItem() {
  if (!pendingOpenUuid) return

  for (const menu of doc.querySelectorAll('.menu-links-wrapper')) {
    const links = [...menu.children].filter((child) => child.matches?.('.menu-link'))
    const sidebar = links.find((item) => menuLabel(item) === 'Open in sidebar')
    if (!sidebar || menu.querySelector(`[${OPEN_MENU_ATTR}]`)) continue

    const item = sidebar.cloneNode(false)
    item.removeAttribute('href')
    item.setAttribute(OPEN_MENU_ATTR, '')

    const label = doc.createElement('span')
    label.classList.add('flex-1')
    label.textContent = 'Open'
    item.appendChild(label)
    item.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const uuid = pendingOpenUuid
      pendingOpenUuid = ''
      if (uuid) void logseq.App.pushState('page', { name: uuid })
    })

    menu.insertBefore(item, sidebar)
  }
}

function rememberBulletBlock(event) {
  const bullet = event.target?.closest?.('.bullet-container')
  const block = bullet?.closest('.ls-block')
  pendingOpenUuid = block ? blockUuid(block) : ''
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
  doc.removeEventListener('contextmenu', rememberBulletBlock, true)
  pendingOpenUuid = ''

  for (const item of doc.querySelectorAll(`[${OPEN_MENU_ATTR}]`)) item.remove()
  for (const table of doc.querySelectorAll(`[${HIDDEN_ATTR}]`)) table.removeAttribute(HIDDEN_ATTR)
  for (const block of doc.querySelectorAll(`[${BULLET_ATTR}]`)) block.removeAttribute(BULLET_ATTR)
  for (const block of doc.querySelectorAll(`[${VERSE_ATTR}]`)) block.removeAttribute(VERSE_ATTR)
  for (const block of doc.querySelectorAll(`[${TYPE_ATTR}]`)) block.removeAttribute(TYPE_ATTR)
}

function main() {
  migrateLegacySettings()
  logseq.useSettingsSchema(settingsSchema)
  logseq.provideStyle({ key: STYLE_KEY, style: `.block-properties[${HIDDEN_ATTR}] { display: none; }` })
  logseq.onSettingsChanged(repaint)
  logseq.App.onRouteChanged(repaint)
  logseq.DB?.onChanged?.(() => {
    sourceCache.clear()
    repaint()
  })
  logseq.beforeunload?.(async () => teardown())
  doc.addEventListener('contextmenu', rememberBulletBlock, true)

  /* childList/subtree only: this observer must not see its own attribute
   * writes, or every pass would schedule another one. */
  const container = doc.getElementById('app-container') ?? doc.body
  observer = new MutationObserver(repaint)
  observer.observe(container, { childList: true, subtree: true })

  repaint()
}

logseq.ready(main).catch(console.error)
