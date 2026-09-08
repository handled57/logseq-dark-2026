import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { node } from './support/host-document.mjs'
import { repositoryRoot, workspaces } from '../scripts/release-support.mjs'

test('shared release inputs have one canonical source', async () => {
  await access(resolve(repositoryRoot, 'LICENSE'), constants.R_OK)
  const sdk = await readFile(resolve(repositoryRoot, 'vendor/logseq/lsplugin.user.js'), 'utf8')
  assert.ok(sdk.length > 10_000)
  for (const target of await workspaces()) {
    await assert.rejects(access(resolve(target.root, 'LICENSE'), constants.F_OK))
    await assert.rejects(access(resolve(target.root, 'lib/lsplugin.user.js'), constants.F_OK))
  }
})

test('workspace release metadata is an exact package-owned allowlist', async () => {
  for (const { pkg } of await workspaces()) {
    assert.ok(pkg.release.files.includes('package.json'))
    assert.ok(pkg.release.files.includes('manifest.json'))
    assert.ok(!pkg.release.files.includes('LICENSE'))
    assert.ok(!pkg.release.files.some((file) => file.startsWith('lib/')))
    assert.equal(new Set(pkg.release.files).size, pkg.release.files.length)
  }
})

test('shared host fixture models host descendants and event delivery', () => {
  const host = node('body')
  const child = host.appendChild(node('button', { classes: ['menu-link'] }))
  let clicked = false
  child.addEventListener('click', () => { clicked = true })
  assert.equal(host.querySelector('.menu-link'), child)
  child.dispatch('click')
  assert.equal(clicked, true)

  /* `closest` walks the fixture's own parent chain, starting at the element
   * itself, the way a host document's does. */
  const inner = child.appendChild(node('span'))
  assert.equal(inner.closest('.menu-link'), child)
  assert.equal(child.closest('.menu-link'), child)
  assert.equal(inner.closest('.nothing-here'), null)
})

test('repository documentation covers package ownership and independent migration', async () => {
  const required = [
    ['README.md', ['Dark High Contrast', 'Passage', 'Anno', 'CONTRIBUTING.md']],
    ['CONTRIBUTING.md', ['Node.js 22', 'LOGSEQ_CSS', 'Marketplace submission', 'anno-vX.Y.Z']],
    ['docs/architecture.md', ['effect: true', 'MutationObserver', 'release.files', 'hls__']],
    ['docs/adding-a-package.md', ['SDK', 'allowlist', 'Manual acceptance']],
    ['docs/migrating-theme-2.md', ['hiddenProperties', 'biblePassageText', 'separately']]
  ]

  for (const [file, phrases] of required) {
    const source = await readFile(resolve(repositoryRoot, file), 'utf8')
    for (const phrase of phrases) {
      assert.ok(source.includes(phrase), `${file} does not document ${phrase}`)
    }
  }
})
