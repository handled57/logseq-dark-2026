import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { licenseSource, sdkSource, selectedWorkspaces } from './release-support.mjs'
import { readArchive } from '../test/support/zip.mjs'

const targets = await selectedWorkspaces(process.argv.includes('--all'))
const shared = ['LICENSE', 'lib/lsplugin.user.js']

for (const target of targets) {
  const prefix = `${target.pkg.name}/`
  const entries = readArchive(await readFile(target.archive))
  const files = [...entries.keys()].filter((name) => !name.endsWith('/')).sort()
  const expected = [...target.pkg.release.files, ...shared]
    .map((file) => `${prefix}${file}`).sort()
  assert.deepEqual(files, expected, `${target.pkg.name} archive contains missing or unexpected files`)

  const archivedPackage = JSON.parse(entries.get(`${prefix}package.json`).toString('utf8'))
  const archivedManifest = JSON.parse(entries.get(`${prefix}manifest.json`).toString('utf8'))
  assert.equal(archivedPackage.name, target.pkg.name)
  assert.equal(archivedPackage.version, target.pkg.version)
  assert.equal(archivedManifest.id, target.pkg.logseq.id)
  assert.equal(archivedManifest.title, target.pkg.title)
  assert.equal(archivedManifest.effect, target.pkg.effect)

  for (const file of target.pkg.release.files) {
    assert.deepEqual(
      entries.get(`${prefix}${file}`),
      await readFile(resolve(target.root, file)),
      `archived ${file} differs from ${relative(process.cwd(), resolve(target.root, file))}`
    )
  }
  assert.deepEqual(entries.get(`${prefix}LICENSE`), await readFile(licenseSource))
  assert.deepEqual(entries.get(`${prefix}lib/lsplugin.user.js`), await readFile(sdkSource))
  console.log(`Verified dist/${target.archiveName}`)
}
