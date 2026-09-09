/* Canonical compact translation source index (schema version 2).
 * Stored hierarchy: books -> chapters -> paragraphs -> verses.
 */

export const TRANSLATION_INDEX_SCHEMA_VERSION = 2

export function bookRef(book) {
  return book.shortName
}

export function verseRef(book, chapter, verse) {
  return `${book.shortName}/${chapter.chapterNum}/${verse.verseNum}`
}

export class TranslationIndex {
  constructor(source) {
    if (source?.schemaVersion !== TRANSLATION_INDEX_SCHEMA_VERSION || !Array.isArray(source.books)) {
      throw new Error(`translation index must use schemaVersion ${TRANSLATION_INDEX_SCHEMA_VERSION}`)
    }
    this.source = source
    this.booksById = new Map()
    this.booksByRef = new Map()
    this.versesById = new Map()
    this.versesByRef = new Map()

    for (const book of source.books) {
      const verses = book.chapters.flatMap((chapter) =>
        chapter.paragraphs.flatMap((paragraph) => paragraph.verses)
      )
      if (!verses.length) throw new Error(`${book.shortName} contains no verses`)
      const bookRecord = {
        bookId: book.bookId, shortName: book.shortName, longName: book.longName,
        fromVerseId: verses[0].verseId, toVerseId: verses.at(-1).verseId, ref: bookRef(book)
      }
      this.booksById.set(bookRecord.bookId, bookRecord)
      this.booksByRef.set(bookRecord.ref, bookRecord)

      for (const chapter of book.chapters) {
        for (const paragraph of chapter.paragraphs) {
          for (const verse of paragraph.verses) {
            const verseRecord = {
              bookId: book.bookId, chapterNum: chapter.chapterNum, longName: book.longName,
              paragraphNum: paragraph.paragraphNum, ref: verseRef(book, chapter, verse),
              shortName: book.shortName, text: verse.text, verseId: verse.verseId,
              verseNum: verse.verseNum
            }
            if (this.versesById.has(verseRecord.verseId) || this.versesByRef.has(verseRecord.ref)) {
              throw new Error(`duplicate verse ${verseRecord.ref} or verseId ${verseRecord.verseId}`)
            }
            this.versesById.set(verseRecord.verseId, verseRecord)
            this.versesByRef.set(verseRecord.ref, verseRecord)
          }
        }
      }
    }
  }

  verse(referenceOrId) {
    const id = typeof referenceOrId === 'string' && /^\d+$/.test(referenceOrId)
      ? Number(referenceOrId) : referenceOrId
    return typeof id === 'number' ? this.versesById.get(id) : this.versesByRef.get(id)
  }

  book(referenceOrId) {
    const id = typeof referenceOrId === 'string' && /^\d+$/.test(referenceOrId)
      ? Number(referenceOrId) : referenceOrId
    return typeof id === 'number' ? this.booksById.get(id) : this.booksByRef.get(id)
  }
}

export function compactLegacyIndex(source) {
  if (source?.schemaVersion === TRANSLATION_INDEX_SCHEMA_VERSION) return source
  if (!Array.isArray(source?.books)) throw new Error('translation index has no books')
  let chapterCount = 0
  let paragraphCount = 0
  let verseCount = 0
  const books = source.books.map((book) => ({
    bookId: book.bookId,
    shortName: book.shortName,
    longName: book.longName,
    chapters: book.chapters.map((chapter) => {
      chapterCount += 1
      const paragraphs = chapter.paragraphs.map((paragraph) => {
        paragraphCount += 1
        const verses = paragraph.verses.map((verse) => {
          verseCount += 1
          return { verseId: verse.verseId, verseNum: verse.verseNum, text: verse.text }
        })
        return { paragraphNum: paragraph.paragraphId, verses }
      })
      return { chapterNum: chapter.chapter, paragraphs }
    })
  }))
  return {
    schemaVersion: TRANSLATION_INDEX_SCHEMA_VERSION,
    stats: { books: books.length, chapters: chapterCount, paragraphs: paragraphCount, verses: verseCount },
    books
  }
}
