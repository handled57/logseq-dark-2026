import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { repositoryRoot } from '../scripts/release-support.mjs'

const THEME_URL = 'file://C:\\Users\\Pcole\\Projects\\logseq-dark-2026\\dist\\logseq-dark-high-contrast-theme\\theme.css'
const CSS_OS_PATH = 'C:\\Users\\Pcole\\Projects\\logseq-dark-2026\\dist\\logseq-dark-high-contrast-theme\\theme.css'
const canon = (p) => String(p).replace(/\\/g, '/').toLowerCase()
const STAMP = 'C:\\Users\\Pcole\\Projects\\logseq-dark-2026\\dist\\.reload-stamp.json'
const PID = 'logseq-dark-high-contrast-theme'
// Exercise the repo-owned template with the stamp path install-reloader.mjs would bake in.
const SRC = (await readFile(resolve(repositoryRoot, 'dev/logseq-custom.js'), 'utf8'))
  .replace('__STAMP_PATH__', JSON.stringify(STAMP).slice(1, -1))

// The reloader logs on every boot and swap; keep errors, drop the chatter.
const quietConsole = { log() {}, warn() {}, error: console.error.bind(console) }

function boot() {
  const mk = (tag) => ({ tagName: tag.toUpperCase(), id: '', rel: '', disabled: false, textContent: '',
    attrs: {}, getAttribute(n) { return this.attrs[n] ?? null },
    remove() { const i = head.children.indexOf(this); if (i >= 0) head.children.splice(i, 1) } })
  const head = { children: [],
    appendChild(el) { const i = this.children.indexOf(el); if (i >= 0) this.children.splice(i, 1); this.children.push(el); return el },
    querySelectorAll(sel) {
      if (sel === 'link[rel="stylesheet"]') return this.children.filter(c => c.tagName === 'LINK' && c.rel === 'stylesheet')
      const m = /^style\[id\^="(.+)"\]$/.exec(sel)
      if (m) return this.children.filter(c => c.tagName === 'STYLE' && c.id.startsWith(m[1]))
      throw new Error('unhandled selector ' + sel)
    } }
  const document = { head, createElement: mk, getElementById: (id) => head.children.find(c => c.id === id) || null }
  const link = mk('link'); link.rel = 'stylesheet'; link.attrs.href = THEME_URL; head.appendChild(link)

  const env = { reloaded: [], disk: '.a{color:red}', stamp: { ts: 1, changed: [] }, missingStamp: false, head, link,
    style: () => head.children.find(c => c.tagName === 'STYLE' && c.id === 'ls-dev-theme-' + PID) || null }
  const window = {
    apis: { doAction: async ([op, path]) => {
      if (path === STAMP) { if (env.missingStamp) throw new Error('ENOENT'); return env.rawStamp ?? JSON.stringify(env.stamp) }
      if (canon(path) === canon(CSS_OS_PATH)) return env.disk
      throw new Error('ENOENT ' + path)
    } },
    LSPluginCore: {
      _currentTheme: { pid: PID, opt: { url: THEME_URL } },
      themes: new Map([[PID, [{ url: THEME_URL }]]]),
      reload: async (id) => { env.reloaded.push(id) }
    },
  }
  new Function('window', 'document', 'setInterval', 'clearInterval', 'console', SRC)(
    window, document, () => 1, () => {}, quietConsole)
  env.lsDev = window.lsDev
  env.core = window.LSPluginCore
  return env
}

test('first stamp is adopted without reloading anything', async () => {
  const e = boot()
  e.stamp = { ts: 100, changed: [{ id: 'logseq-anno', theme: false, action: 'reload' }] }
  await e.lsDev.tick()
  assert.deepEqual(e.reloaded, [], 'must not reload on the first stamp it sees')
})

test('a plugin change reloads only that plugin', async () => {
  const e = boot()
  await e.lsDev.tick()
  e.stamp = { ts: 200, changed: [{ id: 'logseq-anno', theme: false, action: 'reload' }] }
  await e.lsDev.tick()
  assert.deepEqual(e.reloaded, ['logseq-anno'])
  assert.equal(e.style(), null, 'no theme style tag for a plugin change')
})

test('css-only theme change swaps CSS and does not reload the plugin', async () => {
  const e = boot()
  await e.lsDev.tick()
  e.disk = '.b{color:blue}'
  e.stamp = { ts: 200, changed: [{ id: PID, theme: true, action: 'css' }] }
  await e.lsDev.tick()
  assert.deepEqual(e.reloaded, [], 'css action must not reload')
  assert.equal(e.style().textContent, '.b{color:blue}')
  assert.equal(e.link.disabled, true, 'original link must be disabled so deleted rules stop applying')
})

test('theme style tag stays last in head so it wins the cascade', async () => {
  const e = boot()
  await e.lsDev.tick()
  e.stamp = { ts: 200, changed: [{ id: PID, theme: true, action: 'css' }] }
  await e.lsDev.tick()
  // something else injects a stylesheet afterwards, then another build lands
  const later = { tagName: 'LINK', rel: 'stylesheet', id: '', attrs: {}, getAttribute() { return null }, remove() {} }
  e.head.appendChild(later)
  e.disk = '.c{color:green}'
  e.stamp = { ts: 300, changed: [{ id: PID, theme: true, action: 'css' }] }
  await e.lsDev.tick()
  assert.equal(e.head.children.at(-1), e.style(), 'style must be re-appended last')
  assert.equal(e.style().textContent, '.c{color:green}')
})

test('theme js change reloads the plugin AND refreshes css', async () => {
  const e = boot()
  await e.lsDev.tick()
  e.disk = '.d{color:teal}'
  e.stamp = { ts: 200, changed: [{ id: PID, theme: true, action: 'reload' }] }
  await e.lsDev.tick()
  assert.deepEqual(e.reloaded, [PID])
  assert.equal(e.style().textContent, '.d{color:teal}', 'link survives reload, so css must still be swapped')
})

test('switching themes drops the orphaned style tag', async () => {
  const e = boot()
  await e.lsDev.tick()
  e.stamp = { ts: 200, changed: [{ id: PID, theme: true, action: 'css' }] }
  await e.lsDev.tick()
  assert.ok(e.style(), 'style present while theme selected')
  // user picks another theme: LSPluginCore ejects our shadowed link
  e.link.remove()
  e.core._currentTheme = { pid: 'other', opt: { url: 'file://x.css' } }
  e.stamp = { ts: 300, changed: [{ id: 'logseq-anno', theme: false, action: 'reload' }] }
  await e.lsDev.tick()
  assert.equal(e.style(), null, 'stale theme css must not override the newly chosen theme')
})

test('same ts is ignored, and a half-written stamp is survivable', async () => {
  const e = boot()
  await e.lsDev.tick()
  e.stamp = { ts: 200, changed: [{ id: 'logseq-anno', theme: false, action: 'reload' }] }
  await e.lsDev.tick()
  await e.lsDev.tick()
  assert.deepEqual(e.reloaded, ['logseq-anno'], 'unchanged ts must not re-reload')
  e.rawStamp = '{ "ts": 400, "chan'
  await assert.doesNotReject(() => e.lsDev.tick())
  e.rawStamp = null
  e.missingStamp = true
  await assert.doesNotReject(() => e.lsDev.tick(), 'missing stamp = watcher not running')
})

test('assets:// theme url resolves to the same file and the same link', async () => {
  const e = boot()
  // what _loadConfigThemes registers from the manifest, before preferences normalize it
  const assetsUrl = 'assets://C:/Users/Pcole/Projects/logseq-dark-2026/dist/'
    + 'logseq-dark-high-contrast-theme/theme.css'
  e.core._currentTheme = { pid: PID, opt: { url: assetsUrl } }
  await e.lsDev.tick()
  e.disk = '.e{color:plum}'
  e.stamp = { ts: 200, changed: [{ id: PID, theme: true, action: 'css' }] }
  await e.lsDev.tick()
  assert.equal(e.style().textContent, '.e{color:plum}', 'assets:// must resolve to the file')
  assert.equal(e.link.disabled, true, 'must still find the file:// link it shadows')
})
