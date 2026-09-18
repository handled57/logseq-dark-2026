import assert from 'node:assert/strict'
import { access, cp, mkdir, readFile, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
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

export async function stageBundle(target) {
  await mkdir(target.bundle, { recursive: true })
  for (const file of target.pkg.release.files) {
    await cp(resolve(target.root, file), resolve(target.bundle, file), { recursive: true })
  }
  await mkdir(resolve(target.bundle, 'lib'), { recursive: true })
  await cp(sdkSource, resolve(target.bundle, 'lib/lsplugin.user.js'))
  await cp(licenseSource, resolve(target.bundle, 'LICENSE'))
}

export async function stageUnpackedLocalFiles(target, { announce = true } = {}) {
  const staged = []
  for (const file of target.pkg.release.unpackedLocalFiles ?? []) {
    const source = resolve(target.root, file)
    if (await access(source, constants.R_OK).then(() => true, () => false)) {
      await mkdir(resolve(target.bundle, file, '..'), { recursive: true })
      await cp(source, resolve(target.bundle, file))
      staged.push(file)
      if (announce) {
        console.log(`Staged local ${file} into dist/${target.pkg.name}/ for unpacked testing; it is not in the ZIP.`)
      }
    }
  }
  return staged
}
