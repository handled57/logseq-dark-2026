/* Able Table: finds and keys every rendered Markdown table, hangs one settings
 * control on it, and — behind that control's one toggle — searches it in place.
 *
 * Everything here is display-only. Typing in the field hides the rows that do
 * not match by marking them; no row is removed, reordered or rewritten, no
 * block is collapsed, and nothing at all reaches the graph. Closing the field
 * or unloading the plugin leaves the table exactly as Logseq rendered it.
 *
 * Keying a table by its block's UUID and its ordinal within that block —
 * rather than by the DOM node Logseq happens to have rendered right now — is
 * what lets a re-rendered table find state written against it earlier. Logseq
 * replaces rendered nodes constantly during ordinary editing and navigation,
 * so a search string kept against the element itself would be lost on the next
 * keystroke elsewhere on the page. The table is this plugin's only kind of
 * render, so the kind is constant and the key carries the two parts that vary.
 *
 * `parent.document` is reachable because package.json declares `effect: true`.
 * That flag keeps the plugin entry on the host's own `file://` origin;
 * side-effect-free packages are rewritten to `lsp://logseq.io/`, a different
 * origin, and every table this plugin exists to find would be out of reach.
 */

const doc = parent.document

/* Every attribute and style key this plugin writes is namespaced to Able
 * Table, so a theme or a sibling plugin annotating the same host document —
 * Dark High Contrast writes `data-hc-*`, Passage `data-passage-*`, Anno
 * `data-anno-*` — never reads or clears one of these, and this plugin's own
 * teardown never touches theirs. The one thing Able Table knows about another
 * package is read in CSS and never written: see
 * `docs/contracts/table-controls-v1.md`. */
const STYLE_KEY = 'able-table'
const TABLE_ATTR = 'data-able-table'
const ANCHOR_ATTR = 'data-able-anchor'
const SETTINGS_ATTR = 'data-able-settings'
const PANEL_ATTR = 'data-able-panel'
const TOGGLE_ATTR = 'data-able-toggle'
const SEARCH_ATTR = 'data-able-search'
const FIELD_ATTR = 'data-able-field'
const CLEAR_ATTR = 'data-able-clear'
const STATUS_ATTR = 'data-able-status'
const FILTERED_ATTR = 'data-able-filtered'
const KEY_ATTR = 'data-able-key'
const PANEL_TOP_PROPERTY = '--able-panel-top'

/* The main editor only, and Logseq's own render of a Markdown table there:
 * a `<table>` that is the direct child of the `div.table-wrapper` box the
 * reader sees. Sidebars, whiteboards and dialogs render their own copies and
 * are left as Logseq draws them, exactly as the theme's rich-content controls
 * are. */
const MAIN_EDITOR_SELECTOR = '#main-content-container'
const TABLE_WRAPPER_SELECTOR = '.table-wrapper'

/* The plugin's whole appearance, registered once under its own key.
 *
 * Two of these rules read Dark High Contrast rather than declaring their own
 * number, and both fall back to a value of Able Table's own when the theme is
 * not installed. The theme pins its collapse control to the wrapper's top
 * right corner at `--hc-collapse-control-size`; the settings control takes
 * that corner when there is no such sibling and steps left of it when there
 * is. This is a one-directional read in CSS alone — nothing is measured, and
 * nothing of the theme's is written, moved or required. */
const STYLE = `
#main-content-container div.table-wrapper[data-able-table] {
  position: relative;
}

/* The field and the panel are rendered outside the wrapper, which is an
 * \`overflow: auto\` scroller: inside it, the panel would be clipped by the
 * table's own horizontal scrolling and would scroll away from its button.
 * Their parent is the box they are positioned against. */
#main-content-container [data-able-anchor] {
  position: relative;
}

[data-able-settings] {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--hc-collapse-control-size, 1.25rem);
  height: var(--hc-collapse-control-size, 1.25rem);
  margin: 0;
  padding: 0;
  font-family: inherit;
  font-size: 0.75rem;
  line-height: 1;
  color: var(--ls-primary-text-color, #e7e7e7);
  background: var(--ls-secondary-background-color, #0a0a0a);
  border: 1px solid var(--ls-border-color, #6b6b6b);
  border-radius: 2px;
  cursor: pointer;
  opacity: 0.7;
}

div.table-wrapper:has(> [data-hc-collapse]) > [data-able-settings] {
  right: calc(var(--hc-collapse-control-size, 1.25rem) + 0.5rem);
}

[data-able-settings]::after {
  content: "\\22ef";
}

[data-able-table]:hover > [data-able-settings],
[data-able-settings][aria-expanded="true"],
[data-able-settings]:hover,
[data-able-settings]:focus-visible {
  opacity: 1;
}

[data-able-settings]:focus-visible,
[data-able-toggle]:focus-visible,
[data-able-clear]:focus-visible,
[data-able-field]:focus-visible {
  outline: 2px solid var(--ls-active-primary-color, #6fc3df);
  outline-offset: 1px;
}

[data-able-panel] {
  position: absolute;
  right: 0;
  top: calc(var(--able-panel-top, 0px) + var(--hc-collapse-control-size, 1.25rem) + 0.25rem);
  z-index: 3;
  padding: 0.375rem;
  color: var(--ls-primary-text-color, #e7e7e7);
  background: var(--ls-secondary-background-color, #0a0a0a);
  border: 1px solid var(--ls-border-color, #6b6b6b);
  border-radius: 2px;
}

[data-able-toggle] {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  margin: 0;
  padding: 0.125rem 0.25rem;
  font-family: inherit;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: inherit;
  white-space: nowrap;
  background: none;
  border: 0;
  cursor: pointer;
}

/* The switch itself, drawn before the words so the state reads left to
 * right. */
[data-able-toggle]::before {
  content: "\\2610";
  font-size: 1rem;
  line-height: 1;
}

[data-able-toggle][aria-checked="true"]::before {
  content: "\\2611";
}

[data-able-search] {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  margin: 0 0 0.25rem;
}

[data-able-field] {
  flex: 1 1 auto;
  min-width: 0;
  height: 1.75rem;
  margin: 0;
  padding: 0 0.5rem;
  font-family: inherit;
  font-size: 0.875rem;
  color: var(--ls-primary-text-color, #e7e7e7);
  background: var(--ls-primary-background-color, #000000);
  border: 1px solid var(--ls-border-color, #6b6b6b);
  border-radius: 2px;
}

[data-able-clear] {
  flex: 0 0 auto;
  width: 1.5rem;
  height: 1.5rem;
  margin: 0;
  padding: 0;
  font-family: inherit;
  font-size: 0.875rem;
  line-height: 1;
  color: inherit;
  background: none;
  border: 1px solid transparent;
  border-radius: 2px;
  cursor: pointer;
}

[data-able-clear]::after {
  content: "\\00d7";
}

[data-able-clear]:hover {
  border-color: var(--ls-border-color, #6b6b6b);
}

[data-able-status] {
  flex: 0 0 auto;
  font-size: 0.75rem;
  line-height: 1.4;
  opacity: 0.8;
}

/* A hidden row is hidden by this one declaration and nothing else, so dropping
 * the mark is all it takes to restore it. It is important because the plugin's
 * style and the host's own table rules are two stylesheets whose order is not
 * the plugin's to decide. */
[data-able-filtered] {
  display: none !important;
}
`

/* State lives here, keyed by `<block uuid>:<ordinal>` — the ordinal counts
 * tables within the same block, in document order, so a block holding more
 * than one table gives each its own key. Every table opens with its search
 * off; nothing here is read from or written to the graph, and it is discarded
 * on unload and rebuilt from the render on the next load. */
const tableState = new Map()

function stateFor(key) {
  const existing = tableState.get(key)
  if (existing) return existing

  const created = { open: false, search: false, query: '' }
  tableState.set(key, created)
  return created
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i

/* Logseq marks a block's own element with `blockid`; its rendered content
 * wrapper additionally carries the same UUID in its id, for the blocks old
 * enough to still write it that way. Either is read, and a candidate that is
 * not a UUID at all counts as no block found. */
function blockUuid(table) {
  const block = table.closest?.('.ls-block')
  const wrapper = block?.querySelector?.(':scope > .block-main-container > .block-content-wrapper')
  const candidate =
    block?.getAttribute?.('blockid') || block?.dataset?.uuid || wrapper?.id?.replace(/^block-content-/, '') || ''

  return UUID_PATTERN.test(candidate) ? candidate : ''
}

function childWith(element, attribute) {
  for (const child of element?.children ?? []) {
    if (child.matches?.(`[${attribute}]`)) return child
  }

  return null
}

/* The field and the panel are siblings of the wrapper rather than children of
 * it, so they are found beside it and matched on the key they carry. */
function siblingWith(wrapper, attribute, key) {
  for (const sibling of wrapper.parentElement?.children ?? []) {
    if (sibling.matches?.(`[${attribute}]`) && sibling.getAttribute?.(KEY_ATTR) === key) return sibling
  }

  return null
}

function insertAfter(element, reference) {
  const parent = reference.parentElement
  if (!parent) return

  const next = reference.nextElementSibling
  if (next) parent.insertBefore(element, next)
  else parent.appendChild(element)
}

/* One predictable rule: a case-insensitive substring test over the rendered
 * text, with runs of whitespace collapsed to one space so a value wrapped
 * across lines in the markup still reads as the words it renders as. */
function normalise(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/* The rows a search may hide. A head is never touched; where the markup writes
 * none, the first row stands as one, the way a folded table keeps its first
 * row. */
function bodyRows(table) {
  const rows = []

  for (const row of table.querySelectorAll('tr')) {
    if (row.closest?.('thead')) continue
    rows.push(row)
  }

  return table.querySelector?.('thead') ? rows : rows.slice(1)
}

function applyFilter(table, query, pass) {
  const needle = normalise(query)
  const rows = bodyRows(table)
  let shown = 0

  for (const row of rows) {
    if (needle && !normalise(row.textContent).includes(needle)) {
      row.setAttribute(FILTERED_ATTR, '')
      pass.filtered.add(row)
      continue
    }

    row.removeAttribute(FILTERED_ATTR)
    shown += 1
  }

  return { shown, total: rows.length }
}

function statusText(shown, total, query) {
  const rows = total === 1 ? 'row' : 'rows'
  if (!normalise(query)) return `${total} ${rows}`
  /* Zero matches is a readable state of its own: the head is still standing,
   * and saying so is the difference between an empty table and a broken one. */
  if (shown === 0) return `No rows match; the header row is all that is left`

  return `${shown} of ${total} ${rows}`
}

function ensureSettings(wrapper, key, name, state) {
  let control = childWith(wrapper, SETTINGS_ATTR)

  if (!control) {
    control = doc.createElement('button')
    control.setAttribute('type', 'button')
    control.setAttribute(SETTINGS_ATTR, '')
    /* Appended rather than placed first: the theme hangs its own collapse
     * control last inside this same wrapper, and both are pinned to the corner
     * by CSS, so neither depends on the order the other arrives in. */
    wrapper.appendChild(control)
  }

  const label = `Search options for ${name}`
  control.setAttribute(KEY_ATTR, key)
  control.setAttribute('aria-expanded', state.open ? 'true' : 'false')
  control.setAttribute('aria-label', label)
  control.setAttribute('title', label)

  return control
}

function buildPanel(key) {
  const panel = doc.createElement('div')
  panel.setAttribute(PANEL_ATTR, '')
  panel.setAttribute(KEY_ATTR, key)
  panel.setAttribute('role', 'group')

  const toggle = doc.createElement('button')
  toggle.setAttribute('type', 'button')
  toggle.setAttribute(TOGGLE_ATTR, '')
  toggle.setAttribute(KEY_ATTR, key)
  toggle.setAttribute('role', 'switch')
  toggle.textContent = 'Full table search'
  panel.appendChild(toggle)

  return panel
}

/* The panel is positioned against the wrapper's own parent, so where the
 * wrapper sits in that box is the one number the stylesheet cannot work out
 * for itself. */
function anchorPanel(panel, wrapper) {
  const top = wrapper.offsetTop
  if (typeof top === 'number') panel.style?.setProperty?.(PANEL_TOP_PROPERTY, `${top}px`)
}

function ensurePanel(wrapper, key, name, state) {
  const existing = siblingWith(wrapper, PANEL_ATTR, key)

  if (!state.open) {
    existing?.remove()
    return null
  }

  const panel = existing ?? buildPanel(key)
  if (!existing) insertAfter(panel, wrapper)

  panel.setAttribute('aria-label', `Search options for ${name}`)
  childWith(panel, TOGGLE_ATTR)?.setAttribute('aria-checked', state.search ? 'true' : 'false')
  anchorPanel(panel, wrapper)

  return panel
}

function buildClear(key) {
  const clear = doc.createElement('button')
  clear.setAttribute('type', 'button')
  clear.setAttribute(CLEAR_ATTR, '')
  clear.setAttribute(KEY_ATTR, key)
  return clear
}

function buildSearch(key) {
  const row = doc.createElement('div')
  row.setAttribute(SEARCH_ATTR, '')
  row.setAttribute(KEY_ATTR, key)

  const field = doc.createElement('input')
  field.setAttribute('type', 'text')
  field.setAttribute(FIELD_ATTR, '')
  field.setAttribute(KEY_ATTR, key)
  field.setAttribute('autocomplete', 'off')
  field.setAttribute('spellcheck', 'false')
  row.appendChild(field)

  /* Polite, so a row disappearing under the reader's hands is announced rather
   * than silent, and never interrupts what they are typing. */
  const status = doc.createElement('span')
  status.setAttribute(STATUS_ATTR, '')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  row.appendChild(status)

  return row
}

function ensureSearch(wrapper, key, name, state) {
  const existing = siblingWith(wrapper, SEARCH_ATTR, key)

  if (!state.search) {
    existing?.remove()
    return null
  }

  const row = existing ?? buildSearch(key)
  if (!existing) wrapper.parentElement?.insertBefore(row, wrapper)

  const field = childWith(row, FIELD_ATTR)
  if (field) {
    field.setAttribute('aria-label', `Search ${name}`)
    field.setAttribute('placeholder', `Find in ${name}`)
    if (field.value !== state.query) field.value = state.query
  }

  /* The clear affordance is there only while there is something to clear. */
  const status = childWith(row, STATUS_ATTR)
  let clear = childWith(row, CLEAR_ATTR)
  if (state.query && !clear) {
    clear = buildClear(key)
    row.insertBefore(clear, status)
  } else if (!state.query && clear) {
    clear.remove()
  }

  clear?.setAttribute('aria-label', `Clear the search of ${name}`)
  clear?.setAttribute('title', `Clear the search of ${name}`)

  return row
}

function setStatus(row, { shown, total }, query) {
  const status = childWith(row, STATUS_ATTR)
  if (!status) return

  const text = statusText(shown, total, query)
  /* Writing the same string still replaces the text node, which the observer
   * would read as a change and answer with another pass. */
  if (status.textContent !== text) status.textContent = text
}

function applyTable(wrapper, table, key, name, pass) {
  const state = stateFor(key)
  const parent = wrapper.parentElement

  if (parent?.setAttribute) {
    parent.setAttribute(ANCHOR_ATTR, '')
    pass.anchors.add(parent)
  }

  pass.controls.add(ensureSettings(wrapper, key, name, state))

  const panel = ensurePanel(wrapper, key, name, state)
  if (panel) pass.panels.add(panel)

  /* Rows are restored before the field that filtered them can go, so turning
   * the search off can never leave a row hidden behind a removed field. */
  const counts = applyFilter(table, state.search ? state.query : '', pass)

  const row = ensureSearch(wrapper, key, name, state)
  if (row) {
    pass.searches.add(row)
    setStatus(row, counts, state.query)
  }
}

/* One pass over every table Logseq currently renders in the main editor. Read
 * in document order, so two tables in the same block always get the same two
 * ordinals however many times this runs, and the number each one is called by
 * counts up the page the way a reader would. A table the pass does not reach —
 * because its block was deleted, its content no longer renders a table, or the
 * block is being edited — gives back its marks, its controls and its field in
 * the same pass; its state is kept, so the render that returns comes back
 * searched. */
function markTables() {
  const marked = new Set()
  const live = new Set()
  const counts = new Map()
  const pass = { anchors: new Set(), controls: new Set(), panels: new Set(), searches: new Set(), filtered: new Set() }
  let position = 0

  for (const root of doc.querySelectorAll(MAIN_EDITOR_SELECTOR)) {
    for (const table of root.querySelectorAll('table')) {
      const wrapper = table.parentElement
      if (!wrapper || typeof wrapper.matches !== 'function' || !wrapper.matches(TABLE_WRAPPER_SELECTOR)) continue

      const uuid = blockUuid(table)
      const ordinal = counts.get(uuid) ?? 0
      counts.set(uuid, ordinal + 1)
      position += 1

      const key = `${uuid}:${ordinal}`
      wrapper.setAttribute(TABLE_ATTR, key)
      marked.add(wrapper)
      live.add(key)

      applyTable(wrapper, table, key, `table ${position}`, pass)
    }
  }

  for (const wrapper of doc.querySelectorAll(`[${TABLE_ATTR}]`)) {
    if (marked.has(wrapper)) continue

    /* A stale wrapper left behind by a re-render carries the key the table
     * that replaced it is now using; only a key no table answers to any more
     * gives up its state. */
    const key = wrapper.getAttribute(TABLE_ATTR)
    if (!live.has(key)) tableState.delete(key)
    wrapper.removeAttribute(TABLE_ATTR)
  }

  release(pass)
}

/* Anything this plugin wrote that this pass did not reuse belongs to a table
 * that is no longer rendered. Nodes go, marks are dropped, and the rows they
 * hid come back. */
function release(pass) {
  for (const control of doc.querySelectorAll(`[${SETTINGS_ATTR}]`)) {
    if (!pass.controls.has(control)) control.remove()
  }

  for (const panel of doc.querySelectorAll(`[${PANEL_ATTR}]`)) {
    if (!pass.panels.has(panel)) panel.remove()
  }

  for (const row of doc.querySelectorAll(`[${SEARCH_ATTR}]`)) {
    if (!pass.searches.has(row)) row.remove()
  }

  for (const row of doc.querySelectorAll(`[${FILTERED_ATTR}]`)) {
    if (!pass.filtered.has(row)) row.removeAttribute(FILTERED_ATTR)
  }

  for (const anchor of doc.querySelectorAll(`[${ANCHOR_ATTR}]`)) {
    if (!pass.anchors.has(anchor)) anchor.removeAttribute(ANCHOR_ATTR)
  }
}

/* The sandbox is an unrendered iframe, so its own rAF never fires; the host
 * window's does. Coalescing per frame keeps a burst of edit-mode mutations
 * down to one pass, the way the theme's and Passage's entries do. */
let queued = false
function repaint() {
  if (queued) return
  queued = true
  parent.requestAnimationFrame(() => {
    queued = false
    markTables()
  })
}

function focusIn(attribute, key) {
  for (const element of doc.querySelectorAll(`[${attribute}]`)) {
    if (element.getAttribute(KEY_ATTR) === key) return element.focus?.()
  }
}

function closePanels() {
  let closed = false

  for (const state of tableState.values()) {
    if (!state.open) continue
    state.open = false
    closed = true
  }

  if (closed) markTables()
  return closed
}

function togglePanel(control) {
  const key = control.getAttribute(KEY_ATTR)
  const state = tableState.get(key)
  if (!state) return

  const open = !state.open
  /* One panel at a time: opening this one dismisses any other. */
  for (const [other, value] of tableState) value.open = other === key && open

  markTables()
  /* The press was taken before the host could move focus, so the control is
   * handed it here — which is also where focus returns when the panel is
   * dismissed from the keyboard. */
  focusIn(SETTINGS_ATTR, key)
}

function toggleSearch(toggle) {
  const key = toggle.getAttribute(KEY_ATTR)
  const state = tableState.get(key)
  if (!state) return

  state.search = !state.search
  /* Turning it off clears what the field held, so it never comes back holding
   * a search the reader has closed. */
  if (!state.search) state.query = ''

  markTables()
  if (state.search) focusIn(FIELD_ATTR, key)
  else focusIn(TOGGLE_ATTR, key)
}

function clearSearch(clear) {
  const key = clear.getAttribute(KEY_ATTR)
  const state = tableState.get(key)
  if (!state) return

  state.query = ''
  markTables()
  focusIn(FIELD_ATTR, key)
}

/* Every node this plugin hangs in the host document sits inside rendered block
 * content, where a click of Logseq's own opens the block for editing and Enter
 * or Space reaches its shortcut handling. Taking these events in the capture
 * phase, before React's root container sees them, is what keeps each control
 * to itself. */
function chromeOf(target) {
  return target?.closest?.(`[${SETTINGS_ATTR}], [${PANEL_ATTR}], [${SEARCH_ATTR}]`) ?? null
}

function onPointer(event) {
  const target = event.target
  const chrome = chromeOf(target)

  if (!chrome) {
    /* A click anywhere else dismisses an open panel, and is otherwise left
     * entirely to Logseq. */
    if (event.type === 'click') closePanels()
    return
  }

  event.stopPropagation()

  /* The field is the one place a press must still reach its own element: a
   * prevented `mousedown` puts no caret in an input. Stopping the event is all
   * that is needed to keep the block out of edit mode. */
  if (!target.closest?.(`[${FIELD_ATTR}]`)) event.preventDefault()
  if (event.type !== 'click') return

  const settings = target.closest?.(`[${SETTINGS_ATTR}]`)
  if (settings) return togglePanel(settings)

  const toggle = target.closest?.(`[${TOGGLE_ATTR}]`)
  if (toggle) return toggleSearch(toggle)

  const clear = target.closest?.(`[${CLEAR_ATTR}]`)
  if (clear) return clearSearch(clear)
}

function onKeyDown(event) {
  const chrome = chromeOf(event.target)
  if (!chrome) return

  event.stopPropagation()

  if (event.key === 'Escape') {
    event.preventDefault()
    if (closePanels()) focusIn(SETTINGS_ATTR, chrome.getAttribute(KEY_ATTR))
    return
  }

  /* A field takes its own keys, space included. */
  if (event.target.closest?.(`[${FIELD_ATTR}]`)) return
  if (event.key !== 'Enter' && event.key !== ' ') return

  const control = event.target.closest?.(`[${SETTINGS_ATTR}], [${TOGGLE_ATTR}], [${CLEAR_ATTR}]`)
  if (!control) return

  event.preventDefault()
  if (control.matches(`[${SETTINGS_ATTR}]`)) togglePanel(control)
  else if (control.matches(`[${TOGGLE_ATTR}]`)) toggleSearch(control)
  else clearSearch(control)
}

/* The key that opened a control has to be kept from Logseq on the way up as
 * well as on the way down. */
function onKeyUp(event) {
  if (chromeOf(event.target)) event.stopPropagation()
}

function onInput(event) {
  const field = event.target?.closest?.(`[${FIELD_ATTR}]`)
  if (!field) return

  event.stopPropagation()

  const state = tableState.get(field.getAttribute(KEY_ATTR))
  if (!state) return

  state.query = field.value ?? ''
  markTables()
}

const LISTENERS = [
  ['mousedown', onPointer],
  ['click', onPointer],
  ['keydown', onKeyDown],
  ['keyup', onKeyUp],
  ['input', onInput]
]

/* Everything this script writes lives in the host document, which outlives the
 * plugin, so unloading has to leave none of it behind — and only its own. */
let observer = null
function teardown() {
  observer?.disconnect()
  observer = null
  tableState.clear()

  for (const [type, handler] of LISTENERS) doc.removeEventListener?.(type, handler, true)

  release({ anchors: new Set(), controls: new Set(), panels: new Set(), searches: new Set(), filtered: new Set() })
  for (const wrapper of doc.querySelectorAll(`[${TABLE_ATTR}]`)) wrapper.removeAttribute(TABLE_ATTR)
}

function main() {
  logseq.provideStyle({ key: STYLE_KEY, style: STYLE })
  logseq.beforeunload?.(async () => teardown())

  for (const [type, handler] of LISTENERS) doc.addEventListener(type, handler, true)

  /* childList/subtree only: this observer must not see its own attribute
   * writes, or every pass would schedule another one. */
  const container = doc.body
  observer = new MutationObserver(repaint)
  observer.observe(container, { childList: true, subtree: true })

  repaint()
}

logseq.ready(main).catch(console.error)
