/* Structural tests for the Anno package: metadata, the entry, and what the
 * package is allowed to ship.
 *
 * Anno installs on its own, so nothing here may reach into a sibling
 * workspace: the package carries every file it needs, and no file that belongs
 * to a theme or to another plugin.
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
  const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8')
  const latest = changelog.match(/^## (\d+\.\d+\.\d+) - \d{4}-\d{2}-\d{2}$/m)
  assert.ok(latest, 'changelog has no versioned release heading')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pkg.version, latest[1], 'package.json version and changelog disagree')
})

test('the package is a plugin, not a theme, and carries no dependencies', () => {
  assert.equal(pkg.name, 'logseq-anno')
  assert.equal(pkg.author, 'Peter Cole')
  assert.equal(pkg.repo, 'handled57/logseq-dark-2026')
  // `effect` is load-bearing, not descriptive: a side-effect-free package has
  // its entry rewritten to lsp://logseq.io/, a different origin from the host
  // window, which puts both `parent.document` and the host's own `parent.apis`
  // bridge out of reach — and the import needs each of them.
  assert.equal(pkg.effect, true)
  // Anno paints nothing beyond its own prompt.
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
  assert.match(marketplace.description, /pdf/i)
})

test('the plugin entry loads the vendored SDK, then the command', async () => {
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
  // Nothing is generated or staged locally, so there is nothing to keep out of
  // the archive afterwards.
  assert.equal(pkg.release.unpackedLocalFiles, undefined)
})

test('the command script offers both entry points and reaches the host itself', () => {
  assert.match(script, /parent\.document/)
  assert.match(script, /logseq\.ready\(main\)/)
  assert.match(script, /registerSlashCommand/)
  assert.match(script, /registerCommandPalette/)
  // The asset write has no plugin API; the host's own IPC bridge is the route.
  assert.match(code, /parent\.apis/)
  assert.match(code, /'writeFile'/)

  /* Anno annotates nothing in the host document, so it watches nothing there:
   * the prompt is built when a command asks for it and removed when it
   * closes. */
  assert.doesNotMatch(code, /MutationObserver/, 'the command observes the host document')
  assert.doesNotMatch(code, /(?<!parent\.)requestAnimationFrame/)
})

test('everything written into the host document is namespaced to Anno', () => {
  assert.doesNotMatch(code, /data-hc-/, 'the command writes a theme-owned attribute')
  assert.doesNotMatch(code, /data-passage-/, "the command writes Passage's attribute")
  assert.doesNotMatch(code, /'hc-|'passage-/, "the command claims another package's style key")

  for (const attribute of script.match(/'data-[\w-]+'/g) ?? []) {
    assert.match(attribute, /^'data-anno-/, `${attribute} is not namespaced to Anno`)
  }
  for (const id of script.match(/^const [A-Z_]*(FIELD_ID|STYLE_KEY) = '[^']+'/gm) ?? []) {
    assert.match(id, /'anno-/, `${id} is not namespaced to Anno`)
  }
})
