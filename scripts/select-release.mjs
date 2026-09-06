import assert from 'node:assert/strict'
import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repositoryRoot, workspace } from './release-support.mjs'

const releases = {
  anno: 'packages/anno',
  passage: 'packages/passage',
  theme: 'packages/dark-high-contrast'
}

export async function selectRelease(tag) {
  const match = /^(anno|passage|theme)-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag)
  assert.ok(match, `unsupported release tag: ${tag}`)

  const [, product, version] = match
  const workspacePath = releases[product]
  const target = await workspace(resolve(repositoryRoot, workspacePath))
  assert.equal(
    version,
    target.pkg.version,
    `${tag} does not match ${workspacePath}/package.json version ${target.pkg.version}`
  )

  const changelog = await readFile(resolve(target.root, 'CHANGELOG.md'), 'utf8')
  const newest = /^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/m.exec(changelog)?.[1]
  assert.ok(newest, `${workspacePath}/CHANGELOG.md has no versioned entry`)
  assert.equal(
    version,
    newest,
    `${tag} does not match newest ${workspacePath}/CHANGELOG.md version ${newest}`
  )

  return {
    archive: `dist/${target.archiveName}`,
    release_name: `${target.pkg.title} ${version}`,
    workspace: workspacePath
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const selected = await selectRelease(process.argv[2] ?? '')
  const output = Object.entries(selected).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output)
  else process.stdout.write(output)
}
