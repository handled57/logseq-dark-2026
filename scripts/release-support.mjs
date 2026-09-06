import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const distRoot = resolve(repositoryRoot, 'dist')
export const sdkSource = resolve(repositoryRoot, 'vendor/logseq/lsplugin.user.js')
export const licenseSource = resolve(repositoryRoot, 'LICENSE')

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function workspaces() {
  const rootPackage = await readJson(resolve(repositoryRoot, 'package.json'))
  assert.deepEqual(rootPackage.workspaces, ['packages/*'], 'release tooling expects packages/* workspaces')
  const names = (await readdir(resolve(repositoryRoot, 'packages'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  return Promise.all(names.map(async (name) => workspace(resolve(repositoryRoot, 'packages', name))))
}

export async function workspace(root = process.cwd()) {
  const pkg = await readJson(resolve(root, 'package.json'))
  assert.ok(Array.isArray(pkg.release?.files), `${pkg.name} has no release.files allowlist`)
  return {
    root,
    pkg,
    bundle: resolve(distRoot, pkg.name),
    archiveName: `${pkg.name}-${pkg.version}.zip`,
    archive: resolve(distRoot, `${pkg.name}-${pkg.version}.zip`)
  }
}

export async function selectedWorkspaces(all) {
  return all ? workspaces() : [await workspace()]
}
