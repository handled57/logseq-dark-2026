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

test('package exposes one CSS-only dark theme', () => {
  assert.equal(pkg.name, 'logseq-dark-high-contrast-theme')
  assert.equal(pkg.author, 'Peter Cole')
  assert.equal(pkg.repo, 'handled57/logseq-dark-2026')
  assert.equal(pkg.effect, false)
  assert.equal(pkg.theme, true)
  assert.equal(pkg.main, undefined)
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

test('marketplace metadata is classic-only and side-effect free', () => {
  assert.equal(marketplace.id, pkg.name)
  assert.equal(marketplace.repo, pkg.repo)
  assert.equal(marketplace.author, pkg.author)
  assert.equal(marketplace.theme, true)
  assert.equal(marketplace.effect, false)
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
  assert.match(css, /\.bullet-container:not\(\.typed-list\)/)
  assert.match(css, /\.ls-block:hover:has\(\.ls-block:hover\)/)
  assert.match(css, /\.ls-block:hover:not\(:has\(\.ls-block:hover\)\)/)
  assert.match(css, /\.block-children,[\s\S]*?\.block-children-left-border\s*\{[\s\S]*?border-left-color:\s*transparent\s*!important/)
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

test('stylesheet is local, structurally balanced, and avoids global monospace', () => {
  assert.doesNotMatch(css, /@import\s+url\(/i)
  assert.doesNotMatch(css, /https?:\/\//i)
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
    ['warning text', '#ffff00', '#332a00', 4.5],
    ['error text', '#f48771', '#3b0d08', 4.5],
    ['success text', '#b7d6a8', '#14240f', 4.5]
  ]) {
    assert.ok(contrast(foreground, background) >= minimum, `${name} contrast is too low`)
  }
})
