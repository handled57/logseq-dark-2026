// Install dev/logseq-custom.js into a graph as <graph>/logseq/custom.js, with the
// dist/.reload-stamp.json path baked in.
//
// Usage: npm run dev:install -- "C:\path\to\graph"   (or a WSL /mnt/c/... path)

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { distRoot, repositoryRoot } from './release-support.mjs'

const graphDir = process.argv[2] ?? process.env.LS_GRAPH_DIR
if (!graphDir) {
  console.error('Usage: npm run dev:install -- <graph-dir>')
  process.exit(1)
}

// Logseq is the Windows app, so it needs a Windows path even when this runs under WSL.
function toHostPath(path) {
  const drive = /^\/mnt\/([a-z])\//.exec(path)
  if (process.platform !== 'linux' || !drive) return path
  return `${drive[1].toUpperCase()}:${path.slice(drive[0].length - 1)}`.replace(/\//g, '\\')
}

const source = resolve(repositoryRoot, 'dev/logseq-custom.js')
const stampPath = toHostPath(resolve(distRoot, '.reload-stamp.json'))
const template = await readFile(source, 'utf8')
if (!template.includes('__STAMP_PATH__')) {
  throw new Error(`${source} has no __STAMP_PATH__ placeholder to fill in`)
}
// JSON.stringify escapes the backslashes for the single-quoted JS string, then trim its quotes.
const reloader = template.replace('__STAMP_PATH__', JSON.stringify(stampPath).slice(1, -1))

const targetDir = resolve(graphDir, 'logseq')
const target = resolve(targetDir, 'custom.js')
const existing = await readFile(target, 'utf8').catch(() => null)
if (existing !== null && !existing.includes('Dev reloader for the logseq-dark-2026')) {
  console.error(`Refusing to overwrite ${target}: it was not written by this script.`)
  console.error('Move it aside, or merge dev/logseq-custom.js into it by hand.')
  process.exit(1)
}

await mkdir(targetDir, { recursive: true })
await writeFile(target, reloader)
console.log(`Installed ${target}`)
console.log(`Watching stamp ${stampPath}`)
console.log('Restart Logseq (or re-index) to pick it up; it asks once to allow custom.js.')
