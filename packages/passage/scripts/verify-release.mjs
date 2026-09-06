import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const archiveName = `${pkg.name}-${pkg.version}.zip`
const archive = resolve(root, 'dist', archiveName)
const prefix = `${pkg.name}/`

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50

/* Reading the archive in-process keeps this check identical on every platform.
 * Shelling out to `unzip` only worked where that binary happens to exist, which
 * silently skipped the release gate on Windows. */
function readArchive(buffer) {
  let eocd = buffer.length - 22
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== EOCD_SIGNATURE) eocd -= 1
  assert.ok(eocd >= 0, 'not a zip archive: no end-of-central-directory record')

  const total = buffer.readUInt16LE(eocd + 10)
  let cursor = buffer.readUInt32LE(eocd + 16)
  const entries = new Map()

  for (let index = 0; index < total; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), CENTRAL_SIGNATURE, 'malformed central directory')

    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    // Some archivers write Windows separators; the spec mandates forward slashes.
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength).replace(/\\/g, '/')

    const dataStart =
      localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)

    assert.ok(method === 0 || method === 8, `${name} uses unsupported compression method ${method}`)
    entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw))

    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

const entries = readArchive(await readFile(archive))

/* Directory records are optional and archiver-specific, so the contract is the
 * set of files. */
const files = [...entries.keys()].filter((name) => !name.endsWith('/')).sort()
const expected = [
  `${prefix}CHANGELOG.md`,
  `${prefix}LICENSE`,
  `${prefix}README.md`,
  `${prefix}THIRD_PARTY_NOTICES.md`,
  `${prefix}bible.js`,
  `${prefix}icon.svg`,
  `${prefix}index.html`,
  `${prefix}index.js`,
  `${prefix}lib/lsplugin.user.js`,
  `${prefix}manifest.json`,
  `${prefix}package.json`,
  /* The manifest, and only the manifest: the verse text it is built alongside
   * is a licensed edition, and shipping it here would republish it. */
  `${prefix}resources/bible.books.json`
].sort()

assert.deepEqual(files, expected, 'release archive contains missing or unexpected files')

/* The load-bearing check. `build-release.mjs` stages a local verse index into
 * the unpacked folder after this archive is closed, so the only thing standing
 * between a developer's licensed text and a published ZIP is this file list.
 * Named explicitly as well as covered by the list above, because a change that
 * loosened it should fail loudly and say why. */
assert.deepEqual(
  files.filter((name) => /bible\.(text|index)|\.text\.json$/i.test(name)),
  [],
  'release archive carries verse text, which is a licensed edition and must never ship'
)

/* Passage ships no stylesheet of its own: the block it writes is ordinary
 * Logseq markup, and painting it is a theme's business. */
assert.deepEqual(
  files.filter((name) => name.endsWith('.css')),
  [],
  'release archive carries a stylesheet, which belongs to a theme rather than to Passage'
)

const archivedPackage = JSON.parse(entries.get(`${prefix}package.json`).toString('utf8'))
assert.equal(archivedPackage.name, pkg.name)
assert.equal(archivedPackage.version, pkg.version)
assert.equal(archivedPackage.effect, true, 'the entry needs effect:true to read the host document')

const archivedManifest = JSON.parse(entries.get(`${prefix}manifest.json`).toString('utf8'))
assert.equal(archivedManifest.id, pkg.logseq.id)
assert.equal(archivedManifest.title, pkg.title)
assert.equal(archivedManifest.effect, true)

const sourceScript = await readFile(resolve(root, 'index.js'), 'utf8')
assert.equal(
  entries.get(`${prefix}index.js`).toString('utf8'),
  sourceScript,
  'archived index.js differs from the canonical plugin script'
)

const sourceParser = await readFile(resolve(root, 'bible.js'), 'utf8')
assert.equal(
  entries.get(`${prefix}bible.js`).toString('utf8'),
  sourceParser,
  'archived bible.js differs from the canonical reference parser'
)

/* The archived manifest is the shipped one, and it has to hold no verse text:
 * every book carries names, counts and offsets only. */
const archivedBooks = JSON.parse(entries.get(`${prefix}resources/bible.books.json`).toString('utf8'))
const bookKeys = ['bookId', 'shortName', 'longName', 'fromVerseId', 'chapters']
const chapterKeys = ['chapter', 'verses', 'first', 'missing']
for (const book of archivedBooks.books) {
  assert.deepEqual(
    Object.keys(book).filter((key) => !bookKeys.includes(key)),
    [],
    `${book.shortName} carries fields beyond the manifest's own`
  )
  for (const chapter of book.chapters) {
    assert.deepEqual(
      Object.keys(chapter).filter((key) => !chapterKeys.includes(key)),
      [],
      `${book.shortName} ${chapter.chapter} carries fields beyond the manifest's own`
    )
  }
}

console.log(`Verified dist/${archiveName}`)
