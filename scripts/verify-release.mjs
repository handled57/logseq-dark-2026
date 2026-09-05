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
  `${prefix}icon.svg`,
  `${prefix}index.html`,
  `${prefix}index.js`,
  `${prefix}lib/lsplugin.user.js`,
  `${prefix}manifest.json`,
  `${prefix}package.json`,
  // The README embeds the palette chart, so the archive carries it too.
  `${prefix}screenshots/color-palette.svg`,
  `${prefix}screenshots/logseq-dark-high-contrast.png`,
  `${prefix}theme.css`
].sort()

assert.deepEqual(files, expected, 'release archive contains missing or unexpected files')

const archivedPackage = JSON.parse(entries.get(`${prefix}package.json`).toString('utf8'))
assert.equal(archivedPackage.name, pkg.name)
assert.equal(archivedPackage.version, pkg.version)

const sourceCss = await readFile(resolve(root, 'theme.css'), 'utf8')
assert.equal(
  entries.get(`${prefix}theme.css`).toString('utf8'),
  sourceCss,
  'archived theme.css differs from the canonical stylesheet'
)

const sourceScript = await readFile(resolve(root, 'index.js'), 'utf8')
assert.equal(
  entries.get(`${prefix}index.js`).toString('utf8'),
  sourceScript,
  'archived index.js differs from the canonical plugin script'
)

const sourceScreenshot = await readFile(resolve(root, 'screenshots', 'logseq-dark-high-contrast.png'))
assert.deepEqual(
  entries.get(`${prefix}screenshots/logseq-dark-high-contrast.png`),
  sourceScreenshot,
  'archived screenshot differs from the public screenshot'
)

console.log(`Verified dist/${archiveName}`)
