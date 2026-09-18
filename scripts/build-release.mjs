import { mkdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { basename } from 'node:path'
import {
  distRoot, selectedWorkspaces, stageBundle, stageUnpackedLocalFiles
} from './release-support.mjs'

const all = process.argv.includes('--all')
const targets = await selectedWorkspaces(all)

if (all) await rm(distRoot, { recursive: true, force: true })
await mkdir(distRoot, { recursive: true })

for (const target of targets) {
  if (!all) {
    await rm(target.bundle, { recursive: true, force: true })
    await rm(target.archive, { force: true })
  }
  await stageBundle(target)

  const bundleName = target.pkg.name
  const archivers = process.platform === 'win32'
    ? [
        ['powershell', ['-NoProfile', '-NonInteractive', '-Command',
          `Compress-Archive -Path '${bundleName}' -DestinationPath '${target.archiveName}' -Force`]],
        ['zip', ['-rq', target.archiveName, bundleName]]
      ]
    : [
        ['zip', ['-rq', target.archiveName, bundleName]],
        ['powershell', ['-NoProfile', '-NonInteractive', '-Command',
          `Compress-Archive -Path '${bundleName}' -DestinationPath '${target.archiveName}' -Force`]]
      ]

  let zipped
  for (const [command, args] of archivers) {
    zipped = spawnSync(command, args, { cwd: distRoot, stdio: 'inherit' })
    if (zipped.error?.code === 'ENOENT') continue
    break
  }
  if (zipped?.error) throw zipped.error
  if (zipped?.status !== 0) throw new Error(`archiving ${bundleName} exited with status ${zipped?.status}`)

  await stageUnpackedLocalFiles(target)

  console.log(`Built dist/${basename(target.archive)}`)
}
