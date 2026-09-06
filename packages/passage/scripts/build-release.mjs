import { access, cp, mkdir, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const dist = resolve(root, 'dist')
const bundleName = pkg.name
const bundle = resolve(dist, bundleName)
const archive = `${bundleName}-${pkg.version}.zip`

/* The verse text is a licensed edition and is in none of these: it is not
 * committed, and it is not packaged. It is staged into the unpacked folder
 * after the archive is closed — see the end of this file. */
const releaseFiles = [
  'package.json',
  'manifest.json',
  'index.html',
  'index.js',
  'bible.js',
  'resources/bible.books.json',
  'lib',
  'icon.svg',
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

/* `zip` ships with the CI runner and every mainstream Unix, but not with
 * Windows, where Compress-Archive is the built-in equivalent. */
const archivers = process.platform === 'win32'
  ? [
      ['powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Compress-Archive -Path '${bundleName}' -DestinationPath '${archive}' -Force`]],
      ['zip', ['-rq', archive, bundleName]]
    ]
  : [
      ['zip', ['-rq', archive, bundleName]],
      ['powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Compress-Archive -Path '${bundleName}' -DestinationPath '${archive}' -Force`]]
    ]

let zipped
for (const [command, args] of archivers) {
  zipped = spawnSync(command, args, { cwd: dist, stdio: 'inherit' })
  if (zipped.error?.code === 'ENOENT') continue
  break
}

if (zipped.error) throw zipped.error
if (zipped.status !== 0) throw new Error(`archiving exited with status ${zipped.status}`)

console.log(`Built dist/${archive}`)

/* The archive is closed, so what happens to the staging folder from here cannot
 * reach it. That is the whole point of doing this last.
 *
 * `dist/<name>/` is also the folder a developer loads as an unpacked plugin,
 * and a rebuild wipes it. A local `resources/bible.text.json` is copied in so
 * that folder is a complete working plugin across rebuilds, while the ZIP stays
 * exactly the file list `scripts/verify-release.mjs` asserts. Nothing is copied
 * when there is no local index, which is every clean checkout and CI. */
const localText = resolve(root, 'resources', 'bible.text.json')
const hasLocalText = await access(localText, constants.R_OK).then(() => true, () => false)

if (hasLocalText) {
  await cp(localText, resolve(bundle, 'resources', 'bible.text.json'))
  console.log(
    `Staged your local resources/bible.text.json into dist/${bundleName}/ for unpacked ` +
    'testing. It is licensed text: it is not in the ZIP and is never published.'
  )
}
