/* Structural tests for the Passage package: metadata, the entry, and what the
 * package is allowed to ship.
 *
 * Passage installs on its own, so nothing here may reach into a sibling
 * workspace: the package carries every file it needs, and no file that belongs
 * to a theme.
 */

import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const marketplace = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
const entry = await readFile(resolve(root, 'index.html'), 'utf8')
const script = await readFile(resolve(root, 'index.js'), 'utf8')

test('the released version matches the newest changelog entry', async () => {
  const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8')
  const latest = changelog.match(/^## (\d+\.\d+\.\d+) - \d{4}-\d{2}-\d{2}$/m)
  assert.ok(latest, 'changelog has no versioned release heading')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pkg.version, latest[1], 'package.json version and changelog disagree')
})

test('the package is a plugin, not a theme, and carries no dependencies', () => {
  assert.equal(pkg.name, 'logseq-passage')
  assert.equal(pkg.author, 'Peter Cole')
  assert.equal(pkg.repo, 'handled57/logseq-dark-2026')
  // `effect` is load-bearing, not descriptive: a side-effect-free package has
  // its entry rewritten to lsp://logseq.io/, a different origin from the host
  // window, which puts `parent.document` out of reach — and the `<` picker
  // bridge has no other way in.
  assert.equal(pkg.effect, true)
  // Passage paints nothing: it writes a block, and a theme styles it.
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
  assert.match(marketplace.description, /passage/i)
})

test('the plugin entry loads the vendored SDK, then the parser, then the command', async () => {
  const sdk = await readFile(resolve(root, 'lib', 'lsplugin.user.js'), 'utf8')
  assert.ok(sdk.length > 10_000, 'the vendored SDK is unexpectedly small')

  assert.match(entry, /<script src="\.\/lib\/lsplugin\.user\.js"><\/script>/)
  assert.match(entry, /<script src="\.\/bible\.js"><\/script>/)
  assert.match(entry, /<script src="\.\/index\.js"><\/script>/)
  assert.ok(
    entry.indexOf('lsplugin.user.js') < entry.indexOf('bible.js'),
    'the parser runs before the SDK defines the logseq global'
  )
  // Both are classic scripts sharing one global scope, so the parser has to be
  // defined by the time the entry script calls it.
  assert.ok(
    entry.indexOf('bible.js') < entry.indexOf('index.js'),
    'index.js runs before bible.js defines the reference parser'
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

test('the package ships the reference manifest and no verse text', async () => {
  const parser = await readFile(resolve(root, 'bible.js'), 'utf8')
  const books = JSON.parse(await readFile(resolve(root, 'resources', 'bible.books.json'), 'utf8'))
  const ignored = await readFile(resolve(root, '.gitignore'), 'utf8')

  assert.ok(pkg.files.includes('bible.js'))
  assert.ok(pkg.files.includes('resources/bible.books.json'))
  // The verse text is a licensed edition. It is built locally, never committed,
  // and the manifest that ships in its place carries counts, not words.
  assert.deepEqual(
    pkg.files.filter((file) => file.startsWith('resources')),
    ['resources/bible.books.json']
  )
  assert.match(ignored, /^resources\/\*$/m)
  assert.match(ignored, /^!resources\/bible\.books\.json$/m)

  assert.deepEqual(books.stats, { books: 84, chapters: 1398, verses: 37758 })
  // Names, counts and offsets, and nothing else: a stray text field would be
  // verse text republished under another name.
  for (const book of books.books) {
    assert.deepEqual(
      Object.keys(book).sort(),
      ['bookId', 'chapters', 'fromVerseId', 'longName', 'shortName'],
      book.shortName
    )
    for (const chapter of book.chapters) {
      assert.deepEqual(
        Object.keys(chapter).filter((key) => !['chapter', 'verses', 'first', 'missing'].includes(key)),
        [],
        `${book.shortName} ${chapter.chapter}`
      )
    }
  }

  // The parser reaches nothing: no host document, no network, no plugin API.
  // Its own prose says as much, so the check reads the code without it.
  const code = parser.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /parent\.|document|fetch\(|logseq\./)
})

test('the tracked source carries no verse text', async () => {
  const shipped = await readdir(resolve(root, 'resources'))
  // Whatever a local build has left in the working tree, only the manifest is
  // committed and only the manifest ships.
  assert.ok(shipped.includes('bible.books.json'))
  const ignored = await readFile(resolve(root, '.gitignore'), 'utf8')
  assert.match(ignored, /bible\.text\.json|resources\/\*/)
})

test('the command script reads the host document and namespaces what it writes', () => {
  assert.match(script, /parent\.document/)
  assert.match(script, /logseq\.ready\(main\)/)
  assert.match(script, /registerSlashCommand/)

  /* Observing attributes would make each pass schedule the next one, and the
   * sandbox iframe is never rendered, so its own rAF never fires. */
  assert.match(script, /\{ childList: true, subtree: true \}/)
  assert.doesNotMatch(script, /attributes:\s*true/)
  assert.doesNotMatch(script, /(?<!parent\.)requestAnimationFrame/)

  /* A theme annotates the same host document. Every attribute, style key and
   * element id Passage writes is its own, so neither plugin's teardown reaches
   * the other's nodes. */
  const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /data-hc-/, 'the command writes a theme-owned attribute')
  assert.doesNotMatch(code, /'hc-/, 'the command claims a theme-owned style key')
  for (const attribute of script.match(/'data-[\w-]+'/g) ?? []) {
    assert.match(attribute, /^'data-passage-/, `${attribute} is not namespaced to Passage`)
  }
})
