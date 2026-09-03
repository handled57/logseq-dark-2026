import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const archiveName = `${pkg.name}-${pkg.version}.zip`
const archive = resolve(root, 'dist', archiveName)
const prefix = `${pkg.name}/`

function unzip(args) {
  const result = spawnSync('unzip', args, { encoding: 'utf8' })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr || `unzip ${args.join(' ')} failed`)
  return result.stdout
}

function unzipBuffer(args) {
  const result = spawnSync('unzip', args)
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr.toString() || `unzip ${args.join(' ')} failed`)
  return result.stdout
}

const entries = unzip(['-Z1', archive]).trim().split('\n').filter(Boolean).sort()
const expected = [
  prefix,
  `${prefix}CHANGELOG.md`,
  `${prefix}LICENSE`,
  `${prefix}README.md`,
  `${prefix}THIRD_PARTY_NOTICES.md`,
  `${prefix}icon.svg`,
  `${prefix}manifest.json`,
  `${prefix}package.json`,
  `${prefix}screenshots/`,
  `${prefix}screenshots/logseq-dark-high-contrast.png`,
  `${prefix}theme.css`
].sort()

assert.deepEqual(entries, expected, 'release archive contains missing or unexpected files')

const archivedPackage = JSON.parse(unzip(['-p', archive, `${prefix}package.json`]))
assert.equal(archivedPackage.name, pkg.name)
assert.equal(archivedPackage.version, pkg.version)

const sourceCss = await readFile(resolve(root, 'theme.css'), 'utf8')
const archivedCss = unzip(['-p', archive, `${prefix}theme.css`])
assert.equal(archivedCss, sourceCss, 'archived theme.css differs from the canonical stylesheet')

const sourceScreenshot = await readFile(resolve(root, 'screenshots', 'logseq-dark-high-contrast.png'))
const archivedScreenshot = unzipBuffer(['-p', archive, `${prefix}screenshots/logseq-dark-high-contrast.png`])
assert.deepEqual(archivedScreenshot, sourceScreenshot, 'archived screenshot differs from the public screenshot')

console.log(`Verified dist/${archiveName}`)
