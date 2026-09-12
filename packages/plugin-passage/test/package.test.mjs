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
  const sdk = await readFile(resolve(root, '..', '..', 'vendor', 'logseq', 'lsplugin.user.js'), 'utf8')
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

test('the package ships a book manifest for every translation it offers', async () => {
  const parser = await readFile(resolve(root, 'bible.js'), 'utf8')
  const books = JSON.parse(await readFile(resolve(root, 'resources', 'nrsvue.books.json'), 'utf8'))
  const net = JSON.parse(await readFile(resolve(root, 'resources', 'net.books.json'), 'utf8'))
  const ignored = await readFile(resolve(root, '.gitignore'), 'utf8')

  assert.ok(pkg.files.includes('bible.js'))
  /* The manifests and the registry carry structural data, and the default
   * translation's verse text ships with them so an install writes passages
   * with no further setup. Every other translation's text is local. */
  assert.deepEqual(
    pkg.files.filter((file) => file.startsWith('resources')),
    [
      'resources/net.books.json',
      'resources/nrsvue.books.json',
      'resources/translations.json',
      'resources/net.text.json'
    ]
  )
  /* The NRSVue verse text and its source indexes are the local files; its
   * manifest holds no verse text and ships, so the ignore names the files it
   * means rather than the translation. */
  assert.match(ignored, /^resources\/nrsvue\.index\*$/m)
  assert.match(ignored, /^resources\/nrsvue\.text\*$/m)
  // A blanket ignore would keep a shipped manifest out of the package.
  assert.doesNotMatch(ignored, /^resources\/(?:\*|nrsvue\*)$/m)

  /* Two canons, and neither is the other: the deuterocanonical books are in
   * one manifest and not in the other, which is the whole reason a translation
   * resolves against its own. */
  assert.deepEqual(net.stats, { books: 66, chapters: 1189, verses: 31086 })
  const named = (manifest) => manifest.books.map(({ shortName }) => shortName)
  assert.ok(named(books).includes('Sir'))
  assert.equal(named(net).includes('Sir'), false)

  assert.deepEqual(books.stats, { books: 84, chapters: 1398, verses: 37758 })
  // Names, counts and offsets, and nothing else.
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

test('locally built text indexes stay local', async () => {
  const shipped = await readdir(resolve(root, 'resources'))
  // Whatever a local build has left in the working tree, the manifests, the
  // registry and the default translation remain the tracked resources.
  for (const file of [
    'net.books.json',
    'nrsvue.books.json',
    'translations.json',
    'net.text.json'
  ]) {
    assert.ok(shipped.includes(file), file)
  }
  const ignored = await readFile(resolve(root, '.gitignore'), 'utf8')
  assert.match(ignored, /^resources\/nrsvue\.text\*$/m)
})

test('the registry names both of every translation\'s files, and one of their indexes ships', async () => {
  const registry = JSON.parse(await readFile(resolve(root, 'resources', 'translations.json'), 'utf8'))

  assert.equal(registry.schemaVersion, 1)
  assert.ok(registry.translations.length >= 1)
  /* A translation is a manifest and a text index under one abbreviation, so an
   * entry names both and neither can be paired with another translation's. */
  for (const entry of registry.translations) {
    assert.deepEqual(
      Object.keys(entry),
      ['name', 'abbreviation', 'books', 'text'],
      entry.abbreviation
    )
    const abbreviation = entry.abbreviation.toLowerCase()
    assert.equal(entry.books, `resources/${abbreviation}.books.json`)
    assert.equal(entry.text, `resources/${abbreviation}.text.json`)
  }
  // Sorted by abbreviation, so the same set of translations writes the same file.
  assert.deepEqual(
    registry.translations.map(({ abbreviation }) => abbreviation),
    [...registry.translations.map(({ abbreviation }) => abbreviation)].sort()
  )

  /* Whichever of a translation's files is present, it names the translation it
   * holds, and names the same one the registry does: an option in the dropdown,
   * the books it resolves against and the text behind them are one data set. */
  for (const entry of registry.translations) {
    for (const file of [entry.books, entry.text]) {
      const path = resolve(root, file)
      if (!(await access(path, constants.R_OK).then(() => true, () => false))) continue
      const index = JSON.parse(await readFile(path, 'utf8'))
      assert.equal(index.schemaVersion, 2, file)
      assert.deepEqual(
        index.translation,
        { name: entry.name, abbreviation: entry.abbreviation },
        file
      )
      assert.ok(Object.keys(index.books).length > 0, file)
    }
  }

  // NET is the default translation, and the only verse text in the archive.
  const net = registry.translations.find(({ abbreviation }) => abbreviation === 'NET')
  assert.deepEqual(net, {
    name: 'New English Translation',
    abbreviation: 'NET',
    books: 'resources/net.books.json',
    text: 'resources/net.text.json'
  })
  assert.deepEqual(
    pkg.release.files.filter((file) => file.endsWith('.text.json')),
    ['resources/net.text.json']
  )
  /* Every manifest ships, so a translation whose text a reader builds locally
   * still has the books that text was built from. */
  assert.deepEqual(
    pkg.release.files.filter((file) => file.endsWith('.books.json')),
    registry.translations.map(({ books }) => books).sort()
  )
  assert.ok(pkg.release.files.includes('resources/translations.json'))

  // The runtime builds its dropdown from the registry, not from a verse index.
  assert.match(script, /resources\/translations\.json/)
  assert.match(script, /enumChoices/)
})

test('the build stages a local verse index only after the archive is closed', async () => {
  const repo = resolve(root, '..', '..')
  const build = await readFile(resolve(repo, 'scripts', 'build-release.mjs'), 'utf8')
  const verify = await readFile(resolve(repo, 'scripts', 'verify-release.mjs'), 'utf8')

  /* The text index is copied into the unpacked folder after archiving so a
   * developer's install keeps working across rebuilds. */
  assert.doesNotMatch(JSON.stringify(pkg.release.files), /nrsvue\.text\.json/, 'the local text index is in the fixed release file list')
  assert.deepEqual(pkg.release.unpackedLocalFiles, ['resources/nrsvue.text.json'])

  const archived = build.indexOf('zipped?.status')
  const staged = build.indexOf('unpackedLocalFiles')
  assert.ok(archived >= 0, 'the build no longer archives')
  assert.ok(staged >= 0, 'the build no longer stages a local verse index')
  assert.ok(staged > archived, 'the verse index is staged before the archive is closed')

  // The generic verifier derives an exact allowlist from workspace metadata.
  assert.match(verify, /release\.files/)
})

test('the command script reads the host document and namespaces what it writes', () => {
  assert.match(script, /parent\.document/)
  assert.match(script, /logseq\.ready\(main\)/)
  assert.match(script, /registerSlashCommand/)
  assert.match(script, /registerCommandPalette/)

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
