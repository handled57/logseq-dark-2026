/* Anno: imports a PDF into the graph and opens the page it is annotated from.
 *
 * Logseq already has a PDF viewer and a highlight store; what it has no route
 * into is the import. A PDF becomes annotatable by living in the graph's own
 * `assets/` folder and being linked from a block, and Logseq then derives
 * everything else from that one filename: opening `../assets/<name>.pdf` gives
 * the viewer the key `<name>`, which makes `assets/<name>.edn` the highlight
 * store and `hls__<name>` the page every highlight is collected on. So the
 * page title asked for below is not decoration — it is what the asset is named
 * after, and therefore what Logseq's own annotation page is named after too.
 *
 * Two entry points, one import path: the `/` slash command and the command
 * palette, which reaches the same prompt from `Cmd+Shift+P`.
 *
 * `parent.document` and `parent.apis` are reachable because package.json
 * declares `effect: true`. That flag keeps the plugin entry on the host's own
 * `file://` origin; side-effect-free packages are rewritten to
 * `lsp://logseq.io/`, a different origin, and the file chooser, the prompt and
 * the write into the graph would all be out of reach.
 */

const doc = parent.document

const COMMAND_LABEL = 'Anno: Import PDF'
const PALETTE_KEY = 'anno-import-pdf'

/* Every attribute, element id and style key this plugin writes is namespaced
 * to Anno, so a theme or a sibling plugin annotating the same host document —
 * Dark High Contrast writes `data-hc-*`, Passage `data-passage-*` — never
 * reads or clears one of these, and no teardown touches another's nodes. */
const DIALOG_ATTR = 'data-anno-dialog'
const CHOOSER_ATTR = 'data-anno-chooser'
const FILE_ATTR = 'data-anno-file'
const ACTIONS_ATTR = 'data-anno-actions'
const DIALOG_STYLE_KEY = 'anno-dialog'
const PDF_FIELD_ID = 'anno-pdf'
const TITLE_FIELD_ID = 'anno-page-title'

const PDF_ACCEPT = 'application/pdf,.pdf'
const PDF_EXTENSION = /\.pdf$/i

const PAGE_TEMPLATE_SETTING = 'annotationPageTemplate'
const HIGHLIGHT_TEMPLATE_SETTING = 'annotationHighlightTemplate'
const NO_TEMPLATE = 'No template'
let templates = []

/* Classic graphs store both block and page properties on `:block/properties`,
 * so one query finds either kind of template. Keep the properties with the
 * name: they say which pieces of Logseq's PDF metadata the template already
 * supplies and therefore which pieces Anno must add. */
async function loadTemplates() {
  const rows =
    (await logseq.DB?.datascriptQuery?.(
      '[:find ?template ?properties :where [?entity :block/properties ?properties] ' +
        '[(get ?properties :template) ?template]]'
    )) ?? []
  const found = new Map()

  for (const [value, properties] of rows) {
    const names = Array.isArray(value) ? value : [value]
    for (const name of names) {
      const label = typeof name === 'string' ? name.trim() : ''
      if (label && !found.has(label)) found.set(label, properties ?? {})
    }
  }

  templates = [...found].sort(([left], [right]) => left.localeCompare(right))
  return templates
}

function settingsSchema() {
  return [
    {
      key: PAGE_TEMPLATE_SETTING,
      type: 'enum',
      enumChoices: [NO_TEMPLATE, ...templates.map(([name]) => name)],
      enumPicker: 'select',
      default: NO_TEMPLATE,
      title: 'Annotation page template',
      description:
        'Template to apply when Anno creates a page. Choices come from blocks and pages ' +
        'with a template property; existing pages are left as they are.'
    },
    {
      key: HIGHLIGHT_TEMPLATE_SETTING,
      type: 'enum',
      enumChoices: [NO_TEMPLATE, ...templates.map(([name]) => name)],
      enumPicker: 'select',
      default: NO_TEMPLATE,
      title: 'Annotation/highlight template',
      description:
        'Template to add beneath each new PDF annotation or highlight block. Choices come ' +
        'from blocks and pages with a template property; existing highlights are left alone.'
    }
  ]
}

function selectedTemplate(setting = PAGE_TEMPLATE_SETTING) {
  const selected = logseq.settings?.[setting]
  return templates.find(([name]) => name === selected) ?? null
}

/* Logseq creates the graph block for a PDF highlight lazily, when the reader
 * first links, drags or opens that highlight in the graph. It identifies that
 * block with `ls-type:: annotation`. Only an insertion transaction qualifies:
 * editing an old annotation after Anno starts must not apply a newly selected
 * template retroactively.
 *
 * A highlight's own block carries native text, UUID and PDF properties, so the
 * template belongs beneath it. An empty child gives Logseq's template command
 * the same replaceable target it receives on a newly created page. */
const INSERT_BLOCK_OPS = new Set(['insert-block', 'insert-blocks'])
async function templateNewHighlights({ blocks = [], txMeta = {} } = {}) {
  const template = selectedTemplate(HIGHLIGHT_TEMPLATE_SETTING)
  const operation = String(txMeta.outlinerOp ?? txMeta['outliner-op'] ?? '').replace(/^:/, '')
  if (!template || !INSERT_BLOCK_OPS.has(operation)) return

  for (const block of blocks) {
    /* Datascript spells the property `ls-type`, while the JavaScript SDK
     * camel-cases that same key to `lsType` on entities delivered to
     * `DB.onChanged`. Accept both representations so the live callback sees
     * the annotation block Logseq just created. */
    const type = block?.properties?.lsType ?? block?.properties?.['ls-type']
    if (type !== 'annotation' || !block.uuid) continue

    let target = null
    try {
      target = await logseq.Editor.insertBlock(block.uuid, '', { sibling: false })
      if (target?.uuid) await logseq.Editor.insertTemplate(target.uuid, template[0])
    } catch (error) {
      if (target?.uuid) await logseq.Editor.deleteBlock?.(target.uuid)
      console.warn('Anno could not apply the annotation/highlight template', error)
    }
  }
}

/* Naming the asset.
 *
 * Logseq runs a PDF's basename through sanitize-filename to get the viewer key
 * it stores highlights under, so a title carrying a character a filename
 * cannot hold would name one file and be annotated under another. Anno puts a
 * space in place of those characters first, which makes the two names the same
 * one: what is written to disk is already what Logseq would derive from it,
 * and it still reads as the title it came from.
 */
const ILLEGAL = /[/?<>\\:*|"\u0000-\u001f\u007f-\u009f]/g
const COLLAPSE = /\s+/g
const TRAILING = /[. ]+$/
const RELATIVE = /^\.+$/
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i
/* A filename budget, not a title one: the extension is part of what has to fit,
 * and a name is measured in bytes rather than characters. */
const FILENAME_BYTES = 255 - '.pdf'.length

function withinBytes(name, budget) {
  const encoder = new TextEncoder()
  let fitted = name
  while (fitted && encoder.encode(fitted).length > budget) fitted = fitted.slice(0, -1)
  return fitted
}

function assetName(title) {
  const spaced = title.replace(ILLEGAL, ' ').replace(COLLAPSE, ' ').trim()
  const cleaned = withinBytes(spaced, FILENAME_BYTES).replace(TRAILING, '')
  return RELATIVE.test(cleaned) || WINDOWS_DEVICE.test(cleaned) ? '' : cleaned
}

/* Reaching the host's filesystem.
 *
 * `parent.apis.doAction` is the host's own IPC bridge, and the only route a
 * plugin has to the graph folder: Logseq's plugin API can create a page and
 * append a block to it, but nothing in it writes an asset. Each action takes
 * one array whose head names it. */
function hostAction(...call) {
  const apis = parent.apis
  if (typeof apis?.doAction !== 'function') throw new Error('Anno needs the Logseq desktop app to import a PDF')
  return apis.doAction(call)
}

/* The host does not reject a failed action: `ipcMain.handle('main', ...)`
 * catches everything its handlers throw and *returns* the exception, naming
 * `stat` as one whose failure is ordinary enough not to log. So a path that is
 * not there answers with a resolved value that carries no stat in it, and the
 * size is what tells the two apart. Rejection is still handled, for the host
 * that has no bridge at all. */
async function statOf(path) {
  try {
    const stat = await hostAction('stat', path)
    return typeof stat?.size === 'number' ? stat : null
  } catch (error) {
    return null
  }
}

async function alreadyInGraph(path) {
  return (await statOf(path)) !== null
}

/* Where the asset goes, and the relative href a page links it by. Pages live in
 * the graph's `pages/` folder, so `../assets/` is the path from a page to the
 * asset folder beside it — the same link Logseq's own paste and drop write. */
async function graphTarget(asset) {
  const graph = await logseq.App?.getCurrentGraph?.()
  const root = typeof graph?.path === 'string' ? graph.path.replace(/[/\\]+$/, '') : ''
  if (!root) return null

  return {
    repo: graph.url,
    assets: `${root}/assets`,
    path: `${root}/assets/${asset}.pdf`,
    href: `../assets/${asset}.pdf`,
    highlights: `hls__${asset}`
  }
}

async function writeAsset(target, file) {
  /* Read before writing: an unreadable file must not leave a truncated asset
   * or a page pointing at one. */
  const data = await file.arrayBuffer()
  await hostAction('mkdir-recur', target.assets)
  await hostAction('writeFile', target.repo, target.path, data)

  /* A write that failed resolves exactly like one that worked, for the reason
   * statOf describes, so the asset is read back at its full length before a
   * page is allowed to link it. */
  const written = await statOf(target.path)
  if (written?.size !== data.byteLength) throw new Error(NOT_WRITTEN)
}

/* A `]` in the title would close the link's label early, and the label is only
 * what the block reads as; the asset it points at is named by the title all the
 * same. */
const LABEL_BRACKETS = /[[\]]/g

/* The page is created when it is missing and used as it stands when it is not,
 * so importing a second PDF under a title already in the graph adds to that
 * page rather than replacing it — and re-importing the same PDF onto it does
 * not leave the link twice. */
function pdfProperties(title, target, templateProperties = {}) {
  const properties = {}
  if (!Object.hasOwn(templateProperties, 'file')) {
    properties.file = `![${title.replace(LABEL_BRACKETS, '')}](${target.href})`
  }
  if (!Object.hasOwn(templateProperties, 'file-path')) properties['file-path'] = target.href
  return properties
}

async function linkPage(title, target) {
  const existing = await logseq.Editor.getPage?.(title)
  const template = existing ? null : selectedTemplate()
  const properties = template ? pdfProperties(title, target, template[1]) : {}
  const page = await logseq.Editor.createPage(title, properties, {
    redirect: true,
    createFirstBlock: Boolean(template)
  })

  if (template) {
    const [first] = (await logseq.Editor.getPageBlocksTree?.(page?.uuid ?? title)) ?? []
    if (first?.uuid) await logseq.Editor.insertTemplate(first.uuid, template[0])
  }

  const blocks = (await logseq.Editor.getPageBlocksTree?.(page?.uuid ?? title)) ?? []
  if (blocks.some((block) => (block?.content ?? '').includes(target.href))) return

  await logseq.Editor.appendBlockInPage(
    page?.uuid ?? title,
    `![${title.replace(LABEL_BRACKETS, '')}](${target.href})`
  )
}

/* The prompt is this plugin's own chrome, whichever theme is selected, so it
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
  min-width: 380px;
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
  max-width: 46ch;
  color: var(--vscode-hc-error, #f48771);
}

/* The chooser itself is never the control the reader uses: the system dialog
 * opens on its own, and the button beside the filename reopens it. */
[${DIALOG_ATTR}] [${CHOOSER_ATTR}] { display: none; }

[${DIALOG_ATTR}] [${FILE_ATTR}] {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* A long filename gives up its middle rather than widening the prompt. */
[${DIALOG_ATTR}] [${FILE_ATTR}] span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
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

const NO_FILE_CHOSEN = 'No PDF chosen'
const CHOOSE_A_PDF = 'Choose a PDF to import.'
const UNUSABLE_TITLE =
  'A file cannot be named after that title. Give it at least one character a filename can hold.'
const NO_GRAPH = 'Anno imports into an open file graph, and there is none open.'
const NOT_WRITTEN =
  'Anno could not write the PDF into the graph\u2019s assets folder, so no page was created.'
const taken = (asset) =>
  `assets/${asset}.pdf is already in this graph. Give the page a different title, or annotate the ` +
  'PDF that is already there.'
const imported = (title, target) =>
  `Imported ${title}. Highlights you make in this PDF are collected on ${target.highlights}.`

/* Resolves with the file, the page title and where the asset goes, or with null
 * when the prompt is dismissed — nothing is written in that case, so Escape,
 * Cancel and a click outside all leave the graph exactly as it was.
 *
 * Everything that can be answered by editing the prompt is answered in it: a
 * title no file can be named after, and a title whose asset is already in the
 * graph, both leave it open with the reason under the fields rather than
 * failing after it closes.
 */
let dismissDialog = null
function askForPdf() {
  return new Promise((resolve) => {
    const overlay = doc.createElement('div')
    const form = doc.createElement('form')
    const fileLabel = doc.createElement('label')
    const fileRow = doc.createElement('div')
    const chooser = doc.createElement('input')
    const chosen = doc.createElement('span')
    const browse = doc.createElement('button')
    const titleLabel = doc.createElement('label')
    const title = doc.createElement('input')
    const message = doc.createElement('p')
    const actions = doc.createElement('div')
    const cancel = doc.createElement('button')
    const confirm = doc.createElement('button')

    overlay.setAttribute(DIALOG_ATTR, '')
    fileLabel.setAttribute('for', PDF_FIELD_ID)
    fileLabel.textContent = 'PDF file'
    fileRow.setAttribute(FILE_ATTR, '')
    chooser.setAttribute(CHOOSER_ATTR, '')
    chooser.id = PDF_FIELD_ID
    chooser.type = 'file'
    chooser.accept = PDF_ACCEPT
    chosen.textContent = NO_FILE_CHOSEN
    browse.type = 'button'
    browse.textContent = 'Choose PDF…'
    titleLabel.setAttribute('for', TITLE_FIELD_ID)
    titleLabel.textContent = 'Page title'
    title.id = TITLE_FIELD_ID
    title.type = 'text'
    title.placeholder = 'The page this PDF is annotated from'
    title.setAttribute('autocomplete', 'off')
    actions.setAttribute(ACTIONS_ATTR, '')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    confirm.type = 'submit'
    confirm.textContent = 'Import'
    confirm.disabled = true

    const chosenFile = () => chooser.files?.[0] ?? null

    function close(choice) {
      dismissDialog = null
      parent.removeEventListener('keydown', keys, true)
      doc.removeEventListener('focusin', holdFocus, true)
      overlay.remove()
      resolve(choice)
    }

    /* The prompt is modal, so it holds the focus for as long as it is open.
     * Logseq is still running whatever the command was invoked from behind it
     * and puts the caret back into its own editor on its own schedule; focus
     * taken back that way is silent, and the page title would be typed into a
     * block instead of the field. Anything focused outside the prompt is handed
     * straight back to whatever inside it had the focus last. */
    let held = title
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

    /* Import is available once there is a file and a title to name it after. */
    function refresh() {
      confirm.disabled = !chosenFile() || title.value.trim() === ''
    }

    /* The title defaults to the PDF's own name, and keeps doing so while the
     * reader has not written one: choosing a different file re-defaults, and a
     * title typed by hand is never overwritten by a later choice. */
    let titleEdited = false
    function pick() {
      const file = chosenFile()
      if (!file) return

      chosen.textContent = file.name
      if (!titleEdited) title.value = file.name.replace(PDF_EXTENSION, '')
      message.textContent = ''
      refresh()
      title.focus?.()
    }

    async function submit(event) {
      event?.preventDefault?.()
      const file = chosenFile()
      if (!file) {
        message.textContent = CHOOSE_A_PDF
        return
      }

      const wanted = title.value.trim()
      /* A blank title names no page and no file, so the prompt stays open. */
      if (!wanted) return

      const asset = assetName(wanted)
      if (!asset) {
        message.textContent = UNUSABLE_TITLE
        return
      }

      try {
        const target = await graphTarget(asset)
        if (!target) {
          message.textContent = NO_GRAPH
          return
        }
        /* Overwriting an asset would take a PDF already in the graph out from
         * under the highlights recorded against it. */
        if (await alreadyInGraph(target.path)) {
          message.textContent = taken(asset)
          return
        }

        close({ file, title: wanted, target })
      } catch (error) {
        message.textContent = error?.message ?? NO_GRAPH
      }
    }

    /* Import is the prompt's default action, and Escape its cancel, for as long
     * as it is open. Logseq binds its own shortcuts on the document and sees a
     * key there before the prompt does, so the prompt claims those two keys on
     * the parent window in the capturing phase, which precedes the document. */
    function keys(event) {
      if (event.key !== 'Enter' && event.key !== 'Escape') return

      event.preventDefault?.()
      event.stopPropagation()
      event.stopImmediatePropagation?.()

      if (event.key === 'Escape') close(null)
      else void submit(event)
    }

    chooser.addEventListener('change', pick)
    browse.addEventListener('click', () => chooser.click?.())
    title.addEventListener('input', () => {
      titleEdited = true
      message.textContent = ''
      refresh()
    })
    form.addEventListener('submit', (event) => void submit(event))
    cancel.addEventListener('click', () => close(null))
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close(null)
    })
    /* Nothing typed into the prompt belongs to whatever is behind it. */
    overlay.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Escape') close(null)
      else if (event.key === 'Enter') void submit(event)
    })
    parent.addEventListener('keydown', keys, true)
    doc.addEventListener('focusin', holdFocus, true)

    fileRow.appendChild(chooser)
    fileRow.appendChild(chosen)
    fileRow.appendChild(browse)
    actions.appendChild(cancel)
    actions.appendChild(confirm)
    form.appendChild(fileLabel)
    form.appendChild(fileRow)
    form.appendChild(titleLabel)
    form.appendChild(title)
    form.appendChild(message)
    form.appendChild(actions)
    overlay.appendChild(form)
    doc.body.appendChild(overlay)
    title.focus?.()

    /* The chooser opens with the prompt, because choosing the PDF is the first
     * thing the command is for; the button reopens it for a second look. This
     * is the last thing the prompt does, so a host that refuses to open a file
     * dialog for a script still leaves a usable prompt behind. Cancelling the
     * chooser leaves that prompt open with nothing chosen and nothing written. */
    try {
      chooser.click?.()
    } catch (error) {
      console.warn('Anno could not open the file chooser', error)
    }
  })
}

let prompting = false
async function importPdf() {
  if (prompting) return
  prompting = true

  try {
    const choice = await askForPdf()
    if (!choice) return

    /* The asset first: a page linking a PDF that was never written would be a
     * broken link, while an asset whose page failed is still a PDF in the
     * graph, importable again under the same title. */
    await writeAsset(choice.target, choice.file)
    await linkPage(choice.title, choice.target)
    logseq.UI?.showMsg?.(imported(choice.title, choice.target), 'success')
  } catch (error) {
    console.warn('Anno could not import the PDF', error)
    logseq.UI?.showMsg?.(error?.message ?? 'Anno could not import the PDF', 'error')
  } finally {
    prompting = false
  }
}

/* The prompt lives in the host document, which outlives the plugin, so
 * unloading has to leave none of it behind. */
function teardown() {
  dismissDialog?.()
  for (const node of doc.querySelectorAll(`[${DIALOG_ATTR}]`)) node.remove()
}

function main() {
  /* The schema is registered after the graph query lands so the enum is a real
   * dropdown of this graph's templates rather than a free-form template name. */
  void loadTemplates()
    .catch(() => templates)
    .then(() => logseq.useSettingsSchema(settingsSchema()))
  logseq.provideStyle({ key: DIALOG_STYLE_KEY, style: DIALOG_STYLE })
  logseq.Editor?.registerSlashCommand?.(COMMAND_LABEL, () => importPdf())
  logseq.App?.registerCommandPalette?.({ key: PALETTE_KEY, label: COMMAND_LABEL }, () => importPdf())
  logseq.DB?.onChanged?.((change) => void templateNewHighlights(change))
  logseq.beforeunload?.(async () => teardown())
}

logseq.ready(main).catch(console.error)
