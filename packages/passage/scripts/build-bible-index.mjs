/* Turns a Bible index into the artifacts the Passage command reads.
 *
 *   node scripts/build-bible-index.mjs [--input <file>] [--out <directory>]
 *     [--name <translation name>] [--abbreviation <abbreviation>]
 *
 * Three files come out of it:
 *
 *   resources/bible.books.json   the manifest: book names, chapter counts, verse
 *                                counts and verse-id offsets, and no verse text.
 *                                Committed, shipped in the package, and what the
 *                                reference parser resolves against.
 *   resources/<abbr>.text.json   the text index: the verse text itself, under the
 *                                lower-cased abbreviation of the translation it
 *                                holds, and naming that translation inside.
 *   resources/translations.json  the registry: one line-sized entry per built
 *                                translation. Committed and shipped, and small
 *                                enough for the plugin to read at startup to
 *                                build its Translation dropdown.
 *
 * A translation names itself. The source index may declare a `translation`
 * block, and `--name` and `--abbreviation` state or override it.
 *
 * The schemaVersion 2 input keeps every verse once in its paragraph. The
 * NRSVue input carries four defects this script repairs; see REPAIRS below.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TranslationIndex } from './translation-index.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const inputPath = resolve(root, option('input', 'resources/nrsvue.index.json'))
const outDirectory = resolve(root, option('out', 'resources'))

/* Book names the input states wrongly. `Bah` is a typo; `Psalm` is the
 * singular of a plural title; and bookIds 72–84 hold the right content under
 * names shifted by one deuterocanonical book, so every one of them is renamed
 * rather than reordered. Each entry states the chapter count the real book has,
 * which is asserted against the input before anything is written. */
const REPAIRS = {
  19: { longName: 'Psalms', chapters: 150 },
  35: { shortName: 'Hab', chapters: 3 },
  72: { shortName: 'Bar', longName: 'Baruch', chapters: 5 },
  73: { shortName: 'EpJer', longName: 'Epistle of Jeremiah', chapters: 1 },
  74: { shortName: 'Sgof3', longName: 'Song of the Three', chapters: 1 },
  75: { shortName: 'Sus', longName: 'Susanna', chapters: 1 },
  76: { shortName: 'Bel', longName: 'Bel and the Dragon', chapters: 1 },
  77: { shortName: '1Macc', longName: '1 Maccabees', chapters: 16 },
  78: { shortName: '2Macc', longName: '2 Maccabees', chapters: 15 },
  79: { shortName: '1Esd', longName: '1 Esdras', chapters: 9 },
  80: { shortName: 'PrMan', longName: 'Prayer of Manasseh', chapters: 1 },
  /* The stored chapter number is the psalm's own number in the psalter, which
   * is the clearest proof that this book is Psalm 151 rather than 4 Maccabees;
   * as a book of its own it has one chapter, numbered 1. */
  81: { shortName: 'Ps151', longName: 'Psalm 151', chapters: 1, renumber: { 151: 1 } },
  82: { shortName: '3Macc', longName: '3 Maccabees', chapters: 7 },
  83: { shortName: '2Esd', longName: '2 Esdras', chapters: 16 },
  84: { shortName: '4Macc', longName: '4 Maccabees', chapters: 18 }
}

/* Section headings and psalm superscriptions belong to the passage that follows
 * them, and the input leaves both at the tail of the verse they interrupt. A
 * heading is title-cased and carries no terminal punctuation; a superscription
 * is a sentence, so it is only peeled from the last verse of a psalm, and only
 * when it opens the way the psalter's own superscriptions do. */
const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'about', 'after', 'against', 'among', 'around',
  'before', 'behind', 'below', 'beneath', 'beside', 'between', 'but', 'by',
  'concerning', 'during', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'out',
  'over', 'the', 'through', 'throughout', 'to', 'toward', 'towards', 'under',
  'until', 'up', 'upon', 'versus', 'via', 'with', 'within', 'without',
  'not', 'no', 'nor', 'so', 'than', 'that', 'then', 'when', 'while',
  'who', 'whom', 'whose', 'why', 'how', 'if', 'yet', 'be', 'is', 'are',
  'his', 'her', 'their', 'its', 'my', 'our', 'your'
])

const TERMINAL_PUNCTUATION = /[.,;:!?”"’)\-—–]$/
const PARENTHETICAL = /^\([^)]*\)$/
const SUPERSCRIPTION =
  /^(?:To the leader\b|Of [A-Z]|A (?:Psalm|Song|Maskil|Miktam|Prayer|prayer|Shiggaion|love song)\b|Praise\. )/
const PSALMS = 19

/* Schema 2 of the text index is schema 1 with the translation named in it. */
const TEXT_SCHEMA_VERSION = 2

function headingLine(line) {
  if (!line || line.length > 64 || TERMINAL_PUNCTUATION.test(line)) return false

  const words = line.split(/\s+/)
  if (words.length > 14) return false

  return words.every((word, index) => {
    const bare = word.replace(/^[“"‘'(]+/, '').replace(/[”"’')]+$/, '')
    if (!bare) return false
    return /^[A-Z0-9]/.test(bare) || (index > 0 && SMALL_WORDS.has(bare.toLowerCase()))
  })
}

/* The double brackets around passages the input marks as textually doubtful
 * are page-reference syntax in Logseq, so they are dropped rather than left to
 * turn a passage into a set of broken links. */
function withoutEditorialBrackets(text) {
  return text
    .replace(/\[\[|\]\]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, '').replace(/^[ \t]+/, ''))
    .filter((line, index, lines) => line !== '' || (index > 0 && index < lines.length - 1))
    .join('\n')
    .trim()
}

function splitTrailingMatter(text, { psalm, last }) {
  const lines = text.split('\n')
  const trailing = []

  while (lines.length > 1) {
    const line = lines.at(-1).trim()
    const heading = headingLine(line) || PARENTHETICAL.test(line)
    const superscription = psalm && last && line.endsWith('.') && SUPERSCRIPTION.test(line)
    if (!heading && !superscription) break

    trailing.unshift(line)
    lines.pop()
  }

  return { text: lines.join('\n').trim(), heading: trailing.join(' ') }
}

const input = JSON.parse(await readFile(inputPath, 'utf8'))
const sourceIndex = new TranslationIndex(input)
const problems = []

/* The translation the text index holds, named in the index itself so no reader
 * of the file has to infer it from the filename. Either the source index
 * declares it or the command line does; the command line wins. */
const declared = input.translation ?? {}
const translation = {
  name: option('name', declared.name),
  abbreviation: option('abbreviation', declared.abbreviation)
}

if (!translation.name || !translation.abbreviation) {
  throw new Error(
    'name the translation: pass --name and --abbreviation, or declare a translation block in the source index'
  )
}

function versesOf(chapter) {
  return chapter.paragraphs.flatMap((paragraph) =>
    paragraph.verses.map((verse) => sourceIndex.verse(verse.verseId))
  )
}

const books = []
const text = {}
let expectedVerseId = 1
let chapterTotal = 0
let verseTotal = 0

for (const book of input.books) {
  const repair = REPAIRS[book.bookId] ?? {}
  const sourceBook = sourceIndex.book(book.bookId)
  const shortName = repair.shortName ?? book.shortName
  const longName = repair.longName ?? book.longName

  if (repair.chapters !== undefined && repair.chapters !== book.chapters.length) {
    problems.push(
      `bookId ${book.bookId} carries ${book.chapters.length} chapters, but ${longName} has ${repair.chapters}`
    )
  }

  if (sourceBook.fromVerseId !== expectedVerseId) {
    problems.push(`${shortName} starts at verseId ${sourceBook.fromVerseId}, expected ${expectedVerseId}`)
  }

  const outline = []
  const chapters = {}
  let previousChapter = -Infinity

  for (const chapter of book.chapters) {
    const number = repair.renumber?.[chapter.chapterNum] ?? chapter.chapterNum
    if (number <= previousChapter) {
      problems.push(`${shortName} chapter ${number} does not follow chapter ${previousChapter}`)
    }
    previousChapter = number

    const verses = versesOf(chapter)
    const numbers = verses.map(({ verseNum }) => verseNum)
    const rendered = []
    const paragraphs = []
    const headings = {}

    /* Verse numbers ascend, but they neither always start at 1 nor run
     * gaplessly: the input may omit verses,
     * so Matthew 17 runs 1–20, 22–27, and the Greek additions to Esther open at
     * 5:3. Both shapes are recorded rather than closed up, because a reference
     * to an absent verse has to be refused, not silently
     * shifted onto its neighbour. */
    if (numbers.some((value, index) => index > 0 && value <= numbers[index - 1])) {
      problems.push(`${shortName} ${number} has verse numbers that do not ascend`)
    }

    for (const [position, verse] of verses.entries()) {
      if (verse.verseId !== expectedVerseId) {
        problems.push(
          `${shortName} ${number}:${verse.verseNum} has verseId ${verse.verseId}, expected ${expectedVerseId}`
        )
      }
      expectedVerseId += 1

      const split = splitTrailingMatter(withoutEditorialBrackets(verse.text), {
        psalm: book.bookId === PSALMS,
        last: position === verses.length - 1
      })

      rendered.push(split.text)
      if (split.heading) headings[verse.verseNum] = split.heading
      if (position === 0 || verse.paragraphNum !== verses[position - 1].paragraphNum) {
        paragraphs.push(verse.verseNum)
      }
    }

    const present = new Set(numbers)
    const missing = []
    for (let candidate = numbers[0]; candidate < numbers.at(-1); candidate += 1) {
      if (!present.has(candidate)) missing.push(candidate)
    }

    const entry = { chapter: number, verses: verses.length }
    if (numbers[0] !== 1) entry.first = numbers[0]
    if (missing.length) entry.missing = missing
    outline.push(entry)
    verseTotal += verses.length

    chapters[number] = { verses: rendered, paragraphs }
    if (numbers[0] !== 1 || missing.length) chapters[number].numbers = numbers
    if (Object.keys(headings).length) chapters[number].headings = headings
  }

  chapterTotal += outline.length
  books.push({
    bookId: book.bookId,
    shortName,
    longName,
    fromVerseId: sourceBook.fromVerseId,
    chapters: outline
  })
  text[shortName] = chapters
}

const duplicates = books
  .map(({ shortName }) => shortName)
  .filter((name, index, all) => all.indexOf(name) !== index)
if (duplicates.length) problems.push(`duplicate short names: ${duplicates.join(', ')}`)

if (problems.length) {
  console.error(problems.map((problem) => `  ${problem}`).join('\n'))
  throw new Error(`the input index failed ${problems.length} consistency check(s)`)
}

/* No timestamp: the manifest is committed, so regenerating it from the same
 * input has to produce the same bytes. */
const manifest = {
  schemaVersion: 1,
  stats: { books: books.length, chapters: chapterTotal, verses: verseTotal },
  books
}

const textFile = `${translation.abbreviation.toLowerCase()}.text.json`

await writeFile(resolve(outDirectory, 'bible.books.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(
  resolve(outDirectory, textFile),
  JSON.stringify({ schemaVersion: TEXT_SCHEMA_VERSION, translation, books: text })
)

/* The registry is the one file the plugin reads to know what it can offer, so
 * building a translation adds it to the list rather than replacing the list:
 * a graph with both translations built keeps both options. Sorted by
 * abbreviation, so the same set of translations always writes the same bytes. */
const registryPath = resolve(outDirectory, 'translations.json')
const registered = await readFile(registryPath, 'utf8').then(
  (contents) => JSON.parse(contents).translations ?? [],
  () => []
)
const translations = [
  ...registered.filter((entry) => entry.abbreviation !== translation.abbreviation),
  { ...translation, text: `resources/${textFile}` }
].sort((first, second) => first.abbreviation.localeCompare(second.abbreviation))

await writeFile(
  registryPath,
  `${JSON.stringify({ schemaVersion: 1, translations }, null, 2)}\n`
)

console.log(
  `Wrote bible.books.json, ${textFile} and translations.json for ` +
    `${translation.name} (${translation.abbreviation}): ${manifest.stats.books} books, ` +
    `${manifest.stats.chapters} chapters, ${manifest.stats.verses} verses`
)
