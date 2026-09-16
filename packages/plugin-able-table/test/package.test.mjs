/* Structural tests for the Able Table package: metadata, the entry, and what
 * the package is allowed to ship.
 *
 * Able Table installs on its own, so nothing here may reach into a sibling
 * workspace: the package carries every file it needs, and no file that
 * belongs to a theme or to another plugin.
 */

import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const marketplace = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
const entry = await readFile(resolve(root, 'index.html'), 'utf8')
const script = await readFile(resolve(root, 'index.js'), 'utf8')
/* What the runtime says about itself is prose; these checks read the code
 * without it. */
const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('the released version matches the newest changelog entry', async () => {
  // Pinning the version as a literal here would let package.json and the
  // changelog drift apart; deriving it keeps one source of truth.
  const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8')
  const [, released] = changelog.match(/^## (\d+\.\d+\.\d+) - \d{4}-\d{2}-\d{2}$/m) ?? []

  assert.ok(released, 'the changelog has no dated release heading')
  assert.equal(pkg.version, released)
  // Finished work ships as a release rather than accumulating unreleased.
  assert.doesNotMatch(changelog, /^## Unreleased\s*\n\s*\n\s*-/m, 'the changelog left an entry unreleased')
})

test('the package is a plugin, not a theme, and carries no dependencies', () => {
  assert.equal(pkg.name, 'logseq-able-table')
  assert.equal(pkg.author, 'Peter Cole')
  assert.equal(pkg.repo, 'handled57/logseq-dark-2026')
  // `effect` is load-bearing, not descriptive: a side-effect-free package has
  // its entry rewritten to lsp://logseq.io/, a different origin from the host
  // window, which puts `parent.document` — where every rendered table lives —
  // out of reach.
  assert.equal(pkg.effect, true)
  assert.equal(pkg.theme, undefined)
  assert.equal(pkg.logseq.themes, undefined)
  assert.equal(pkg.main, 'index.html')
  assert.equal(pkg.logseq.main, 'index.html')
  assert.equal(pkg.logseq.id, pkg.name)
  // The SDK is vendored under lib/, so installing from a release needs no
  // install step and no runtime dependency resolution.
  assert.deepEqual(pkg.dependencies, undefined)
  assert.deepEqual(pkg.devDependencies, undefined)
})

test('marketplace metadata is classic-only and agrees with the package', () => {
  assert.equal(marketplace.id, pkg.name)
  assert.equal(marketplace.repo, pkg.repo)
  assert.equal(marketplace.author, pkg.author)
  assert.equal(marketplace.title, pkg.title)
  assert.equal(marketplace.theme, false)
  assert.equal(marketplace.effect, pkg.effect)
  assert.equal(marketplace.web, false)
  assert.equal(marketplace.supportsDB, false)
  assert.equal(marketplace.supportsDBOnly, false)
})

test('the plugin entry loads the vendored SDK, then the runtime', async () => {
  const sdk = await readFile(resolve(root, '..', '..', 'vendor', 'logseq', 'lsplugin.user.js'), 'utf8')
  assert.ok(sdk.length > 10_000, 'the vendored SDK is unexpectedly small')

  assert.match(entry, /<script src="\.\/lib\/lsplugin\.user\.js"><\/script>/)
  assert.match(entry, /<script src="\.\/index\.js"><\/script>/)
  assert.ok(
    entry.indexOf('lsplugin.user.js') < entry.indexOf('index.js'),
    'index.js runs before the SDK defines the logseq global'
  )
})

test('the package ships no stylesheet and no icon a theme owns', async () => {
  await assert.rejects(access(resolve(root, 'theme.css'), constants.F_OK))
  assert.deepEqual(pkg.files.filter((file) => file.endsWith('.css')), [])
  const icon = await readFile(resolve(root, 'icon.svg'), 'utf8')
  assert.match(icon, /^<svg\b/)
  assert.match(icon, /<\/svg>\s*$/)
  assert.equal(pkg.logseq.icon, './icon.svg')
})

test('the release ships exactly the runtime and its documentation', () => {
  assert.deepEqual(pkg.release.files, [
    'package.json',
    'manifest.json',
    'index.html',
    'index.js',
    'icon.svg',
    'README.md',
    'CHANGELOG.md',
    'THIRD_PARTY_NOTICES.md'
  ])
  // Nothing is generated or staged locally, so there is nothing to keep out
  // of the archive afterwards.
  assert.equal(pkg.release.unpackedLocalFiles, undefined)
})

test('the runtime observes the host document and marks tables, and offers no setting', () => {
  assert.match(script, /parent\.document/)
  assert.match(script, /logseq\.ready\(main\)/)
  assert.match(script, /new MutationObserver/)
  assert.match(script, /parent\.requestAnimationFrame/)
  assert.match(script, /querySelectorAll\(MAIN_EDITOR_SELECTOR\)/)
  assert.match(script, /TABLE_WRAPPER_SELECTOR/)
  assert.match(script, /logseq\.beforeunload/)

  /* Every control sits inside rendered block content, where a click of
   * Logseq's own opens the block for editing; the capture phase is what keeps
   * each one to itself. */
  for (const type of ['mousedown', 'click', 'keydown', 'keyup', 'input', 'focusout']) {
    assert.match(code, new RegExp(`'${type}'`), `${type} is not answered`)
  }
  assert.match(code, /addEventListener\(type, handler, true\)/)
  assert.match(code, /removeEventListener\?\.\(type, handler, true\)/)

  // Search is a per-table toggle in the panel, not a plugin-wide preference.
  assert.doesNotMatch(code, /useSettingsSchema/)
})

test('everything written into the host document is namespaced to Able Table', () => {
  assert.doesNotMatch(code, /data-passage-/, "the runtime writes Passage's attribute")
  assert.doesNotMatch(code, /data-anno-/, "the runtime writes Anno's attribute")

  for (const attribute of script.match(/'data-[\w-]+'/g) ?? []) {
    assert.match(attribute, /^'data-able-/, `${attribute} is not namespaced to Able Table`)
  }
  assert.match(code, /STYLE_KEY = 'able-table'/)
})

test("the theme's collapse control is read in CSS alone, and never written", () => {
  /* docs/contracts/table-controls-v1.md: a one-directional, read-only hook.
   * The plugin may notice the theme's control to step out of its way, and may
   * do nothing else with it — no script reads it, and no package is a
   * dependency of the other. */
  assert.deepEqual(
    [...new Set(code.match(/data-hc-[\w-]*/g) ?? [])],
    ['data-hc-collapse'],
    'the runtime names a theme attribute other than the published hook'
  )
  assert.match(code, /div\.table-wrapper:has\(> \[data-hc-collapse\]\) > \[data-able-settings\]/)
  // Read through a selector, never through the DOM API and never as a value.
  assert.doesNotMatch(code, /Attribute\(\s*[`'"]data-hc-/)
  assert.doesNotMatch(code, /[`'"]data-hc-[\w-]*[`'"]/)

  // Every number it borrows carries Able Table's own fallback, so the control
  // is drawn and placed with no theme installed.
  for (const use of code.match(/var\(--hc-[\w-]+[^)]*\)/g) ?? []) {
    assert.match(use, /^var\(--hc-collapse-control-size, 1\.25rem\)$/, `${use} has no fallback`)
  }
})
