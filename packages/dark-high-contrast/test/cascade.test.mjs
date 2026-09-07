/*
 * Cascade regression tests.
 *
 * The theme loads after Logseq's own `style.css`, so a theme declaration only
 * takes effect when its selector's specificity is greater than or equal to the
 * upstream selector it has to beat. Every stock-color leak this suite guards
 * against was an upstream selector quietly out-ranking a theme selector, which
 * is invisible when reading either stylesheet on its own.
 *
 * Logseq's stylesheet is not a dependency of this repository, so the upstream
 * selectors and token names are pinned here as literals. Point LOGSEQ_CSS at an
 * installed `style.css` to additionally verify those literals still match the
 * shipping app.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compareSpecificity as compare, specificity, splitSelectors } from '../../../test/support/pinned-css.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const css = await readFile(resolve(root, 'theme.css'), 'utf8')

/* Specificity as [ids, classes/attributes/pseudo-classes, types/pseudo-elements].
 * `:not()`, `:is()` and `:has()` take the specificity of their most specific
 * argument and contribute nothing themselves; `:where()` contributes nothing. */
const format = (value) => `(${value.join(',')})`

/* Each pairing names the upstream selector the theme must out-rank and the
 * theme selector that does it. `tie` marks a deliberate equal-specificity
 * match, which the theme wins on stylesheet order. */
const pairings = [
  {
    surface: 'the --ls-* palette block',
    upstream: 'html[data-theme=dark][data-color=logseq]',
    theme: 'html[data-theme][data-color]:root'
  },
  {
    surface: 'the --lx-* Radix scale block',
    upstream: 'html[data-color=blue] body',
    theme: 'html[data-theme][data-color]:root body'
  },
  {
    surface: 'inline code',
    upstream: ':not(pre)>code',
    theme: ':root :not(pre) > code'
  },
  {
    surface: "the PDF viewer's own background token",
    upstream: '.extensions__pdf-container',
    theme: '.extensions__pdf-container[data-theme]'
  },
  {
    surface: 'even table rows',
    upstream: '.block-content tr:nth-child(2n)',
    theme: '.block-content tr:nth-child(even)',
    tie: true
  },
  {
    surface: 'scrollbar troughs',
    upstream: '.visible-scrollbar ::-webkit-scrollbar',
    theme: '.visible-scrollbar ::-webkit-scrollbar',
    tie: true
  },
  {
    surface: 'date picker day hover',
    upstream: '.datepicker td.available:hover',
    theme: '.datepicker td.available:hover',
    tie: true
  },
  {
    surface: 'the installed-themes list hover',
    upstream: 'html[data-theme=dark][data-color=logseq] .cp__themes-installed .it:hover',
    theme: 'html[data-theme][data-color] .cp__themes-installed .it:hover',
    tie: true
  },
  {
    surface: 'rendered admonition icon dividers',
    upstream: '.admonition-icon',
    theme: '.admonitionblock:is(.tip, .note, .important, .caution, .pinned, .warning) .admonition-icon'
  },
  {
    surface: 'verse numbers',
    upstream: 'mark',
    theme: '.block-body > .passage mark'
  },
  {
    surface: 'a property table under an admonition or a passage',
    upstream: '.block-properties',
    theme:
      '.block-content:has(> .block-body > :is(.admonitionblock:is(.tip, .note, .important, .caution, .pinned, .warning), .passage)):has(> .block-properties:not([data-hc-hidden])) > .block-properties'
  }
]

test('theme selectors out-rank the upstream rules they replace', () => {
  for (const { surface, upstream, theme, tie } of pairings) {
    const ours = specificity(theme)
    const theirs = specificity(upstream)
    const order = compare(ours, theirs)
    const detail = `${surface}: theme ${format(ours)} vs upstream ${format(theirs)}`
    if (tie) assert.equal(order, 0, `${detail} — expected an exact tie won on load order`)
    else assert.ok(order > 0, `${detail} — theme does not out-rank upstream`)
    assert.ok(css.includes(theme), `${surface}: "${theme}" is missing from theme.css`)
  }
})

test('the variable block beats every accent Logseq ships', () => {
  // Logseq re-declares --ls-* per accent on html[data-theme=…][data-color=…]
  // and --lx-* on `html[data-color=…] body`. Both forms must lose.
  for (const accent of ['logseq', 'tomato', 'blue', 'green', 'olive', 'sand']) {
    assert.ok(
      compare(
        specificity('html[data-theme][data-color]:root'),
        specificity(`html[data-theme=dark][data-color=${accent}]`)
      ) > 0,
      `--ls-* block loses to the ${accent} accent`
    )
    assert.ok(
      compare(
        specificity('html[data-theme][data-color]:root body'),
        specificity(`html[data-color=${accent}] body`)
      ) > 0,
      `--lx-* block loses to the ${accent} accent`
    )
  }
})

/* Logseq resolves backgrounds as var(--lx-…, var(--ls-…, var(--rx-…))), so an
 * undefined --lx-* token hands the surface to the selected accent's Radix ramp.
 * All 50 tokens the app reads have to be pinned by the theme. */
const radixTokens = [
  ...Array.from({ length: 12 }, (_, i) => `--lx-gray-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 12 }, (_, i) => `--lx-gray-${String(i + 1).padStart(2, '0')}-alpha`),
  ...Array.from({ length: 12 }, (_, i) => `--lx-accent-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 12 }, (_, i) => `--lx-accent-${String(i + 1).padStart(2, '0')}-alpha`),
  '--lx-popover-bg',
  '--lx-pdf-container-dark-bg'
]

test('every Radix token Logseq reads is pinned by the theme', () => {
  for (const token of radixTokens) {
    assert.match(css, new RegExp(`^\\s*${token}\\s*:`, 'm'), `${token} is not defined`)
  }
})

test('the unprefixed --color-level chain is pinned', () => {
  for (let level = 1; level <= 6; level += 1) {
    assert.match(css, new RegExp(`^\\s*--color-level-${level}\\s*:`, 'm'))
  }
  assert.match(css, /\.color-level\s*\{[\s\S]*?background-color:\s*var\(--vscode-hc-black\)\s*!important/)
})

test('the theme never falls through to an upstream --rx-* ramp', () => {
  assert.doesNotMatch(css, /var\(\s*--rx-/)
})

test('the forced-colors override matches the main block specificity', () => {
  const block = css.match(/@media\s*\(forced-colors:\s*active\)\s*\{(?:[^{}]|\{[^{}]*\})*/)
  assert.ok(block, 'forced-colors block is missing')
  assert.match(block[0], /html\[data-theme\]\[data-color\]:root/)
  assert.match(block[0], /--lx-gray-01:\s*Canvas/)
})

/* Surfaces that previously rendered in Logseq's stock palette because the theme
 * had no rule for them at all. */
test('every repaired surface still carries a rule', () => {
  for (const [surface, selector] of [
    ['block hover highlight', '.block-highlight'],
    ['odd table rows', '.block-content tr:nth-child(odd)'],
    ['checkbox and radio fills', '.form-radio'],
    ['scrollbar corners', '::-webkit-scrollbar-corner'],
    ['search match highlighting', '.ui__list-item-highlighted-span'],
    ['shortcut key chips', '.ui__button-shortcut-key'],
    ['closed bullet halos', '.bullet-container:not(.typed-list).bullet-closed'],
    ["Logseq's CodeMirror skin", '.cm-s-lsradix.cm-s-dark'],
    ['the all-pages toolbar', '.cp__all_pages .actions'],
    ['the settings sidebar', '.cp__settings-inner aside'],
    ['the shortcut conflicts list', '.cp__shortcut-conflicts-list-wrap > section'],
    ['the onboarding cards', '.cp__onboarding-setups .inner-card > article.importer'],
    ['the dashboard cards', '.dashboard-create-card'],
    ['the sidebar help popup', '.cp__sidebar-help-menu-popup'],
    ['the PDF text layer', '.extensions__pdf-container[data-theme] .textLayer']
  ]) {
    assert.ok(css.includes(selector), `${surface}: "${selector}" is missing`)
  }
})

/* Logseq builds a rendered admonition as
 * `div.flex.flex-row.admonitionblock` > `div.pr-4.admonition-icon.flex.flex-col
 * .justify-center` (holding an `h-8 w-8` icon) + `div.ml-4.text-lg`. A passage
 * is a bare `div.passage` with no such structure, so the theme rebuilds that
 * geometry out of padding and two pseudo-elements. These are the upstream
 * utility declarations that geometry is derived from; if any of them changes,
 * the passage stops lining up with the admonitions beside it. */
const admonitionMetrics = ['.h-8{height:2rem}', '.w-8{width:2rem}', '.pr-4{padding-right:1rem}', '.ml-4{margin-left:1rem}']

/* The vertical half of the same geometry. A property table moved under a box
 * inherits the box's 2rem tail, and keeps the 4px of its own the table has
 * always carried above it. */
const spacingMetrics = [
  '.abstract,.admonitionblock{margin:2rem 0}',
  '.block-properties,.page-properties{background-color:var(--lx-gray-03,var(--ls-block-properties-background-color,var(--rx-gray-03)));margin:4px 0;padding:4px 8px}'
]

/* A verse number is a `mark`, which upstream dresses as a page highlight. The
 * passage has to undo all of it — the padding above all, since the number is
 * set in a gutter whose width the theme, not the highlight, decides. */
const markDeclaration =
  'mark{background:var(--ls-page-mark-bg-color,#fef3ac);border-radius:3px;' +
  'color:var(--ls-page-mark-color,#262626);padding:2px 4px}'

test('the passage undoes the page-highlight treatment upstream gives a mark', () => {
  const rule = css.match(/\n\.block-body > \.passage mark \{([^}]*)\}/)
  assert.ok(rule, '.block-body > .passage mark is missing')

  for (const [property, value] of [
    ['color', 'var(--vscode-hc-cyan)'],
    ['background', 'transparent'],
    ['padding', '0']
  ]) {
    assert.match(rule[1], new RegExp(`\\n\\s*${property}:\\s*${value.replace(/[().*+?^$|[\]\\]/g, '\\$&')};`))
  }
})

test('the passage indent reproduces the admonition icon column', () => {
  const rule = (selector) => {
    const match = css.match(new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')} \\{([^}]*)\\}`))
    assert.ok(match, `${selector} is missing`)
    return match[1]
  }
  const rem = (declarations, property) => {
    const match = declarations.match(new RegExp(`(?:^|;|\\n)\\s*${property}:\\s*([^;\\n]+)`))
    assert.ok(match, `${property} is missing`)
    const value = match[1].trim().split(/\s+/).at(property === 'padding' ? -1 : 0)
    const number = Number.parseFloat(value)
    return value.endsWith('px') ? number / 16 : number
  }

  const glyph = rule('.block-body > .passage::after')
  const column = rem(rule('.block-body > .passage::before'), 'width')
  const divider = rem(rule('.block-body > .passage::before'), 'border-right')
  const indent = rem(rule('.block-body > .passage'), 'padding')

  // The glyph follows the passage font without changing the historical column.
  assert.match(glyph, /width:\s*var\(--hc-admonition-icon-size\)/)
  assert.equal(rem(rule('.block-body > .passage'), 'min-height'), 2)
  // The fixed icon column retains the old `h-8`/`w-8` plus `pr-4` geometry.
  assert.equal(column, 3)
  // The divider the theme widens on `.admonition-icon`.
  assert.equal(divider, 0.25)
  // Everything above, plus the content column's `ml-4`.
  assert.equal(indent, column + divider + 1)
})

test('the moved property table lines up with the box text and takes the box tail', () => {
  const declarations = (selector) => {
    const start = css.indexOf(`\n${selector} {`)
    assert.ok(start >= 0, `${selector} is missing`)
    return css.slice(start, css.indexOf('}', start))
  }

  const scope =
    '.block-content:has(> .block-body > :is(.admonitionblock:is(.tip, .note, .important, .caution, .pinned, .warning), .passage)):has(> .block-properties:not([data-hc-hidden]))'
  const table = declarations(`${scope} > .block-properties`)

  const offset = table.match(/margin-left:\s*calc\(([\d.]+)rem \+ (\d+)px\)/)
  assert.ok(offset, 'the table carries no offset to the box text')

  // A box's text starts at the indent the passage reserves as padding — the
  // icon column, the divider and the content's own `ml-4` — laid inside the
  // transparent edge the box is drawn with. Both figures are read back off the
  // passage, so the table lines up with the text of either kind of box.
  const indent = declarations('.block-body > .passage').match(/padding:\s*0 0 0 ([\d.]+)rem/)
  const edge = declarations('.block-body > .passage').match(/border:\s*(\d+)px solid transparent/)
  assert.equal(Number.parseFloat(offset[1]), Number.parseFloat(indent[1]))
  assert.equal(Number.parseInt(offset[2], 10), Number.parseInt(edge[1], 10))

  // The table is set off from the box above it: wider than the 4px Logseq gives
  // a table sitting in flow, and well inside the 2rem tail below it, so the gap
  // reads as a break between the box and its own table rather than as the space
  // between two blocks. Both figures are compared at the 16px root the app runs
  // at.
  const rem = 16
  const gap = table.match(/margin-top:\s*([\d.]+)rem;/)
  assert.ok(gap, 'the table sits flush against the box above it')
  const flow = Number.parseInt(spacingMetrics[1].match(/(?:^|;|\{)margin:(\d+)px 0/)[1], 10)
  const above = Number.parseFloat(gap[1]) * rem
  assert.ok(above > flow, `the gap above the table (${above}px) is no wider than Logseq's ${flow}px flow gap`)
  assert.ok(above < 2 * rem, 'the gap above the table is not clearly narrower than the tail below it')

  // The 2rem tail Logseq gives the box moves to the table below it, so the
  // table stays with its own box instead of drifting to the next block.
  assert.ok(spacingMetrics[0].includes('margin:2rem 0'), 'the pinned box tail is no longer 2rem')
  assert.match(table, /margin-bottom:\s*2rem;/)
  assert.match(css, /> \.block-body > :is\([^{]*\.passage\) \{\s*\n\s*margin-bottom:\s*0;/)
})

/* The bullet rail hangs every block's bullet on one vertical line. Every
 * distance it moves a bullet by is Logseq's own: the 29px a nesting level
 * indents its subtree, the 22px fold arrow the bullet sits behind, the 16px
 * bullet, the 24px control box the bullet is centered in, the 2rem the scroll
 * container keeps left of the page, and the size Logseq gives each heading,
 * which is what a heading's bullet drops by. Those are pinned here because the
 * rail is arithmetic on them — if Logseq re-measures a block, the rail bends
 * rather than breaks visibly, so nothing else would catch it. */
const railMetrics = [
  '.block-children-container{margin-left:29px;position:relative}',
  '.block-control-wrap{height:24px;margin-top:0;padding-right:6px}',
  '.bullet-container{align-items:center;border-radius:50%;display:flex;height:16px;justify-content:center;width:16px}',
  '.bullet-container .bullet{border-radius:9999px;font-size:15px;height:6px;opacity:.8;width:6px}',
  '.bullet-container.as-order-list{justify-content:center;padding-left:3px;white-space:nowrap;width:22px}',
  '.block-control-wrap.is-order-list{margin-right:0;padding-right:0}',
  '.block-control-wrap.is-order-list .bullet-link-wrap{left:-3px;position:relative}',
  '#main-content-container{padding-left:2rem;padding-right:2rem}',
  '.editor-inner .h1.uniline-block,.ls-block h1{font-size:2em;min-height:1.5em}',
  '.editor-inner .h2.uniline-block,.ls-block h2{font-size:1.5em;min-height:1.5em}',
  '.editor-inner .h3.uniline-block,.ls-block h3{font-size:1.2em;min-height:1.2em}',
  '.editor-inner .h4.uniline-block,.ls-block h4{font-size:1em;min-height:1em}',
  '.editor-inner .h5.uniline-block,.ls-block h5{font-size:.83em;min-height:.83em}',
  '.editor-inner .h6.uniline-block,.ls-block h6{font-size:.75em;min-height:.75em}',
  // Logseq's own marker for a block with children, which is what the rail reads
  // to decide a block carries the hierarchy. It is written from the block's
  // stored children rather than the rendered ones, so it holds while a block is
  // folded and its subtree is not in the DOM.
  'main.ls-fold-button-on-right .ls-block[haschild=true] .control-hide{display:block!important}',
  // Both layouts re-measure that indentation, which is why the rail opts out of
  // them rather than drawing a line through the wrong column.
  'main.ls-fold-button-on-right .block-children-container{margin-left:7px}',
  '.content.doc-mode .block-children-container{margin-left:18px}'
]

/* Read back off the declarations above. */
const rail = { indent: 29, arrow: 22, bullet: 16, dot: 6, box: 24, gutter: 6, orderList: 22, pagePad: 32 }

/* Logseq's heading sizes, as multiples of the block's own text size. */
const headings = { h1: 2, h2: 1.5, h3: 1.2, h4: 1, h5: 0.83, h6: 0.75 }

/* The rail reaches the page's own tree in the main editor and nothing else:
 * not the sidebars, whiteboards or dialogs that render outside
 * `#main-content-container`, not the embedded and queried trees that render
 * inside a `.block-content-wrapper`, and not the two layouts above. */
const scope =
  'main:not(.ls-fold-button-on-right) #main-content-container .page-blocks-inner .content:not(.doc-mode)'
const block = `${scope} .ls-block:not(.block-content-wrapper *)`
const row = `${block} > .block-main-container`
const wrap = `${row} > .block-control-wrap`

/* Theme rules, as [selector, declarations], with selectors on one line. */
const rules = new Map(
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|\n)([^{}]+?)\{([^{}]*)\}/g)].map(([, selector, body]) => [
    selector.replace(/\s+/g, ' ').trim(),
    body
  ])
)

function rule(selector) {
  const body = rules.get(selector)
  assert.ok(body !== undefined, `no rule for "${selector}"`)
  return body
}

function value(body, property) {
  const match = body.match(new RegExp(`(?:^|;|\\n)\\s*${property}:\\s*([^;\\n]+)`))
  assert.ok(match, `${property} is missing`)
  return match[1].trim()
}

function px(body, property) {
  const match = body.match(new RegExp(`(?:^|;|\\n)\\s*${property}:\\s*(-?[\\d.]+)(?:px|(?=\\s*;))`))
  assert.ok(match, `${property} is missing`)
  return Number.parseFloat(match[1])
}

/* The px an expression adds to a rail variable, as in `calc(var(--x) + 87px)`. */
function added(expression, variable) {
  if (expression === `var(${variable})`) return 0
  const match = expression.match(new RegExp(`^calc\\(var\\(${variable}\\) \\+ ([\\d.]+)px\\)$`))
  assert.ok(match, `"${expression}" is not measured from ${variable}`)
  return Number.parseFloat(match[1])
}

test('the rail stands in the margin Logseq leaves left of the page', () => {
  const base = css.match(/\n:root \{\n  --hc-rail-offset: ([\d.]+)px;\n\}/)
  assert.ok(base, 'the rail has no offset to stand in the margin by')
  const offset = Number.parseFloat(base[1])
  assert.ok(offset > 0, 'the rail does not stand left of the content column')

  // A full-width page has only the scroll container's own padding left of the
  // tree, so the whole control column — the fold arrow included — has to fit
  // inside it.
  const fullWidth = px(
    rule('#main-content-container > .cp__sidebar-main-content[data-is-full-width="true"]'),
    '--hc-rail-offset'
  )
  assert.ok(fullWidth <= rail.pagePad, 'a full-width page draws its rail outside the scroll container')
  assert.ok(fullWidth < offset, 'a full-width page is given the same rail as a page with margins')

  // A narrow window leaves less beside the page, so the rail asks for less.
  const narrow = css.match(/@media \(max-width: (\d+)px\) \{\s*:root \{\s*--hc-rail-offset: (\d+)px;/)
  assert.ok(narrow, 'the rail does not give way on a narrow window')
  assert.ok(Number.parseInt(narrow[2], 10) < offset, 'a narrow window is given the full rail offset')
})

test('the rail takes back exactly the indentation each nesting level applied', () => {
  // Pulled left by everything the level indented plus the margin the rail
  // stands in, and handed back on the other side so the content column does not
  // travel with the bullet.
  const column = rule(wrap)
  assert.equal(value(column, 'margin-left'), 'calc(-1 * var(--hc-rail-indent))')
  assert.equal(value(column, 'margin-right'), 'var(--hc-rail-indent)')
  assert.equal(added(value(column, '--hc-rail-indent'), '--hc-rail-offset'), 0)

  const levels = new Map()
  for (const [selector, body] of rules) {
    if (!selector.startsWith(scope) || !selector.endsWith('.block-control-wrap')) continue
    const depth = selector.split('.block-children ').length - 1
    if (depth === 0) continue
    assert.ok(!levels.has(depth), `nesting level ${depth} is shifted by two rules`)
    assert.equal(
      selector,
      `${scope} ${'.block-children '.repeat(depth)}.ls-block:not(.block-content-wrapper *) > .block-main-container > .block-control-wrap`,
      `the rule for nesting level ${depth} is scoped differently from the rest of the rail`
    )
    levels.set(depth, body)
  }

  assert.ok(levels.size >= 12, `only ${levels.size} nesting levels ride the rail`)
  for (const [depth, body] of levels) {
    assert.equal(
      added(value(body, '--hc-rail-indent'), '--hc-rail-offset'),
      rail.indent * depth,
      `level ${depth} lands off the rail`
    )
  }
  for (let depth = 1; depth <= levels.size; depth += 1) {
    assert.ok(levels.has(depth), `nesting level ${depth} has no rail rule`)
  }
})

/* The rail's hierarchy colors, in the ROYGBIV order it steps through, and the
 * guard the heading rules already qualify themselves by. */
const spectrum = 7
const headingGuard = ':not(:is(.block-ref, .block-embed, .embed-page, .custom-query) *)'

/* The three rows that carry the hierarchy: a block Logseq marks as having
 * children, a block whose first line renders as a heading, and that same
 * heading while it is being typed. */
const qualifying = [
  `${scope} .ls-block:not(.block-content-wrapper *)[haschild="true"] > .block-main-container > .block-control-wrap`,
  `${scope} .ls-block:not(.block-content-wrapper *) > .block-main-container:has(> .block-content-wrapper :is(h1, h2, h3, h4, h5, h6)${headingGuard}) > .block-control-wrap`,
  `${scope} .ls-block:not(.block-content-wrapper *) > .block-main-container:has(> .editor-wrapper :is(.h1, .h2, .h3, .h4, .h5, .h6)) > .block-control-wrap`
]

test('every nesting level takes the next color of the spectrum', () => {
  // A top-level block opens the spectrum at red, and is the level every deeper
  // rule is measured from.
  const defaults = rule(wrap)
  assert.equal(value(defaults, '--hc-rail-depth-color'), 'var(--hc-rail-depth-1)')

  const levels = new Map()
  for (const [selector, body] of rules) {
    if (!selector.startsWith(scope) || !selector.endsWith('.block-control-wrap')) continue
    const depth = selector.split('.block-children ').length - 1
    if (depth === 0) continue
    levels.set(depth, body)
  }

  assert.ok(levels.size >= 12, `only ${levels.size} nesting levels are colored`)
  for (const [depth, body] of levels) {
    // Seven colors for however many levels ride the rail: past the seventh the
    // spectrum starts again, so no two adjacent levels ever share a hue.
    assert.equal(
      value(body, '--hc-rail-depth-color'),
      `var(--hc-rail-depth-${(depth % spectrum) + 1})`,
      `nesting level ${depth + 1} is not the ${(depth % spectrum) + 1}${'st nd rd th th th th'.split(' ')[depth % spectrum]} color of the spectrum`
    )
  }

  // The spectrum itself is seven colors deep, and each one is a palette token
  // rather than a literal written into the rail.
  for (let step = 1; step <= spectrum; step += 1) {
    assert.match(
      css,
      new RegExp(`\\n  --hc-rail-depth-${step}: var\\(--(?:vscode-)?hc-[\\w-]+\\);`),
      `the spectrum has no ${step}${step === 1 ? 'st' : 'th'} color`
    )
  }
  assert.ok(!/--hc-rail-depth-8:/.test(css), 'the spectrum is longer than the seven colors the levels cycle through')
})

test('a heading and a block with children take their depth color; ordinary prose does not', () => {
  // Ordinary prose is unchanged: a white bullet on the rail's own cyan line.
  const defaults = rule(wrap)
  assert.equal(value(defaults, '--hc-rail-line-color'), 'var(--vscode-hc-cyan)')
  assert.equal(value(defaults, '--hc-rail-bullet-color'), 'var(--vscode-hc-white)')

  // A block that carries the hierarchy hands its depth's color to both, so its
  // bullet and the stretch of line it paints always agree.
  const carried = rule(qualifying.join(', '))
  assert.equal(value(carried, '--hc-rail-line-color'), 'var(--hc-rail-depth-color)')
  assert.equal(value(carried, '--hc-rail-bullet-color'), 'var(--hc-rail-depth-color)')
  for (const selector of qualifying) {
    assert.ok(
      compare(specificity(selector), specificity(wrap)) > 0,
      `"${selector.slice(-72)}" does not out-rank the defaults it replaces`
    )
  }

  // The line and the bullet read those two variables and nothing else, so a
  // block's segment is painted in the same color as its own bullet.
  assert.equal(value(rule(`${wrap}::before, ${wrap}::after`), 'background-color'), 'var(--hc-rail-line-color)')
  const dot = rule(`${wrap} .bullet-container .bullet`)
  assert.equal(value(dot, 'background-color'), 'var(--hc-rail-bullet-color)')
  assert.match(dot, /0 0 0 calc\(2px \* var\(--hc-rail-bullet-scale\)\) var\(--hc-rail-bullet-color\)/)

  // Every one of those colors is declared on a block's own control column,
  // which no descendant block sits inside: a child's segment takes the child's
  // depth, never the color of the parent holding it.
  for (const [selector, body] of rules) {
    if (!/(?:^|;|\n)\s*--hc-rail-(?:depth|line|bullet)-color:/.test(body)) continue
    for (const part of splitSelectors(selector)) {
      assert.ok(
        part.endsWith('.block-control-wrap'),
        `a hierarchy color is declared where a descendant block inherits it: "${part.slice(0, 60)}…"`
      )
    }
  }

  // Pointing at the control column still fills the bullet the way it does
  // everywhere outside the rail, which the colored bullet would otherwise
  // out-rank.
  assert.equal(
    value(rule(`${wrap}:hover .bullet-container .bullet`), 'background-color'),
    'var(--vscode-hc-focus)'
  )
  assert.ok(
    compare(specificity(`${wrap}:hover .bullet-container .bullet`), specificity(`${wrap} .bullet-container .bullet`)) > 0,
    'the bullet under the pointer does not out-rank its own depth color'
  )
})

test("a bullet sits on the middle of its block's first line", () => {
  // Half of the 24px line an ordinary block renders, which is what Logseq's own
  // 24px control box was centering the bullet by.
  const center = rail.box / 2
  assert.equal(px(rule(row), '--hc-rail-bullet-y'), center)

  // A heading is set off by a margin of its own font size and its line is half
  // again as tall, so its bullet drops by 1.75 times the size Logseq gives that
  // level. The margin is the theme's own, so it is read out of the stylesheet
  // rather than assumed.
  assert.match(
    css,
    /\.ls-block :is\(h1, h2, h3, h4, h5, h6\),\s*\n\s*\.editor-inner \.uniline-block:is\([^)]*\) \{\s*\n\s*margin-top: 1em !important;/,
    'headings no longer carry the margin the rail measures their bullet by'
  )
  const guard = ':not(:is(.block-ref, .block-embed, .embed-page, .custom-query) *)'
  for (const [level, size] of Object.entries(headings)) {
    const body = rule(
      `${row}:has(> .block-content-wrapper ${level}${guard}), ${row}:has(> .editor-wrapper .${level})`
    )
    const drop = Number.parseFloat(value(body, '--hc-rail-bullet-y'))
    assert.ok(
      Math.abs(drop - size * 1.75) < 0.001,
      `a ${level} bullet drops ${drop}em, not the 1.75 × ${size}em its own line asks for`
    )
    assert.match(value(body, '--hc-rail-bullet-y'), /em$/, `a ${level} bullet is placed in px, not in its own text`)
  }

  // Everything else the rail draws for a row is measured from that one number,
  // so a bullet, the fold arrow beside it, an ordered list's number and both
  // ends of the line always meet.
  assert.equal(
    value(rule(`${wrap} > .bullet-link-wrap`), 'margin-top'),
    'calc(var(--hc-rail-bullet-y) - var(--hc-rail-bullet-size) / 2)'
  )
  assert.equal(value(rule(`${wrap} > .block-control`), 'margin-top'), `calc(var(--hc-rail-bullet-y) - ${center}px)`)
  assert.equal(value(rule(`${wrap}::after`), 'top'), 'var(--hc-rail-bullet-y)')
})

test("a bullet is drawn at the size of its block's first line", () => {
  // Ordinary prose is the baseline: exactly the bullet Logseq draws, so the
  // scale is a plain multiple of its 16px halo and its 6px dot, and everything
  // outside the rail — sidebars, dialogs, document mode — keeps that default.
  // A custom property substitutes against the element it is declared on, so the
  // two sizes are declared beside the scale, on the row that carries it: read
  // from `:root` they would resolve against the root's scale and never follow a
  // heading's.
  const defaults = rule(row)
  assert.equal(Number.parseFloat(value(defaults, '--hc-rail-bullet-scale')), 1)
  assert.equal(value(defaults, '--hc-rail-bullet-size'), `calc(${rail.bullet}px * var(--hc-rail-bullet-scale))`)
  assert.equal(value(defaults, '--hc-rail-bullet-dot'), `calc(${rail.dot}px * var(--hc-rail-bullet-scale))`)

  // A first line that is X% larger than ordinary text draws a bullet X% larger,
  // so each heading's scale is the size Logseq gives that level, in the
  // rendered view and in the editor textarea alike.
  const guard = ':not(:is(.block-ref, .block-embed, .embed-page, .custom-query) *)'
  for (const [level, size] of Object.entries(headings)) {
    const body = rule(
      `${row}:has(> .block-content-wrapper ${level}${guard}), ${row}:has(> .editor-wrapper .${level})`
    )
    assert.equal(
      Number.parseFloat(value(body, '--hc-rail-bullet-scale')),
      size,
      `a ${level} bullet is not drawn at the ${size}× its own line is set in`
    )
  }

  // The halo, the dot inside it and the rings around that dot all follow.
  const halo = rule(`${wrap} .bullet-container`)
  assert.equal(value(halo, 'width'), 'var(--hc-rail-bullet-size)')
  assert.equal(value(halo, 'height'), 'var(--hc-rail-bullet-size)')
  for (const dot of [rule(`${wrap} .bullet-container .bullet`), rule(`${wrap} .bullet-container.typed-list .bullet`)]) {
    assert.equal(value(dot, 'width'), 'var(--hc-rail-bullet-dot)')
    assert.equal(value(dot, 'height'), 'var(--hc-rail-bullet-dot)')
    assert.match(dot, /box-shadow: 0 0 0 calc\(1px \* var\(--hc-rail-bullet-scale\)\)/)
    assert.match(dot, /0 0 0 calc\(2px \* var\(--hc-rail-bullet-scale\)\)/)
  }
  const hovered = `${block}:hover:not(:has(.ls-block:hover))`
  assert.match(
    rule(`${hovered} > .block-main-container > .block-control-wrap .bullet-container .bullet`),
    /0 0 0 calc\(5px \* var\(--hc-rail-bullet-scale\)\)/,
    'a hovered bullet keeps a ring sized for an ordinary bullet'
  )

  // A bullet grows around the rail rather than off it: half of whatever it grew
  // by comes off either side, so its center stays on the line at every size,
  // and the row's own width is unchanged.
  const link = rule(`${wrap} > .bullet-link-wrap`)
  const centering = `calc((${rail.bullet}px - var(--hc-rail-bullet-size)) / 2)`
  assert.equal(value(link, 'margin-left'), centering)
  assert.equal(value(link, 'margin-right'), centering)
})

test('the rail line runs from the first bullet to the end of the last block', () => {
  const line = rule(`${wrap}::before, ${wrap}::after`)
  // The fold arrow, then half a bullet: the center of the bullet Logseq draws.
  assert.equal(px(line, 'left'), rail.arrow + rail.bullet / 2)
  assert.equal(px(line, 'width'), 1)
  assert.match(line, /background-color:\s*var\(--hc-rail-line-color\)/)
  // Decorative: the line is never what a click lands on.
  assert.match(line, /pointer-events:\s*none/)
  // Behind the bullets, inside the stacking context the row is given for it.
  assert.match(line, /z-index:\s*-1/)
  assert.match(rule(row), /isolation:\s*isolate/)

  const up = rule(`${wrap}::before`)
  const down = rule(`${wrap}::after`)

  // The upward segment reaches the center of its own bullet, having started
  // above the row to cover the gap between one block and the next.
  assert.ok(px(up, 'top') < 0, 'the upward segment does not cover the gap above its row')
  assert.equal(added(value(up, 'height'), '--hc-rail-bullet-y'), -px(up, 'top'))

  // The downward segment leaves that center and runs past the foot of its row,
  // by less than the distance a bullet sits below the row it follows — so it
  // always meets the next segment and can never outrun a bullet center.
  const overshoot = -px(down, 'bottom')
  assert.ok(overshoot > 0, 'the downward segment stops short of the block below it')
  assert.ok(overshoot < rail.box / 2, 'the downward segment can outrun the bullet below it')

  // The rail starts at a bullet center: the first rendered block draws nothing
  // above its own bullet.
  assert.match(
    rule(`${block}:not(.ls-block *):not(.ls-block ~ .ls-block) > .block-main-container > .block-control-wrap::before`),
    /display:\s*none/
  )
  // It ends with the last rendered block rather than past it: that block's tail
  // stops at its own foot instead of overdrawing into the space below.
  assert.equal(
    px(
      rule(
        `${block}:not(:has(> .block-children-container .ls-block)):not(:has(~ .ls-block)):not(.ls-block:has(~ .ls-block) *) > .block-main-container > .block-control-wrap::after`
      ),
      'bottom'
    ),
    0
  )
})

test('an ordered list keeps its number beside the content and a bullet on the rail', () => {
  const marker = rule(`${wrap} .bullet-container.as-order-list`)
  // On the rail it reads as a bullet like any other, so it takes a bullet's box,
  // sized like every other bullet by the line it hangs beside.
  assert.equal(value(marker, 'width'), 'var(--hc-rail-bullet-size)')
  assert.equal(px(marker, 'padding-left'), 0)
  assert.match(rule(`${wrap} .bullet-container.typed-list .bullet`), /background-color:\s*var\(--hc-rail-bullet-color\)/)

  // Logseq drops the gutter for an ordered list because its number is wider
  // than a bullet. The number is no longer there, so the gutter comes back and
  // every content column starts at the same offset.
  assert.equal(px(rule(`${wrap}.is-order-list`), 'padding-right'), rail.gutter)

  // The number is laid back where Logseq drew it: the control column was pulled
  // out of the row by `--hc-rail-indent`, so measuring the number back out by
  // the same distance lands it beside the content at every nesting level.
  const label = rule(`${wrap} .bullet-container.typed-list .bullet > label`)
  assert.match(label, /position:\s*absolute/)
  assert.equal(added(value(label, 'left'), '--hc-rail-indent'), rail.arrow)
  assert.equal(px(label, 'width'), rail.orderList)
  assert.equal(px(label, 'height'), rail.box)
  assert.equal(value(label, 'top'), `calc(var(--hc-rail-bullet-y) - ${rail.box / 2}px)`)

  // Upstream hangs an ordered list's bullet off a relative box shifted by 3px.
  // That box would otherwise take the bullet off the rail.
  assert.match(rule(`${wrap} > .bullet-link-wrap`), /position:\s*static/)
})

test('the rail out-ranks the bullet suppression it answers', () => {
  const visible = `${wrap} .bullet-container`
  assert.match(rule(visible), /opacity:\s*1\s*!important/)

  // The rules that keep a special block bulletless everywhere else. Both are
  // !important, so specificity is what decides which one the rail sees.
  for (const suppressed of [
    '.ls-block[data-hc-hide-bullet] > .block-main-container > .block-control-wrap .bullet-container:not(.typed-list)',
    '.ls-block:has(> .block-main-container > .block-content-wrapper :is(.org-src-container, .src, .center, .CENTER, .org-center, [style*="text-align: center"], [style*="text-align:center"], .verse, .VERSE, .org-verse, .passage)) > .block-main-container > .block-control-wrap .bullet-container:not(.typed-list)'
  ]) {
    assert.ok(rules.has(suppressed) || [...rules.keys()].some((key) => key.endsWith(suppressed)), `the rule "${suppressed.slice(0, 48)}…" is gone`)
    assert.ok(
      compare(specificity(visible), specificity(suppressed)) > 0,
      "the rail does not out-rank the rule that hides a special block's bullet"
    )
  }
})

test('hovering a block lights its own bullet and no other', () => {
  const hovered = `${block}:hover:not(:has(.ls-block:hover)) > .block-main-container > .block-control-wrap`
  const halo = rule(`${hovered} .bullet-container`)
  const dot = rule(`${hovered} .bullet-container .bullet`)

  // The color that block paints the rail with, at a fraction of full strength:
  // the line's cyan for ordinary prose, its own depth's hue for a heading or a
  // parent, so the halo stays visible against every bullet the rail draws.
  const glow = /color-mix\(in srgb, var\(--hc-rail-line-color\) \d+%, transparent\)/
  assert.match(halo, new RegExp(`background-color:\\s*${glow.source}`), 'a hovered bullet is not lit in its own rail color')
  assert.match(
    dot,
    new RegExp(`0 0 0 calc\\(\\d+px \\* var\\(--hc-rail-bullet-scale\\)\\) ${glow.source}`),
    'a hovered bullet has no ring in its own rail color'
  )

  // The dot keeps the ring the theme draws it with, so hover adds to a bullet
  // rather than replacing it — and that ring is still the bullet's own color,
  // not the white every bullet carried before the rail was colored.
  assert.match(
    dot,
    /0 0 0 calc\(1px \* var\(--hc-rail-bullet-scale\)\) var\(--vscode-hc-black\),\s*\n?\s*0 0 0 calc\(2px \* var\(--hc-rail-bullet-scale\)\) var\(--hc-rail-bullet-color\)/
  )

  // Only the block the pointer is over: an ancestor holding a hovered block
  // keeps its own bullet plain, the way the block highlight already behaves.
  assert.ok(
    compare(specificity(`${hovered} .bullet-container`), specificity(`${wrap} .bullet-container`)) > 0,
    'the hovered bullet does not out-rank the rail bullet it repaints'
  )
})

/* Optional: confirm the pinned literals still describe the installed app. */
const upstreamPath = process.env.LOGSEQ_CSS
test(
  'pinned upstream selectors still ship in Logseq',
  { skip: !upstreamPath || !existsSync(upstreamPath) ? 'set LOGSEQ_CSS to an installed style.css' : false },
  async () => {
    const upstream = await readFile(upstreamPath, 'utf8')
    for (const { surface, upstream: selector } of pairings) {
      const compact = selector.replace(/\s*>\s*/g, '>')
      assert.ok(
        upstream.includes(selector) || upstream.includes(compact),
        `${surface}: upstream no longer ships "${selector}"`
      )
    }
    for (const declaration of [...admonitionMetrics, ...spacingMetrics, ...railMetrics]) {
      assert.ok(upstream.includes(declaration), `Logseq no longer ships "${declaration}"`)
    }
    assert.ok(upstream.includes(markDeclaration), 'Logseq no longer ships the page-mark rule')
    for (const token of radixTokens) {
      assert.ok(upstream.includes(`var(${token}`), `Logseq no longer reads ${token}`)
    }
  }
)
