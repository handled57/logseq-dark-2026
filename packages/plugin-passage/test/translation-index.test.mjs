import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Buffer } from 'node:buffer'
import { compactLegacyIndex, TranslationIndex } from '../scripts/translation-index.mjs'

const legacy = {
  schemaVersion: 1,
  generatedAt: 'ignored',
  stats: { books: 1, chapters: 1, paragraphs: 2, verses: 3 },
  books: [{
    bookId: 40, shortName: 'Matt', longName: 'Matthew', fromVerseId: 100, toVerseId: 102,
    chapters: [{
      chapter: 17, chapterRef: 'Matt/17', fromVerseId: 100, toVerseId: 102,
      verses: [],
      paragraphs: [
        { paragraphId: 9, fromVerseId: 100, toVerseId: 101, verses: [
          { verseId: 100, verseNum: 20, text: 'Prose.' },
          { verseId: 101, verseNum: 22, text: 'Line one.\nLine two.' }
        ] },
        { paragraphId: 10, fromVerseId: 102, toVerseId: 102, verses: [
          { verseId: 102, verseNum: 23, text: 'Next paragraph.' }
        ] }
      ]
    }]
  }],
  indexes: { versesByRef: {}, refsByVerseId: {}, chaptersByRef: {}, booksByShortName: {} }
}

test('the compact schema stores one copy of intrinsic verse data', () => {
  const compact = compactLegacyIndex(legacy)
  assert.deepEqual(Object.keys(compact), ['schemaVersion', 'stats', 'books'])
  assert.deepEqual(Object.keys(compact.books[0]), ['bookId', 'shortName', 'longName', 'chapters'])
  assert.deepEqual(Object.keys(compact.books[0].chapters[0]), ['chapterNum', 'paragraphs'])
  assert.deepEqual(Object.keys(compact.books[0].chapters[0].paragraphs[0]), ['paragraphNum', 'verses'])
  assert.deepEqual(Object.keys(compact.books[0].chapters[0].paragraphs[0].verses[0]),
    ['verseId', 'verseNum', 'text'])
  assert.equal(compact.books[0].chapters[0].paragraphs[0].verses[1].text, 'Line one.\nLine two.')
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(legacy)) * 0.6)
})

test('lookups derive complete verse and book records', () => {
  const index = new TranslationIndex(compactLegacyIndex(legacy))
  const expectedVerse = {
    bookId: 40, chapterNum: 17, longName: 'Matthew', paragraphNum: 9,
    ref: 'Matt/17/22', shortName: 'Matt', text: 'Line one.\nLine two.',
    verseId: 101, verseNum: 22
  }
  assert.deepEqual(index.verse('Matt/17/22'), expectedVerse)
  assert.deepEqual(index.verse(101), expectedVerse)
  assert.deepEqual(index.verse('101'), expectedVerse)
  assert.equal(index.verse('Matt/17/21'), undefined)
  assert.deepEqual(index.book('Matt'), {
    bookId: 40, shortName: 'Matt', longName: 'Matthew',
    fromVerseId: 100, toVerseId: 102, ref: 'Matt'
  })
})

test('conversion is deterministic', () => {
  assert.equal(JSON.stringify(compactLegacyIndex(legacy)), JSON.stringify(compactLegacyIndex(legacy)))
})
