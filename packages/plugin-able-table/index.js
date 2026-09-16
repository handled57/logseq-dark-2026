/* Able Table: finds and keys every rendered Markdown table, hangs one settings
 * control on it, and — behind that control's one toggle — searches it in
 * place, a column at a time from its own header or across every cell at once,
 * and sorts it by any one of its columns.
 *
 * Everything here is display-only. Typing in a field hides the rows that do
 * not match by marking them; sorting moves rendered rows within the group they
 * were rendered in, remembering the order they arrived in so it can be handed
 * back. No row is removed or rewritten, no block is collapsed, and nothing at
 * all reaches the graph. Closing a field, dropping the sort or unloading the
 * plugin leaves the table exactly as Logseq rendered it.
 *
 * Keying a table by its block's UUID and its ordinal within that block —
 * rather than by the DOM node Logseq happens to have rendered right now — is
 * what lets a re-rendered table find state written against it earlier. Logseq
 * replaces rendered nodes constantly during ordinary editing and navigation,
 * so a search string kept against the element itself would be lost on the next
 * keystroke elsewhere on the page. The table is this plugin's only kind of
 * render, so the kind is constant and the key carries the two parts that vary;
 * a column filter is held under that key by the column's own index.
 *
 * That same key, under the graph it was read in, is what a table's settings
 * are remembered by between sessions: the two switches, the search, the sort
 * and every committed filter are written to this plugin's own settings file
 * and read back when the table renders again. That file is Logseq's dotdir,
 * not the graph — searching, sorting or filtering a table still changes no
 * Markdown, no block and no property, and still writes nothing any graph
 * tracks.
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
const NOTE_ATTR = 'data-able-note'
const OPTION_ATTR = 'data-able-option'
const HEAD_ATTR = 'data-able-head'
const COLUMN_ATTR = 'data-able-column'
const COLUMN_CONTROL_ATTR = 'data-able-column-control'
const MENU_ATTR = 'data-able-column-menu'
const ITEM_ATTR = 'data-able-menu-item'
const ACTION_ATTR = 'data-able-action'
const COLUMN_FILTER_ATTR = 'data-able-column-filter'
const COLUMN_TERM_ATTR = 'data-able-column-term'
const ICON_ATTR = 'data-able-icon'
const SORT_ATTR = 'data-able-sort'
const ROW_ATTR = 'data-able-row'
const FILTERED_ATTR = 'data-able-filtered'
const KEY_ATTR = 'data-able-key'
const PANEL_TOP_PROPERTY = '--able-panel-top'
const MENU_TOP_PROPERTY = '--able-menu-top'
const MENU_LEFT_PROPERTY = '--able-menu-left'

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
[data-able-field]:focus-visible,
[data-able-column-control]:focus-visible,
[data-able-menu-item]:focus-visible,
[data-able-column-filter]:focus-visible,
[data-able-column-term]:focus-visible {
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

[data-able-note] {
  max-width: 14rem;
  margin: 0.25rem 0 0;
  padding: 0 0.25rem;
  font-size: 0.75rem;
  line-height: 1.4;
  opacity: 0.8;
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

/* A header cell carrying a column control. The strip the control stands in is
 * reserved as padding, so the control never sits over the column name however
 * narrow the column is, and the name is never clickable: a click on the header
 * itself still belongs to Logseq. The reserved strip is the one thing this
 * feature changes about the table's own layout, and it changes it when the
 * reader turns the feature on rather than as they use it. */
#main-content-container [data-able-head] {
  position: relative;
  padding-right: 1.5rem;
  /* A table cell is laid out vertically centred, so an uneven header row —
   * one column's name wrapping, or a committed filter under it — drags every
   * other name down past the line its own control is set on. Opening the
   * names at the top of the row instead keeps the control and the name it
   * belongs to on one line in every column. */
  vertical-align: top;
}

/* Pinned to the right of the cell — inside the divider, beside the name
 * rather than under it — so a wrapped name or a committed filter never moves
 * it. It is drawn in cyan rather than in the host's accent: one colour means
 * "filter this column" whatever theme is running, it is nothing the header's
 * own text can be, and it does not go amber under a theme whose accent is. It
 * fills the strip the header reserves for it — 1.25rem inside 1.5rem, the size
 * the theme's own controls are drawn at — so making it easier to see costs the
 * table no width it had not already given up.
 *
 * Vertically it is set on the name's own first line rather than against the
 * top of the cell, so the funnel and the column it filters read as one line.
 * Logseq pads a header cell by \`10px 8px\` and sets it in 14px on the
 * document's 1.5 line height, which puts the middle of that first line 20.5px
 * down; the control is 20px tall, so opening it at the cell's own top padding
 * centres it within half a pixel of the name. A name that wraps, or a
 * committed filter below it, leaves the control on that first line. */
[data-able-column-control] {
  position: absolute;
  top: 0.625rem;
  right: 0.25rem;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  margin: 0;
  padding: 0;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
  color: #6fc3df;
  background: var(--ls-secondary-background-color, #0a0a0a);
  border: 1px solid transparent;
  border-radius: 2px;
  cursor: pointer;
}

/* The same cyan taken down to where it can still be read: a light host draws
 * the header behind this control in near-white, and a cyan bright enough for a
 * dark theme all but disappears on it. Logseq marks the host element itself,
 * so the rule answers the setting rather than the operating system. */
html[data-theme=light] [data-able-column-control] {
  color: #0f6b8a;
}

[data-able-column-control]::after {
  content: "\\22ee";
}

/* A funnel says what the menu behind the control is for, and tells it apart
 * from the table's own settings control. The face carries one weight, so the
 * bold the ellipsis is set in is handed back here. */
[data-able-column-control][data-able-icon="filter"]::after {
  content: "\\eaa5";
  font-family: tabler-icons;
  font-weight: 400;
}

/* A column this table is sorted by says so on its own control, in place of the
 * funnel: one arrow, pointing the way the column now reads. It is drawn in the
 * document's own face rather than the icon face, so it is there whether or not
 * the host loaded Tabler Icons, and it is declared after the funnel so it wins
 * the glyph on a column that is both sorted and filtered — what that column is
 * filtered by is already written under its name. */
[data-able-column-control][data-able-sort='asc']::after {
  content: "\\2191";
  font-family: inherit;
  font-weight: 700;
}

[data-able-column-control][data-able-sort='desc']::after {
  content: "\\2193";
  font-family: inherit;
  font-weight: 700;
}

/* The menu's own sort items carry their state as a mark rather than as a
 * colour, so the one that is on reads the same under every host theme. */
[data-able-menu-item][aria-checked='true'] {
  font-weight: 700;
}

[data-able-menu-item][aria-checked='true']::after {
  content: "\\00a0\\2713";
}

/* The control is drawn at full strength already, so hovering it, opening its
 * menu or giving it focus outlines the box it stands in rather than
 * brightening the glyph. */
[data-able-head]:hover > [data-able-column-control],
[data-able-column-control][aria-expanded="true"],
[data-able-column-control]:hover,
[data-able-column-control]:focus-visible {
  border-color: var(--ls-border-color, #6b6b6b);
}

/* The menu is rendered beside the wrapper rather than in the cell, for the
 * same reason the settings panel is: the wrapper is an \`overflow: auto\`
 * scroller, and a menu inside it would be clipped by the table's own
 * scrolling. Both offsets are measured from the control it belongs to, and
 * kept inside the block's own box, so a menu on the last column opens inward
 * rather than off the edge and one on the first column never runs off the
 * other side. */
[data-able-column-menu] {
  position: absolute;
  top: var(--able-menu-top, 0px);
  left: var(--able-menu-left, 0px);
  z-index: 4;
  min-width: 9rem;
  padding: 0.25rem;
  color: var(--ls-primary-text-color, #e7e7e7);
  background: var(--ls-secondary-background-color, #0a0a0a);
  border: 1px solid var(--ls-border-color, #6b6b6b);
  border-radius: 2px;
}

[data-able-menu-item] {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0.25rem 0.375rem;
  font-family: inherit;
  font-size: 0.8125rem;
  line-height: 1.4;
  text-align: left;
  white-space: nowrap;
  color: inherit;
  background: none;
  border: 0;
  border-radius: 2px;
  cursor: pointer;
}

[data-able-menu-item]:hover {
  background: var(--ls-primary-background-color, #000000);
}

/* The rule between how the table is ordered and what is searched or dropped in
 * it. It is one hairline in the host's own border colour rather than a gap,
 * so the two halves of the menu read as two groups at a glance; it carries no
 * item mark, so it is never focused, walked past with the arrow keys or
 * pressed. */
[data-able-column-menu] > [role="separator"] {
  height: 1px;
  margin: 0.25rem 0.375rem;
  background: var(--ls-border-color, #6b6b6b);
  opacity: 0.6;
}

/* The field stands in for the column name only: it stops at the control's
 * strip, so the menu that opened it is still there to be used. */
[data-able-column-filter] {
  position: absolute;
  /* Stretched between its insets rather than given a width: a width would
   * over-constrain the box and the right inset — the control's strip — would
   * be dropped. */
  inset: 0 1.5rem 0 0;
  z-index: 1;
  box-sizing: border-box;
  min-width: 0;
  margin: 0;
  padding: 0 0.25rem;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: normal;
  color: var(--ls-primary-text-color, #e7e7e7);
  background: var(--ls-primary-background-color, #000000);
  border: 1px solid var(--ls-active-primary-color, #6fc3df);
  border-radius: 2px;
}

/* The committed filter, in flow under the column name. A zero preferred width
 * with a percentage floor lays the line out across the cell rather than across
 * its own text, and \`anywhere\` — the one overflow-wrap value that counts
 * toward intrinsic sizing — leaves the column's floor where the name's longest
 * word put it. A long filter can still change how the table shares its width
 * between columns; what it cannot do is widen the table past the wrapper and
 * put a horizontal scrollbar on a table that had none. */
[data-able-column-term] {
  display: block;
  width: 0;
  min-width: 100%;
  margin: 0.125rem 0 0;
  padding: 0;
  font-family: inherit;
  font-size: 0.6875rem;
  font-weight: normal;
  line-height: 1.4;
  text-align: inherit;
  text-decoration: none;
  color: inherit;
  background: none;
  border: 0;
  cursor: pointer;
  opacity: 0.8;
  word-break: normal;
  overflow-wrap: anywhere;
}

/* Drawn before the term, so the line reads as the thing that drops it. */
[data-able-column-term]::before {
  content: "\\00d7\\00a0";
}

[data-able-column-term]:hover {
  opacity: 1;
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
 * off and no column filtered; nothing here is read from or written to the
 * graph, and it is discarded on unload and rebuilt from the render on the next
 * load.
 *
 * `search` and `columns` are the panel's two toggles. `filters` holds one
 * committed term per column index, `editing` the one field that is open on
 * this table, if any, with what it currently holds, `menu` the column whose
 * menu is open, and `sort` the one column the table is ordered by and the
 * direction it is read in. `names` remembers each column's name, read while the
 * cell was still the one Logseq rendered, so a field covering a name can still
 * be labelled with it. */
const tableState = new Map()

function stateFor(key) {
  const existing = tableState.get(key)
  if (existing) return existing

  const created = {
    open: false,
    search: false,
    columns: false,
    query: '',
    filters: new Map(),
    names: new Map(),
    editing: null,
    menu: null,
    sort: null
  }

  tableState.set(key, created)
  return restore(created, key)
}

/* What a table is remembered by between sessions, and where.
 *
 * The store is this plugin's own settings object, which Logseq keeps in its
 * dotdir — `settings/logseq-able-table.json` beside the application's own
 * preferences — rather than anywhere in the graph. That is the whole point of
 * reaching for it: a reader who has tuned a table wants it tuned again next
 * time, and nobody wants their Markdown, a block or a property rewritten to
 * say so. A graph synced to another machine carries none of this, which is the
 * right answer for a display preference.
 *
 * Everything lives under one key, as a branch per graph and a record per
 * table, so one write says the whole truth: the host merges what it is given
 * over the settings it holds, one level deep, and handing it the whole tree is
 * what lets a table that no longer remembers anything drop out of it.
 *
 * Only what a reader chose is kept — a table left at its defaults writes no
 * record at all — so the store stays about as long as the list of tables
 * somebody has actually tuned. What it does not do is notice that a block was
 * deleted: a record outlives the table it belongs to, costing a few dozen
 * bytes, and there is no way to tell that block from one on a page nobody has
 * opened yet. */
const STORE_KEY = 'tables'

/* Long enough that typing into a field is one write rather than one per
 * keystroke, short enough that it has happened by the time anyone could act on
 * it. Anything still waiting is written out on unload. */
const SAVE_DELAY = 400

let persisted = {}

/* Which graph is open, or `null` while the host has not said yet. Resolving it
 * takes a round trip, which is longer than the first render takes: a table
 * that renders in the meantime opens at its defaults and is restored the
 * moment the answer arrives, and nothing is written until then, so a record
 * can never land in the wrong graph's branch. */
let graph = null

const DIRECTIONS = new Set(['asc', 'desc'])

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function branchFor(create) {
  const existing = plainObject(persisted[graph])
  if (existing) return existing
  if (!create) return null

  const created = {}
  persisted[graph] = created
  return created
}

/* Reading the store is total: every field is checked on its own, and anything
 * that is not what it should be is treated as absent rather than raised. The
 * file is a plain JSON file a person can open and edit, and a version of this
 * plugin that has not been written yet may have left fields here that this one
 * does not know — neither is a reason to render a table wrongly, or at all
 * differently from one nothing was ever stored for. */
function restore(state, key) {
  const record = plainObject(branchFor(false)?.[key])
  if (!record) return state

  state.search = record.search === true
  state.columns = record.columns === true
  state.query = state.search && typeof record.query === 'string' ? record.query : ''

  const sort = plainObject(record.sort)
  const index = sort ? Number(sort.index) : Number.NaN
  state.sort =
    Number.isInteger(index) && index >= 0 && DIRECTIONS.has(sort.direction)
      ? { index, direction: sort.direction }
      : null

  for (const [at, term] of Object.entries(plainObject(record.filters) ?? {})) {
    const column = Number(at)
    const value = typeof term === 'string' ? collapse(term) : ''
    if (Number.isInteger(column) && column >= 0 && value) state.filters.set(column, value)
  }

  return state
}

/* What is worth remembering about a table, or nothing at all. The panel being
 * open, the field being edited and the menu being down are all left out: they
 * are the transient half of the state, discarded on every re-render already,
 * and a reader returning to a page does not want its menus waiting for them. */
function snapshot(state) {
  const record = {}

  if (state.search) record.search = true
  if (state.columns) record.columns = true
  if (state.search && state.query) record.query = state.query
  if (state.sort) record.sort = { index: state.sort.index, direction: state.sort.direction }

  if (state.filters.size) {
    const filters = {}
    for (const [index, term] of state.filters) filters[index] = term
    record.filters = filters
  }

  return Object.keys(record).length ? record : null
}

function remember(key, state) {
  if (graph === null) return

  const branch = branchFor(true)
  const record = snapshot(state)

  /* Most passes change nothing, and a pass that changed nothing must not cost
   * a file write: what the store already says is compared with what it would
   * say now, and only a real difference is queued. */
  if (JSON.stringify(branch[key] ?? null) === JSON.stringify(record)) return

  if (record) branch[key] = record
  else delete branch[key]

  queueSave()
}

let saving = null

function flush() {
  if (saving === null) return

  parent.clearTimeout(saving)
  saving = null

  try {
    logseq.updateSettings({ [STORE_KEY]: persisted })
  } catch (error) {
    /* A store that cannot be written is a table that opens at its defaults
     * next time, which is a great deal better than one that does not open. */
    console.warn('[able-table] could not save table settings', error)
  }
}

function queueSave() {
  if (saving !== null) return
  saving = parent.setTimeout(flush, SAVE_DELAY)
}

/* The host's answer to which graph is open, and the tables already rendered
 * while it was on its way. A table the reader has touched in that moment keeps
 * what they did — it is the only one whose state says anything — and every
 * other one is restored from the store before the pass that follows. */
async function scopeGraph() {
  try {
    const current = await logseq.App?.getCurrentGraph?.()
    graph = (typeof current?.url === 'string' && current.url) || ''
  } catch {
    graph = ''
  }

  for (const [key, state] of tableState) {
    if (!snapshot(state)) restore(state, key)
  }

  markTables()
}

/* Switching graphs inside the app does not reload this plugin, so the branch
 * every table is read from and written to has to change under it. What is
 * waiting goes to the graph it was read in, and every table starts again. */
async function regraph() {
  flush()
  tableState.clear()
  graph = null
  await scopeGraph()
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

function collapse(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/* One predictable rule: a case-insensitive substring test over the rendered
 * text, with runs of whitespace collapsed to one space so a value wrapped
 * across lines in the markup still reads as the words it renders as. */
function normalise(text) {
  return collapse(text).toLowerCase()
}

function cellsOf(row) {
  const cells = []
  for (const cell of row?.children ?? []) cells.push(cell)
  return cells
}

/* A row reads as its cells with a space between them, never as the row's own
 * `textContent`: a browser concatenates cells with nothing in between, so a
 * row rendering `| Ada | Lovelace |` would read as `AdaLovelace` and a reader
 * typing what they can see would find nothing. A row with no cells at all —
 * not a shape Logseq renders — falls back to its text. */
function rowText(row, cells) {
  if (cells.length) return cells.map((cell) => cell.textContent ?? '').join(' ')
  return row.textContent ?? ''
}

function matchesRow(row, needle, filters) {
  const cells = cellsOf(row)

  if (needle && !normalise(rowText(row, cells)).includes(needle)) return false

  for (const [index, term] of filters) {
    /* Cells are matched to columns by index, and a row with no cell at that
     * index — a ragged or spanned row, which Markdown cannot write but pasted
     * HTML can — matches nothing rather than everything. */
    if (!normalise(cells[index]?.textContent).includes(term)) return false
  }

  return true
}

/* Every column term narrowing the table right now, normalised once. The column
 * whose field is open counts as what that field holds rather than as what it
 * last committed, so the table narrows as the reader types and widens again as
 * they backspace. */
function activeFilters(state) {
  const active = []

  for (const [index, term] of state.filters) {
    if (state.editing?.index === index) continue
    const needle = normalise(term)
    if (needle) active.push([index, needle])
  }

  if (state.editing) {
    const needle = normalise(state.editing.draft)
    if (needle) active.push([state.editing.index, needle])
  }

  return active
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

/* Sorting is the one thing this plugin does that moves a node Logseq rendered,
 * so the order they were rendered in is written down before the first move:
 * every body row is stamped with its position within the group it arrived in,
 * and no row is ever stamped twice. Dropping the sort, turning the columns off
 * or unloading the plugin puts the rows back in that order and takes the
 * stamps off again, which is what keeps a display-only feature display-only. */
function groupsOf(rows) {
  const groups = new Map()

  for (const row of rows) {
    const parent = row.parentElement
    if (!parent) continue

    const group = groups.get(parent)
    if (group) group.push(row)
    else groups.set(parent, [row])
  }

  return groups
}

function stampRows(group) {
  for (const [at, row] of group.entries()) {
    if (row.getAttribute(ROW_ATTR) === null) row.setAttribute(ROW_ATTR, String(at))
  }
}

function renderedAt(row) {
  return Number(row.getAttribute(ROW_ATTR) ?? 0)
}

/* One predictable rule, read off the cell in that column: the reader's own
 * collation, case- and accent-insensitive like the search is, with runs of
 * digits compared as numbers so `Item 2` comes before `Item 10` and a column
 * of numbers sorts as numbers rather than as text. */
function compareCells(a, b, index) {
  const left = collapse(cellsOf(a)[index]?.textContent)
  const right = collapse(cellsOf(b)[index]?.textContent)

  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

/* Rows that read the same in the sorted column keep the order they were
 * rendered in, so sorting by one column never shuffles what the reader could
 * already see in the others — and sorting the same column twice puts the table
 * in the same order both times. */
function sortedRows(group, sort) {
  const rows = [...group]
  if (!sort) return rows.sort((a, b) => renderedAt(a) - renderedAt(b))

  const direction = sort.direction === 'desc' ? -1 : 1
  return rows.sort((a, b) => compareCells(a, b, sort.index) * direction || renderedAt(a) - renderedAt(b))
}

/* The rows are placed into the slots they already occupy, in the wanted order,
 * so nothing but a body row moves and a headless table's first row — which
 * stands in for a head — keeps its place at the top of the group.
 *
 * A row already in its slot is left alone. That matters: the observer that
 * schedules this pass sees the moves it makes, and a pass that reordered an
 * already sorted table would schedule another one for ever. */
function orderRows(parent, group, wanted) {
  let at = 0

  for (const row of wanted) {
    const children = parent.children ?? []
    while (at < children.length && !group.has(children[at])) at += 1

    const slot = children[at] ?? null
    if (slot !== row) parent.insertBefore(row, slot)
    at += 1
  }
}

function applySort(table, state, pass) {
  const rows = bodyRows(table)

  /* A table nobody has sorted is left exactly as Logseq rendered it: no stamp
   * is written until the first sort, and no order is restored unless there is
   * a stamp saying what to restore it to. */
  if (!state.sort && !rows.some((row) => row.getAttribute(ROW_ATTR) !== null)) return

  for (const [parent, group] of groupsOf(rows)) {
    if (state.sort) stampRows(group)
    orderRows(parent, new Set(group), sortedRows(group, state.sort))
  }

  for (const row of rows) {
    if (state.sort) pass.rows.add(row)
    else row.removeAttribute(ROW_ATTR)
  }
}

/* The search and every column filter are answered in one pass, conjunctively:
 * a row is shown when it satisfies all of them, in whatever order they were
 * applied. */
function applyFilter(table, state, pass) {
  const needle = normalise(state.search ? state.query : '')
  const filters = activeFilters(state)
  const rows = bodyRows(table)
  let shown = 0

  for (const row of rows) {
    if (!matchesRow(row, needle, filters)) {
      row.setAttribute(FILTERED_ATTR, '')
      pass.filtered.add(row)
      continue
    }

    row.removeAttribute(FILTERED_ATTR)
    shown += 1
  }

  return { shown, total: rows.length, narrowed: Boolean(needle) || filters.length > 0 }
}

function statusText({ shown, total, narrowed }) {
  const rows = total === 1 ? 'row' : 'rows'
  if (!narrowed) return `${total} ${rows}`
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

/* What the panel says about the table under it. A Markdown table renders a
 * head only where it declares a header separator row, and a table with no head
 * has no column names to filter by; saying so is the difference between a
 * feature that is missing and one that is broken. */
const COLUMN_NOTE = 'A menu on every column header sorts and searches that column.'
const NO_COLUMN_NOTE = 'This table renders no header row, so only full table search is available.'

/* What the full table search field says while it is empty. */
const FIELD_HINT = 'Find in table'

/* The panel's switches, in the order they are read. `columns` is offered only
 * to a table that renders a head. */
const OPTIONS = [
  { name: 'search', label: 'Full table search' },
  { name: 'columns', label: 'Columns' }
]

function buildToggle(key, option) {
  const toggle = doc.createElement('button')
  toggle.setAttribute('type', 'button')
  toggle.setAttribute(TOGGLE_ATTR, '')
  toggle.setAttribute(KEY_ATTR, key)
  toggle.setAttribute(OPTION_ATTR, option.name)
  toggle.setAttribute('role', 'switch')
  toggle.textContent = option.label
  return toggle
}

function optionIn(panel, name) {
  for (const child of panel?.children ?? []) {
    if (child.matches?.(`[${TOGGLE_ATTR}]`) && child.getAttribute?.(OPTION_ATTR) === name) return child
  }

  return null
}

function buildPanel(key) {
  const panel = doc.createElement('div')
  panel.setAttribute(PANEL_ATTR, '')
  panel.setAttribute(KEY_ATTR, key)
  panel.setAttribute('role', 'group')

  for (const option of OPTIONS) panel.appendChild(buildToggle(key, option))

  const note = doc.createElement('p')
  note.setAttribute(NOTE_ATTR, '')
  panel.appendChild(note)

  return panel
}

/* The panel is positioned against the wrapper's own parent, so where the
 * wrapper sits in that box is the one number the stylesheet cannot work out
 * for itself. */
function anchorPanel(panel, wrapper) {
  const top = wrapper.offsetTop
  if (typeof top === 'number') panel.style?.setProperty?.(PANEL_TOP_PROPERTY, `${top}px`)
}

function ensurePanel(wrapper, key, name, state, head) {
  const existing = siblingWith(wrapper, PANEL_ATTR, key)

  if (!state.open) {
    existing?.remove()
    return null
  }

  const panel = existing ?? buildPanel(key)
  if (!existing) insertAfter(panel, wrapper)

  panel.setAttribute('aria-label', `Search options for ${name}`)
  optionIn(panel, 'search')?.setAttribute('aria-checked', state.search ? 'true' : 'false')

  /* A table with no head is offered no column switch at all: a switch that
   * could be turned on and do nothing is worse than none. */
  const columns = optionIn(panel, 'columns')
  if (head) columns?.setAttribute('aria-checked', state.columns ? 'true' : 'false')
  else columns?.remove()

  const note = childWith(panel, NOTE_ATTR)
  const text = head ? COLUMN_NOTE : NO_COLUMN_NOTE
  if (note && note.textContent !== text) note.textContent = text

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
    /* The label names the table, because a screen reader meets this field with
     * nothing around it and several tables may be on the page. The hint does
     * not: the reader can see which table it belongs to, and a number that
     * counts up the page is one more thing to read for no gain. */
    field.setAttribute('aria-label', `Search ${name}`)
    field.setAttribute('placeholder', FIELD_HINT)
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

function setStatus(row, counts) {
  const status = childWith(row, STATUS_ATTR)
  if (!status) return

  const text = statusText(counts)
  /* Writing the same string still replaces the text node, which the observer
   * would read as a change and answer with another pass. */
  if (status.textContent !== text) status.textContent = text
}

/* Logseq renders a Markdown table's head as `thead > tr > th` and every body
 * group as `tbody > tr > td`, so the head row's cells are the columns a reader
 * can filter by. A table declaring no header separator row renders no `thead`
 * at all, and gives back no columns. */
function headCells(table) {
  const head = table.querySelector?.('thead')
  if (!head) return []

  for (const row of head.children ?? []) {
    if (row.tagName === 'TR') return cellsOf(row)
  }

  return []
}

/* The column's name, read while the cell is still the one Logseq rendered —
 * before a term line or a field of this plugin's is standing in it — and kept
 * against the column, so a field covering the name can still be labelled with
 * it. A render that replaces the cell takes this plugin's nodes with it, so
 * the next pass reads the new name from a clean cell. */
function columnName(cell, state, index) {
  if (!childWith(cell, COLUMN_TERM_ATTR) && !childWith(cell, COLUMN_FILTER_ATTR)) {
    state.names.set(index, collapse(cell.textContent))
  }

  return state.names.get(index) || `column ${index + 1}`
}

/* Logseq 0.10.15 links Tabler Icons from its own page, so the funnel the
 * control is drawn with is already in the host document: naming that face
 * costs no request, ships no file, and adds no dependency. What it cannot have
 * is a fallback — the glyph lives in the private use area, where a face that
 * is missing renders a replacement box rather than the next font's glyph — so
 * the runtime asks whether the face is really loaded and marks the control
 * only then. A host without it keeps the vertical ellipsis.
 *
 * `check` answers for a face that has finished loading, so a control built
 * before the host asked for it would keep the ellipsis; the answer is re-asked
 * each pass until it is yes, and `main` asks for the face to settle it. */
const ICON_FONT = '1rem tabler-icons'
let iconsLoaded = false
function iconFont() {
  if (iconsLoaded) return true

  try {
    iconsLoaded = doc.fonts?.check?.(ICON_FONT) === true
  } catch {
    iconsLoaded = false
  }

  return iconsLoaded
}

function buildControl(key, index) {
  const control = doc.createElement('button')
  control.setAttribute('type', 'button')
  control.setAttribute(COLUMN_CONTROL_ATTR, '')
  control.setAttribute(KEY_ATTR, key)
  control.setAttribute(COLUMN_ATTR, String(index))
  control.setAttribute('aria-haspopup', 'menu')
  return control
}

function buildTerm(key, index) {
  const term = doc.createElement('button')
  term.setAttribute('type', 'button')
  term.setAttribute(COLUMN_TERM_ATTR, '')
  term.setAttribute(KEY_ATTR, key)
  term.setAttribute(COLUMN_ATTR, String(index))
  return term
}

function buildColumnField(key, index) {
  const field = doc.createElement('input')
  field.setAttribute('type', 'text')
  field.setAttribute(COLUMN_FILTER_ATTR, '')
  field.setAttribute(KEY_ATTR, key)
  field.setAttribute(COLUMN_ATTR, String(index))
  field.setAttribute('autocomplete', 'off')
  field.setAttribute('spellcheck', 'false')
  return field
}

/* One header cell: marked, carrying its own menu control, the committed filter
 * under its name and — while it is the column being edited — the field that is
 * laid over it. All three are appended rather than substituted, so the cell's
 * own rendered markup is never moved, and the name itself is left alone: a
 * click on it is still Logseq's. */
function applyColumn(cell, key, index, state, pass) {
  const name = columnName(cell, state, index)

  cell.setAttribute(HEAD_ATTR, '')
  cell.setAttribute(KEY_ATTR, key)
  cell.setAttribute(COLUMN_ATTR, String(index))
  pass.columns.add(cell)

  const control = childWith(cell, COLUMN_CONTROL_ATTR) ?? cell.appendChild(buildControl(key, index))
  if (iconFont()) control.setAttribute(ICON_ATTR, 'filter')

  /* Which column the table is sorted by is said on the header itself, in the
   * one attribute a screen reader already knows to read, and drawn on that
   * column's own control as an arrow. */
  const direction = state.sort?.index === index ? state.sort.direction : ''
  if (direction) {
    cell.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending')
    control.setAttribute(SORT_ATTR, direction)
  } else {
    cell.removeAttribute('aria-sort')
    control.removeAttribute(SORT_ATTR)
  }

  const label = `Column options for ${name}`
  control.setAttribute('aria-expanded', state.menu === index ? 'true' : 'false')
  control.setAttribute('aria-label', label)
  control.setAttribute('title', label)
  pass.columnControls.add(control)

  const committed = state.filters.get(index) ?? ''
  let term = childWith(cell, COLUMN_TERM_ATTR)
  if (committed && !term) term = cell.appendChild(buildTerm(key, index))
  else if (!committed && term) {
    term.remove()
    term = null
  }

  if (term) {
    if (term.textContent !== committed) term.textContent = committed
    term.setAttribute('aria-label', `Clear the filter on ${name}`)
    term.setAttribute('title', `Clear the filter on ${name}`)
    pass.terms.add(term)
  }

  const editing = state.editing?.index === index
  let field = childWith(cell, COLUMN_FILTER_ATTR)
  if (editing && !field) field = cell.appendChild(buildColumnField(key, index))
  else if (!editing && field) {
    field.remove()
    field = null
  }

  if (field) {
    field.setAttribute('aria-label', `Search ${name}`)
    field.setAttribute('placeholder', name)
    /* Written only when it differs: assigning the same string still moves the
     * caret to the end of the field the reader is typing in. */
    if (field.value !== state.editing.draft) field.value = state.editing.draft
    pass.fields.add(field)
  }
}

/* The menu one column's control has open, built beside the wrapper and
 * measured against the control it belongs to.
 *
 * It reads in the order a reader reaches for: how the table is ordered first,
 * because sorting is the one thing here that is asked of every column and
 * costs nothing to undo, then a rule, then what narrows the table down.
 * Everything above the rule is always there; below it, `Find in column` always
 * is and `Clear filter` only while there is one to clear. */
const MENU_ITEMS = [
  { action: 'asc', label: 'Sort A-Z', direction: 'asc' },
  { action: 'desc', label: 'Sort Z-A', direction: 'desc' },
  { action: 'separator', separator: true },
  { action: 'search', label: 'Find in column' },
  /* Nothing to clear is not an item to press: it is hung and taken away with
   * the filter itself. */
  { action: 'clear', label: 'Clear filter', filtered: true }
]

function buildMenu(key, index) {
  const menu = doc.createElement('div')
  menu.setAttribute(MENU_ATTR, '')
  menu.setAttribute(KEY_ATTR, key)
  menu.setAttribute(COLUMN_ATTR, String(index))
  menu.setAttribute('role', 'menu')
  return menu
}

/* The rule between the menu's two halves. It carries the action it is known by
 * so the pass that maintains the menu finds it where it found everything else,
 * and it carries no item mark: the arrow keys, the press handlers and focus
 * all read that mark, so leaving it off is what makes this a line rather than
 * something to land on. */
function buildSeparator(key, index, action) {
  const rule = doc.createElement('div')
  rule.setAttribute(ACTION_ATTR, action)
  rule.setAttribute(KEY_ATTR, key)
  rule.setAttribute(COLUMN_ATTR, String(index))
  rule.setAttribute('role', 'separator')
  return rule
}

function buildItem(key, index, { action, label, direction, separator }) {
  if (separator) return buildSeparator(key, index, action)

  const item = doc.createElement('button')
  item.setAttribute('type', 'button')
  item.setAttribute(ITEM_ATTR, '')
  item.setAttribute(ACTION_ATTR, action)
  item.setAttribute(KEY_ATTR, key)
  item.setAttribute(COLUMN_ATTR, String(index))
  /* The two directions are one choice with a state, not two commands: a radio
   * is what says so, and what lets the item that is on be pressed again. */
  item.setAttribute('role', direction ? 'menuitemradio' : 'menuitem')
  item.textContent = label
  return item
}

function itemIn(menu, action) {
  for (const child of menu.children ?? []) {
    if (child.getAttribute?.(ACTION_ATTR) === action) return child
  }

  return null
}

/* The menu is positioned against the wrapper's own parent, like the panel, so
 * where the control sits inside the scrolling table is the one thing the
 * stylesheet cannot work out for itself. */
function anchorMenu(menu, control, anchor) {
  const controlBox = control?.getBoundingClientRect?.()
  const anchorBox = anchor?.getBoundingClientRect?.()
  const menuBox = menu.getBoundingClientRect?.()
  if (!controlBox || !anchorBox || !menuBox) return

  /* Right-aligned to its control, which is where a menu hung on the last
   * column has to open; where that would put it off the other edge — a menu
   * wider than the column it belongs to, on the first one — it opens from the
   * control's left instead, and is held inside the block either way. */
  const aligned = controlBox.right - anchorBox.left - menuBox.width
  const left = aligned < 0 ? controlBox.left - anchorBox.left : aligned

  menu.style?.setProperty?.(MENU_TOP_PROPERTY, `${controlBox.bottom - anchorBox.top + 2}px`)
  menu.style?.setProperty?.(
    MENU_LEFT_PROPERTY,
    `${Math.max(0, Math.min(left, Math.max(0, anchorBox.width - menuBox.width)))}px`
  )
}

function ensureMenu(wrapper, key, state, cells, pass) {
  const existing = siblingWith(wrapper, MENU_ATTR, key)
  const index = state.menu

  if (index === null || !cells[index]) {
    existing?.remove()
    return
  }

  const menu = existing?.getAttribute(COLUMN_ATTR) === String(index) ? existing : buildMenu(key, index)
  if (menu !== existing) {
    existing?.remove()
    insertAfter(menu, wrapper)
  }

  const name = state.names.get(index) || `column ${index + 1}`
  menu.setAttribute('aria-label', `Column options for ${name}`)

  for (const option of MENU_ITEMS) {
    const wanted = !option.filtered || state.filters.has(index)
    let item = itemIn(menu, option.action)

    if (wanted && !item) item = menu.appendChild(buildItem(key, index, option))
    else if (!wanted && item) {
      item.remove()
      item = null
    }

    if (!item || !option.direction) continue
    const on = state.sort?.index === index && state.sort.direction === option.direction
    item.setAttribute('aria-checked', on ? 'true' : 'false')
  }

  anchorMenu(menu, childWith(cells[index], COLUMN_CONTROL_ATTR), wrapper.parentElement)
  pass.menus.add(menu)
}

function applyColumns(table, key, state, pass) {
  const cells = headCells(table)

  /* No head is no column names, and a switch that is off is no columns either.
   * A filter the reader can no longer see beside the column it narrows, or
   * drop from its menu, is not one they can be left holding. */
  if (!cells.length || !state.columns) {
    state.filters.clear()
    state.editing = null
    state.menu = null
    state.sort = null
    return { head: cells.length > 0, cells: [] }
  }

  /* A table that has lost the column it was sorted by is read in the order it
   * was rendered in again, rather than by a column that is no longer there. */
  if (state.sort && !cells[state.sort.index]) state.sort = null

  /* A filter whose column has gone the same way is dropped on its own, and
   * everything else the reader set is left standing. Left in place it would be
   * a filter with nothing to read it beside, nothing to clear it from, and no
   * cell to match — which would hide every row in the table. Losing a column
   * happens when the block is edited, and now also when a filter stored
   * against an older shape of the table is read back into a newer one. */
  for (const index of [...state.filters.keys()]) {
    if (!cells[index]) state.filters.delete(index)
  }

  if (state.editing && !cells[state.editing.index]) state.editing = null

  for (const [index, cell] of cells.entries()) applyColumn(cell, key, index, state, pass)

  return { head: true, cells }
}

/* What an open field holds becomes the column's committed filter; an empty one
 * commits nothing and drops whatever that column held. */
function commit(state) {
  if (!state.editing) return

  const { index, draft } = state.editing
  const term = collapse(draft)
  state.editing = null

  if (term) state.filters.set(index, term)
  else state.filters.delete(index)
}

function applyTable(wrapper, table, key, name, pass) {
  const state = stateFor(key)
  const parent = wrapper.parentElement

  if (parent?.setAttribute) {
    parent.setAttribute(ANCHOR_ATTR, '')
    pass.anchors.add(parent)
  }

  pass.controls.add(ensureSettings(wrapper, key, name, state))

  /* The columns are read before anything is filtered by them, so a table that
   * has just lost its head, or a switch that has just been turned off, filters
   * by nothing. */
  const { head, cells } = applyColumns(table, key, state, pass)
  ensureMenu(wrapper, key, state, cells, pass)

  /* Sorted before the rows are counted and filtered, so what the search hides
   * and what the status says are read off the table in front of the reader. */
  applySort(table, state, pass)

  const panel = ensurePanel(wrapper, key, name, state, head)
  if (panel) pass.panels.add(panel)

  /* Rows are restored before the field that filtered them can go, so turning
   * the search off can never leave a row hidden behind a removed field. */
  const counts = applyFilter(table, state, pass)

  const row = ensureSearch(wrapper, key, name, state)
  if (row) {
    pass.searches.add(row)
    setStatus(row, counts)
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
function emptyPass() {
  return {
    anchors: new Set(),
    controls: new Set(),
    panels: new Set(),
    searches: new Set(),
    filtered: new Set(),
    rows: new Set(),
    columns: new Set(),
    columnControls: new Set(),
    menus: new Set(),
    terms: new Set(),
    fields: new Set()
  }
}

function markTables() {
  const marked = new Set()
  const live = new Set()
  const counts = new Map()
  const pass = emptyPass()
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

  /* A table the pass did not reach is not rendered right now: its block is
   * being edited, or the page has moved on. The field that was open goes with
   * that render, so what it held is committed rather than dropped, and the
   * table comes back filtered by what the reader last typed. */
  for (const [key, state] of tableState) {
    if (state.editing && !live.has(key)) commit(state)
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

  /* Every pass ends by saying what each table it still holds is set to. One
   * place rather than one per control: a toggle, a sort, a committed filter
   * and a keystroke in a field all end up here, and what is written out is
   * whatever the pass that answered them left behind. Giving up a table's
   * in-memory state above is not forgetting it — that state is rebuilt from
   * the store the next time the table renders. */
  for (const [key, state] of tableState) remember(key, state)

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

  for (const control of doc.querySelectorAll(`[${COLUMN_CONTROL_ATTR}]`)) {
    if (!pass.columnControls.has(control)) control.remove()
  }

  for (const menu of doc.querySelectorAll(`[${MENU_ATTR}]`)) {
    if (!pass.menus.has(menu)) menu.remove()
  }

  for (const field of doc.querySelectorAll(`[${COLUMN_FILTER_ATTR}]`)) {
    if (!pass.fields.has(field)) field.remove()
  }

  for (const term of doc.querySelectorAll(`[${COLUMN_TERM_ATTR}]`)) {
    if (!pass.terms.has(term)) term.remove()
  }

  /* A header cell is Logseq's own node, so what is given back is every
   * attribute this plugin wrote on it rather than the cell itself. */
  for (const cell of doc.querySelectorAll(`[${HEAD_ATTR}]`)) {
    if (pass.columns.has(cell)) continue
    for (const attribute of [HEAD_ATTR, KEY_ATTR, COLUMN_ATTR, 'aria-sort']) cell.removeAttribute(attribute)
  }

  /* A stamped row this pass did not reach belongs to a table that is no longer
   * rendered, or to a plugin that is unloading: it goes back where it was
   * rendered and gives its stamp back, so nothing of a sort outlives the
   * feature that applied it. */
  const stale = []
  for (const row of doc.querySelectorAll(`[${ROW_ATTR}]`)) {
    if (!pass.rows.has(row)) stale.push(row)
  }

  for (const [parent, group] of groupsOf(stale)) {
    orderRows(parent, new Set(group), sortedRows(group, null))
  }

  for (const row of stale) row.removeAttribute(ROW_ATTR)

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

/* This plugin's own nodes are found by the key they carry rather than by where
 * they sit, because the render they sit in is replaced under them. A column's
 * chrome carries its index as well. */
function nodeFor(attribute, key, index) {
  for (const element of doc.querySelectorAll(`[${attribute}]`)) {
    if (element.getAttribute(KEY_ATTR) !== key) continue
    if (index !== undefined && element.getAttribute(COLUMN_ATTR) !== String(index)) continue
    return element
  }

  return null
}

function focusIn(attribute, key, index) {
  nodeFor(attribute, key, index)?.focus?.()
}

function focusOption(key, name) {
  for (const toggle of doc.querySelectorAll(`[${TOGGLE_ATTR}]`)) {
    if (toggle.getAttribute(KEY_ATTR) !== key || toggle.getAttribute(OPTION_ATTR) !== name) continue
    return toggle.focus?.()
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

/* The reader scrolled: a menu measured against a control that has moved is
 * pointing at nothing, so it goes. */
function onScroll() {
  closeMenus()
}

/* A click on the page is the reader moving on: an open panel is dismissed, and
 * an open field commits what it holds, exactly as losing focus would — which,
 * where the click landed on something focusable, it also has. */
function dismiss() {
  let changed = false

  for (const state of tableState.values()) {
    if (state.editing) {
      commit(state)
      changed = true
    }

    if (state.open || state.menu !== null) {
      state.open = false
      state.menu = null
      changed = true
    }
  }

  if (changed) markTables()
  return changed
}

/* One popup at a time, whichever kind it is: a column menu dismisses the
 * settings panel and any other column's menu, and the panel dismisses every
 * menu. */
function closeMenus() {
  let closed = false

  for (const state of tableState.values()) {
    if (state.menu === null) continue
    state.menu = null
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
  /* One popup at a time: opening this panel dismisses every other panel and
   * every column menu. */
  for (const [other, value] of tableState) {
    value.open = other === key && open
    value.menu = null
  }

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
   * a search the reader has closed. The column filters are not its to clear. */
  if (!state.search) state.query = ''

  markTables()
  if (state.search) focusIn(FIELD_ATTR, key)
  else focusOption(key, 'search')
}

/* The switch the whole column feature hangs off. Turning it off takes away
 * every control, menu, field and committed filter on that table, and gives
 * back every row they were hiding: an affordance the reader cannot see is not
 * one that should still be narrowing what they read. */
function toggleOption(toggle) {
  if (toggle.getAttribute(OPTION_ATTR) === 'columns') return toggleColumns(toggle)
  return toggleSearch(toggle)
}

function toggleColumns(toggle) {
  const key = toggle.getAttribute(KEY_ATTR)
  const state = tableState.get(key)
  if (!state) return

  state.columns = !state.columns
  markTables()
  focusOption(key, 'columns')
}

function clearSearch(clear) {
  const key = clear.getAttribute(KEY_ATTR)
  const state = tableState.get(key)
  if (!state) return

  state.query = ''
  markTables()
  focusIn(FIELD_ATTR, key)
}

function columnOf(node) {
  const key = node.getAttribute(KEY_ATTR)
  const raw = node.getAttribute(COLUMN_ATTR)
  const state = tableState.get(key)
  if (!state || raw === null) return null

  return { key, index: Number(raw), state }
}

/* Opening and closing a column's menu. The control keeps focus while its menu
 * is open, so the menu is reached with Tab or with the arrow keys and Escape
 * always comes back to it. */
function toggleMenu(control) {
  const column = columnOf(control)
  if (!column) return

  const open = column.state.menu !== column.index

  for (const [other, value] of tableState) {
    value.menu = other === column.key && open ? column.index : null
    if (other !== column.key || !open) continue
    /* A menu and the settings panel are two answers to the same question. */
    value.open = false
  }

  markTables()
  if (open) focusIn(ITEM_ATTR, column.key, column.index)
  else focusIn(COLUMN_CONTROL_ATTR, column.key, column.index)
}

/* The menu's items. `Search column` closes the menu and opens the field over
 * the column name, holding what that column last searched for; `Sort A-Z` and
 * `Sort Z-A` order the whole table by that column; `Clear filter` drops the
 * column's filter. */
function activateItem(item) {
  const column = columnOf(item)
  if (!column) return

  const action = item.getAttribute(ACTION_ATTR)
  column.state.menu = null

  if (action === 'clear') return clearColumn(item)
  if (action === 'search') return openColumn(item)
  if (action === 'asc' || action === 'desc') return sortColumn(item, action)

  markTables()
}

/* Ordering the table by one column. A table is sorted by one column at a time,
 * so sorting by another replaces it, and the direction that is already on is
 * pressed again to drop the sort and read the table in the order Logseq
 * rendered it. Nothing is written to the graph either way: the markdown behind
 * the table is untouched, and the next load opens it unsorted. */
function sortColumn(node, direction) {
  const column = columnOf(node)
  if (!column) return

  /* An open field anywhere commits what it holds rather than losing it,
   * exactly as it does when the reader clicks away. */
  for (const state of tableState.values()) commit(state)

  const current = column.state.sort
  const on = current?.index === column.index && current.direction === direction
  column.state.sort = on ? null : { index: column.index, direction }

  markTables()
  focusIn(COLUMN_CONTROL_ATTR, column.key, column.index)
}

/* Moving through an open menu from the keyboard. */
function stepMenu(item, step) {
  const menu = item.closest?.(`[${MENU_ATTR}]`)
  const items = []
  for (const child of menu?.children ?? []) {
    if (child.matches?.(`[${ITEM_ATTR}]`)) items.push(child)
  }

  const at = items.indexOf(item)
  if (at === -1 || !items.length) return

  items[(at + step + items.length) % items.length].focus?.()
}

/* Opening a column's field. Whatever was open elsewhere commits rather than
 * being dropped, wherever the reader went next. */
function openColumn(node) {
  const column = columnOf(node)
  if (!column) return

  for (const other of tableState.values()) {
    if (other !== column.state || other.editing?.index !== column.index) commit(other)
  }

  if (!column.state.editing) {
    column.state.editing = { index: column.index, draft: column.state.filters.get(column.index) ?? '' }
  }

  markTables()

  const field = nodeFor(COLUMN_FILTER_ATTR, column.key, column.index)
  field?.focus?.()
  /* Reopened holding what was committed, and selected, so the next keystroke
   * refines or discards it. */
  field?.setSelectionRange?.(0, (field.value ?? '').length)
}

/* Closing it, either way round: what the field holds becomes the column's
 * filter, or is dropped for the one last committed. The node is passed rather
 * than the key alone so a stray event from a field this plugin has already
 * taken away can never close the one that replaced it. */
function closeColumn(node, keep) {
  const column = columnOf(node)
  if (!column?.state.editing || column.state.editing.index !== column.index) return false

  if (keep) commit(column.state)
  else column.state.editing = null

  markTables()
  return true
}

function clearColumn(term) {
  const column = columnOf(term)
  if (!column) return

  /* Dropping one column's filter is all this does: it never opens that
   * column's field, and never leaves another's open field hanging. */
  for (const state of tableState.values()) commit(state)
  column.state.filters.delete(column.index)

  markTables()
  focusIn(COLUMN_CONTROL_ATTR, column.key, column.index)
}

/* Every node this plugin hangs in the host document sits inside rendered block
 * content, where a click of Logseq's own opens the block for editing and Enter
 * or Space reaches its shortcut handling. Taking these events in the capture
 * phase, before React's root container sees them, is what keeps each control
 * to itself. */
/* The header cell itself is not on this list: the column name is Logseq's, and
 * a click on it opens the block for editing exactly as it always did. What
 * this plugin answers for is the control it hangs in the cell, the menu that
 * control opens, and the field and committed filter that come of it. */
function chromeOf(target) {
  return (
    target?.closest?.(
      `[${SETTINGS_ATTR}], [${PANEL_ATTR}], [${SEARCH_ATTR}], [${COLUMN_CONTROL_ATTR}], ` +
        `[${MENU_ATTR}], [${COLUMN_FILTER_ATTR}], [${COLUMN_TERM_ATTR}]`
    ) ?? null
  )
}

function fieldOf(target) {
  return target?.closest?.(`[${FIELD_ATTR}], [${COLUMN_FILTER_ATTR}]`) ?? null
}

function onPointer(event) {
  const target = event.target
  const chrome = chromeOf(target)

  if (!chrome) {
    /* A click anywhere else dismisses an open panel and commits an open field,
     * and is otherwise left entirely to Logseq. */
    if (event.type === 'click') dismiss()
    return
  }

  event.stopPropagation()

  /* A field is the one place a press must still reach its own element: a
   * prevented `mousedown` puts no caret in an input. Stopping the event is all
   * that is needed to keep the block out of edit mode. */
  if (!fieldOf(target)) event.preventDefault()
  if (event.type !== 'click') return

  const settings = target.closest?.(`[${SETTINGS_ATTR}]`)
  if (settings) return togglePanel(settings)

  const toggle = target.closest?.(`[${TOGGLE_ATTR}]`)
  if (toggle) return toggleOption(toggle)

  const clear = target.closest?.(`[${CLEAR_ATTR}]`)
  if (clear) return clearSearch(clear)

  const control = target.closest?.(`[${COLUMN_CONTROL_ATTR}]`)
  if (control) return toggleMenu(control)

  const item = target.closest?.(`[${ITEM_ATTR}]`)
  if (item) return activateItem(item)

  /* The committed filter, and nothing else on the header, is what a click
   * drops a column's filter with. */
  const term = target.closest?.(`[${COLUMN_TERM_ATTR}]`)
  if (term) return clearColumn(term)
}

function onKeyDown(event) {
  const chrome = chromeOf(event.target)
  if (!chrome) return

  event.stopPropagation()

  /* An open column field answers Escape and Enter itself: Escape restores the
   * filter the column last committed, Enter commits what the field holds. Both
   * leave focus on the header, so the interaction carries on from there. */
  const editor = event.target.closest?.(`[${COLUMN_FILTER_ATTR}]`)
  if (editor) {
    if (event.key !== 'Escape' && event.key !== 'Enter') return

    event.preventDefault()
    const key = editor.getAttribute(KEY_ATTR)
    const index = editor.getAttribute(COLUMN_ATTR)
    closeColumn(editor, event.key === 'Enter')
    focusIn(COLUMN_CONTROL_ATTR, key, index)
    return
  }

  /* An open menu is walked with the arrow keys, the way a menu is. */
  const item = event.target.closest?.(`[${ITEM_ATTR}]`)
  if (item && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault()
    return stepMenu(item, event.key === 'ArrowDown' ? 1 : -1)
  }

  if (event.key === 'Escape') {
    event.preventDefault()

    /* Escape answers the nearest thing that is open: a menu first, and its
     * control takes focus back. */
    const column = item ?? event.target.closest?.(`[${COLUMN_CONTROL_ATTR}]`)
    if (column && closeMenus()) {
      focusIn(COLUMN_CONTROL_ATTR, column.getAttribute(KEY_ATTR), column.getAttribute(COLUMN_ATTR))
      return
    }

    if (closePanels()) focusIn(SETTINGS_ATTR, chrome.getAttribute(KEY_ATTR))
    return
  }

  /* A field takes its own keys, space included. */
  if (event.target.closest?.(`[${FIELD_ATTR}]`)) return
  if (event.key !== 'Enter' && event.key !== ' ') return

  const control = event.target.closest?.(
    `[${SETTINGS_ATTR}], [${TOGGLE_ATTR}], [${CLEAR_ATTR}], [${COLUMN_CONTROL_ATTR}], [${ITEM_ATTR}], ` +
      `[${COLUMN_TERM_ATTR}]`
  )
  if (!control) return

  event.preventDefault()
  if (control.matches(`[${SETTINGS_ATTR}]`)) togglePanel(control)
  else if (control.matches(`[${TOGGLE_ATTR}]`)) toggleOption(control)
  else if (control.matches(`[${COLUMN_CONTROL_ATTR}]`)) toggleMenu(control)
  else if (control.matches(`[${ITEM_ATTR}]`)) activateItem(control)
  else if (control.matches(`[${COLUMN_TERM_ATTR}]`)) clearColumn(control)
  else clearSearch(control)
}

/* The key that opened a control has to be kept from Logseq on the way up as
 * well as on the way down. */
function onKeyUp(event) {
  if (chromeOf(event.target)) event.stopPropagation()
}

function onInput(event) {
  const field = fieldOf(event.target)
  if (!field) return

  event.stopPropagation()

  const state = tableState.get(field.getAttribute(KEY_ATTR))
  if (!state) return

  if (!field.matches(`[${COLUMN_FILTER_ATTR}]`)) state.query = field.value ?? ''
  else if (state.editing) state.editing = { ...state.editing, draft: field.value ?? '' }

  markTables()
}

/* A field that loses focus closes, committing what it holds: the reader has
 * moved on, and the column keeps what they typed. */
function onFocusOut(event) {
  const editor = event.target?.closest?.(`[${COLUMN_FILTER_ATTR}]`)
  if (editor) closeColumn(editor, true)
}

const LISTENERS = [
  ['mousedown', onPointer],
  ['click', onPointer],
  ['keydown', onKeyDown],
  ['keyup', onKeyUp],
  ['input', onInput],
  ['focusout', onFocusOut],
  ['scroll', onScroll]
]

/* Everything this script writes lives in the host document, which outlives the
 * plugin, so unloading has to leave none of it behind — and only its own. */
let observer = null
function teardown() {
  /* The store is not this plugin's to clear, and unloading is not a reader
   * saying they want their tables back at the defaults: an ordinary reload
   * unloads and reloads this plugin, and every table has to come back the way
   * it was left. What belongs here is the opposite — anything still waiting on
   * the save's delay is written out now, while there is still a host to write
   * it. */
  flush()

  observer?.disconnect()
  observer = null
  tableState.clear()

  for (const [type, handler] of LISTENERS) doc.removeEventListener?.(type, handler, true)

  release(emptyPass())
  for (const wrapper of doc.querySelectorAll(`[${TABLE_ATTR}]`)) wrapper.removeAttribute(TABLE_ATTR)
}

function main() {
  logseq.provideStyle({ key: STYLE_KEY, style: STYLE })
  logseq.beforeunload?.(async () => teardown())

  for (const [type, handler] of LISTENERS) doc.addEventListener(type, handler, true)

  /* What every table was left set to, last time. The settings object is handed
   * over as this plugin connects, so it is here to be read rather than waited
   * for; which graph it is read under is the part that has to be asked. */
  persisted = plainObject(logseq.settings?.[STORE_KEY]) ?? {}
  scopeGraph().catch(console.error)
  logseq.App?.onCurrentGraphChanged?.(() => {
    regraph().catch(console.error)
  })

  /* Logseq draws its own chrome in this face, so it is loaded long before a
   * table renders; asking costs nothing and repaints the controls that were
   * built while it was still on its way. */
  try {
    doc.fonts?.load?.(ICON_FONT)?.then?.(repaint, () => {})
  } catch {
    /* A host with no font set draws the ellipsis, which is the fallback. */
  }

  /* childList/subtree only: this observer must not see its own attribute
   * writes, or every pass would schedule another one. */
  const container = doc.body
  observer = new MutationObserver(repaint)
  observer.observe(container, { childList: true, subtree: true })

  repaint()
}

logseq.ready(main).catch(console.error)
