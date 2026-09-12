/* The reading half of the Passage v1 content contract.
 *
 * `docs/contracts/passage-v1.md` holds the fixtures, and this file drives the
 * theme's own classification over them. The Passage package's suite reads the
 * same block of the same document from its own workspace and asserts that its
 * command writes these sources; nothing here loads, imports or stubs that
 * package. One document is the whole of the coupling.
 */

import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { classicScript } from '../../../test/support/classic-script.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contract = resolve(root, '..', '..', 'docs', 'contracts', 'passage-v1.md')
const css = await readFile(resolve(root, 'theme.css'), 'utf8')

function fixtures(document) {
  const start = document.indexOf('<!-- passage-v1-fixtures:start -->')
  const end = document.indexOf('<!-- passage-v1-fixtures:end -->')
  assert.ok(start >= 0 && end > start, 'the contract has no fixture block')

  const fenced = document.slice(start, end).match(/```json\n([\s\S]*?)```/)
  assert.ok(fenced, 'the fixture block holds no json')
  return JSON.parse(fenced[1])
}

const { cases } = fixtures(await readFile(contract, 'utf8'))

/* The classification functions are top-level declarations of a classic script,
 * so running it in a context is enough to call them directly. Nothing else of
 * the entry is exercised here: this is about the source, not the host. */
const context = {
  console,
  parent: { document: { getElementById: () => null, querySelectorAll: () => [] } },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  logseq: {
    settings: {},
    App: { onRouteChanged() {} },
    useSettingsSchema() {},
    provideStyle() {},
    onSettingsChanged() {},
    /* The entry is never started: `ready` is where it would begin, and this
     * suite only wants the declarations the script leaves on the context. */
    ready: () => Promise.resolve()
  }
}
vm.createContext(context)
const themeScript = await classicScript(resolve(root, 'index.js'))
themeScript.runInContext(context)

for (const { name, source, verseLines } of cases) {
  test(`the theme reads the contract's ${name} fixture`, () => {
    /* A passage opens with a marker under its drawer, so every fixture is a
     * special block source: the bullet is the rail's, not the block's. */
    assert.equal(context.specialSource(source), true, `${name} was not read as a structural block`)
    assert.equal(
      context.versesOpenLines(source),
      verseLines,
      `${name} disagrees with the contract about hanging its verse numbers`
    )
  })
}

test('the default property rule matches the casing the contract writes', () => {
  const rules = context.parseRules('type: passage')
  const properties = {}

  /* The drawer as the rendered table reports it: keys and values lower-cased,
   * which is why `type:: Passage` and a `type: passage` rule are one block. */
  for (const line of cases[0].source.split('\n')) {
    const match = line.match(/^([\w.-]+):: (.*)$/)
    if (match) properties[match[1].toLowerCase()] = match[2].trim().toLowerCase()
  }

  assert.equal(properties.type, 'passage')
  assert.equal(context.shouldHide(rules, properties), true)
  assert.equal(context.blockType(rules, properties), 'passage')
})

test('the stylesheet paints the render the contract names, and only through it', () => {
  /* `div.passage` is the one render hook the contract offers: Logseq emits no
   * `.admonitionblock` for a custom block it does not know. */
  assert.match(css, /\.block-body > \.passage \{/)
  /* The verse gutter is asked for by the attribute the theme writes, never by
   * anything Passage puts in the document. */
  assert.match(css, /\[data-hc-verse-lines\]/)
  assert.doesNotMatch(css, /data-passage-/)
})
