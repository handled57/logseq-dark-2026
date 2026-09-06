import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const marketplace = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
const css = await readFile(resolve(root, 'theme.css'), 'utf8')
const entry = await readFile(resolve(root, 'index.html'), 'utf8')
const script = await readFile(resolve(root, 'index.js'), 'utf8')

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cssValue(name) {
  const match = css.match(new RegExp(`${escapeRegExp(name)}\\s*:\\s*([^;]+);`))
  assert.ok(match, `${name} is missing`)
  return match[1].trim().toLowerCase()
}

function luminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16) / 255)
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

test('the released version matches the newest changelog entry', async () => {
  // Pinning the version as a literal here let package.json and the changelog
  // drift apart; deriving it keeps one source of truth.
  const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8')
  const latest = changelog.match(/^## (\d+\.\d+\.\d+) - \d{4}-\d{2}-\d{2}$/m)
  assert.ok(latest, 'changelog has no versioned release heading')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pkg.version, latest[1], 'package.json version and changelog disagree')
})

test('package exposes one dark theme plus the property-hiding entry', () => {
  assert.equal(pkg.name, 'logseq-dark-high-contrast-theme')
  assert.equal(pkg.author, 'Peter Cole')
  assert.equal(pkg.repo, 'handled57/logseq-dark-2026')
  // `effect` is load-bearing, not descriptive: a side-effect-free package has
  // its entry rewritten to lsp://logseq.io/, a different origin from the host
  // window, which puts `parent.document` out of reach.
  assert.equal(pkg.effect, true)
  assert.equal(pkg.theme, true)
  assert.equal(pkg.main, 'index.html')
  assert.equal(pkg.logseq.main, 'index.html')
  // The SDK is vendored under lib/, so installing from a release needs no
  // install step and no runtime dependency resolution.
  assert.deepEqual(pkg.dependencies, undefined)
  assert.equal(pkg.logseq.id, pkg.name)
  assert.equal(pkg.logseq.themes.length, 1)
  assert.deepEqual(pkg.logseq.themes[0], {
    name: 'Dark High Contrast',
    url: './theme.css',
    mode: 'dark',
    description: "VS Code's Dark High Contrast workbench, adapted for Logseq classic graphs."
  })
})

test('marketplace metadata is classic-only and agrees with the package', () => {
  assert.equal(marketplace.id, pkg.name)
  assert.equal(marketplace.repo, pkg.repo)
  assert.equal(marketplace.author, pkg.author)
  assert.equal(
    marketplace.description,
    'A VS Code-inspired Dark High Contrast theme for Logseq classic graphs, with configurable property hiding.'
  )
  assert.equal(marketplace.theme, true)
  assert.equal(marketplace.effect, pkg.effect)
  assert.equal(marketplace.web, false)
  assert.equal(marketplace.supportsDB, false)
  assert.equal(marketplace.supportsDBOnly, false)
})

test('canonical stylesheet and public screenshot exist', async () => {
  await access(resolve(root, 'theme.css'), constants.R_OK)
  const screenshot = await readFile(resolve(root, 'screenshots', 'logseq-dark-high-contrast.png'))
  assert.equal(screenshot.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'screenshot is not a PNG')
  assert.ok(screenshot.length > 100_000, 'screenshot is unexpectedly small')
  await assert.rejects(access(resolve(root, 'custom.css'), constants.F_OK))
})

test('README and palette chart document every fixed stylesheet color', async () => {
  const readme = await readFile(resolve(root, 'README.md'), 'utf8')
  const palette = await readFile(resolve(root, 'screenshots', 'color-palette.svg'), 'utf8')
  const start = '<!-- fixed-color-values:start -->'
  const end = '<!-- fixed-color-values:end -->'
  const startIndex = readme.indexOf(start)
  const endIndex = readme.indexOf(end)

  assert.ok(readme.includes('screenshots/color-palette.svg'), 'README does not embed the palette chart')
  assert.ok(startIndex >= 0 && endIndex > startIndex, 'README palette markers are missing or reversed')
  assert.match(palette, /^<svg\b/)
  assert.match(palette, /<\/svg>\s*$/)

  const documented = readme.slice(startIndex + start.length, endIndex)

  const uniqueMatches = (source, pattern, transform = (value) => value.toLowerCase()) =>
    [...new Set([...source.matchAll(pattern)].map((match) => transform(match[1] ?? match[0])))].sort()
  const hexPattern = /#[\da-f]{6}\b/gi
  const rgbPattern = /(rgb\([^)]*\))/gi
  const cssHslPattern = /^\s*--[\w-]+:\s*(\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%);/gm
  const documentedHslPattern = /`(\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%)`/g
  const chartHslPattern = /hsl\((\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%)\)/g
  const normalizeComponents = (value) => value.toLowerCase().replace(/\s+/g, ' ')

  const expected = {
    hex: uniqueMatches(css, hexPattern),
    rgb: uniqueMatches(css, rgbPattern),
    hsl: uniqueMatches(css, cssHslPattern, normalizeComponents)
  }
  const readmeColors = {
    hex: uniqueMatches(documented, hexPattern),
    rgb: uniqueMatches(documented, rgbPattern),
    hsl: uniqueMatches(documented, documentedHslPattern, normalizeComponents)
  }
  const chartColors = {
    hex: uniqueMatches(palette, hexPattern),
    rgb: uniqueMatches(palette, rgbPattern),
    hsl: uniqueMatches(palette, chartHslPattern, normalizeComponents)
  }

  assert.deepEqual(
    { hex: expected.hex.length, rgb: expected.rgb.length, hsl: expected.hsl.length },
    { hex: 50, rgb: 27, hsl: 9 },
    'stylesheet color inventory changed unexpectedly'
  )
  assert.deepEqual(readmeColors, expected, 'README fixed-color tables have drifted from theme.css')
  assert.deepEqual(chartColors, expected, 'palette chart has drifted from theme.css')

  for (const keyword of ['transparent', 'inherit', 'currentColor', 'Canvas', 'CanvasText', 'LinkText', 'Highlight', 'HighlightText']) {
    assert.ok(readme.includes(`\`${keyword}\``), `README does not explain ${keyword}`)
  }
})

test('the plugin entry loads the vendored SDK before the property script', async () => {
  const sdk = await readFile(resolve(root, 'lib', 'lsplugin.user.js'), 'utf8')
  assert.ok(sdk.length > 10_000, 'the vendored SDK is unexpectedly small')

  assert.match(entry, /<script src="\.\/lib\/lsplugin\.user\.js"><\/script>/)
  assert.match(entry, /<script src="\.\/index\.js"><\/script>/)
  assert.ok(
    entry.indexOf('lsplugin.user.js') < entry.indexOf('index.js'),
    'index.js runs before the SDK defines the logseq global'
  )
  // The SDK and the theme's own script, and nothing else: the reference parser
  // is the Passage package's, and loading it here would ship a second copy.
  assert.deepEqual([...entry.matchAll(/<script src="([^"]+)"/g)].map(([, src]) => src), [
    './lib/lsplugin.user.js',
    './index.js'
  ])
})

test('the theme ships nothing that belongs to Passage', async () => {
  /* Passage is a package of its own. The theme styles the blocks it writes, but
   * it neither carries its files nor depends on it being installed. */
  await assert.rejects(access(resolve(root, 'bible.js'), constants.F_OK))
  await assert.rejects(access(resolve(root, 'resources'), constants.F_OK))
  await assert.rejects(access(resolve(root, 'scripts', 'build-bible-index.mjs'), constants.F_OK))

  assert.deepEqual(pkg.files.filter((file) => /bible|resources/i.test(file)), [])

  const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /bible|registerSlashCommand|data-passage-/i)
  // The one exception is the render Logseq emits for a passage block, which is
  // content in the graph rather than anything the plugin provides.
  assert.match(code, /'\.passage'/)
})

test('the property script reads the host document and hides only its own table', () => {
  assert.match(script, /parent\.document/)
  /* Every attribute and style key the theme writes is its own, so a sibling
   * plugin annotating the same document is never read, replaced or cleared. */
  for (const attribute of script.match(/'data-[\w-]+'/g) ?? []) {
    assert.match(attribute, /^'data-hc-/, `${attribute} is not namespaced to the theme`)
  }
  assert.match(script, /\.block-properties\[\$\{HIDDEN_ATTR\}\] \{ display: none; \}/)
  assert.match(script, /logseq\.ready\(main\)/)

  /* Observing attributes would make each pass schedule the next one, and the
   * sandbox iframe is never rendered, so its own rAF never fires. */
  assert.match(script, /\{ childList: true, subtree: true \}/)
  assert.doesNotMatch(script, /attributes:\s*true/)
  assert.doesNotMatch(script, /(?<!parent\.)requestAnimationFrame/)
})

test('official High Contrast palette values remain exact', () => {
  const expected = {
    '--vscode-hc-black': '#000000',
    '--vscode-hc-white': '#ffffff',
    '--vscode-hc-focus': '#f38518',
    '--vscode-hc-border': '#5b7e96',
    '--vscode-hc-blue': '#569cd6',
    '--vscode-hc-link': '#3794ff',
    '--vscode-hc-green': '#7ca668',
    '--vscode-hc-string': '#ce9178',
    '--vscode-hc-purple': '#c586c0',
    '--vscode-hc-cyan': '#9cdcfe',
    '--vscode-hc-type': '#4ec9b0',
    '--vscode-hc-yellow': '#ffff00',
    '--vscode-hc-error': '#f48771'
  }

  for (const [name, value] of Object.entries(expected)) assert.equal(cssValue(name), value)
})

test('classic and ShUI theme contracts cover every planned surface', () => {
  for (const variable of [
    '--background', '--foreground', '--card', '--popover', '--primary', '--accent', '--ring',
    '--ls-primary-background-color', '--ls-secondary-background-color', '--ls-tertiary-background-color',
    '--ls-primary-text-color', '--ls-secondary-text-color', '--ls-border-color', '--ls-focus-ring-color',
    '--ls-left-sidebar-border-color', '--ls-right-sidebar-topbar-color', '--ls-header-button-background',
    '--ls-notification-background', '--ls-error-background-color', '--ls-warning-background-color',
    '--ls-success-background-color', '--ls-color-file-sync-error', '--ls-color-file-sync-pending',
    '--ls-color-file-sync-idle', '--ls-block-bullet-active-color', '--ls-block-left-color',
    '--ph-link-color', '--ph-highlight-scroll-into-color', '--ls-whiteboard-tooltip-background',
    '--ls-whiteboard-select-background-selected', '--ls-wb-background-color-default',
    '--ls-wb-stroke-color-default', '--ls-wb-text-color-default'
  ]) {
    assert.match(css, new RegExp(`${escapeRegExp(variable)}\\s*:`), `${variable} is missing`)
  }
})

test('workbench selectors and accessibility fallbacks are present', () => {
  for (const pattern of [
    /\.cp__header\s*\{/,
    /\.left-sidebar-inner \.nav-content-item \.header/,
    /\.cp__right-sidebar \.sidebar-item \.sidebar-item-header/,
    /\.cp__cmdk/,
    /\[cmdk-item\]/,
    /\.settings-modal/,
    /\.ui__notifications \.notification-area/,
    /\.extensions__pdf-toolbar/,
    /\.whiteboard-page-title/,
    /:focus-visible/,
    /forced-colors:\s*active/,
    /prefers-reduced-motion:\s*reduce/
  ]) assert.match(css, pattern)
})

test('focused layout and nested-block behavior remain part of the theme', () => {
  assert.match(css, /\.cp__sidebar-main-content:not\(\[data-is-full-width="true"\]\)/)
  assert.match(css, /width:\s*80%/)
  assert.match(css, /\.ls-block\[data-hc-hide-bullet\] > \.block-main-container > \.block-control-wrap \.bullet-container:not\(\.typed-list\)\s*\{[\s\S]*?opacity:\s*0\s*!important/)
  assert.match(css, /\.ls-block:has\(> \.block-main-container > \.block-content-wrapper:is\([^)]*\[style\*="text-align: center"\][^)]*\)\)[\s\S]*?> \.block-main-container > \.block-control-wrap \.bullet-container:not\(\.typed-list\)/)
  assert.match(css, /\.ls-block:has\(> \.block-main-container > \.block-content-wrapper :is\([^)]*\[style\*="text-align: center"\][^)]*\)\)[\s\S]*?> \.block-main-container > \.block-control-wrap \.bullet-container:not\(\.typed-list\)\s*\{[\s\S]*?opacity:\s*0\s*!important/)
  assert.doesNotMatch(css, /\.ls-block:hover:has\(\.ls-block:hover\)/)
  assert.doesNotMatch(css, /\.ls-block:(?:hover|focus-within)\s*> \.block-main-container > \.block-control-wrap \.bullet-container:not\(\.typed-list\)/)
  assert.match(css, /\.ls-block:hover:not\(:has\(\.ls-block:hover\)\)/)
  assert.match(css, /\.block-children,[\s\S]*?\.block-children-left-border\s*\{[\s\S]*?border-left:\s*0\s*!important[\s\S]*?background-color:\s*transparent\s*!important/)
})

/* Hovering a block outlines it but must not fill it. The gray raised fill is
 * reserved for the deliberate, persistent states: a selected block and
 * Logseq's own `.block-highlight`. */
test('block hover outlines without painting a background', () => {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|\n)([^{}]+?)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => [selector.replace(/\s+/g, ' ').trim(), body])

  /* The rail lights a hovered block's bullet through a selector that mentions
   * `.block-content-wrapper` only inside a `:not()`. Match on the rule's
   * subject instead: what it paints is the last simple selector. */
  const paints = selector =>
    selectors(selector).some(one =>
      one.replace(/\([^()]*\)/g, '').trim().endsWith('.block-content-wrapper')
    )

  const hoverFill = rules.filter(
    ([selector, body]) =>
      selector.includes('.ls-block:hover') &&
      paints(selector) &&
      /(?:^|[;{\s])background(?:-color)?\s*:/.test(body)
  )
  assert.deepEqual(hoverFill, [], 'hovering a block must not set a background')

  const hoverOutline = rules.find(
    ([selector, body]) =>
      selector.includes('.ls-block:hover:not(:has(.ls-block:hover)) > .flex > .block-content-wrapper') &&
      /outline:\s*1px solid var\(--vscode-hc-border\)/.test(body)
  )
  assert.ok(hoverOutline, 'the hovered block keeps its outline')

  const persistentFill = rules.find(
    ([selector, body]) =>
      selector.includes('.ls-block.selected > .flex > .block-content-wrapper') &&
      selector.includes('.block-highlight') &&
      /background:\s*var\(--ls-block-highlight-color\)/.test(body)
  )
  assert.ok(persistentFill, 'selected and highlighted blocks keep the raised fill')
  assert.ok(
    !persistentFill[0].includes(':hover'),
    'the raised fill must not be shared with a hover selector'
  )

  /* The property table still drops its border on the hovered block, so the
   * panel and the block read as one surface. Losing the fill did not change
   * that, but the rule has to carry the innermost-hover guard: without it an
   * ancestor's own table went borderless whenever a child was hovered. */
  const propertyBorder = rules.find(
    ([selector, body]) =>
      selector.includes('.ls-block:hover') &&
      selector.includes('.block-properties') &&
      /border-color:\s*transparent/.test(body)
  )
  assert.ok(propertyBorder, 'the hovered block hides its property table border')
  assert.ok(
    propertyBorder[0].includes(':hover:not(:has(.ls-block:hover))'),
    'only the innermost hovered block hides its property table border'
  )
})

/* The bullet rail: every block in the page's own tree hangs its bullet on one
 * vertical line. cascade.test.mjs checks the arithmetic that places it; these
 * are the rules about where the rail is allowed to reach and what it shows. */
const railScope =
  'main:not(.ls-fold-button-on-right) #main-content-container .page-blocks-inner .content:not(.doc-mode)'
const railRules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|\n)([^{}]+?)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => [selector.replace(/\s+/g, ' ').trim(), body])
  .filter(([selector]) => selector.includes('#main-content-container .page-blocks-inner'))

/* A selector list, split at the commas that separate selectors rather than the
 * ones inside `:is()` and `:has()`. */
function selectors(list) {
  const found = []
  let depth = 0
  let start = 0
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === '(') depth += 1
    else if (list[index] === ')') depth -= 1
    else if (list[index] === ',' && depth === 0) {
      found.push(list.slice(start, index).trim())
      start = index + 1
    }
  }
  found.push(list.slice(start).trim())
  return found
}

/* What a selector actually paints: its last compound, with the guards a rule
 * qualifies itself by — `:has()`, `:not()` — taken back off. */
function subject(selector) {
  let plain = selector
  let previous
  do {
    previous = plain
    plain = plain.replace(/:(?:has|not|is|where)\([^()]*\)/g, '')
  } while (plain !== previous)
  return plain.split(/[\s>]+/).filter(Boolean).pop() ?? ''
}

test('the rail reaches the page tree in the main editor and nothing else', () => {
  assert.ok(railRules.length >= 20, 'the rail is missing from the stylesheet')

  for (const [selector] of railRules) {
    for (const part of selectors(selector)) {
      // Sidebars, whiteboards and dialogs render outside the main editor; the
      // right-hand fold button and document mode re-measure the indentation the
      // rail is drawn from. All four are out of reach by construction.
      assert.ok(part.startsWith(railScope), `a rail rule escapes the main editor: "${part.slice(0, 60)}…"`)
      // Embedded and queried trees render inside a block's content and keep
      // Logseq's own layout rather than being pulled onto the page's rail.
      assert.ok(
        part.includes('.ls-block:not(.block-content-wrapper *)'),
        `a rail rule reaches an embedded tree: "${part.slice(0, 60)}…"`
      )
    }
  }

  for (const surface of ['.cp__right-sidebar', '#right-sidebar', '.ui__modal', '.whiteboard', '.references']) {
    assert.ok(
      railRules.every(([selector]) => !selector.includes(surface)),
      `the rail names ${surface}, which is not the primary editor`
    )
  }
})

test('every rendered block in the main editor keeps a bullet on the rail', () => {
  const wrapSelector =
    `${railScope} .ls-block:not(.block-content-wrapper *) > .block-main-container > .block-control-wrap`
  const declarations = (selector) => {
    const found = railRules.find(([candidate]) => candidate === selector)
    assert.ok(found, `no rail rule for "${selector}"`)
    return found[1]
  }

  // The bullets the theme hides elsewhere — code, centered text, verse,
  // passages, empty blocks — are all part of the rail.
  assert.match(declarations(`${wrapSelector} .bullet-container`), /opacity:\s*1\s*!important/)

  // The control column spans its row so the rail line can run the height of a
  // block, and the bullet stays on the row's first line rather than drifting to
  // the middle of a tall one.
  const wrap = declarations(wrapSelector)
  assert.match(wrap, /align-self:\s*stretch/)
  assert.match(wrap, /align-items:\s*flex-start/)

  // The nested connector lines the theme hides stay hidden: the rail replaces
  // them, and this is the rule that keeps them from coming back.
  assert.match(css, /\.block-children,[\s\S]*?\.block-children-left-border\s*\{[\s\S]*?border-left:\s*0\s*!important/)

  // The rail reads `.block-children` as the record of how deep a block sits and
  // declares nothing on those boxes: not a connector line, and not a display
  // that would reveal the descendants a collapsed block never renders. Every
  // rule paints a row or something in its control column, and nothing else —
  // the block types a rule names to place a bullet are guards on the row, not
  // boxes it touches.
  const painted = /^(?:\.block-main-container|\.block-control-wrap|\.block-control|\.bullet-link-wrap|\.bullet-container|\.bullet|label)(?:\.[\w-]+)*(?:::(?:before|after))?$/
  for (const [selector] of railRules) {
    for (const part of selectors(selector)) {
      assert.match(
        subject(part),
        painted,
        `a rail rule paints something other than a block's own control column: "${part.slice(0, 60)}…"`
      )
    }
  }
})

test('interactive chrome stays black with one-pixel orange borders', () => {
  assert.match(css, /#search-button,[\s\S]*?border-color:\s*transparent\s*!important/)
  assert.match(css, /#search-button:hover,[\s\S]*?border-color:\s*var\(--vscode-hc-focus\)\s*!important/)
  assert.match(css, /\.left-sidebar-inner a\.item:hover,[\s\S]*?border-color:\s*var\(--vscode-hc-focus\)/)
  assert.match(css, /textarea\.block-editor:focus\s*\{[\s\S]*?border:\s*1px solid var\(--vscode-hc-focus\)\s*!important[\s\S]*?box-shadow:\s*none\s*!important/)
  assert.match(css, /th\s*\{[\s\S]*?background:\s*var\(--vscode-hc-black\)\s*!important/)
  assert.match(css, /kbd\s*\{[\s\S]*?background:\s*var\(--vscode-hc-black\)/)
})

test('fenced code has a single outer border', () => {
  assert.match(css, /pre\s*>\s*code[\s\S]*?background:\s*transparent[\s\S]*?border:\s*0/)
})

test('named admonitions share their icon color with a four-pixel divider', () => {
  const types = ['tip', 'note', 'important', 'caution', 'pinned', 'warning']
  const scopedTypes = types.map((type) => `.${type}`).join(', ')
  const semanticAccents = {
    tip: 'var(--vscode-hc-focus)',
    note: '#ebbc00',
    important: '#eb9091',
    caution: '#fa934e',
    pinned: 'currentColor',
    warning: '#fa934e'
  }

  for (const type of types) {
    assert.match(
      css,
      new RegExp(`\\.admonitionblock\\.${type}(?:,|\\s*\\{)[\\s\\S]*?--hc-admonition-accent\\s*:\\s*${escapeRegExp(semanticAccents[type])}`),
      `${type} does not preserve its semantic accent`
    )
  }

  assert.match(
    css,
    new RegExp(`\\.admonitionblock:is\\(${escapeRegExp(scopedTypes)}\\)\\s*\\{[\\s\\S]*?border-color:\\s*transparent\\s*!important`)
  )
  assert.match(
    css,
    new RegExp(`\\.admonitionblock:is\\(${escapeRegExp(scopedTypes)}\\) \\.admonition-icon\\s*\\{[\\s\\S]*?color:\\s*var\\(--hc-admonition-accent\\)\\s*!important[\\s\\S]*?border-right:\\s*4px solid var\\(--hc-admonition-accent\\)\\s*!important`)
  )
  assert.match(
    css,
    new RegExp(`\\.admonitionblock:is\\(${escapeRegExp(scopedTypes)}\\) \\.admonition-icon svg\\s*\\{[\\s\\S]*?color:\\s*var\\(--hc-admonition-accent\\)\\s*!important[\\s\\S]*?fill:\\s*var\\(--hc-admonition-accent\\)\\s*!important`)
  )

  assert.doesNotMatch(css, /\.admonitionblock:not\(/)
  assert.match(css, /blockquote\s*\{[\s\S]*?border-left:\s*4px solid var\(--vscode-hc-border\)/)
  assert.match(css, /\.notification-content\.warning,\s*\.warning\s*\{[\s\S]*?border-color:\s*var\(--vscode-hc-yellow\)\s*!important/)
})

test('the passage block reproduces the admonition treatment on its own selectors', () => {
  // Logseq emits no `.admonitionblock` for `#+BEGIN_PASSAGE`, so `.passage`
  // must not join the admonition type list; it carries the shared accent
  // vocabulary instead.
  assert.doesNotMatch(css, /\.admonitionblock:is\([^)]*passage/)
  assert.match(css, /\.block-body > \.passage \{[\s\S]*?--hc-admonition-accent:\s*var\(--vscode-hc-cyan\)/)
  assert.match(
    css,
    /\.block-body > \.passage \{[\s\S]*?background:\s*var\(--vscode-hc-black\)\s*!important[\s\S]*?border:\s*1px solid transparent\s*!important/
  )

  // The indent a real admonition builds out of `w-8` + `pr-4` + the divider +
  // `ml-4`, restated as padding, and the row height its `h-8` icon forces.
  assert.match(
    css,
    /\.block-body > \.passage \{[\s\S]*?padding:\s*0 0 0 4\.25rem[\s\S]*?min-height:\s*2rem[\s\S]*?font-size:\s*1\.125rem/
  )

  // The divider is its own pseudo-element: a mask clips the border off the box
  // it is applied to, so the glyph and the line cannot share one element.
  assert.match(
    css,
    /\.block-body > \.passage::before \{[\s\S]*?width:\s*3rem;[\s\S]*?border-right:\s*4px solid var\(--hc-admonition-accent\)/
  )
  assert.doesNotMatch(css, /\.block-body > \.passage::before \{[^}]*mask/)

  // The glyph: a full-height box with the icon centered in it, matching the
  // `flex-col justify-center` column and `h-8 w-8` icon of an admonition.
  assert.match(
    css,
    /\.block-body > \.passage::after \{[\s\S]*?width:\s*2rem;[\s\S]*?background-color:\s*var\(--hc-admonition-accent\)/
  )
  assert.match(css, /\.block-body > \.passage::after \{[^}]*?\n\s*mask-position:\s*50% 50%/)
  assert.match(css, /\.block-body > \.passage::after \{[^}]*?\n\s*mask-size:\s*2rem 2rem/)
  // `mask-image` over a colored `background-image`, so the icon's color stays a
  // palette token rather than being baked into the SVG.
  assert.match(css, /\.block-body > \.passage::after \{[\s\S]*?\n\s*mask-image:\s*url\("data:image\/svg\+xml,/)
  assert.match(css, /\.block-body > \.passage::after \{[\s\S]*?-webkit-mask-image:\s*url\("data:image\/svg\+xml,/)
  assert.doesNotMatch(css, /\.block-body > \.passage::after \{[^}]*background-image:/)

  // The bullet must go before the asynchronous stored-source lookup resolves.
  assert.match(
    css,
    /\.ls-block:has\(> \.block-main-container > \.block-content-wrapper :is\([^)]*\.passage\)\)[\s\S]*?> \.block-main-container > \.block-control-wrap \.bullet-container:not\(\.typed-list\)/
  )
})

test('verse numbers are cyan, and hang in a gutter where the block asks for one', () => {
  // The number is a `mark` because that is the only element the markup can give
  // it: mldoc reads a `<` opening a line as block-level HTML, so it cannot carry
  // a tag of its own, and a bare run of digits is nothing CSS can reach.
  assert.match(
    css,
    /\.block-body > \.passage mark \{[\s\S]*?color:\s*var\(--vscode-hc-cyan\)[\s\S]*?background:\s*transparent/
  )

  // One variable carries the gutter: zero on the passage itself, so every rule
  // reading it is inert, and a width only on a block whose source says every
  // verse number opens a line. 1.75em clears the widest number in the canon.
  assert.match(css, /\.block-body > \.passage \{[\s\S]*?--hc-verse-gutter:\s*0px/)
  assert.match(
    css,
    /\.ls-block\[data-hc-verse-lines\] > \.block-main-container > \.block-content-wrapper \.block-body > \.passage \{\s*--hc-verse-gutter:\s*1\.75em/
  )

  // The verses are indented by the gutter and each number is pulled back out of
  // it, which is what puts a wrapped verse in line with its own text.
  assert.match(
    css,
    /\.block-body > \.passage > \* \{[\s\S]*?padding-left:\s*var\(--hc-verse-gutter\)/
  )
  assert.match(
    css,
    /\.block-body > \.passage mark \{[\s\S]*?min-width:\s*var\(--hc-verse-gutter\);\s*\n\s*margin-left:\s*calc\(-1 \* var\(--hc-verse-gutter\)\)/
  )

  // The reference and the chapter headings open lines of their own, so they
  // hang out to the passage's edge rather than sitting in the gutter.
  assert.match(
    css,
    /\.block-body > \.passage :is\(b:first-child, br \+ b\) \{\s*margin-left:\s*calc\(-1 \* var\(--hc-verse-gutter\)\)/
  )
})

test('a visible property table renders below the admonition or passage it names', () => {
  // Logseq renders `.block-properties` ahead of `.block-body`, so the scope has
  // to name both halves at once: a rendered box, and a table `index.js` has not
  // marked hidden. A table the configuration hides stays where it is, and so
  // does every ordinary block.
  const boxes = ':is(.admonitionblock:is(.tip, .note, .important, .caution, .pinned, .warning), .passage)'
  const scope = `.block-content:has(> .block-body > ${boxes}):has(> .block-properties:not([data-hc-hidden]))`

  assert.match(
    css,
    new RegExp(`${escapeRegExp(scope)} \\{\\s*\\n\\s*display:\\s*flex;\\s*\\n\\s*flex-direction:\\s*column;`),
    'the reordering column is missing or is not scoped to a visible table on a rendered box'
  )

  // Last in the column, and lined up with the box's text: the box's own 1px
  // edge, then the 4.25rem indent its content sits at. The table is set off
  // from the box above it and carries the box's 2rem tail below it.
  assert.match(
    css,
    new RegExp(`${escapeRegExp(scope)} > \\.block-properties \\{[\\s\\S]*?order:\\s*1;[\\s\\S]*?margin-left:\\s*calc\\(4\\.25rem \\+ 1px\\);[\\s\\S]*?margin-top:\\s*0\\.75rem;[\\s\\S]*?margin-bottom:\\s*2rem;`)
  )

  // The 2rem tail moves off the box and onto the table below it, so the table
  // stays with the block it describes rather than drifting to the next one.
  assert.match(
    css,
    new RegExp(`\\.block-content:has\\(> \\.block-properties:not\\(\\[data-hc-hidden\\]\\)\\) > \\.block-body > ${escapeRegExp(boxes)} \\{\\s*\\n\\s*margin-bottom:\\s*0;`)
  )

  // The attribute the scope reads is the one the script writes.
  assert.match(script, /const HIDDEN_ATTR = 'data-hc-hidden'/)

  // No rule may move a property table on its own: every selector that orders or
  // indents one has to name the box it is being moved under, so an ordinary
  // block's properties stay where Logseq puts them.
  for (const rule of css.match(/[^{}]+\{[^{}]*\}/g) ?? []) {
    const [selector, declarations] = rule.split('{')
    if (!selector.includes('.block-properties')) continue
    if (!/(?:^|[\s;])order:|margin-left:/.test(declarations)) continue
    assert.match(
      selector,
      /\.admonitionblock|\.passage/,
      `"${selector.trim()}" moves a property table without naming a rendered box`
    )
  }
})

test('workbench chrome is bordered in the contrast border, not white', () => {
  // Panes, panels, sidebars and controls all draw their edges with
  // --vscode-hc-border. Two declarations use a border property to paint
  // something that is not chrome, and stay white on purpose.
  const allowed = new Set([
    '--ls-block-bullet-border-color: var(--vscode-hc-white)',
    'border-left-color: var(--vscode-hc-white) !important'
  ])

  const offenders = (css.match(/[\w-]*border[\w-]*\s*:\s*[^;{}]*--vscode-hc-white[^;{}]*/g) ?? [])
    .map((declaration) => declaration.replace(/\s+/g, ' ').trim())
    .filter((declaration) => !allowed.has(declaration))

  assert.deepEqual(offenders, [], 'chrome border is still painted white')

  // The tokens the rest of the theme and Logseq's ShUI components read.
  assert.equal(cssValue('--ls-border-color'), 'var(--vscode-hc-border)')
  assert.equal(cssValue('--ls-left-sidebar-border-color'), 'var(--vscode-hc-border)')
  assert.equal(cssValue('--ls-settings-header-border-color'), 'var(--vscode-hc-border)')
  assert.equal(cssValue('--border'), '204 24% 47%')
  assert.equal(cssValue('--input'), '204 24% 47%')

  // The panes themselves.
  assert.match(css, /\.left-sidebar-inner\s*\{[\s\S]*?border-right:\s*1px solid var\(--vscode-hc-border\)/)
  assert.match(css, /\.cp__right-sidebar\s*\{[\s\S]*?border-left:\s*1px solid var\(--vscode-hc-border\)/)
  assert.match(css, /\.cp__header\s*\{[\s\S]*?border-bottom:\s*1px solid var\(--vscode-hc-border\)/)
})

test('stylesheet is local, structurally balanced, and avoids global monospace', () => {
  assert.doesNotMatch(css, /@import\s+url\(/i)
  // The SVG namespace inside the inline passage icon is an XML identifier that
  // is never dereferenced. Every other absolute URL would be a remote fetch.
  assert.doesNotMatch(css.replaceAll("http://www.w3.org/2000/svg", ''), /https?:\/\//i)
  assert.doesNotMatch(css, /body\s*\{[^}]*font-family:\s*(?:monospace|[^;]*mono)/i)

  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let depth = 0
  for (const char of withoutComments) {
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    assert.ok(depth >= 0, 'closing brace appears before an opening brace')
  }
  assert.equal(depth, 0, 'stylesheet has unbalanced braces')
})

test('principal foreground/background pairs meet WCAG thresholds', () => {
  for (const [name, foreground, background, minimum] of [
    ['primary text', '#ffffff', '#000000', 7],
    ['secondary text', '#d7d7d7', '#000000', 7],
    ['disabled text', '#a0a0a0', '#000000', 4.5],
    ['link text', '#3794ff', '#000000', 4.5],
    ['selection text', '#000000', '#ffffff', 7],
    ['string token', '#ce9178', '#000000', 4.5],
    ['comment token', '#7ca668', '#000000', 4.5],
    ['verse number', '#9cdcfe', '#000000', 7],
    ['warning text', '#ffff00', '#332a00', 4.5],
    ['error text', '#f48771', '#3b0d08', 4.5],
    ['success text', '#b7d6a8', '#14240f', 4.5],
    // A border is a non-text UI component, so 3:1 is the threshold it has to clear.
    ['pane border', '#5b7e96', '#000000', 3]
  ]) {
    assert.ok(contrast(foreground, background) >= minimum, `${name} contrast is too low`)
  }
})

test('the theme is a self-contained workspace of the monorepo root', async () => {
  const repo = resolve(root, '..', '..')
  const workspace = JSON.parse(await readFile(resolve(repo, 'package.json'), 'utf8'))

  assert.equal(workspace.private, true, 'the coordinator would otherwise be publishable')
  assert.ok(workspace.workspaces.includes('packages/*'), 'the package is outside the workspaces glob')
  assert.equal(resolve(repo, 'packages', 'dark-high-contrast'), root)

  // The coordinator aggregates; it owns no sources and no dependencies of its
  // own, so a package stays installable without `npm install`.
  for (const script of ['test', 'build', 'verify:release', 'check']) {
    assert.match(workspace.scripts[script], /--workspaces/, `root ${script} does not aggregate`)
    assert.ok(pkg.scripts[script], `the theme does not define ${script}`)
  }
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    assert.equal(workspace[field], undefined, `the root declares ${field}`)
    assert.equal(pkg[field], undefined, `the theme declares ${field}`)
  }

  // Everything the archive ships is resolved inside this package: nothing is
  // read from the repository root or from a sibling package.
  for (const file of pkg.files) await access(resolve(root, file), constants.R_OK)
  const build = await readFile(resolve(root, 'scripts', 'build-release.mjs'), 'utf8')
  assert.ok(!/\.\.\/\.\.|packages\//.test(build), 'the build reaches outside the package')
})
