/* Able Table: finds and keys every rendered Markdown table so a later stage
 * can search and filter it in place.
 *
 * This release is the plugin's lifecycle skeleton and nothing else. It loads,
 * observes the host document the way Dark High Contrast and Passage do,
 * marks every table Logseq renders in the main editor, and tears itself down
 * cleanly. No control is drawn, no setting is offered, and no row is ever
 * hidden — that is full table search's and column filtering's work, built on
 * top of what this file establishes.
 *
 * Keying a table by its block's UUID and its ordinal within that block —
 * rather than by the DOM node Logseq happens to have rendered right now — is
 * what lets a re-rendered table find state written against it earlier. Logseq
 * replaces rendered nodes constantly during ordinary editing and navigation,
 * so a search string or a column filter kept against the element itself would
 * be lost on the next keystroke elsewhere on the page. Establishing that key
 * here, before there is any state worth keeping, means the feature stages
 * only have to read it.
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
 * teardown never touches theirs. */
const STYLE_KEY = 'able-table'
const TABLE_ATTR = 'data-able-table'

/* The main editor only, and Logseq's own render of a Markdown table there:
 * a `<table>` that is the direct child of the `div.table-wrapper` box the
 * reader sees. Sidebars, whiteboards and dialogs render their own copies and
 * are left as Logseq draws them, exactly as the theme's rich-content controls
 * are. */
const MAIN_EDITOR_SELECTOR = '#main-content-container'
const TABLE_WRAPPER_SELECTOR = '.table-wrapper'

/* State lives here, keyed by `<block uuid>:<ordinal>` — the ordinal counts
 * tables within the same block, in document order, so a block holding more
 * than one table gives each its own key. Nothing here is read from or
 * written to the graph; it is discarded on unload and rebuilt from the
 * render on the next load. */
const tableState = new Map()

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

/* One pass over every table Logseq currently renders in the main editor. Read
 * in document order, so two tables in the same block always get the same two
 * ordinals however many times this runs. A table the pass does not reach —
 * because its block was deleted, or its content no longer renders a table —
 * releases its mark and its state in the same pass. */
function markTables() {
  const marked = new Set()
  const counts = new Map()

  for (const root of doc.querySelectorAll(MAIN_EDITOR_SELECTOR)) {
    for (const table of root.querySelectorAll('table')) {
      const wrapper = table.parentElement
      if (!wrapper || typeof wrapper.matches !== 'function' || !wrapper.matches(TABLE_WRAPPER_SELECTOR)) continue

      const uuid = blockUuid(table)
      const ordinal = counts.get(uuid) ?? 0
      counts.set(uuid, ordinal + 1)

      const key = `${uuid}:${ordinal}`
      wrapper.setAttribute(TABLE_ATTR, key)
      marked.add(wrapper)
      if (!tableState.has(key)) tableState.set(key, {})
    }
  }

  for (const wrapper of doc.querySelectorAll(`[${TABLE_ATTR}]`)) {
    if (marked.has(wrapper)) continue

    tableState.delete(wrapper.getAttribute(TABLE_ATTR))
    wrapper.removeAttribute(TABLE_ATTR)
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

/* Everything this script writes lives in the host document, which outlives
 * the plugin, so unloading has to leave none of it behind. */
let observer = null
function teardown() {
  observer?.disconnect()
  observer = null
  tableState.clear()

  for (const wrapper of doc.querySelectorAll(`[${TABLE_ATTR}]`)) wrapper.removeAttribute(TABLE_ATTR)
}

function main() {
  /* No behavior lives in this style yet; the key is claimed here so a later
   * stage only has to fill it in, never register it. */
  logseq.provideStyle({ key: STYLE_KEY, style: '' })
  logseq.beforeunload?.(async () => teardown())

  /* childList/subtree only: this observer must not see its own attribute
   * writes, or every pass would schedule another one. */
  const container = doc.body
  observer = new MutationObserver(repaint)
  observer.observe(container, { childList: true, subtree: true })

  repaint()
}

logseq.ready(main).catch(console.error)
