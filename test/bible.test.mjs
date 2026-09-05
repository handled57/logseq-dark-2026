/* Behavioral tests for the reference parser.
 *
 * `bible.js` is a classic script like `index.js`, so it is run in a `vm`
 * context and its top-level declarations are read off that context's global.
 * Everything here resolves against the manifest the theme actually ships,
 * because the counts and names in that file are half of what is being tested.
 */

import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const context = { console }
vm.createContext(context)
new vm.Script(await readFile(resolve(root, 'bible.js'), 'utf8')).runInContext(context)

const manifest = JSON.parse(await readFile(resolve(root, 'resources', 'bible.books.json'), 'utf8'))
const { parsePassageReference, composePassageText } = context

const parse = (reference) => parsePassageReference(reference, manifest)

/* The parser runs in its own realm, so its arrays are not the test realm's
 * `Array`; a round trip through JSON makes the result ordinary data. */
function resolved(reference) {
  const outcome = parse(reference)
  assert.equal(outcome.ok, true, `${reference}: ${outcome.error}`)
  return JSON.parse(JSON.stringify(outcome))
}

function rejected(reference) {
  const outcome = parse(reference)
  assert.equal(outcome.ok, false, `${reference} resolved when it should not have`)
  assert.match(outcome.error, /\S/)
  return outcome.error
}

test('the shipped manifest describes the whole edition', () => {
  assert.deepEqual(manifest.stats, { books: 84, chapters: 1398, verses: 37758 })
  assert.equal(manifest.books.length, manifest.stats.books)

  const names = manifest.books.map(({ shortName }) => shortName)
  assert.equal(new Set(names).size, names.length, 'short names are not unique')

  // Verse ids run without a gap from the first book to the last, which is what
  // makes the validity of a range one comparison.
  let expected = 1
  for (const book of manifest.books) {
    assert.equal(book.fromVerseId, expected, book.shortName)
    expected += book.chapters.reduce((total, { verses }) => total + verses, 0)
  }
  assert.equal(expected - 1, manifest.stats.verses)
})

test('the corrected book names are the ones the parser answers to', () => {
  // The source index names these books one deuterocanonical book out of step,
  // and calls Habakkuk `Bah` and the Psalms `Psalm`.
  const corrected = {
    35: ['Hab', 'Habakkuk'],
    19: ['Ps', 'Psalms'],
    72: ['Bar', 'Baruch'],
    73: ['EpJer', 'Epistle of Jeremiah'],
    74: ['Sgof3', 'Song of the Three'],
    75: ['Sus', 'Susanna'],
    76: ['Bel', 'Bel and the Dragon'],
    77: ['1Macc', '1 Maccabees'],
    78: ['2Macc', '2 Maccabees'],
    79: ['1Esd', '1 Esdras'],
    80: ['PrMan', 'Prayer of Manasseh'],
    81: ['Ps151', 'Psalm 151'],
    82: ['3Macc', '3 Maccabees'],
    83: ['2Esd', '2 Esdras'],
    84: ['4Macc', '4 Maccabees']
  }

  for (const [bookId, [shortName, longName]] of Object.entries(corrected)) {
    const book = manifest.books.find((entry) => entry.bookId === Number(bookId))
    assert.deepEqual([book.shortName, book.longName], [shortName, longName])
    assert.equal(resolved(`${longName} 1:1`).start.shortName, shortName)
  }

  assert.equal(resolved('Habakkuk 3:19').canonical, 'Habakkuk 3:19')
  assert.equal(resolved('Psalms 150:6').canonical, 'Psalms 150:6')
})

test('every written form of a reference resolves to the same canonical form', () => {
  const forms = {
    'John 3:16': ['John 3:16', 'john 3:16', 'JOHN 3:16', 'Jn 3:16', 'jn3:16', ' John  3 : 16 '],
    'Genesis 50': ['Gen 50', 'Genesis 50', 'gen. 50', 'Gn 50'],
    'Genesis 1-3': ['Gen 1-3', 'Genesis 1 - 3', 'Gen 1–3', 'Gen 1 — 3', 'Gen 1-Gen 3', 'Gen 1 - 3'],
    'Genesis 50 - Exodus 2': [
      'Gen 50 - Ex 2', 'Genesis 50-Exodus 2', 'Gen 50–Ex 2', 'Gen 50 — Exod 2'
    ],
    'Genesis 50:1-10': ['Genesis 50:1-10', 'Genesis 50:1 - 10', 'Gen 50:1–10', 'Gen 50:1 — 10'],
    'Genesis 1:1 - 2:3': ['Gen 1:1-2:3', 'Genesis 1:1 - 2:3', 'Gen 1:1–2:3', 'Gen 1:1 — 2:3'],
    'Genesis 50:1 - Exodus 2:25': [
      'Genesis 50:1 - Ex 2:25', 'Gen 50:1-Exodus 2:25', 'Gen 50:1–Ex 2:25', 'Gen 50:1 — Ex 2:25'
    ],
    '1 Corinthians 13:1-13': [
      '1 Cor 13:1-13', '1Cor 13:1-13', '1 Corinthians 13:1 – 13', '1co 13:1-13'
    ]
  }

  for (const [canonical, written] of Object.entries(forms)) {
    for (const reference of written) {
      assert.equal(resolved(reference).canonical, canonical, reference)
    }
  }
})

test('a reference is written under the book\u2019s full name, in one of six forms', () => {
  // The six shapes a reference is written in. The dash is tight where what
  // follows it is a bare number continuing the book and chapter already named,
  // and spaced where it carries a chapter or a book of its own.
  const forms = [
    ['Gen', 'Genesis'],
    ['Gen 1', 'Genesis 1'],
    ['Gen 1-2', 'Genesis 1-2'],
    ['Gen 1:1-2:1', 'Genesis 1:1 - 2:1'],
    ['Gen 50:20-Ex 1:10', 'Genesis 50:20 - Exodus 1:10'],
    ['Gen 1:1-10', 'Genesis 1:1-10']
  ]

  for (const [written, canonical] of forms) {
    assert.equal(resolved(written).canonical, canonical, written)
  }

  // A range of whole books is the one form written with no number at all.
  assert.equal(resolved('Gen - Ex').canonical, 'Genesis - Exodus')
  // A name that is itself numbered stays whole: the digits belong to the book.
  assert.equal(resolved('1 Cor').canonical, '1 Corinthians')
  assert.equal(resolved('Psalm 151').canonical, 'Psalm 151')
})

test('a book named on its own is the whole of that book', () => {
  const whole = resolved('Genesis')
  assert.equal(whole.canonical, 'Genesis')
  assert.equal(whole.tags.length, 50)
  assert.deepEqual([whole.tags[0], whole.tags.at(-1)], ['Gen/1', 'Gen/50'])
  assert.deepEqual(
    [whole.start.chapter, whole.start.verse, whole.end.chapter, whole.end.verse],
    [1, 1, 50, 26]
  )

  // A whole book runs from each end chapter's own first and last verse, which
  // is what keeps the books that begin somewhere other than 1:1 correct.
  const sirach = resolved('Sirach')
  assert.equal(sirach.canonical, 'Sirach')
  assert.deepEqual([sirach.start.chapter, sirach.start.verse], [0, 1])
  assert.deepEqual([sirach.tags[0], sirach.tags.at(-1)], ['Sir/0', 'Sir/51'])

  // One chapter is still the whole book, and is written without its number.
  assert.equal(resolved('Obadiah').canonical, 'Obadiah')
  assert.deepEqual(resolved('Obadiah').tags, ['Obad/1'])
})

test('a bare number after the dash is a verse only when it stands alone', () => {
  // `Gen 50:1 - 10` is verse 10; `Gen 1 - 3` is chapter 3; and a book beside
  // the number makes it that book's chapter however the left side was written.
  assert.equal(resolved('Gen 50:1 - 10').canonical, 'Genesis 50:1-10')
  assert.equal(resolved('Gen 1 - 3').canonical, 'Genesis 1-3')
  assert.equal(resolved('Gen 50:1 - Ex 2').canonical, 'Genesis 50:1 - Exodus 2:25')
  assert.equal(resolved('Gen 50 - Ex 2:5').canonical, 'Genesis 50:1 - Exodus 2:5')
})

test('the tags name every chapter the passage spans, in order', () => {
  assert.deepEqual(resolved('Gen 50 - Ex 2').tags, ['Gen/50', 'Ex/1', 'Ex/2'])
  assert.deepEqual(resolved('Genesis 50:1-10').tags, ['Gen/50'])
  assert.deepEqual(resolved('John 3:16').tags, ['John/3'])
  assert.deepEqual(resolved('Gen 1:1-3:2').tags, ['Gen/1', 'Gen/2', 'Gen/3'])
  // Across a book boundary the whole of the books between is spanned.
  assert.deepEqual(resolved('Obad 1 - Jonah 2').tags, ['Obad/1', 'Jonah/1', 'Jonah/2'])
  assert.deepEqual(resolved('2John 1 - Jude 1').tags, ['2John/1', '3John/1', 'Jude/1'])
})

test('a backwards range is refused', () => {
  assert.match(rejected('Ex 2-Gen 50'), /backwards/)
  assert.match(rejected('Gen 3-Gen 1'), /backwards/)
  assert.match(rejected('Gen 1:5-1:2'), /backwards/)
  assert.match(rejected('Rev 22-Gen 1'), /backwards/)
  // The endpoints touching is still a range, not a backwards one.
  assert.equal(resolved('Gen 1:1-1:1').canonical, 'Genesis 1:1')
})

test('a chapter or verse the edition does not carry is refused', () => {
  assert.match(rejected('Gen 51'), /50 chapters/)
  assert.match(rejected('Gen 0'), /no chapter 0/)
  assert.match(rejected('Obad 2'), /one chapter/)
  assert.match(rejected('John 3:37'), /no verse 37/)
  assert.match(rejected('Ps 23:7'), /no verse 7/)
  assert.match(rejected('Gen 1:1-Gen 1:32'), /no verse 32/)
  // Verses this edition omits as textually doubtful are gaps, not shifts:
  // Matthew 17 runs 1–20 and 22–27, and 17:21 is not 17:22 under another name.
  assert.match(rejected('Matt 17:21'), /without 21/)
  assert.equal(resolved('Matt 17:27').end.verse, 27)
})

test('an unknown or unparseable reference is refused', () => {
  assert.match(rejected('Foo 1'), /No book named/)
  assert.match(rejected('Foo'), /not a passage reference/)
  assert.match(rejected('3:16'), /not a passage reference/)
  assert.match(rejected(''), /John 3:16/)
  assert.match(rejected('   '), /John 3:16/)
  assert.match(rejected('Gen 1-'), /not a passage reference/)
  assert.equal(parsePassageReference('Gen 1', null).ok, false)
})

test('chapters that do not begin at verse one keep their own numbering', () => {
  // The Greek additions to Esther open at 5:3, and Sirach's prologue is
  // numbered chapter 0.
  assert.equal(resolved('AddEsth 5:3').canonical, 'Additions to Esther 5:3')
  assert.match(rejected('AddEsth 5:1'), /no verse 1/)
  assert.equal(resolved('Sir 0:1').canonical, 'Sirach 0:1')
  assert.deepEqual(resolved('Sir 0-1').tags, ['Sir/0', 'Sir/1'])
})

/* A stand-in for the text index, in the shape the generator writes. */
const textIndex = {
  books: {
    Gen: {
      1: {
        verses: ['In the beginning.', 'And the earth.', 'Then God said.'],
        paragraphs: [1, 3]
      },
      2: { verses: ['Thus the heavens.'], paragraphs: [1] }
    },
    Ps: {
      23: {
        verses: ['The LORD is my shepherd;\nI shall not want.', 'He makes me lie down.'],
        paragraphs: [1],
        headings: { 1: 'Trust in God' }
      },
      /* A three-digit verse number, which no other chapter here reaches. */
      119: { verses: ['Those who persecute me draw near.'], numbers: [150], paragraphs: [150] }
    },
    Matt: {
      17: { verses: ['He said to them.', 'As they were gathering.'], numbers: [20, 22], paragraphs: [20] }
    },
    /* Adjacent one- and four-chapter books, which is what makes a span across a
     * book boundary small enough to write out here. */
    Obad: {
      1: { verses: ['The vision of Obadiah.', 'I will make you least.'], paragraphs: [1] }
    },
    Jonah: {
      1: { verses: ['Now the word of the LORD.', 'Go at once to Nineveh.'], paragraphs: [1] }
    }
  }
}

/* Every display option off, which is what the dialog opens with. */
const PLAIN = { headings: false, numbers: false, perLine: false }

const compose = (reference, options) => composePassageText(resolved(reference), textIndex, options)

test('the passage text is prose, with paragraphs kept and verse numbers dropped', () => {
  // A paragraph break is a blank line: without one the paragraphs render as a
  // single run of prose.
  assert.equal(
    composePassageText(resolved('Gen 1'), textIndex),
    'In the beginning. And the earth.\n\nThen God said.'
  )
  assert.equal(composePassageText(resolved('Gen 1:2'), textIndex), 'And the earth.')
  // A chapter boundary is a paragraph boundary, and is separated the same way.
  assert.equal(
    composePassageText(resolved('Gen 1:3-2:1'), textIndex),
    'Then God said.\n\nThus the heavens.'
  )
  // No verse numbers survive, and the text neither opens nor closes on a blank
  // line.
  const text = composePassageText(resolved('Gen 1'), textIndex)
  assert.doesNotMatch(text, /^\d|\s\d+\s/)
  assert.equal(text, text.trim())
  assert.doesNotMatch(text, /\n{3}/)
})

test('poetry keeps its lineation and headings are left out', () => {
  const psalm = composePassageText(resolved('Ps 23:1-2'), textIndex)
  assert.equal(psalm, 'The LORD is my shepherd;\nI shall not want.\nHe makes me lie down.')
  assert.doesNotMatch(psalm, /Trust in God/)
})

test('a chapter with omitted verses composes from the numbers it has', () => {
  assert.equal(
    composePassageText(resolved('Matt 17:20-22'), textIndex),
    'He said to them. As they were gathering.'
  )
})

test('an absent text index composes nothing rather than failing', () => {
  assert.equal(composePassageText(resolved('Gen 1'), null), '')
  assert.equal(composePassageText(resolved('Gen 1'), { books: {} }), '')
  assert.equal(composePassageText({ ok: false }, textIndex), '')
  // A book the index does not carry is the same case as no index at all.
  assert.equal(composePassageText(resolved('Lev 1'), textIndex), '')

  // With no text there is nothing for an option to format, so an empty body
  // stays empty rather than filling with headings or verse numbers.
  const every = { headings: true, numbers: true, perLine: true }
  assert.equal(composePassageText(resolved('Gen 1'), null, every), '')
  assert.equal(composePassageText(resolved('Lev 1'), textIndex, every), '')
})

test('with every display option off the passage is composed exactly as before', () => {
  // The options are additive: unchecked, and however they are passed, the text
  // is the plain prose the command has always written.
  for (const reference of ['Gen 1', 'Gen 1:2', 'Gen 1:3-2:1', 'Ps 23:1-2', 'Matt 17:20-22']) {
    const plain = compose(reference)
    assert.equal(compose(reference, PLAIN), plain, reference)
    assert.equal(compose(reference, {}), plain, reference)
    assert.equal(compose(reference, null), plain, reference)
  }
})

test('chapter headings name the book in full above every chapter they head', () => {
  const headings = { ...PLAIN, headings: true }

  // A whole chapter, and a heading above it even though the reference names
  // only the one chapter.
  assert.equal(
    compose('Gen 1', headings),
    '**Genesis 1**\n\nIn the beginning. And the earth.\n\nThen God said.'
  )
  // A single verse and a partial chapter are headed the same way.
  assert.equal(compose('Gen 1:2', headings), '**Genesis 1**\n\nAnd the earth.')
  assert.equal(
    compose('Gen 1:2-3', headings),
    '**Genesis 1**\n\nAnd the earth.\n\nThen God said.'
  )
  // One heading per chapter across a chapter boundary...
  assert.equal(
    compose('Gen 1:3-2:1', headings),
    '**Genesis 1**\n\nThen God said.\n\n**Genesis 2**\n\nThus the heavens.'
  )
  // ...and across a book boundary, each under its own book's long name.
  assert.equal(
    compose('Obad 1:1-Jonah 1:2', headings),
    '**Obadiah 1**\n\nThe vision of Obadiah. I will make you least.\n\n' +
      '**Jonah 1**\n\nNow the word of the LORD. Go at once to Nineveh.'
  )
})

test('verse numbers are superscripts against the verse they open', () => {
  const numbers = { ...PLAIN, numbers: true }

  assert.equal(
    compose('Gen 1', numbers),
    '\u00b9In the beginning. \u00b2And the earth.\n\n\u00b3Then God said.'
  )
  // A partial chapter is numbered from where it starts, not from one.
  assert.equal(compose('Gen 1:2', numbers), '\u00b2And the earth.')
  // A chapter this edition numbers with a gap keeps each number against its own
  // verse: Matthew 17:21 is not in the text, and 22 is not renumbered to 21.
  assert.equal(
    compose('Matt 17:20-22', numbers),
    '\u00b2\u2070He said to them. \u00b2\u00b2As they were gathering.'
  )
  // Poetry takes the number on the first of its lines and keeps the rest.
  assert.equal(
    compose('Ps 23:1-2', numbers),
    '\u00b9The LORD is my shepherd;\nI shall not want.\n\u00b2He makes me lie down.'
  )
  // Every digit of a number has a superscript of its own.
  assert.equal(compose('Ps 119:150', numbers), '\u00b9\u2075\u2070Those who persecute me draw near.')
})

test('a verse number never opens a line with markup', () => {
  // mldoc, the parser behind every Logseq block, reads a `<` at the start of a
  // line as block-level HTML and closes the paragraph around it. A verse number
  // written as `<sup>1</sup>` was therefore pushed onto a line of its own
  // wherever it opened one — every paragraph, and with one verse per line every
  // verse. Superscript digits are plain text and parse where they stand.
  const references = ['Gen 1', 'Gen 1:2', 'Gen 1:3-2:1', 'Ps 23:1-2', 'Ps 119:150',
    'Matt 17:20-22', 'Obad 1:1-Jonah 1:2']

  for (const reference of references) {
    for (const headings of [false, true]) {
      for (const perLine of [false, true]) {
        const composed = compose(reference, { headings, numbers: true, perLine })
        for (const line of composed.split('\n')) {
          assert.doesNotMatch(line, /^</, `${reference} opens a line with markup`)
        }
        // The number is still against its verse rather than adrift from it.
        assert.doesNotMatch(composed, /[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]\s/, reference)
      }
    }
  }
})

test('one verse per line breaks between verses without flattening poetry', () => {
  const perLine = { ...PLAIN, perLine: true }

  // Prose that ran together as a paragraph is broken verse by verse, and the
  // paragraph boundary is still a blank line.
  assert.equal(
    compose('Gen 1', perLine),
    'In the beginning.\nAnd the earth.\n\nThen God said.'
  )
  // The line breaks inside a verse are the edition's own lineation and survive
  // untouched; the option adds breaks, it never removes them.
  assert.equal(
    compose('Ps 23:1-2', perLine),
    'The LORD is my shepherd;\nI shall not want.\nHe makes me lie down.'
  )
  // A chapter boundary stays a paragraph boundary rather than becoming one more
  // verse break.
  assert.equal(compose('Gen 1:3-2:1', perLine), 'Then God said.\n\nThus the heavens.')
})

test('the three display options combine', () => {
  const every = { headings: true, numbers: true, perLine: true }

  assert.equal(
    compose('Gen 1', every),
    '**Genesis 1**\n\n\u00b9In the beginning.\n\u00b2And the earth.\n\n' +
      '\u00b3Then God said.'
  )
  assert.equal(
    compose('Obad 1:1-Jonah 1:2', every),
    '**Obadiah 1**\n\n\u00b9The vision of Obadiah.\n\u00b2I will make you least.\n\n' +
      '**Jonah 1**\n\n\u00b9Now the word of the LORD.\n\u00b2Go at once to Nineveh.'
  )
  // Two of the three, to show the pairs are independent of the third.
  assert.equal(
    compose('Gen 1:2', { ...every, perLine: false }),
    '**Genesis 1**\n\n\u00b2And the earth.'
  )
  assert.equal(
    compose('Gen 1', { ...every, headings: false }),
    '\u00b9In the beginning.\n\u00b2And the earth.\n\n\u00b3Then God said.'
  )
  assert.equal(
    compose('Gen 1', { ...every, numbers: false }),
    '**Genesis 1**\n\nIn the beginning.\nAnd the earth.\n\nThen God said.'
  )
  // A section heading the index carries is still left out, whatever is on.
  assert.doesNotMatch(compose('Ps 23:1-2', every), /Trust in God/)
})

test('the resolved chapters carry the long book name a heading is written with', () => {
  assert.deepEqual(
    resolved('Obad 1:1-Jonah 1:2').chapters.map(({ shortName, longName }) => [shortName, longName]),
    [['Obad', 'Obadiah'], ['Jonah', 'Jonah']]
  )
})

test('the whole edition resolves and composes without throwing', () => {
  for (const book of manifest.books) {
    for (const chapter of book.chapters) {
      const outcome = resolved(`${book.shortName} ${chapter.chapter}`)
      assert.equal(outcome.tags.length, 1)
      assert.equal(outcome.end.verseId - outcome.start.verseId + 1, chapter.verses)
    }
  }

  // The whole edition as one span names every chapter exactly once.
  const whole = resolved('Gen 1 - 4Macc 18')
  assert.equal(whole.tags.length, manifest.stats.chapters)
  assert.equal(new Set(whole.tags).size, whole.tags.length)
  assert.equal(whole.start.verseId, 1)
  assert.equal(whole.end.verseId, manifest.stats.verses)
})
