/* Reference half of the Passage command.
 *
 * Everything here is pure: it takes the manifest (`resources/bible.books.json`)
 * and, when there is one, the text index, and turns a typed reference such as
 * `Gen 50 - Ex 2` into a canonical reference, the chapter tags that belong on
 * the block, and the passage text. Nothing in this file touches the host
 * document, the plugin API, or the network, which is what lets the tests drive
 * it directly.
 *
 * Like `index.js` this is a classic script rather than a module: it is loaded
 * ahead of `index.js` by `index.html`, so its declarations are globals both the
 * entry script and the `vm`-based tests read.
 */

/* Book names are matched with case, spacing and punctuation folded away, so
 * `1 Cor`, `1Cor.` and `1cor` are one name. Every short and long name in the
 * manifest is matched this way; these are the further spellings people write,
 * and each one has to fold to something no other book already answers to. */
const BIBLE_ALIASES = {
  gn: 'Gen', ge: 'Gen',
  ex: 'Ex', exo: 'Ex', exod: 'Ex',
  lv: 'Lev', levit: 'Lev',
  nm: 'Num', nb: 'Num', nu: 'Num',
  dt: 'Deut', deu: 'Deut',
  jos: 'Josh',
  jdg: 'Judg', jgs: 'Judg',
  rt: 'Ruth',
  '1sa': '1Sam', '1sm': '1Sam', '2sa': '2Sam', '2sm': '2Sam',
  '1kgs': '1Kings', '1ki': '1Kings', '1kg': '1Kings',
  '2kgs': '2Kings', '2ki': '2Kings', '2kg': '2Kings',
  '1chr': '1Chron', '1ch': '1Chron', '2chr': '2Chron', '2ch': '2Chron',
  ezr: 'Ezra', ne: 'Neh',
  esth: 'Est', es: 'Est',
  jb: 'Job',
  psalm: 'Ps', psa: 'Ps', psm: 'Ps', pss: 'Ps',
  pr: 'Prov', prv: 'Prov',
  ecc: 'Eccles', eccl: 'Eccles', qoh: 'Eccles',
  songofsongs: 'Song', songofsolomon: 'Song', sos: 'Song', cant: 'Song', canticles: 'Song',
  is: 'Isa', isai: 'Isa',
  je: 'Jer', jr: 'Jer',
  la: 'Lam',
  eze: 'Ezek', ezk: 'Ezek',
  dn: 'Dan',
  ho: 'Hos',
  jl: 'Joel',
  am: 'Amos',
  ob: 'Obad', oba: 'Obad',
  jon: 'Jonah', jnh: 'Jonah',
  mi: 'Mic',
  na: 'Nah',
  hb: 'Hab',
  zep: 'Zeph', zp: 'Zeph',
  hg: 'Hag',
  zec: 'Zech', zc: 'Zech',
  ml: 'Mal',
  mt: 'Matt', mat: 'Matt',
  mk: 'Mark', mrk: 'Mark', mr: 'Mark',
  lk: 'Luke', luk: 'Luke',
  jn: 'John', jhn: 'John',
  ac: 'Acts',
  ro: 'Rom', rm: 'Rom',
  '1co': '1Cor', '2co': '2Cor',
  ga: 'Gal',
  ephes: 'Eph',
  php: 'Phil', pp: 'Phil',
  cl: 'Col',
  '1th': '1Thess', '2th': '2Thess',
  '1ti': '1Tim', '1tm': '1Tim', '2ti': '2Tim', '2tm': '2Tim',
  tit: 'Titus', ti: 'Titus',
  phlm: 'Philem', phm: 'Philem',
  hebr: 'Heb',
  jas: 'James', jm: 'James',
  '1pt': '1Pet', '1pe': '1Pet', '2pt': '2Pet', '2pe': '2Pet',
  '1jn': '1John', '1jo': '1John', '2jn': '2John', '2jo': '2John',
  '3jn': '3John', '3jo': '3John',
  jde: 'Jude',
  re: 'Rev', rv: 'Rev', apoc: 'Rev', apocalypse: 'Rev',
  tb: 'Tob',
  jdt: 'Jth', judith: 'Jth',
  addesther: 'AddEsth', greekesther: 'AddEsth', esthergreek: 'AddEsth',
  wis: 'WisdofSol', wisd: 'WisdofSol', wisdom: 'WisdofSol',
  ecclus: 'Sir', bensira: 'Sir', ecclesiasticus: 'Sir',
  letjer: 'EpJer', letterofjeremiah: 'EpJer',
  prazar: 'Sgof3', songofthethree: 'Sgof3', songofthethreeyoungmen: 'Sgof3',
  '1mc': '1Macc', '1ma': '1Macc', '2mc': '2Macc', '2ma': '2Macc',
  '3mc': '3Macc', '3ma': '3Macc', '4mc': '4Macc', '4ma': '4Macc',
  '1es': '1Esd', '2es': '2Esd',
  prayerofmanasseh: 'PrMan', prman: 'PrMan',
  psalm151: 'Ps151'
}

/* En dash between the endpoints of a written reference; a hyphen or em dash is
 * accepted on the way in and normalized to this on the way out. */
const BIBLE_DASH = '–'
const BIBLE_DASHES = /[-–—]/

function bibleFold(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/* One lookup table per manifest, keyed on the manifest object itself so a
 * reload rebuilds it and a repeated parse does not. */
const bibleIndexes = new WeakMap()

function bibleIndex(manifest) {
  const books = manifest?.books
  if (!Array.isArray(books)) return null

  const existing = bibleIndexes.get(manifest)
  if (existing) return existing

  const byName = new Map()
  const byShortName = new Map()

  for (const book of books) {
    const chapters = new Map()
    let offset = 0

    for (const entry of book.chapters) {
      const first = entry.first ?? 1
      const missing = entry.missing ?? []
      chapters.set(entry.chapter, {
        number: entry.chapter,
        first,
        /* Verse numbers ascend but neither always start at 1 nor run
         * gaplessly, so the last number is the count plus the gaps. */
        last: first + entry.verses + missing.length - 1,
        count: entry.verses,
        missing,
        fromVerseId: book.fromVerseId + offset
      })
      offset += entry.verses
    }

    const resolved = { ...book, chapterMap: chapters, order: books.indexOf(book) }
    byShortName.set(book.shortName, resolved)
    byName.set(bibleFold(book.shortName), resolved)
    if (!byName.has(bibleFold(book.longName))) byName.set(bibleFold(book.longName), resolved)
  }

  for (const [alias, shortName] of Object.entries(BIBLE_ALIASES)) {
    const book = byShortName.get(shortName)
    if (book && !byName.has(alias)) byName.set(alias, book)
  }

  const index = { books, byName, byShortName }
  bibleIndexes.set(manifest, index)
  return index
}

function bibleFailure(message) {
  return { ok: false, error: message }
}

/* `Book chapter`, `Book chapter:verse`, `chapter:verse` or a bare number. The
 * book name is whatever precedes the trailing numbers, which is why the leading
 * group is lazy: `1 Cor 13` and `Ps151 1` both name a book that starts, or
 * ends, in a digit. */
const BIBLE_ENDPOINT = /^(.*?)\s*(\d+)(?:\s*:\s*(\d+))?$/

function bibleEndpoint(text) {
  const match = BIBLE_ENDPOINT.exec(text.trim())
  if (!match) return null

  const [, name, first, second] = match
  return {
    name: name.trim(),
    chapter: second === undefined ? undefined : Number(first),
    verse: second === undefined ? Number(first) : Number(second),
    /* A lone number is a chapter or a verse depending on the endpoint it
     * follows, so which one it is stays open until both sides are known. */
    bare: second === undefined
  }
}

function bibleVerseId(chapter, verse) {
  const skipped = chapter.missing.filter((number) => number < verse).length
  return chapter.fromVerseId + (verse - chapter.first) - skipped
}

function bibleResolvePoint(index, name, chapterNumber, verseNumber, fallback) {
  const book = name ? index.byName.get(bibleFold(name)) : fallback
  if (!book) return bibleFailure(`No book named “${name}”.`)

  const chapter = book.chapterMap.get(chapterNumber)
  if (!chapter) {
    const count = book.chapters.length
    return bibleFailure(
      `${book.longName} has ${count === 1 ? 'one chapter' : `${count} chapters`}, ` +
        `so there is no chapter ${chapterNumber}.`
    )
  }

  if (verseNumber !== undefined) {
    const absent = verseNumber < chapter.first || verseNumber > chapter.last ||
      chapter.missing.includes(verseNumber)
    if (absent) {
      return bibleFailure(
        `${book.longName} ${chapter.number} runs ${chapter.first}–${chapter.last}` +
          `${chapter.missing.length ? ` without ${chapter.missing.join(', ')}` : ''}, ` +
          `so there is no verse ${verseNumber}.`
      )
    }
  }

  return { ok: true, book, chapter, verse: verseNumber }
}

/* Every chapter the span touches, in order, as `shortName/chapter`. */
function bibleChapterSpan(index, start, end) {
  const span = []

  for (let position = start.book.order; position <= end.book.order; position += 1) {
    const book = index.byShortName.get(index.books[position].shortName)
    for (const chapter of book.chapters) {
      const before = position === start.book.order && chapter.chapter < start.chapter.number
      const after = position === end.book.order && chapter.chapter > end.chapter.number
      if (!before && !after) span.push({ book, chapter: book.chapterMap.get(chapter.chapter) })
    }
  }

  return span
}

function bibleCanonical(start, end, verses) {
  const sameBook = start.book === end.book
  const sameChapter = sameBook && start.chapter.number === end.chapter.number

  if (!verses) {
    const head = `${start.book.shortName} ${start.chapter.number}`
    if (sameChapter) return head
    return `${head}${BIBLE_DASH}${sameBook ? '' : `${end.book.shortName} `}${end.chapter.number}`
  }

  const head = `${start.book.shortName} ${start.chapter.number}:${start.verse}`
  if (sameChapter && start.verse === end.verse) return head
  if (sameChapter) return `${head}${BIBLE_DASH}${end.verse}`
  return `${head}${BIBLE_DASH}${sameBook ? '' : `${end.book.shortName} `}` +
    `${end.chapter.number}:${end.verse}`
}

/* Turns a typed reference into everything the block needs, or into the message
 * the dialog shows while staying open. */
function parsePassageReference(input, manifest) {
  const index = bibleIndex(manifest)
  if (!index) return bibleFailure('The Bible index is not loaded.')

  const text = String(input ?? '').trim()
  if (!text) return bibleFailure('Type a reference such as John 3:16.')

  const divider = text.search(BIBLE_DASHES)
  const left = bibleEndpoint(divider === -1 ? text : text.slice(0, divider))
  const right = divider === -1 ? null : bibleEndpoint(text.slice(divider + 1))

  if (!left || !left.name || (divider !== -1 && !right)) {
    return bibleFailure(`“${text}” is not a passage reference.`)
  }

  /* A bare left endpoint is `Book chapter`; a bare right endpoint is a verse
   * when the left named one and a chapter when it did not. */
  const startChapter = left.bare ? left.verse : left.chapter
  const startVerse = left.bare ? undefined : left.verse
  const start = bibleResolvePoint(index, left.name, startChapter, startVerse)
  if (!start.ok) return start

  let end = start
  if (right) {
    /* A lone number after the dash is a verse only when it stands alone: name a
     * book beside it and it is that book's chapter. */
    const verses = startVerse !== undefined && !right.name
    const endChapter = right.bare
      ? (verses ? start.chapter.number : right.verse)
      : right.chapter
    const endVerse = right.bare ? (verses ? right.verse : undefined) : right.verse
    end = bibleResolvePoint(index, right.name, endChapter, endVerse, start.book)
    if (!end.ok) return end
  }

  const verses = start.verse !== undefined || end.verse !== undefined
  const from = { ...start, verse: start.verse ?? start.chapter.first }
  const to = { ...end, verse: end.verse ?? end.chapter.last }

  if (bibleVerseId(from.chapter, from.verse) > bibleVerseId(to.chapter, to.verse)) {
    return bibleFailure(`${bibleCanonical(from, to, verses)} runs backwards.`)
  }

  const span = bibleChapterSpan(index, from, to)

  return {
    ok: true,
    canonical: bibleCanonical(from, to, verses),
    tags: span.map(({ book, chapter }) => `${book.shortName}/${chapter.number}`),
    chapters: span.map(({ book, chapter }, position) => ({
      shortName: book.shortName,
      /* The long name is what a chapter heading is written with, so it travels
       * with the span rather than being looked up again from the manifest. */
      longName: book.longName,
      chapter: chapter.number,
      from: position === 0 ? from.verse : chapter.first,
      to: position === span.length - 1 ? to.verse : chapter.last
    })),
    start: {
      shortName: from.book.shortName,
      chapter: from.chapter.number,
      verse: from.verse,
      verseId: bibleVerseId(from.chapter, from.verse)
    },
    end: {
      shortName: to.book.shortName,
      chapter: to.chapter.number,
      verse: to.verse,
      verseId: bibleVerseId(to.chapter, to.verse)
    }
  }
}

/* Verses are joined into a paragraph with a space, except where either side
 * carries its own line breaks: that is poetry, and its lineation is the point.
 * `perLine` breaks between every verse instead, which leaves the line breaks
 * inside a verse exactly where they were. Paragraphs and chapters are separated
 * by a blank line, which is what makes them read as paragraphs rather than as
 * one run-on block of prose. */
function bibleParagraph(lines, perLine) {
  return lines.reduce((text, line, position) => {
    if (!position) return line
    const broken = perLine || line.includes('\n') || lines[position - 1].includes('\n')
    return `${text}${broken ? '\n' : ' '}${line}`
  }, '')
}

/* The three display options the dialog offers, read defensively: an absent
 * options object is every option off, which is the plain prose the command has
 * always written. */
function bibleDisplay(options) {
  return {
    headings: Boolean(options?.headings),
    numbers: Boolean(options?.numbers),
    perLine: Boolean(options?.perLine)
  }
}

/* Logseq's markdown parser passes inline HTML through, and `<sup>` is the
 * superscript both it and the DOM agree on: `^{1}` is org syntax and `^^` is a
 * highlight. The number sits against the verse it opens, with no space, so the
 * two never wrap apart. */
function bibleVerseNumber(number, text) {
  return `<sup>${number}</sup>${text}`
}

function composePassageText(resolved, textIndex, options) {
  const books = textIndex?.books
  if (!resolved?.ok || !books) return ''

  const display = bibleDisplay(options)
  const rendered = []

  for (const span of resolved.chapters) {
    const chapter = books[span.shortName]?.[span.chapter]
    if (!chapter) return ''

    const numbers = chapter.numbers ?? chapter.verses.map((text, position) => position + 1)
    const starts = new Set(chapter.paragraphs ?? [])
    const paragraphs = []

    for (const [position, number] of numbers.entries()) {
      if (number < span.from || number > span.to) continue
      const text = String(chapter.verses[position] ?? '').trim()
      if (!text) continue
      if (starts.has(number) || !paragraphs.length) paragraphs.push([])
      paragraphs.at(-1).push(display.numbers ? bibleVerseNumber(number, text) : text)
    }

    /* A chapter heading names the chapter the verses under it come from, so it
     * is written only where there are verses for it to head — a passage with no
     * text is left empty rather than filled with headings. */
    if (display.headings && paragraphs.length) {
      rendered.push(`**${span.longName ?? span.shortName} ${span.chapter}**`)
    }

    for (const paragraph of paragraphs) rendered.push(bibleParagraph(paragraph, display.perLine))
  }

  return rendered.join('\n\n')
}
