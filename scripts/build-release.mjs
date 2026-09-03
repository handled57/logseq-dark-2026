import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const dist = resolve(root, 'dist')
const bundleName = pkg.name
const bundle = resolve(dist, bundleName)
const archive = `${bundleName}-${pkg.version}.zip`

const releaseFiles = [
  'package.json',
  'manifest.json',
  'theme.css',
  'icon.svg',
  'screenshots',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md'
]

await rm(dist, { recursive: true, force: true })
await mkdir(bundle, { recursive: true })

for (const file of releaseFiles) {
  await cp(resolve(root, file), resolve(bundle, file), { recursive: true })
}

const zipped = spawnSync('zip', ['-rq', archive, bundleName], {
  cwd: dist,
  stdio: 'inherit'
})

if (zipped.error) throw zipped.error
if (zipped.status !== 0) throw new Error(`zip exited with status ${zipped.status}`)

console.log(`Built dist/${archive}`)
