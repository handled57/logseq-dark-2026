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

test('the moved property table starts at the divider and takes the box tail', () => {
  const declarations = (selector) => {
    const start = css.indexOf(`\n${selector} {`)
    assert.ok(start >= 0, `${selector} is missing`)
    return css.slice(start, css.indexOf('}', start))
  }

  const scope =
    '.block-content:has(> .block-body > :is(.admonitionblock:is(.tip, .note, .important, .caution, .pinned, .warning), .passage)):has(> .block-properties:not([data-hc-hidden]))'
  const table = declarations(`${scope} > .block-properties`)

  const offset = table.match(/margin-left:\s*calc\(([\d.]+)rem \+ (\d+)px\)/)
  assert.ok(offset, 'the table carries no offset to the divider')

  // The divider stands at the end of the icon column, inside the transparent
  // edge the box is drawn with — the same two figures the passage is built
  // from, so the table lines up with either kind of box.
  const column = declarations('.block-body > .passage::before').match(/width:\s*([\d.]+)rem/)
  const edge = declarations('.block-body > .passage').match(/border:\s*(\d+)px solid transparent/)
  assert.equal(Number.parseFloat(offset[1]), Number.parseFloat(column[1]))
  assert.equal(Number.parseInt(offset[2], 10), Number.parseInt(edge[1], 10))

  // The 2rem tail Logseq gives the box moves to the table below it, so the
  // block keeps the height it had and the table sits against its own box.
  assert.ok(spacingMetrics[0].includes('margin:2rem 0'), 'the pinned box tail is no longer 2rem')
  assert.match(table, /margin-bottom:\s*2rem;/)
  assert.match(css, /> \.block-body > :is\([^{]*\.passage\) \{\s*\n\s*margin-bottom:\s*0;/)
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
    for (const declaration of [...admonitionMetrics, ...spacingMetrics]) {
      assert.ok(upstream.includes(declaration), `Logseq no longer ships "${declaration}"`)
    }
    assert.ok(upstream.includes(markDeclaration), 'Logseq no longer ships the page-mark rule')
    for (const token of radixTokens) {
      assert.ok(upstream.includes(`var(${token}`), `Logseq no longer reads ${token}`)
    }
  }
)
