/* Behavior half of the Dark High Contrast theme.
 *
 * Hides a block's rendered property table when the configured property carries
 * one of the configured values, so a tagged block renders as bare content.
 * Editing needs no special handling: Logseq replaces the whole rendered block
 * (`.block-content-wrapper`, which is what holds `.block-properties`) with a
 * textarea over the raw `:block/content`, and custom properties are part of
 * that content. Clicking into the block therefore already shows the content
 * and its properties as source.
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

const settingsSchema = [
  {
    key: 'hiddenPropertyKey',
    type: 'string',
    default: 'type',
    title: 'Property key',
    description:
      'Property whose value decides whether a block renders bare. Leave empty to render every block normally.'
  },
  {
    key: 'hiddenPropertyValues',
    type: 'string',
    default: 'foo',
    title: 'Values that hide properties',
    description:
      'Comma-separated values of that property. Use * to hide the properties of every block carrying the key.'
  }
]

/* An absent setting means "not configured yet", so it takes the schema default.
 * An empty string is a deliberate choice and must survive as empty. */
function readSetting(key, fallback) {
  const value = logseq.settings?.[key]
  return typeof value === 'string' ? value.trim().toLowerCase() : fallback
}

function hiddenKey() {
  return readSetting('hiddenPropertyKey', 'type')
}

function hiddenValues() {
  return readSetting('hiddenPropertyValues', 'foo')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
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

function shouldHide(properties) {
  const key = hiddenKey()
  if (!key || !(key in properties)) return false

  const values = hiddenValues()
  return values.includes('*') || values.includes(properties[key])
}

function paint() {
  const key = hiddenKey()

  for (const table of doc.querySelectorAll('.block-properties')) {
    const properties = propertiesOf(table)

    if (shouldHide(properties)) table.setAttribute(HIDDEN_ATTR, '')
    else table.removeAttribute(HIDDEN_ATTR)

    /* Styling hook for theme.css, e.g. .ls-block[data-hc-block-type="foo"]. */
    const block = table.closest('.ls-block')
    if (!block) continue

    if (key && properties[key]) block.setAttribute(TYPE_ATTR, properties[key])
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

function main() {
  logseq.useSettingsSchema(settingsSchema)
  logseq.provideStyle({ key: STYLE_KEY, style: `.block-properties[${HIDDEN_ATTR}] { display: none; }` })
  logseq.onSettingsChanged(repaint)
  logseq.App.onRouteChanged(repaint)

  /* childList/subtree only: this observer must not see its own attribute
   * writes, or every pass would schedule another one. */
  const container = doc.getElementById('app-container') ?? doc.body
  new MutationObserver(repaint).observe(container, { childList: true, subtree: true })

  repaint()
}

logseq.ready(main).catch(console.error)
