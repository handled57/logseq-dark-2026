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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const css = await readFile(resolve(root, 'theme.css'), 'utf8')

/* Specificity as [ids, classes/attributes/pseudo-classes, types/pseudo-elements].
 * `:not()`, `:is()` and `:has()` take the specificity of their most specific
 * argument and contribute nothing themselves; `:where()` contributes nothing. */
function specificity(selector) {
  const total = [0, 0, 0]
  let rest = selector.trim()

  rest = rest.replace(/:(?:not|is|has|matches)\(([^()]*)\)/g, (_, inner) => {
    const best = inner.split(',').map(specificity).sort(compare).pop() ?? [0, 0, 0]
    for (let i = 0; i < 3; i += 1) total[i] += best[i]
    return ' '
  })
  rest = rest.replace(/:where\([^()]*\)/g, ' ')
  rest = rest.replace(/:[\w-]+\([^()]*\)/g, ':x')

  total[0] += (rest.match(/#[\w-]+/g) ?? []).length
  total[1] += (rest.match(/\.[\w-]+/g) ?? []).length
  total[1] += (rest.match(/\[[^\]]*\]/g) ?? []).length
  total[1] += (rest.match(/(?<!:):(?!:)[\w-]+/g) ?? []).length
  total[2] += (rest.match(/::[\w-]+/g) ?? []).length

  const types = rest
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/::?[\w-]+/g, ' ')
    .replace(/[.#][\w-]+/g, ' ')
  total[2] += (types.match(/(?:^|[\s>+~,])[a-zA-Z][\w-]*/g) ?? []).length

  return total
}

function compare(first, second) {
  return first[0] - second[0] || first[1] - second[1] || first[2] - second[2]
}

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

  const glyph = rem(rule('.block-body > .passage::after'), 'width')
  const column = rem(rule('.block-body > .passage::before'), 'width')
  const divider = rem(rule('.block-body > .passage::before'), 'border-right')
  const indent = rem(rule('.block-body > .passage'), 'padding')

  // `h-8`/`w-8`, and the row height that icon forces on a short admonition.
  assert.equal(glyph, 2)
  assert.equal(rem(rule('.block-body > .passage'), 'min-height'), 2)
  // The icon plus the icon column's own `pr-4`.
  assert.equal(column, glyph + 1)
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
 * bullet, and the 24px control box the bullet is centered in. Those are pinned
 * here because the rail is arithmetic on them — if Logseq re-measures a block,
 * the rail bends rather than breaks visibly, so nothing else would catch it. */
const railMetrics = [
  '.block-children-container{margin-left:29px;position:relative}',
  '.block-control-wrap{height:24px;margin-top:0;padding-right:6px}',
  '.bullet-container{align-items:center;border-radius:50%;display:flex;height:16px;justify-content:center;width:16px}',
  '.bullet-container.as-order-list{justify-content:center;padding-left:3px;white-space:nowrap;width:22px}',
  '.block-control-wrap.is-order-list{margin-right:0;padding-right:0}',
  '.block-control-wrap.is-order-list .bullet-link-wrap{left:-3px;position:relative}',
  // Both layouts re-measure that indentation, which is why the rail opts out of
  // them rather than drawing a line through the wrong column.
  'main.ls-fold-button-on-right .block-children-container{margin-left:7px}',
  '.content.doc-mode .block-children-container{margin-left:18px}'
]

/* Read back off the declarations above. */
const rail = { indent: 29, arrow: 22, bullet: 16, box: 24, gutter: 6, orderList: 22 }

/* The rail reaches the page's own tree in the main editor and nothing else:
 * not the sidebars, whiteboards or dialogs that render outside
 * `#main-content-container`, not the embedded and queried trees that render
 * inside a `.block-content-wrapper`, and not the two layouts above. */
const scope =
  'main:not(.ls-fold-button-on-right) #main-content-container .page-blocks-inner .content:not(.doc-mode)'
const block = `${scope} .ls-block:not(.block-content-wrapper *)`
const wrap = `${block} > .block-main-container > .block-control-wrap`
const control = `${wrap} > .block-control`

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

function px(body, property) {
  const match = body.match(new RegExp(`(?:^|;|\\n)\\s*${property}:\\s*(-?[\\d.]+)(?:px|(?=\\s*;))`))
  assert.ok(match, `${property} is missing`)
  return Number.parseFloat(match[1])
}

test('the rail takes back exactly the indentation each nesting level applied', () => {
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
    // Pulled left by everything the level indented, and handed back on the
    // other side so the content column does not travel with the bullet.
    assert.equal(px(body, 'margin-left'), -rail.indent * depth, `level ${depth} lands off the rail`)
    assert.equal(px(body, 'margin-right'), rail.indent * depth, `level ${depth} drags its content column`)
  }
  for (let depth = 1; depth <= levels.size; depth += 1) {
    assert.ok(levels.has(depth), `nesting level ${depth} has no rail rule`)
  }
})

test('the rail line stands at the center of the bullet column and stops at a bullet', () => {
  const line = rule(`${control}::before, ${control}::after`)
  // The fold arrow, then half a bullet: the center of the bullet Logseq draws.
  assert.equal(px(line, 'left'), rail.arrow + rail.bullet / 2)
  assert.equal(px(line, 'width'), 1)
  assert.match(line, /background-color:\s*var\(--vscode-hc-cyan\)/)
  // Decorative: the line is never what a click lands on.
  assert.match(line, /pointer-events:\s*none/)
  // Behind the bullets, inside the stacking context the row is given for it.
  assert.match(line, /z-index:\s*-1/)
  assert.match(rule(`${block} > .block-main-container`), /isolation:\s*isolate/)

  // What Logseq's 24px control box was centering the bullet by.
  assert.equal(px(rule(`${wrap} > .bullet-link-wrap`), 'margin-top'), (rail.box - rail.bullet) / 2)

  const up = rule(`${control}::before`)
  const down = rule(`${control}::after`)
  const center = rail.box / 2

  // The upward segment reaches the center of its own bullet, having started
  // above the row to cover the gap between one block and the next.
  assert.ok(px(up, 'top') < 0, 'the upward segment does not cover the gap above its row')
  assert.equal(px(up, 'height'), -px(up, 'top') + center)

  // The downward segment leaves that center and runs past the foot of its row,
  // by less than the distance a bullet sits below the row it follows — so it
  // always meets the next segment and can never outrun a bullet center.
  assert.equal(px(down, 'top'), center)
  const overshoot = -px(down, 'bottom')
  assert.ok(overshoot > 0, 'the downward segment stops short of the block below it')
  assert.ok(overshoot < center, 'the downward segment can outrun the bullet below it')

  // Both ends of the rail are a bullet center: the first rendered block draws
  // no upward segment, and the last rendered block no downward one.
  assert.match(rule(`${block}:not(.ls-block *):not(.ls-block ~ .ls-block) > .block-main-container > .block-control-wrap > .block-control::before`), /display:\s*none/)
  assert.match(rule(`${block}:not(:has(> .block-children-container .ls-block)):not(:has(~ .ls-block)):not(.ls-block:has(~ .ls-block) *) > .block-main-container > .block-control-wrap > .block-control::after`), /display:\s*none/)
})

test('an ordered list keeps its number beside the content and a bullet on the rail', () => {
  const marker = rule(`${wrap} .bullet-container.as-order-list`)
  // On the rail it reads as a bullet like any other, so it takes a bullet's box.
  assert.equal(px(marker, 'width'), rail.bullet)
  assert.equal(px(marker, 'padding-left'), 0)
  assert.match(rule(`${wrap} .bullet-container.typed-list .bullet`), /background-color:\s*var\(--vscode-hc-white\)/)

  // Logseq drops the gutter for an ordered list because its number is wider
  // than a bullet. The number is no longer there, so the gutter comes back and
  // every content column starts at the same offset.
  assert.equal(px(rule(`${wrap}.is-order-list`), 'padding-right'), rail.gutter)

  // The number itself is laid back where Logseq drew it, measured from the row
  // rather than from the bullet, so it holds at every nesting level.
  const label = rule(`${wrap} .bullet-container.typed-list .bullet > label`)
  assert.match(label, /position:\s*absolute/)
  assert.equal(px(label, 'left'), rail.arrow)
  assert.equal(px(label, 'width'), rail.orderList)
  assert.equal(px(label, 'height'), rail.box)

  // Upstream hangs an ordered list's bullet off a relative box shifted by 3px.
  // That box would otherwise be what the number above is measured from.
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
