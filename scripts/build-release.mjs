import { access, cp, mkdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, resolve } from 'node:path'
import {
  distRoot, licenseSource, sdkSource, selectedWorkspaces
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
  await mkdir(target.bundle, { recursive: true })

  for (const file of target.pkg.release.files) {
    await cp(resolve(target.root, file), resolve(target.bundle, file), { recursive: true })
  }
  await mkdir(resolve(target.bundle, 'lib'), { recursive: true })
  await cp(sdkSource, resolve(target.bundle, 'lib/lsplugin.user.js'))
  await cp(licenseSource, resolve(target.bundle, 'LICENSE'))

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

  for (const file of target.pkg.release.unpackedLocalFiles ?? []) {
    const source = resolve(target.root, file)
    if (await access(source, constants.R_OK).then(() => true, () => false)) {
      await mkdir(resolve(target.bundle, file, '..'), { recursive: true })
      await cp(source, resolve(target.bundle, file))
      console.log(`Staged local ${file} into dist/${bundleName}/ for unpacked testing; it is not in the ZIP.`)
    }
  }

  console.log(`Built dist/${basename(target.archive)}`)
}
