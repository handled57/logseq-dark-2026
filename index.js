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

const RULES_SETTING = 'hiddenProperties'
const DEFAULT_RULES = 'type: foo'
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

function paint() {
  const active = rules()

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

function main() {
  migrateLegacySettings()
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
