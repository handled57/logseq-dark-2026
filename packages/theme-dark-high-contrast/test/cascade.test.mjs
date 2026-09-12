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

/* A parent's row and its first child's are not two blocks in flow: the child
 * hangs inside a nested group, so the space between those two rows is whatever
 * the group opens on rather than the margin a block carries. These are the two
 * upstream figures the theme counts that space out of — the padding every row
 * is given, and the 2px a nested group opens on. */
const nestingMetrics = [
  '.ls-block{border-bottom:1px solid transparent;min-height:24px;padding:2px 0;position:relative;transition:background-color .3s cubic-bezier(.16,1,.3,1)}',
  '.block-children{border-left:1px solid;border-left-color:var(--lx-gray-04-alpha,var(--ls-guideline-color,var(--rx-gray-04-alpha)))!important;padding-bottom:3px;padding-top:2px}'
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

/* Both layouts hang every block's bullet on one vertical line. Every other distance the
 * rail moves a bullet by is Logseq's own: the 22px fold arrow the bullet sits
 * behind, the 16px bullet, the 24px control box the bullet is centered in, the
 * 2rem the scroll container keeps left of the page, and the size Logseq gives
 * each heading, which is what a heading's bullet drops by. Those are pinned
 * here because the rail is arithmetic on them — if Logseq re-measures a block,
 * the rail bends rather than breaks visibly, so nothing else would catch it. */
const railMetrics = [
  '.block-children-container{margin-left:29px;position:relative}',
  '.block-control-wrap{height:24px;margin-top:0;padding-right:6px}',
  '.block-control,.block-control:hover{color:var(--ls-secondary-text-color);cursor:default;font-size:14px;min-height:22px;min-width:22px;opacity:.4;padding:2px;text-decoration:none;-webkit-user-select:none;-moz-user-select:none;user-select:none}',
  '.bullet-container{align-items:center;border-radius:50%;display:flex;height:16px;justify-content:center;width:16px}',
  '.bullet-container .bullet{border-radius:9999px;font-size:15px;height:6px;opacity:.8;width:6px}',
  '.bullet-container.as-order-list{justify-content:center;padding-left:3px;white-space:nowrap;width:22px}',
  '.block-control-wrap.is-order-list{margin-right:0;padding-right:0}',
  '.block-control-wrap.is-order-list .bullet-link-wrap{left:-3px;position:relative}',
  /* The two upstream declarations the rail's bullet states answer: the halo a
   * folded bullet is given, which is what marks it as folded, and the important
   * fill hovering a bullet would otherwise put inside it. */
  '.bullet-container:not(.typed-list).bullet-closed{background-color:var(--lx-gray-04-alpha,var(--ls-block-bullet-border-color,var(--rx-gray-04-alpha)))}',
  '.bullet-link-wrap:hover>.bullet-container:not(.typed-list) .bullet{background-color:var(--lx-gray-08,var(--ls-block-bullet-color,var(--rx-gray-08)))!important;transform:scale(1.2)}',
  '#main-content-container{padding-left:2rem;padding-right:2rem}',
  '.editor-inner .h1.uniline-block,.ls-block h1{font-size:2em;min-height:1.5em}',
  '.editor-inner .h2.uniline-block,.ls-block h2{font-size:1.5em;min-height:1.5em}',
  '.editor-inner .h3.uniline-block,.ls-block h3{font-size:1.2em;min-height:1.2em}',
  '.editor-inner .h4.uniline-block,.ls-block h4{font-size:1em;min-height:1em}',
  '.editor-inner .h5.uniline-block,.ls-block h5{font-size:.83em;min-height:.83em}',
  '.editor-inner .h6.uniline-block,.ls-block h6{font-size:.75em;min-height:.75em}',
  // A heading quoted inside a block reference is normalized to the block's own
  // text upstream, in a rule of the same specificity that the theme loads after,
  // which is why the theme's own heading sizes step around it.
  '.block-ref :is(h1,h2,h3,h4,h5,h6){border-bottom:none;font-size:1rem}',
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

/* The `/` command menu and every other popup the editor opens live inside the
 * block being edited, and Logseq gives them no stacking level. Because a block
 * is a positioned element, the blocks after the edited one paint over the popup
 * and their text reads through its opaque background. The theme lifts the popup
 * instead, so these are the declarations that lift is measured against: the
 * popup's own rule, which still carries no z-index; the block's positioning,
 * which is what the popup loses to; and the scale the lift is taken from. */
const popupMetrics = [
  '.absolute-modal{background:var(--ls-primary-background-color);overflow:auto}',
  '.absolute-modal[data-modal-name]{background-color:hsl(var(--popover));border-radius:var(--radius);border-width:1px;overflow-x:hidden;overflow-y:auto;padding-bottom:.25rem;padding-top:.25rem}',
  '.ls-block{border-bottom:1px solid transparent;min-height:24px;padding:2px 0;position:relative;transition:background-color .3s cubic-bezier(.16,1,.3,1)}',
  '--ls-z-index-level-1:9',
  '.ui__ac-group-name{color:hsl(var(--popover-foreground)/.2);font-size:.75rem;font-weight:500;line-height:1rem;padding:.5rem}'
]

/* The leading-emoji gutter is a hanging indent inside the block's own text
 * column, so what it is measured against is how Logseq lays that column out:
 * the block's first line sits in a `.flex-1` box inside `.block-content-inner`,
 * the box is `w-full` under Tailwind's border-box reset so the gutter's padding
 * stays inside it, and `.block-content` keeps its whitespace, which is what
 * makes the space after the emoji part of the column the gutter reserves. */
const iconMetrics = [
  '.flex-1{flex:1 1 0%}',
  '.w-full{width:100%}',
  '.block-content{cursor:text;max-width:100%;min-height:24px;overflow:initial;' +
    'overflow-wrap:break-word;white-space:pre-wrap;word-break:break-word}'
]

/* A table is laid out automatically inside a scrolling wrapper at the full
 * width of the block, so what decides a column's width is what each cell
 * reports as its narrowest and widest. The `word-break: break-word` pinned in
 * `iconMetrics` above is inherited into those cells and computes to
 * `overflow-wrap: anywhere`, which counts toward intrinsic sizing and takes a
 * column's floor down to a single character. These are the declarations the
 * cell rule answers. */
const tableMetrics = [
  '.block-content div.table-wrapper,.cp__all_pages-content div.table-wrapper,' +
    '.cp__shortcut-page div.table-wrapper{overflow:auto}',
  '.block-content table,.cp__all_pages-content table,.cp__shortcut-page table' +
    '{border-collapse:collapse;margin:1rem 0;text-align:left;width:100%}'
]

test('a table cell keeps a floor of its own longest word', () => {
  // The value the fix exists to answer, read back off the pinned block rule so
  // an upstream change that drops it takes this test with it.
  const inherited = iconMetrics.find((declaration) => declaration.startsWith('.block-content{'))
  assert.match(inherited, /word-break:break-word/, 'Logseq no longer breaks a block mid-word')

  // Nothing here relies on out-ranking `.block-content`: a declaration that
  // matches the cell itself beats one the cell only inherits.
  const rule = css.match(/\n\.block-content :is\(th, td\) \{([^}]*)\}/)
  assert.ok(rule, '.block-content :is(th, td) is missing')

  // `normal` restores the column floor `anywhere` removed, so a column is at
  // least as wide as its longest word and the wide column wraps instead.
  assert.match(rule[1], /\n\s*word-break:\s*normal;/)
  // `break-word` still breaks a run too long for its column, and unlike
  // `anywhere` it leaves intrinsic sizing alone, so the floor survives it.
  assert.match(rule[1], /\n\s*overflow-wrap:\s*break-word;/)
  assert.doesNotMatch(rule[1], /overflow-wrap:\s*anywhere/)

  // The floor can push the table past the block; the wrapper is what scrolls
  // to it rather than the table being forced to shatter its words again.
  assert.ok(tableMetrics[0].includes('overflow:auto'), 'the table wrapper no longer scrolls')
  assert.ok(tableMetrics[1].includes('width:100%'), 'a table is no longer laid out at the full block width')
})

test('the block-icon gutter and the indent that hangs out of it are one number', () => {
  const gutter = 'var(--hc-block-icon-gutter)'
  const scope = '.ls-block[data-hc-block-icon] > .block-main-container > ' +
    '.block-content-wrapper .block-content > '

  // Both halves read the same variable, so the line the emoji opens always
  // hangs out by exactly what the text below it is indented by. Anything else
  // would leave a wrapped line short of, or past, the words above it.
  assert.ok(css.includes(`${scope}.block-content-inner,\n${scope}.block-body {\n  padding-left: ${gutter};`))
  assert.ok(css.includes(`${scope}.block-content-inner > :first-child {\n  text-indent: calc(-1 * ${gutter});`))

  // The gutter is set in `em`, so it is one emoji of the block's own text
  // rather than a fixed distance that would drift as the text is resized.
  const declared = css.match(/--hc-block-icon-gutter:\s*([\d.]+)em;/)
  assert.ok(declared, 'the icon gutter is not declared in em')
  // One emoji's advance plus the space after it, which is what puts the words
  // following the emoji in the column the lines below them stand in.
  assert.ok(Number(declared[1]) > 1 && Number(declared[1]) < 2, 'the icon gutter is not about one emoji wide')
})

/* A declaration read whole, across the lines a long value is wrapped over,
 * with the wrapping collapsed to one space. `value` reads a single line. */
const declaration = (body, property) => {
  const match = body.replace(/\s*\n\s*/g, ' ').match(new RegExp(`(?:^|;|\\s)${property}:\\s*([^;}]+)`))
  assert.ok(match, `no "${property}" declaration`)
  return match[1].trim()
}

/* Read back off the declarations above. */
const rail = { indent: 29, arrow: 22, bullet: 16, dot: 10, box: 24, gutter: 6, orderList: 22, pagePad: 32 }

/* Logseq's heading sizes, as multiples of the block's own text size. */
const headings = { h1: 2, h2: 1.5, h3: 1.2, h4: 1, h5: 0.83, h6: 0.75 }

/* The fraction of those the theme sets a heading at, read out of the
 * stylesheet: the bullet a heading hangs is measured from the size the heading
 * is actually rendered at, so the two have to be the same number. */
const headingScale = (() => {
  const declared = css.match(/--hc-heading-scale:\s*([\d.]+);/)
  assert.ok(declared, 'the theme declares no heading scale')
  return Number(declared[1])
})()

/* The rail reaches the page's own tree in the main editor and nothing else:
 * not the sidebars, whiteboards or dialogs that render outside
 * `#main-content-container`, not the embedded and queried trees that render
 * inside a `.block-content-wrapper`, and not the two layouts above. */
const scope =
  'main:not(.ls-fold-button-on-right) #main-content-container .page-blocks-inner .content:not(.doc-mode)'
const block = `${scope} .ls-block:not(.block-content-wrapper *)`
const row = `${block} > .block-main-container`
const wrap = `${row} > .block-control-wrap`
const branchedScope = `body[data-hc-rail-layout="branched"] ${scope}`
/* The two rows that open the rail: the page's first block, and the block under
 * a page-properties block, which is the first one the reader wrote. */
const railStart = `${block}:not(.ls-block *):not(.ls-block ~ .ls-block) > .block-main-container > .block-control-wrap::before, ${block}.pre-block:not(.ls-block *):not(.ls-block ~ .ls-block) ~ .ls-block:not(.block-content-wrapper *):not(.ls-block *):not(.ls-block ~ .ls-block ~ .ls-block) > .block-main-container > .block-control-wrap::before`

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

/* A selector with its functional pseudo-classes taken off, innermost first, so
 * what a rule actually paints can be read off the end of it. */
function plain(selector) {
  let stripped = selector
  let previous
  do {
    previous = stripped
    stripped = stripped.replace(/:(?:has|not|is|where)\([^()]*\)/g, '')
  } while (stripped !== previous)
  return stripped
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

test('both rail layouts share the same bullet column', () => {
  assert.doesNotMatch(wrap, /data-hc-rail-layout/)
  // Layout-specific rules must not override the shared depth compensation.
  for (const [selector, declarations] of rules) {
    if (!selector.includes('data-hc-rail-layout')) continue
    for (const property of ['--hc-rail-indent', 'margin-left', 'margin-right']) {
      assert.ok(!declarations.includes(`${property}:`), `${selector}: ${property}`)
    }
  }
  assert.equal(px(rule('#main-content-container > .cp__sidebar-main-content[data-is-full-width="true"]'), '--hc-rail-offset'), 24)
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?--hc-rail-offset: 48px;/)
})

test('branched rails hide both segments at depth changes and retain the opening cap', () => {
  const controls = `${branchedScope} .ls-block:not(.block-content-wrapper *)`
  const before = ' > .block-main-container > .block-control-wrap::before'
  const after = ' > .block-main-container > .block-control-wrap::after'
  const breaks = rule(
    controls + '[data-hc-rail-entry="none"]' + before + ', ' +
    controls + '[data-hc-rail-exit="none"]' + after
  )
  assert.equal(value(breaks, 'display'), 'none !important')
  assert.equal(value(rule(controls + '[data-hc-rail-entry="start"]' + before), 'display'), 'block !important')
  const lines = rule(controls + before + ', ' + controls + after)
  assert.equal(value(lines, 'width'), 'var(--hc-rail-branch-width)')
  assert.equal(value(lines, 'left'), 'calc(30.5px - var(--hc-rail-branch-width) / 2)')
  assert.equal(value(rule('.block-children'), 'padding-top'), 'calc(var(--hc-block-gap) + 2px)')
  const branched = [...rules].filter(([selector]) => selector.startsWith(branchedScope))
  for (const [selector, declarations] of branched) {
    assert.doesNotMatch(declarations, /border-(?:left|right|top|bottom)|radius/)
    assert.doesNotMatch(selector, /\.block-children(?:::before|::after|\s*>)/)
  }
  assert.doesNotMatch(css, /--hc-rail-(?:entry-distance|exit-distance|branch-radius)/)
})

test('branched rails and both endpoint bullets share their own depth color', () => {
  const branchedWrap = `${branchedScope} .ls-block:not(.block-content-wrapper *) > .block-main-container > .block-control-wrap`
  assert.equal(value(rule(branchedWrap), '--hc-rail-bullet-color'), 'var(--hc-rail-depth-color)')
  const branchedLines = `${branchedWrap}::before, ${branchedWrap}::after`
  assert.equal(value(rule(branchedLines), 'background-color'), 'var(--hc-rail-bullet-color)')
  assert.ok(compare(specificity(branchedWrap), specificity(wrap)) > 0)
  assert.ok(compare(specificity(`${branchedWrap}::before`), specificity(`${wrap}::before`)) > 0)
  // Flat retains its configured color and white leaf bullets after switching back.
  assert.equal(value(rule(wrap), '--hc-rail-bullet-color'), 'var(--vscode-hc-white)')
  assert.equal(value(rule(`${wrap}::before, ${wrap}::after`), 'background-color'), 'var(--hc-rail-default-color)')
})

/* The rail's hierarchy colors, in the brightness order it steps through, and the
 * guard the heading rules already qualify themselves by. */
const spectrum = 8
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
      `nesting level ${depth + 1} is not the ${(depth % spectrum) + 1}${'st nd rd th th th th th'.split(' ')[depth % spectrum]} color of the spectrum`
    )
  }

  // The spectrum itself is eight colors deep, and each one is a palette token
  // rather than a literal written into the rail.
  for (let step = 1; step <= spectrum; step += 1) {
    assert.match(
      css,
      new RegExp(`\\n  --hc-rail-depth-${step}: var\\(--(?:vscode-)?hc-[\\w-]+\\);`),
      `the spectrum has no ${step}${step === 1 ? 'st' : step === 2 ? 'nd' : step === 3 ? 'rd' : 'th'} color`
    )
  }
  assert.ok(!/--hc-rail-depth-9:/.test(css), 'the spectrum is longer than the eight colors the levels cycle through')
})

test('a heading and a block with children take their depth color; ordinary prose does not', () => {
  // Ordinary prose keeps its white bullet — never a hierarchy color.
  const defaults = rule(wrap)
  assert.equal(value(defaults, '--hc-rail-bullet-color'), 'var(--vscode-hc-white)')
  assert.equal(value(defaults, '--hc-rail-bullet-fill'), 'var(--hc-rail-bullet-color)')

  // A block that carries the hierarchy hands its depth's color to its bullet,
  // and to its bullet only: the line under it is the reader's own color.
  const carried = rule(qualifying.join(', '))
  assert.equal(value(carried, '--hc-rail-bullet-color'), 'var(--hc-rail-depth-color)')
  assert.doesNotMatch(carried, /--hc-rail-line-color:/)
  for (const selector of qualifying) {
    assert.ok(
      compare(specificity(selector), specificity(wrap)) > 0,
      `"${selector.slice(-72)}" does not out-rank the defaults it replaces`
    )
  }

  // The line is the one color the theme lets a reader set, whatever the block's
  // depth; only the bullet reads the hierarchy.
  assert.equal(
    value(rule(`${wrap}::before, ${wrap}::after`), 'background-color'),
    'var(--hc-rail-default-color)'
  )
  assert.ok(!/--hc-rail-line-color/.test(css), 'the line still has a color of its own to take from a depth')
  const dot = rule(`${wrap} .bullet-container .bullet`)
  assert.equal(value(dot, 'background-color'), 'var(--hc-rail-bullet-fill)')
  assert.equal(
    value(dot, 'box-shadow'),
    'none',
    'a bullet must have no shadow'
  )

  // Every one of those colors is declared on a block's own control column,
  // which no descendant block sits inside: a child's segment takes the child's
  // depth, never the color of the parent holding it.
  for (const [selector, body] of rules) {
    if (!/(?:^|;|\n)\s*--hc-rail-(?:depth-color|bullet-color|bullet-fill):/.test(body)) continue
    for (const part of splitSelectors(selector)) {
      assert.ok(
        plain(part).endsWith('.block-control-wrap') ||
          plain(part).endsWith('.block-control-wrap .bullet-container'),
        `a hierarchy color is declared where a descendant block inherits it: "${part.slice(0, 60)}…"`
      )
    }
  }

  // Pointing at a bullet leaves its inside alone: the same fill it is drawn
  // with at rest, and `!important` because upstream repaints the inside from
  // `.bullet-link-wrap:hover` with an important declaration of its own.
  assert.equal(
    value(rule(`${wrap}:hover .bullet-container .bullet`), 'background-color'),
    'var(--hc-rail-bullet-fill) !important'
  )
  assert.ok(
    compare(specificity(`${wrap}:hover .bullet-container .bullet`), specificity(`${wrap} .bullet-container .bullet`)) > 0,
    'the bullet under the pointer does not out-rank its own depth color'
  )
  assert.ok(
    compare(
      specificity(`${wrap}:hover .bullet-container .bullet`),
      specificity('.bullet-link-wrap:hover > .bullet-container:not(.typed-list) .bullet')
    ) > 0,
    "the rail's hover does not out-rank the upstream fill it answers"
  )
})

test('only expanded parents hide their dot fill', () => {
  for (const [selector, body] of rules) {
    if (!selector.startsWith(scope)) continue
    if (/--hc-rail-bullet-fill:/.test(body)) {
      assert.equal(value(body, '--hc-rail-bullet-fill'),
        selector.includes('[haschild="true"]') && selector.includes('.bullet-container:not(.bullet-closed)')
          ? 'transparent' : 'var(--hc-rail-bullet-color)')
    }
    if (splitSelectors(selector).some(part => plain(part).endsWith('.bullet')) &&
        /background-color:/.test(body)) {
      assert.match(value(body, 'background-color'),
        /^var\(--hc-rail-bullet-fill\)( !important)?$/)
    }
  }
})

test('page properties carry no bullet and no rail, and the rail opens under them', () => {
  // Logseq renders a page's properties as its first block and marks it
  // `pre-block`, in view and while they are being typed.
  const properties = `${scope} .ls-block:not(.block-content-wrapper *).pre-block > .block-main-container > .block-control-wrap`
  assert.equal(value(rule(`${properties}::before, ${properties}::after`), 'display'), 'none')
  assert.equal(value(rule(`${properties} .bullet-container`), 'visibility'), 'hidden')

  // Both halves out-rank the rules that draw the line and reveal the bullet,
  // which are the only ones they have to beat.
  assert.ok(
    compare(specificity(`${properties}::before`), specificity(`${wrap}::before`)) > 0,
    'the property row still paints its stretch of rail'
  )
  assert.ok(
    compare(specificity(`${properties} .bullet-container`), specificity(`${wrap} .bullet-container`)) > 0,
    'the property row still shows a bullet'
  )

  // The rail opens at the first bullet under the properties rather than at the
  // top of the page: the page's first block, and the block after a property
  // block, both paint nothing above their own bullet.
  assert.equal(value(rule(railStart), 'display'), 'none')
})

test('every heading level is set to the same fraction of the size Logseq gives it', () => {
  // Logseq's scale reads oversized against this theme's prose, so every level
  // is taken to one fraction of it. Below 1 or the headings grew; the levels
  // keep Logseq's proportions either way, because each rule scales that
  // level's own multiple rather than declaring a size of its own.
  assert.ok(headingScale > 0 && headingScale < 1, "the heading scale does not reduce Logseq's sizes")

  for (const [level, size] of Object.entries(headings)) {
    // Logseq's own pair of selectors: the rendered heading and the editor
    // textarea, which carries the level as a class. Both are set, so a heading
    // holds its size while it is typed in rather than jumping on each edit.
    const body = rule(`.editor-inner .${level}.uniline-block, .ls-block ${level}:not(.block-ref *)`)
    assert.equal(
      value(body, 'font-size'),
      `calc(${size}em * var(--hc-heading-scale))`,
      `a ${level} is not set at ${size} × the scale`
    )

    // In `em`, so the margin above the heading — the theme's own `1em` — and
    // the `min-height` upstream sets in the heading's own text both follow the
    // type down instead of holding the old scale's spacing.
    assert.doesNotMatch(value(body, 'font-size'), /px|rem/, `a ${level} is sized outside its own text`)
  }

  // The rendered heading is qualified so it cannot reach a heading quoted
  // inside a block reference, which upstream normalizes to the block's own
  // text in a rule this stylesheet would otherwise win on load order.
  const quoted = '.ls-block h1:not(.block-ref *)'
  assert.ok(
    compare(specificity(quoted), specificity('.block-ref :is(h1,h2,h3,h4,h5,h6)')) > 0,
    'the theme out-ranks the block-reference heading rule without excluding it'
  )

  // Page titles are Logseq's own size, not a block heading's, and are left
  // alone: the theme only ever names them for their color and weight.
  assert.doesNotMatch(css, /\.page-title[^{}]*\{[^{}]*font-size/)
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
    // The drop is Logseq's multiple for the level, and the theme takes the
    // heading itself to a fraction of that, so the bullet reads the same
    // scale rather than a number of its own: retuning the type moves the
    // bullet with it instead of leaving it off the line.
    const placement = value(body, '--hc-rail-bullet-y')
    const match = placement.match(/^calc\(([\d.]+)em \* var\(--hc-heading-scale\)\)$/)
    assert.ok(match, `a ${level} bullet is placed at "${placement}", not at its own scaled heading size`)
    const drop = Number.parseFloat(match[1]) * headingScale
    assert.ok(
      Math.abs(drop - size * 1.75 * headingScale) < 0.001,
      `a ${level} bullet drops ${drop}em, not the 1.75 × ${size * headingScale}em its own line asks for`
    )
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

test('every bullet on the rail is drawn at one size', () => {
  // One size for every first line: the bullet column reads as a column, and a
  // heading is marked by the color of its bullet rather than by a bullet larger
  // than its neighbours'. The dot sits inside Logseq's own 16px control, and the
  // two bands around it are the widths every state is measured out from.
  const defaults = rule(row)
  assert.equal(px(defaults, '--hc-rail-bullet-size'), rail.bullet)
  assert.equal(px(defaults, '--hc-rail-bullet-dot'), rail.dot)

  // Nothing sizes a bullet by the line it hangs beside any more: the heading
  // rules place their bullets and say nothing about how large they are.
  assert.ok(!/--hc-rail-bullet-scale/.test(css), 'a bullet is still scaled by its own first line')
  const guard = ':not(:is(.block-ref, .block-embed, .embed-page, .custom-query) *)'
  for (const level of Object.keys(headings)) {
    const body = rule(
      `${row}:has(> .block-content-wrapper ${level}${guard}), ${row}:has(> .editor-wrapper .${level})`
    )
    assert.doesNotMatch(
      body,
      /--hc-rail-bullet-(?:size|dot|gap|ring)/,
      `a ${level} draws a bullet of a size of its own`
    )
    assert.match(body, /--hc-rail-bullet-y/, `a ${level} no longer places its bullet on its own first line`)
  }

  // The control and the solid dot inside it.
  const halo = rule(`${wrap} .bullet-container`)
  assert.equal(value(halo, 'width'), 'var(--hc-rail-bullet-size)')
  assert.equal(value(halo, 'height'), 'var(--hc-rail-bullet-size)')
  for (const dot of [rule(`${wrap} .bullet-container .bullet`), rule(`${wrap} .bullet-container.typed-list .bullet`)]) {
    assert.equal(value(dot, 'width'), 'var(--hc-rail-bullet-dot)')
    assert.equal(value(dot, 'height'), 'var(--hc-rail-bullet-dot)')
    assert.equal(value(dot, 'box-shadow'), 'none')
  }

  // A bullet that never grows is never centered back onto the rail: half of it
  // places its center on the line, and it takes the whole of Logseq's own box.
  const link = rule(`${wrap} > .bullet-link-wrap`)
  assert.equal(value(link, 'margin-top'), 'calc(var(--hc-rail-bullet-y) - var(--hc-rail-bullet-size) / 2)')
  assert.doesNotMatch(link, /margin-(?:left|right)/, 'a bullet is still pulled back around the rail')
})

test('a parent and its first child stand as far apart as two siblings do', () => {
  const rowPad = Number.parseInt(nestingMetrics[0].match(/padding:(\d+)px 0/)[1], 10)
  assert.equal(Number.parseInt(nestingMetrics[1].match(/padding-top:(\d+)px/)[1], 10), rowPad)

  // Two siblings are held apart by the foot of one row, the theme's gap, and
  // the head of the next. A parent and its first child have no margin between
  // them at all: the child hangs in a nested group, and only the head of its
  // own row is padded. So the group opens on the gap plus the padding the
  // parent's foot would have contributed, and the outline a hovered or selected
  // block takes stands clear either way instead of being drawn through the
  // border above it.
  assert.equal(value(rule('.block-children'), 'padding-top'), `calc(var(--hc-block-gap) + ${rowPad}px)`)
  assert.equal(value(rule('.ls-block'), 'margin-bottom'), 'var(--hc-block-gap)')
})

test('the rail line runs from the first bullet to the end of the last block', () => {
  const line = rule(`${wrap}::before, ${wrap}::after`)
  // The fold arrow, then half a bullet: the center of the bullet Logseq draws.
  assert.equal(px(line, 'left'), rail.arrow + rail.bullet / 2)
  assert.equal(px(line, 'width'), 1)
  assert.match(line, /background-color:\s*var\(--hc-rail-default-color\)/)
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

  // The downward segment leaves that center and runs the whole gap below its
  // row, to the top of the next one, where the next block's segment starts. It
  // is the gap itself rather than a number of its own, so widening the space
  // between blocks can never break the line; and landing on the next row's top
  // it still stops short of the bullet that row hangs below it.
  assert.equal(value(down, 'bottom'), 'calc(-1 * var(--hc-block-gap))')
  assert.equal(value(rule('.ls-block'), 'margin-bottom'), 'var(--hc-block-gap)')

  // The rail starts at a bullet center: the first rendered block draws nothing
  // above its own bullet.
  assert.match(rule(railStart), /display:\s*none/)
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
  assert.match(rule(`${wrap} .bullet-container.typed-list .bullet`), /background-color:\s*var\(--hc-rail-bullet-fill\)/)

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

test('the property toggle rides beside the bullet without changing rail geometry', () => {
  const selector = `${wrap} > [data-hc-property-toggle]`
  const control = rule(selector)
  const dot = rule(`${selector}::before`)

  assert.match(control, /position:\s*absolute/)
  assert.equal(px(control, 'width'), 20)
  assert.equal(px(control, 'height'), 20)
  assert.equal(px(control, 'left'), 38)
  assert.equal(value(control, 'top'), 'calc(var(--hc-rail-bullet-y) - 10px)')
  assert.equal(px(dot, 'width'), 8)
  assert.equal(px(dot, 'height'), 8)
  assert.equal(Number(value(dot, 'opacity')), 0)
  assert.ok(px(control, 'left') > 30, 'the property control is not right of the rail line')
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

test('rail controls suppress background halos and hover enlargement', () => {
  const container = `${wrap} .bullet-container`
  assert.equal(value(rule(container), 'background-color'), 'transparent')
  for (const competing of [
    '.bullet-container:not(.typed-list)',
    '.bullet-container:not(.typed-list).bullet-closed',
    '.bullet-link-wrap:hover > .bullet-container'
  ]) {
    assert.ok(compare(specificity(container), specificity(competing)) > 0,
      `rail transparency must override ${competing}`)
  }
  const hovered = `${wrap}:hover .bullet-container .bullet`
  assert.equal(value(rule(hovered), 'transform'), 'none')
  assert.ok(compare(specificity(hovered),
    specificity('.bullet-link-wrap:hover > .bullet-container:not(.typed-list) .bullet')) > 0)
})

test('parent ring interiors mask the rail in both fold states', () => {
  const parent = `${scope} .ls-block:not(.block-content-wrapper *)[haschild="true"] > .block-main-container > .block-control-wrap .bullet-container`
  assert.equal(value(rule(parent), 'background-color'), 'var(--vscode-hc-black)')
  assert.equal(value(rule(parent), 'border-radius'), '50%')
  assert.equal(value(rule(`${parent} .bullet`), 'opacity'), '1')
  // The 16px opaque disc covers the 14px inner diameter (10px dot + two 2px gaps).
  assert.ok(rail.bullet >= rail.dot + 2 * 2)
  for (const competing of [`${wrap} .bullet-container`, `${wrap} .bullet-container.as-order-list`, '.bullet-link-wrap:hover > .bullet-container']) {
    assert.ok(compare(specificity(parent), specificity(competing)) >= 0)
  }
})

test('collapsed parents keep the outer ring and expanded rings have a 13px outer diameter', () => {
  const closed = `${scope} .ls-block:not(.block-content-wrapper *)[haschild="true"] > .block-main-container > .block-control-wrap .bullet-container .bullet`
  assert.equal(value(rule(closed), 'outline'), '2px solid var(--hc-rail-bullet-color)')
  assert.equal(value(rule(closed), 'outline-offset'), '2px')
  const expanded = `${scope} .ls-block:not(.block-content-wrapper *)[haschild="true"] > .block-main-container > .block-control-wrap .bullet-container:not(.bullet-closed)`
  assert.equal(value(rule(expanded), '--hc-rail-bullet-fill'), 'transparent')
  const inset = rule(`${expanded} .bullet`)
  assert.equal(value(inset, 'outline-width'), '2px')
  assert.equal(value(inset, 'outline-offset'), '-0.5px')
  assert.equal(rail.dot + 2 * (px(inset, 'outline-width') + px(inset, 'outline-offset')), 13,
    'expanded ring outer diameter must be 13px')
  assert.ok(compare(specificity(`${expanded} .bullet`), specificity(closed)) > 0)
  assert.equal(value(rule(`${wrap} .bullet-container .bullet`), 'outline'), 'none')
  for (const competing of [`${wrap} .bullet-container .bullet`, `${wrap} .bullet-container.typed-list .bullet`, `${wrap}:hover .bullet-container .bullet`]) {
    assert.ok(compare(specificity(closed), specificity(competing)) >= 0)
  }
  assert.doesNotMatch(css, /--hc-rail-bullet-(?:gap|ring|edge)/)
  for (const [selector, body] of rules) {
    if (!selector.startsWith(scope)) continue
    if (splitSelectors(selector).some(part => plain(part).endsWith('.bullet')) && /box-shadow:/.test(body)) {
      assert.equal(value(body, 'box-shadow'), 'none')
    }
  }
})

test('the slash-command menu is opaque and paints over the blocks below it', () => {
  // The surface itself. Logseq paints it from `hsl(var(--popover))`, which the
  // theme replaces outright rather than by re-pointing the token, so nothing an
  // accent redefines can thin it.
  const surface = [...rules].find(
    ([selector, body]) => selector.split(',').at(-1).trim() === '.absolute-modal[data-modal-name]' && /background:/.test(body)
  )
  assert.ok(surface, 'no rule paints the editor popups')
  assert.match(surface[1], /background:\s*var\(--vscode-hc-black\)\s*!important/)
  assert.match(surface[1], /opacity:\s*1\s*!important/)

  // The popup and the block holding it are both lifted, and both onto Logseq's
  // own scale. The popup's own z-index answers the missing stacking level; the
  // block's carries the popup out of the stacking context the rail makes of
  // every row, which the popup would otherwise be ordered inside.
  const level = 'var(--ls-z-index-level-1)'
  assert.equal(value(rule('.absolute-modal[data-modal-name]'), 'z-index'), level)

  const lift = '.ls-block:has(> .block-main-container .absolute-modal[data-modal-name])'
  assert.equal(value(rule(lift), 'z-index'), level)

  // The lift is on the block rather than the row because the block is already
  // positioned: a row given `position: relative` would become the containing
  // block every absolutely positioned thing inside it is measured from,
  // including the fold arrow Logseq hangs off the block on the right-hand
  // layout.
  assert.doesNotMatch(rule(lift), /position:/)
  assert.ok(
    [...rules].some(([selector, body]) => selector.endsWith('> .block-main-container') && /isolation:\s*isolate/.test(body)),
    'the row no longer isolates the rail, so the popup no longer needs lifting with the block'
  )

  // Lifting the block takes its children up with it, so the last thing left
  // painting over the popup is the edited block's own subtree: the row
  // isolates without being positioned, which orders it against the block's
  // positioned descendants by tree order, and Logseq's children container
  // comes after it. Ordering the children under the row settles that, off the
  // same `:has()` as the lift, so the block is always the stacking context
  // holding them and they go back no further than it.
  const children = `${lift} > .block-children-container`
  assert.equal(value(rule(children), 'z-index'), '-1')

  // Paint order only: upstream already positions the container, so the theme
  // adds no positioning of its own and nothing moves when a popup opens.
  assert.doesNotMatch(rule(children), /position:/)
  assert.ok(
    railMetrics.includes('.block-children-container{margin-left:29px;position:relative}'),
    'the children container is no longer positioned upstream, so ordering it now needs positioning too'
  )
})

test("the popup's section headings are white, bold, and still Logseq's size", () => {
  // Logseq draws them at a fifth of the popover foreground. The theme sets that
  // token to white, so the headings resolve to a fifth of white over the popup's
  // black — about a 1.6:1 contrast, well under any legibility floor. The theme
  // replaces the colour rather than the alpha, so no accent can thin it again.
  const heading = rule('.ui__ac-group-name')
  assert.equal(value(heading, 'color'), 'var(--vscode-hc-white) !important')

  // Sharing the rows' colour costs the heading the one thing that set it apart,
  // so it takes weight instead: bolder than Logseq's own 500 and bolder than
  // the commands under it.
  assert.equal(value(heading, 'font-weight'), '700 !important')

  // Size and padding are still Logseq's, and the heading is not given a
  // background that would box it off from the rows.
  assert.doesNotMatch(heading, /font-size:|padding:|background:/)
})

/* The boxes the page title is laid out in. Logseq holds the title's row at the
 * page's own left edge, lays the title's box 6px left of that and pads its text
 * 8px inside the box, and the title element inside it adds no offset of its own
 * — the linked form pads its text by the same 8px and lays itself back by it —
 * so the title's text starts 2px right of the page. The 20px the block tree is
 * pulled left by is an inline style on `.page-blocks-inner` rather than a
 * declaration, so it is the one measurement the title's arithmetic rests on
 * that cannot be pinned from the stylesheet. */
const titleMetrics = [
  '.ls-page-title{border-radius:calc(var(--radius) - 4px);margin:0 -6px;padding:5px 8px}',
  'a.page-title{color:inherit;display:block;margin-left:-8px;padding:0 8px;transition:none}',
  '.page-title{flex-grow:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
]

const title = { box: 6, pad: 8, treePull: 20 }

test("the page title's text starts in the column the blocks' text stands in", () => {
  // Where a block's text stands, measured from the page's left edge: the tree
  // is pulled left of the page, and then every block holds its text right of
  // the fold arrow's box, the bullet, and the gutter between bullet and text.
  const column = rail.arrow + rail.bullet + rail.gutter - title.treePull

  // Left where Logseq puts it, the title's text falls short of that column,
  // which is the gap the theme closes. The rail moves the bullet out of the
  // column but not the column itself, so closing it is the title's own work.
  assert.ok(title.pad - title.box < column, 'Logseq no longer starts the title left of the blocks')

  const declared = css.match(/\n:root \{\n  --hc-title-indent: ([\d.]+)px;\n\}/)
  assert.ok(declared, 'the title has no indent to stand in the text column by')
  assert.equal(Number.parseFloat(declared[1]), column, 'the title is not indented to the text column')

  // The indent is measured to the text, and the title's own box carries its
  // text 8px in, so the box is laid that much short of the column. Declared on
  // the box rather than on the heading inside it, so the background the title
  // is hovered and edited in travels with the text.
  const selector = [...rules.keys()].find((key) => plain(key).endsWith('.ls-page-title'))
  assert.ok(selector, 'no rule moves the page title')
  assert.equal(value(rule(selector), 'margin-left'), `calc(var(--hc-title-indent) - ${title.pad}px)`)

  // Logseq's own margin on that box is restated, not added to, so the theme has
  // to out-rank it rather than tie with it.
  assert.ok(
    compare(specificity(selector), specificity('.ls-page-title')) > 0,
    'the title indent does not out-rank Logseq\'s own margin on the same box'
  )

  // Same scope as the rail: the page's own title in the main editor. The two
  // layouts that re-measure the tree keep Logseq's alignment, since the column
  // the title would be indented to is not where their text stands.
  assert.ok(selector.startsWith('main:not(.ls-fold-button-on-right)'), 'the right-hand fold layout is indented too')
  assert.match(selector, /#main-content-container:not\(:has\(\.page-blocks-inner \.content\.doc-mode\)\)/)

  // Nothing else moves: the indent is one declaration on one box.
  const declarations = rule(selector).split(';').filter((part) => part.trim())
  assert.equal(declarations.length, 1, 'the title rule carries more than the indent')
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
    for (const declaration of [
      ...admonitionMetrics, ...spacingMetrics, ...nestingMetrics, ...railMetrics, ...titleMetrics, ...popupMetrics, ...iconMetrics,
      ...tableMetrics
    ]) {
      assert.ok(upstream.includes(declaration), `Logseq no longer ships "${declaration}"`)
    }
    assert.ok(upstream.includes(markDeclaration), 'Logseq no longer ships the page-mark rule')
    for (const token of radixTokens) {
      assert.ok(upstream.includes(`var(${token}`), `Logseq no longer reads ${token}`)
    }
  }
)
