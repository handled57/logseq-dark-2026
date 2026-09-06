/* The writing half of the Passage v1 content contract.
 *
 * `docs/contracts/passage-v1.md` holds the fixtures, and this file drives the
 * command until it writes them. The theme's own suite reads the same block of
 * the same document from its own workspace, which is the whole of the coupling
 * between the two packages: one document, no import, no shared runtime.
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

const parser = await classicScript(resolve(root, 'bible.js'))
const manifest = JSON.parse(await readFile(resolve(root, 'resources', 'bible.books.json'), 'utf8'))

function fixtures(document) {
  const start = document.indexOf('<!-- passage-v1-fixtures:start -->')
  const end = document.indexOf('<!-- passage-v1-fixtures:end -->')
  assert.ok(start >= 0 && end > start, 'the contract has no fixture block')

  const fenced = document.slice(start, end).match(/```json\n([\s\S]*?)```/)
  assert.ok(fenced, 'the fixture block holds no json')
  return JSON.parse(fenced[1])
}

const { index, cases } = fixtures(await readFile(contract, 'utf8'))

/* The pure half of the plugin composes the passage; the entry script only wraps
 * it in the marker and the property drawer, which is reproduced here so the
 * fixtures are checked against the composer rather than against a stub host. */
const context = { console }
vm.createContext(context)
parser.runInContext(context)

function write({ reference, display, text }) {
  const resolved = context.parsePassageReference(reference, manifest)
  assert.equal(resolved.ok, true, `${reference}: ${resolved.error}`)

  const body = text ? context.composePassageText(resolved, index, display) : ''
  const source = `#+BEGIN_PASSAGE\n**${resolved.canonical}**\n\n${body ? `${body}\n` : ''}#+END_PASSAGE`

  return { content: `tags:: ${resolved.tags.join(', ')}\ntype:: Passage\n${source}`, resolved }
}

test('the contract states at least one fixture for every display option', () => {
  assert.ok(cases.length >= 5, 'the contract has too few fixtures to be exercised')
  for (const option of ['headings', 'numbers', 'perLine']) {
    assert.ok(
      cases.some(({ display }) => display[option] === true),
      `no fixture exercises the ${option} option`
    )
  }
  assert.ok(cases.some(({ text }) => text === false), 'no fixture covers an absent text index')
})

for (const fixture of cases) {
  test(`Passage writes the contract's ${fixture.name} fixture`, () => {
    assert.equal(write(fixture).content, fixture.source)
  })
}

test('every fixture carries the drawer, the marker and a bold reference', () => {
  for (const { name, source } of cases) {
    const [tags, type, marker, heading, blank] = source.split('\n')
    assert.match(tags, /^tags:: /, name)
    // Case matters where it is written; a reader matches it case-insensitively.
    assert.equal(type, 'type:: Passage', name)
    assert.equal(marker, '#+BEGIN_PASSAGE', name)
    assert.match(heading, /^\*\*.+\*\*$/, name)
    assert.equal(blank, '', name)
    assert.ok(source.endsWith('\n#+END_PASSAGE'), name)
  }
})

/* Superscript digits in highlight markup, and nothing else standing in for a
 * verse number: a theme selects the `mark` the markup renders, and a run of
 * ordinary digits would give it nothing to select. */
test('verse numbers are superscript digits in highlight markup', () => {
  const SUPERSCRIPT = /^\^\^[⁰¹²³⁴-⁹]+\^\^$/

  for (const { name, display, source } of cases) {
    const marks = source.match(/\^\^[\s\S]+?\^\^/g) ?? []
    if (!display.numbers) {
      assert.deepEqual(marks, [], `${name} numbers verses it was not asked to number`)
      continue
    }

    assert.ok(marks.length > 0, `${name} was asked for verse numbers and wrote none`)
    for (const mark of marks) assert.match(mark, SUPERSCRIPT, name)
    assert.doesNotMatch(source, /\^\^[⁰¹²³⁴-⁹]+\^\^\s/, name)
  }
})

test('the chapter tags name every chapter the reference spans', () => {
  const { resolved } = write({ reference: 'Gen 50 - Ex 2', display: {}, text: false })
  assert.equal(resolved.canonical, 'Genesis 50 - Exodus 2')
  assert.deepEqual(JSON.parse(JSON.stringify(resolved.tags)), ['Gen/50', 'Ex/1', 'Ex/2'])
})
