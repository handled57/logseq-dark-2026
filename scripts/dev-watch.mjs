// Watch every workspace's release files, restage the dist/ bundle Logseq sideloads,
// and bump dist/.reload-stamp.json so the graph's logseq/custom.js reloads the plugin
// (or hot-swaps the theme CSS) without touching the Plugins page.
//
// Polling rather than fs.watch on purpose: the repo lives on a Windows drive reached
// through drvfs, where inotify does not fire reliably for either side's writes.
//
// No zipping here -- that belongs to `npm run build`, and it is the slow part.

import { readdir, rename, stat, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import {
  distRoot, workspaces, stageBundle, stageUnpackedLocalFiles
} from './release-support.mjs'

const intervalMs = Number(process.env.LS_DEV_POLL_MS ?? 500)
const stampPath = resolve(distRoot, '.reload-stamp.json')
const targets = await workspaces()

function watchedEntries(target) {
  return [...target.pkg.release.files, ...(target.pkg.release.unpackedLocalFiles ?? [])]
}

// Re-walked every tick so that added and deleted files register, not just edits.
async function fingerprint(target) {
  const seen = new Map()
  const walk = async (absolute) => {
    const info = await stat(absolute).catch(() => null)
    if (!info) return
    if (info.isDirectory()) {
      for (const entry of await readdir(absolute)) await walk(resolve(absolute, entry))
      return
    }
    seen.set(relative(target.root, absolute), `${info.mtimeMs}:${info.size}`)
  }
  for (const entry of watchedEntries(target)) await walk(resolve(target.root, entry))
  return seen
}

function changedPaths(before, after) {
  const changed = []
  for (const [path, mark] of after) if (before.get(path) !== mark) changed.push(path)
  for (const path of before.keys()) if (!after.has(path)) changed.push(path)
  return changed
}

// A theme edit that is only CSS needs no plugin reload at all -- and could not use one
// anyway, since Logseq's `beforereload` unregisters themes with effect=false and so leaves
// the injected <link> in place. Anything else needs the plugin reloaded, because index.js
// and the manifest are only read at load time.
function actionFor(target, changed) {
  const themed = target.pkg.theme === true
  const cssOnly = changed.length > 0 && changed.every((path) => path.endsWith('.css'))
  return themed && cssOnly ? 'css' : 'reload'
}

async function writeStamp(entries) {
  const stamp = { ts: Date.now(), changed: entries }
  const scratch = `${stampPath}.tmp`
  await writeFile(scratch, `${JSON.stringify(stamp, null, 2)}\n`)
  await rename(scratch, stampPath) // atomic, so custom.js never reads a half-written stamp
}

async function restage(target, changed) {
  await stageBundle(target)
  await stageUnpackedLocalFiles(target, { announce: false })
  return {
    id: target.pkg.logseq.id,
    name: target.pkg.name,
    theme: target.pkg.theme === true,
    action: actionFor(target, changed)
  }
}

const fingerprints = new Map()
for (const target of targets) fingerprints.set(target.pkg.name, await fingerprint(target))

// Stage once up front so a freshly cloned checkout has a loadable dist/ before any edit.
await writeStamp(await Promise.all(targets.map((target) => restage(target, []))))

console.log(`Watching ${targets.length} packages every ${intervalMs}ms. Ctrl+C to stop.`)
for (const target of targets) console.log(`  ${target.pkg.logseq.id} -> ${target.bundle}`)
console.log(`Stamp: ${stampPath}`)

let ticking = false
setInterval(async () => {
  if (ticking) return // a slow restage must not overlap the next tick
  ticking = true
  try {
    const entries = []
    for (const target of targets) {
      const next = await fingerprint(target)
      const changed = changedPaths(fingerprints.get(target.pkg.name), next)
      fingerprints.set(target.pkg.name, next)
      if (!changed.length) continue
      const entry = await restage(target, changed)
      entries.push(entry)
      const at = new Date().toLocaleTimeString()
      console.log(`[${at}] ${entry.id}: ${changed.join(', ')} -> ${entry.action}`)
    }
    if (entries.length) await writeStamp(entries)
  } catch (error) {
    console.error('restage failed:', error.message)
  } finally {
    ticking = false
  }
}, intervalMs)
