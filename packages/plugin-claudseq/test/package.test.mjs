/* Structural tests for the Claudseq package: metadata, the entry, what the
 * package ships, and the rules its code keeps.
 *
 * Claudseq installs on its own, so nothing here may reach into a sibling
 * workspace: the package carries every file it needs, including the bridge,
 * and no file that belongs to a theme or to another plugin.
 */

import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { VERSION } from '../bridge/claudseq-bridge.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const marketplace = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
const entry = await readFile(resolve(root, 'index.html'), 'utf8')
const runtime = Object.fromEntries(await Promise.all(['index.js', 'markdown.js', 'timeline.js'].map(async (name) => [name, await readFile(resolve(root, name), 'utf8')])))
const bridge = await readFile(resolve(root, 'bridge/claudseq-bridge.mjs'), 'utf8')
/* What the code says about itself is prose; these checks read the code
 * without it. */
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const code = Object.fromEntries(Object.entries(runtime).map(([name, source]) => [name, withoutComments(source)]))
const bridgeCode = withoutComments(bridge)

test('the released version matches the newest changelog entry and the bridge', async () => {
  const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8')
  const [, released] = changelog.match(/^## (\d+\.\d+\.\d+) - \d{4}-\d{2}-\d{2}$/m) ?? []
  assert.ok(released, 'the changelog has no dated release heading')
  assert.equal(pkg.version, released)
  assert.doesNotMatch(changelog, /^## Unreleased\s*\n\s*\n\s*-/m, 'the changelog left an entry unreleased')
  /* The pane compares the bridge's version with its own to tell a user when
   * to reinstall, so the two ship together. */
  assert.equal(VERSION, pkg.version)
})

test('the package is a plugin, not a theme, and carries no dependencies', () => {
  assert.equal(pkg.name, 'logseq-claudseq')
  assert.equal(pkg.title, 'Claudseq')
  assert.equal(pkg.author, 'Peter Cole')
  assert.equal(pkg.repo, 'handled57/logseq-dark-2026')
  // `effect` keeps the entry on the Logseq window's own file:// origin: it is
  // what reaches `parent.document` and `parent.apis`, and the one origin the
  // bridge admits.
  assert.equal(pkg.effect, true)
  assert.equal(pkg.theme, undefined)
  assert.equal(pkg.logseq.themes, undefined)
  assert.equal(pkg.main, 'index.html')
  assert.equal(pkg.logseq.main, 'index.html')
  assert.equal(pkg.logseq.id, pkg.name)
  assert.equal(pkg.logseq.icon, './icon.svg')
  assert.deepEqual(pkg.dependencies, undefined)
  assert.deepEqual(pkg.devDependencies, undefined)
})

test('marketplace metadata is classic-only and agrees with the package', () => {
  assert.equal(marketplace.id, pkg.name)
  assert.equal(marketplace.title, pkg.title)
  assert.equal(marketplace.repo, pkg.repo)
  assert.equal(marketplace.author, pkg.author)
  assert.equal(marketplace.description, pkg.description)
  assert.equal(marketplace.effect, pkg.effect)
  assert.equal(marketplace.theme, false)
  assert.equal(marketplace.web, false)
  assert.equal(marketplace.supportsDB, false)
  assert.equal(marketplace.supportsDBOnly, false)
})

test('the entry loads the vendored SDK, then the renderer and model, then the runtime', async () => {
  const sdk = await readFile(resolve(root, '..', '..', 'vendor', 'logseq', 'lsplugin.user.js'), 'utf8')
  assert.ok(sdk.length > 10_000, 'the vendored SDK is unexpectedly small')
  const order = [...entry.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map((match) => match[1])
  assert.deepEqual(order, ['lib/lsplugin.user.js', 'markdown.js', 'timeline.js', 'index.js'])
  assert.doesNotMatch(entry, /type="module"/, 'the runtime is classic scripts, not modules')
})

test('the release ships exactly the runtime, the bridge and their documentation', async () => {
  assert.deepEqual(pkg.release.files, [
    'package.json',
    'manifest.json',
    'index.html',
    'index.js',
    'markdown.js',
    'timeline.js',
    'bridge/claudseq-bridge.mjs',
    'icon.svg',
    'README.md',
    'CHANGELOG.md',
    'THIRD_PARTY_NOTICES.md'
  ])
  assert.equal(pkg.release.unpackedLocalFiles, undefined)
  for (const file of pkg.release.files) await access(resolve(root, file), constants.R_OK)
  const icon = await readFile(resolve(root, 'icon.svg'), 'utf8')
  assert.match(icon, /^<svg\b/)
  assert.match(icon, /<\/svg>\s*$/)
})

test('no runtime script turns a string into markup or code', () => {
  for (const [name, source] of Object.entries(code)) {
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(|createContextualFragment|DOMParser/, `${name} parses a string as markup or code`)
  }
  assert.match(code['markdown.js'], /createTextNode/)
  assert.match(code['markdown.js'], /SAFE_LINK/)
})

test('everything written into the host document is namespaced to Claudseq', () => {
  for (const [name, source] of Object.entries(runtime)) {
    for (const attribute of source.match(/'data-[\w-]+'/g) ?? []) {
      /* Logseq's own marker on the style it injects, read to remove it. */
      if (attribute === "'data-injected-style'") continue
      assert.match(attribute, /^'data-claudseq-/, `${name}: ${attribute} is not namespaced to Claudseq`)
    }
    assert.doesNotMatch(source, /data-hc-|data-passage-|data-anno-|data-able-/, `${name} touches another package's attribute`)
  }
  for (const constant of runtime['index.js'].match(/^const [A-Z_]*(?:_ID|_KEY) = '[^']+'/gm) ?? []) {
    assert.match(constant, /'claudseq/, `${constant} is not namespaced to Claudseq`)
  }
  assert.match(runtime['index.js'], /const STYLE_KEY = 'claudseq'/)
  assert.match(runtime['index.js'], /const PANE_ID = 'claudseq-pane'/)
})

test('the pane keeps its state out of the graph', () => {
  const source = code['index.js']
  assert.match(source, /logseq\.updateSettings/)
  assert.doesNotMatch(source, /makeSandboxStorage|FileStorage|Editor\.(?:insertBlock|updateBlock|appendBlockInPage|createPage|upsertBlockProperty)/, 'the pane writes to the graph')
  assert.doesNotMatch(source, /'writeFile'/)
  assert.match(source, /'readFile'/)
})

test('the pane runs one command, the bridge, and changes one Logseq setting, its command allowlist', () => {
  const source = code['index.js']
  assert.equal(source.match(/'runCli'/g)?.length, 1, 'the pane runs more than the bridge')
  assert.match(source, /\['runCli', \{\s*command: node,\s*args: `\$\{shellQuote\(bridgeScriptPath\(\)\)\} serve --until-stdin-closes`,\s*returnResult: false\s*\}\]/)
  const settingCalls = source.match(/'userAppCfgs'/g)?.length ?? 0
  assert.ok(settingCalls > 0)
  assert.equal(source.match(/'userAppCfgs', 'commands-allowlist'/g)?.length, settingCalls, 'the pane touches a Logseq setting other than the allowlist')
})

test('the pane takes away only its own command, and never without its id', () => {
  const source = code['index.js']
  assert.equal(source.match(/unregister_plugin_simple_command/g)?.length, 1)
  assert.match(source, /const id = logseq\.baseInfo\?\.id\s+if \(typeof id !== 'string' \|\| !id\) return\s+await logseq\.App\.unregister_plugin_simple_command\(id\)/)
})

test('the bridge listens on loopback only, never uses a shell, and needs nothing installed', () => {
  assert.match(bridgeCode, /server\.listen\(\w+, '127\.0\.0\.1'/)
  assert.doesNotMatch(bridgeCode, /listen\([^)]*'0\.0\.0\.0'|listen\([^)]*'::'/)
  assert.doesNotMatch(bridgeCode, /shell:\s*true/)
  /* `execFile` takes an argv array; `exec` takes a command line for a shell.
   * A regex's own `.exec(` is not a process. */
  assert.doesNotMatch(bridgeCode, /(?<![.\w])exec\(|execSync\(|spawnSync\(/, 'the bridge runs a command string')
  assert.doesNotMatch(bridgeCode, /import \{[^}]*\bexec\b[^}]*\} from 'node:child_process'/)
  assert.doesNotMatch(bridgeCode, /dangerously-skip-permissions|'--permission-mode', 'bypassPermissions'/)
  assert.match(bridgeCode, /timingSafeEqual/)
  assert.doesNotMatch(bridgeCode, /launchctl|LaunchAgents/, 'the bridge installs something')
  for (const [, specifier] of bridgeCode.matchAll(/^import .* from '([^']+)'/gm)) {
    assert.match(specifier, /^node:/, `the bridge imports ${specifier}`)
  }
  assert.match(bridge, /^#!\/usr\/bin\/env node\n/)
})
