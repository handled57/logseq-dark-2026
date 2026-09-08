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
 * It also hangs an expand/collapse control on every rendered box in the main
 * editor that can be folded on its own — an admonition, a passage, a table, a
 * quote, a code block, a math block, a piece of media, an embed — and marks
 * the folded ones with `data-hc-collapsed`. That fold is the render's alone:
 * no block is collapsed by it, no descendant is unrendered, and nothing is
 * written to the graph.
 *
 * It also takes over the block bullet's left click. Logseq routes that click to
 * the block's own page; here it folds the block instead, the way the arrow
 * beside the bullet does, and opening a block in the main editor moves to the
 * `Open` block-menu action this script registers through Logseq's plugin API.
 * The API puts plugin actions at the end of the menu, so the host-DOM pass
 * moves that registered action immediately before `Open in sidebar`.
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
const BULLET_SELECTOR = '.bullet-link-wrap, .bullet-container'
/* Whiteboard bullets carry gestures of their own — a portal shape, a shape
 * link — so they are left to Logseq. */
const WHITEBOARD_SELECTOR = '.whiteboard-page, .tl-container'
const HAS_CHILD_ATTR = 'haschild'
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

/* The bullet rail's base line: what a block that takes no hierarchy color of
 * its own paints its stretch of rail with. The default is the structural border
 * the editor, the left menu and the sidebars are drawn with, which theme.css
 * also declares as the fallback; the chosen color is written over that as an
 * inline custom property, which out-ranks every stylesheet rule without
 * depending on the order the theme and this entry are loaded in.
 *
 * It goes on `body`, not on the root element: theme.css declares the whole
 * palette on a selector list that includes `html[data-theme][data-color]:root
 * body`, so on a graph with an accent set the body re-declares this variable
 * and a value inherited from `html` never reaches a block. Everything the rail
 * draws is inside the body, so the body is where the override belongs.
 * The eight hierarchy-depth colors are not this setting's to change. */
const RAIL_COLOR_SETTING = 'defaultRailColor'
const DEFAULT_RAIL_COLOR = '#5B7E96'
const RAIL_COLOR_PROPERTY = '--hc-rail-default-color'

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
    key: RAIL_COLOR_SETTING,
    type: 'string',
    inputAs: 'color',
    default: DEFAULT_RAIL_COLOR,
    title: 'Default rail color',
    description:
      'The color of the bullet rail beside blocks that carry no hierarchy of their own — ' +
      'ordinary prose, rather than a heading or a block with children. Defaults to the border ' +
      'color used around the editor, the left menu and the sidebars. Leave empty to keep that ' +
      'border color. The eight colors the hierarchy itself cycles through are unaffected.'
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
  /* A collapse control is the theme's own UI, not a word of the block. */
  for (const control of copy.querySelectorAll(`[${CONTROL_ATTR}]`)) control.remove()
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

/* Collapsible rich content -------------------------------------------------
 *
 * A rendered box that runs long — an admonition, a passage, a table, a quote,
 * a code block, a math block, a piece of media, a block or page embed — takes
 * a control of its own in its top right corner, which folds that one render
 * away. It is not the bullet's fold: the block keeps its properties, its
 * descendants and its source, clicking into it still shows the whole of it,
 * and nothing is written to the graph.
 *
 * The state therefore lives here rather than in a block. Every box opens
 * expanded, and a fold is remembered under the block's UUID, the kind of
 * content, and which one of that kind it is inside the block, so the same box
 * is found again when Logseq re-renders the page.
 */

const COLLAPSIBLE_ATTR = 'data-hc-collapsible'
const COLLAPSED_ATTR = 'data-hc-collapsed'
const CONTROL_ATTR = 'data-hc-collapse'
const CONTROL_KEY_ATTR = 'data-hc-collapse-key'
const CONTROL_LABEL_ATTR = 'data-hc-collapse-label'

/* The main editor only. Sidebars, whiteboards and dialogs render their own
 * copies of the same content and are left as Logseq draws them. */
const MAIN_EDITOR_SELECTOR = '#main-content-container'

/* One entry per kind of render that earns a control. `name` is what the
 * control calls the box in its accessible name. `label` is the word a folded
 * box carries, and having one is also what marks the kind as a shell: the
 * three kinds without one fold to a readable line of their own content
 * instead. */
const RICH_CONTENT = [
  { type: 'admonition', name: 'admonition', selector: '.admonitionblock' },
  { type: 'passage', name: 'passage', selector: '.passage' },
  { type: 'table', name: 'table', selector: '.table-wrapper' },
  { type: 'quote', name: 'quote', label: 'Quote', selector: 'blockquote' },
  { type: 'code', name: 'code block', label: 'Code', selector: '.cp__fenced-code-block, pre' },
  { type: 'math', name: 'math block', label: 'Math', selector: '.latex, .katex-display' },
  { type: 'media', name: 'media', label: 'Media', selector: '.asset-container, img, video, audio, iframe' },
  { type: 'embed', name: 'embed', label: 'Embed', selector: '.embed-block, .embed-page' }
]

const CONTENT_NAMES = new Map(RICH_CONTENT.map(({ type, name }) => [type, name]))

/* Every kind at once, so the editor is read in document order: a box always
 * reaches the pass before anything it holds, whatever order the kinds are
 * written in above. */
const RICH_CONTENT_SELECTOR = RICH_CONTENT.map(({ selector }) => selector).join(', ')

/* The first kind an element answers to. The order above is precedence order,
 * as it is for the property rules. */
function contentKind(element) {
  return RICH_CONTENT.find(({ selector }) => element.matches?.(selector)) ?? null
}

/* A replaced element holds no children of its own, so its control goes to the
 * box around it — never to a box that carries the block itself. */
const REPLACED_MEDIA = new Set(['IMG', 'VIDEO', 'AUDIO', 'IFRAME'])
const BLOCK_STRUCTURE_SELECTOR =
  '.ls-block, .block-main-container, .block-content-wrapper, .block-content, .block-body, .block-children'

const collapsedContent = new Set()

function controlHost(element) {
  if (!REPLACED_MEDIA.has(element.tagName)) return element

  const parent = element.parentElement
  if (!parent) return null
  /* Once the box around the media is the marked host it stays the host: the
   * control's own label is text, and reading it back would answer the test
   * below differently on the next pass. */
  if (parent.getAttribute?.(COLLAPSIBLE_ATTR)) return parent
  if (parent.matches?.(BLOCK_STRUCTURE_SELECTOR)) return null

  /* Media set in a line of prose belongs to that line rather than standing as
   * a box of its own. */
  return (parent.textContent ?? '').trim() === '' ? parent : null
}

function controlOf(host) {
  for (const child of host.children ?? []) {
    if (child.matches?.(`[${CONTROL_ATTR}]`)) return child
  }

  return null
}

/* One control to a box. The outermost render of a nested pair carries it, so a
 * quote inside an admonition, one line of a code block, or a block inside an
 * embed never grows a second one. Only what this pass has marked counts, so a
 * mark left by the pass before never suppresses a control. */
function nestedInside(host, marked) {
  for (let current = host.parentElement; current; current = current.parentElement) {
    if (marked.has(current)) return true
  }

  return false
}

function ensureControl(host, key, label) {
  const existing = controlOf(host)
  const control = existing ?? doc.createElement('button')

  if (!existing) {
    control.setAttribute('type', 'button')
    control.setAttribute(CONTROL_ATTR, '')

    if (label) {
      const word = doc.createElement('span')
      word.setAttribute(CONTROL_LABEL_ATTR, '')
      word.textContent = label
      control.appendChild(word)
    }

    /* Last, so the rules Logseq and this theme write for a box's first child —
     * a passage's reference line, an admonition's icon column — keep naming
     * what they were written for. */
    host.appendChild(control)
  }

  control.setAttribute(CONTROL_KEY_ATTR, key)
  return control
}

function applyCollapse(host, control, collapsed) {
  const name = CONTENT_NAMES.get(host.getAttribute(COLLAPSIBLE_ATTR)) ?? 'content'
  const action = collapsed ? 'Expand' : 'Collapse'

  control.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
  control.setAttribute('aria-label', `${action} ${name}`)
  control.setAttribute('title', `${action} ${name}`)

  if (collapsed) host.setAttribute(COLLAPSED_ATTR, '')
  else host.removeAttribute(COLLAPSED_ATTR)
}

function releaseCollapsible(host) {
  controlOf(host)?.remove()
  host.removeAttribute(COLLAPSIBLE_ATTR)
  host.removeAttribute(COLLAPSED_ATTR)
}

/* Editing a block replaces its render with a textarea over the raw content, so
 * there is normally no box left to fold. A code block keeps its editor inside
 * the render, and this is what opens that one back up. */
function editingBlock(host) {
  const block = host.closest?.('.ls-block')
  return Boolean(block?.querySelector?.('textarea.block-editor, textarea'))
}

function markCollapsible() {
  const marked = new Set()
  const counts = new Map()

  for (const root of doc.querySelectorAll(MAIN_EDITOR_SELECTOR)) {
    for (const element of root.querySelectorAll(RICH_CONTENT_SELECTOR)) {
      const kind = contentKind(element)
      if (!kind) continue

      const host = controlHost(element)
      /* A box already marked is the media inside it arriving at its own host a
       * second time, and one inside a marked box is a render the box carries. */
      if (!host || marked.has(host) || nestedInside(host, marked)) continue

      const block = host.closest?.('.ls-block')
      const scope = `${block ? blockUuid(block) : ''}:${kind.type}`
      const seen = counts.get(scope) ?? 0
      counts.set(scope, seen + 1)

      host.setAttribute(COLLAPSIBLE_ATTR, kind.type)
      marked.add(host)

      const key = `${scope}:${seen}`
      const control = ensureControl(host, key, kind.label)
      applyCollapse(host, control, collapsedContent.has(key) && !editingBlock(host))
    }
  }

  /* A box that is no longer rendered as one — a block being edited, a render
   * Logseq has replaced — gives its control back. */
  for (const host of doc.querySelectorAll(`[${COLLAPSIBLE_ATTR}]`)) {
    if (!marked.has(host)) releaseCollapsible(host)
  }
}

function collapseControl(event) {
  return event.target?.closest?.(`[${CONTROL_ATTR}]`) ?? null
}

function toggleCollapsed(control) {
  const key = control.getAttribute(CONTROL_KEY_ATTR) ?? ''
  if (collapsedContent.has(key)) collapsedContent.delete(key)
  else collapsedContent.add(key)

  const host = control.parentElement
  if (host) applyCollapse(host, control, collapsedContent.has(key))

  /* The press was taken from the host below, which is where focus would have
   * come from; handing it to the control keeps the keyboard on the box the
   * reader just folded. */
  control.focus?.()
}

/* The control sits inside a block's rendered content, where a click of
 * Logseq's own opens the block for editing and a click on a bullet folds it.
 * Taking both the press and the click in the capture phase, before React's
 * root container sees either, is what keeps this control's fold to itself. */
function toggleCollapse(event) {
  const control = collapseControl(event)
  if (!control) return

  event.preventDefault()
  event.stopPropagation()
  if (event.type === 'click') toggleCollapsed(control)
}

/* A button is operated with Enter and Space. Both are answered here rather
 * than left to the click the host would synthesise, so neither key travels on
 * to Logseq's own shortcut handling. */
function toggleCollapseOnKey(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return

  const control = collapseControl(event)
  if (!control) return

  event.preventDefault()
  event.stopPropagation()
  toggleCollapsed(control)
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

/* An empty setting hands the line back to the stylesheet's own default rather
 * than painting it in nothing. */
function applyRailColor() {
  const color = readSetting(RAIL_COLOR_SETTING, DEFAULT_RAIL_COLOR)
  const { style } = doc.body

  if (color) style.setProperty(RAIL_COLOR_PROPERTY, color)
  else style.removeProperty(RAIL_COLOR_PROPERTY)
}

function paint() {
  const active = rules()

  applyRailColor()

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

  markCollapsible()
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
  for (const menu of doc.querySelectorAll('.menu-links-wrapper')) {
    const links = [...menu.children].filter((child) => child.matches?.('.menu-link'))
    const sidebar = links.find((item) => menuLabel(item) === 'Open in sidebar')
    const item = links.find((link) => menuLabel(link) === 'Open')
    if (!sidebar || !item || item.nextElementSibling === sidebar) continue

    item.setAttribute(OPEN_MENU_ATTR, '')
    menu.insertBefore(item, sidebar)
  }
}

function openBlock({ uuid } = {}) {
  if (uuid) void logseq.App.pushState('page', { name: uuid })
}

/* Logseq's own handler on `a.bullet-link-wrap` routes a plain click to the
 * block's page. React listens on its root container, so a capture-phase
 * listener on the document sees the click first and stopping it there replaces
 * that navigation without patching anything of Logseq's.
 *
 * Only a plain primary click is taken. Shift-click still opens the block in the
 * sidebar, right-click still opens the block menu, and a drag never becomes a
 * click, so moving a block is untouched. A block with nothing to fold keeps the
 * click swallowed: the bullet stops navigating everywhere, rather than only
 * where a fold is possible.
 */
function foldOnBulletClick(event) {
  if (event.button > 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return

  const bullet = event.target?.closest?.(BULLET_SELECTOR)
  if (!bullet || bullet.closest(WHITEBOARD_SELECTOR)) return

  const block = bullet.closest('.ls-block')
  const uuid = block ? blockUuid(block) : ''
  if (!uuid) return

  event.preventDefault()
  event.stopPropagation()

  /* Logseq marks a block that has children, collapsed or not, so the one state
   * the DOM cannot show — the children of a collapsed block — is still known.
   * The fold itself is Logseq's: `toggle` reads the stored collapsed state and
   * calls the same collapse and expand handlers the arrow does. */
  if (block.getAttribute?.(HAS_CHILD_ATTR) !== 'true') return
  void logseq.Editor.setBlockCollapsed?.(uuid, { flag: 'toggle' })
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
  doc.removeEventListener('click', foldOnBulletClick, true)
  doc.removeEventListener('mousedown', toggleCollapse, true)
  doc.removeEventListener('click', toggleCollapse, true)
  doc.removeEventListener('keydown', toggleCollapseOnKey, true)

  doc.body.style.removeProperty(RAIL_COLOR_PROPERTY)

  collapsedContent.clear()
  for (const host of doc.querySelectorAll(`[${COLLAPSIBLE_ATTR}]`)) releaseCollapsible(host)
  for (const control of doc.querySelectorAll(`[${CONTROL_ATTR}]`)) control.remove()

  for (const item of doc.querySelectorAll(`[${OPEN_MENU_ATTR}]`)) item.removeAttribute(OPEN_MENU_ATTR)
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
  logseq.Editor.registerBlockContextMenuItem('Open', openBlock)
  doc.addEventListener('click', foldOnBulletClick, true)
  doc.addEventListener('mousedown', toggleCollapse, true)
  doc.addEventListener('click', toggleCollapse, true)
  doc.addEventListener('keydown', toggleCollapseOnKey, true)

  /* childList/subtree only: this observer must not see its own attribute
   * writes, or every pass would schedule another one. */
  /* Logseq portals the block context menu under `body`, outside
   * `#app-container`. Observe the common host so ordinary block menus schedule
   * the same placement pass as menus opened while a special block is still
   * repainting. Attribute writes remain excluded, including our own marker. */
  const container = doc.body
  observer = new MutationObserver(repaint)
  observer.observe(container, { childList: true, subtree: true })

  repaint()
}

logseq.ready(main).catch(console.error)
