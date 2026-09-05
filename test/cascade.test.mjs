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
    for (const token of radixTokens) {
      assert.ok(upstream.includes(`var(${token}`), `Logseq no longer reads ${token}`)
    }
  }
)
