# Passage for Logseq

Insert a Bible passage into a block: a canonical reference, one namespaced tag
per chapter it spans, and — where you have built a local text index — the verse
text itself.

Passage is a plugin, not a theme. It writes ordinary Logseq markup and styles
nothing. The [Dark High Contrast](../dark-high-contrast) theme paints passage
blocks as a sibling of Logseq's named admonitions, but neither package needs the
other: the shape they agree on is written down in
[`docs/contracts/passage-v1.md`](../../docs/contracts/passage-v1.md).

## What it writes

A passage block holds a quoted passage under a bold reference:

```text
tags:: Gen/50, Ex/1, Ex/2
type:: Passage
#+BEGIN_PASSAGE
**Genesis 50 - Exodus 2**

…
#+END_PASSAGE
```

`tags::` names every chapter the passage spans, in order, as
`shortName/chapter`, which makes each chapter a page of its own under a book
namespace. `type:: Passage` is the key a theme's property rules read — it is the
default rule Dark High Contrast ships, which hides the drawer and renders the
block as a bare passage.

The two property lines sit *above* `#+BEGIN_PASSAGE` because a block holds one
property drawer, at the very top of its content: Logseq only recognizes a drawer
as the first thing in a block, and `#+BEGIN_PASSAGE` is a custom block rather
than a title line, so this is where Logseq's own property writer puts them too.
Properties written below `#+END_PASSAGE` are not parsed as properties at all. A
key the block already declares is left exactly as you wrote it — only the
missing one is added.

## Inserting a passage

- Open Logseq's global command palette with **Cmd+Shift+P** on macOS or
  **Ctrl+Shift+P** on Windows and Linux, then choose **Passage: Insert a passage**.
- Type `/passage` and choose **Passage: Insert a passage**.
- Type `<` and choose **Passage: Insert a passage**. Logseq has no plugin API for the `<` picker,
  so this entry is added to the picker's own menu while it is open; it withdraws
  itself as soon as what you have typed can no longer match.

Both prompt for a reference and for how the passage should be displayed. Enter
is **Insert**, the prompt's default action; Escape or **Cancel** dismisses it
without changing the block. A blank reference cannot be submitted.

## References

The reference you type is resolved against the plugin's own index of books,
chapters and verse counts, and written back under the book's full name. Books
are matched on their short or long name, ignoring case, spacing and punctuation,
and on the usual abbreviations besides: `Gn`, `Exod`, `Mt`, `Mk`, `Lk`, `Jn`,
`Psalms`, `1 Cor`, `1Cor`. A range is written with a hyphen, an en dash or an em
dash, spaced or not. A book named on its own is the whole of that book. All of
these are references:

| Written | Means | Written back |
| --- | --- | --- |
| `Gen` | a whole book | `Genesis` |
| `John 3:16` | one verse | `John 3:16` |
| `Gen 50` | a whole chapter | `Genesis 50` |
| `Gen 1-3` | whole chapters | `Genesis 1-3` |
| `Gen 50 - Ex 2` | chapters across a book boundary | `Genesis 50 - Exodus 2` |
| `Genesis 50:1-10` | verses within a chapter | `Genesis 50:1-10` |
| `Gen 1:1-2:3` | verses across a chapter boundary | `Genesis 1:1 - 2:3` |
| `Genesis 50:1 - Ex 2:25` | verses across a book boundary | `Genesis 50:1 - Exodus 2:25` |

However it was typed, a reference is written back in full: the book's long name,
and a dash that is tight where what follows it is a bare number continuing the
book and chapter already named, and spaced where it carries a chapter or a book
of its own. The short name stays on the tags, where it is half of a page name
your graph already carries.

A bare number after the dash is a verse when the left side named one
(`Gen 50:1 - 10`) and a chapter when it did not (`Gen 1 - 3`); name a book beside
it and it is always that book's chapter.

A reference that does not resolve leaves the prompt open with the reason under
the field, so you can correct it: an unknown book, a chapter or verse absent
from the index, or a range that runs backwards, such as `Ex 2-Gen 50`. Gaps in
verse numbering — Matthew 17:21 among them — are refused rather than quietly
read as their neighbour.

## Passage text

The passage itself is written under the reference as plain prose: no verse
numbers, no section headings, a blank line between paragraphs, and poetry keeps
its own lineation. A chapter boundary is a paragraph boundary, so it is
separated the same way.

The text comes from a verse index in the plugin's own `resources` folder. The
**New English Translation (NET)** is bundled and selected by default, so an
installation writes passage text with no further setup. Passage reads the file
locally; it does not fetch or upload verse text.

## Choosing a translation

**Plugins → Passage → Settings → Translation** is a dropdown of the translations
this installation has, each named and abbreviated —
`New English Translation (NET)`. Choosing another one is the whole of the
switch: the next passage is written from that translation's verse index.

The list comes from `resources/translations.json`, a registry the index builder
keeps beside the indexes themselves. It is kilobytes where an index is
megabytes, which is what lets the dropdown be built at startup without reading a
verse of text:

```json
{
  "schemaVersion": 1,
  "translations": [
    { "name": "New English Translation", "abbreviation": "NET", "text": "resources/net.text.json" }
  ]
}
```

Selecting a translation whose index is not in the folder is not a failure: the
command still writes the canonical reference and its chapter tags, and says
which translation has no index behind it.

> Reference resolution still runs against the single shared
> `resources/bible.books.json`, which is built from the NRSVue canon. A
> translation with a different canon — the NET's 66 books among them — accepts
> references to books it does not contain and reports no text for them. Giving
> each translation its own manifest is
> [issue #44](https://github.com/handled57/logseq-dark-2026/issues/44).

## Building another translation

Put per-verse Bible data at `resources/<abbreviation>.index.json` and run:

```sh
node scripts/build-bible-index.mjs --input resources/nrsvue.index.json
```

The source file uses Passage's compact translation-index schema. To convert an
older source index once, without overwriting it while conversion is in flight:

```sh
node scripts/compact-bible-index.mjs \
  --input resources/nrsvue.index.v1.json \
  --output resources/nrsvue.index.json
```

A translation names itself. The source index may declare it, and
`--name` and `--abbreviation` state or override it:

```sh
node scripts/build-bible-index.mjs \
  --input resources/nrsvue.index.json \
  --name "New Revised Standard Version Updated Edition" \
  --abbreviation NRSVUE
```

That writes three files:

| File | What it is |
| --- | --- |
| `resources/bible.books.json` | the manifest: book names, chapter counts, verse counts and verse-id offsets, no verse text. Committed and shipped, which is what makes references resolve with no further setup. |
| `resources/<abbr>.text.json` | the verse text, under the lower-cased abbreviation, naming the translation inside. |
| `resources/translations.json` | the registry the dropdown is built from. Building a translation adds it to the list rather than replacing the list. |

The bundled NET index is committed. Any other translation's verse text stays
local: it is not in the repository and not in the release archive, and it
appears in the dropdown as soon as it has been built.

### Building an index from the NET Bible API

To download the 66-book NET Bible into the same source-index shape, run:

```sh
python3 scripts/build-net-index.py
```

The script uses only Python's standard library and writes
`resources/net.index.json`, declaring the translation it holds. It requests one
chapter at a time, retries transient failures, waits briefly between requests,
and replaces the destination only after the complete index has been built.
Convert that source index into Passage's runtime files with:

```sh
node scripts/build-bible-index.mjs --input resources/net.index.json
```

The index the plugin ships was built this way, and rebuilding it from the same
source writes the same bytes.

Use and distribution of text retrieved from the service must comply with the
[NET Bible copyright and API terms](https://labs.bible.org/api_web_service).

### Translation source-index schema

`*.index.json` files use schema version 2. Their stored shape is:

```text
schemaVersion: 2
translation: { name, abbreviation }
stats: { books, chapters, paragraphs, verses }
books[]: { bookId, shortName, longName, chapters[] }
chapters[]: { chapterNum, paragraphs[] }
paragraphs[]: { paragraphNum, verses[] }
verses[]: { verseId, verseNum, text }
```

`translation` names the translation the index holds — its full name and the
abbreviation it is known by — so the builder needs no arguments to say what it
is converting, and the generated `*.text.json` carries the same block under
schema version 2.

Each verse is stored exactly once, inside its paragraph. `chapterNum` and
`paragraphNum` are the canonical field names; the old `chapter` and
`paragraphId` aliases are not stored. Paragraph numbers remain globally
ordered and stable. Newline characters inside `text` preserve poetry
lineation, while paragraph membership is expressed by the containing paragraph.

The lookup helper in `scripts/translation-index.mjs` builds maps in memory. A
verse reference is `shortName/chapterNum/verseNum` (for example
`John/3/16`), and a book reference is its `shortName` (for example `John`). It
derives book and chapter metadata, paragraph membership, references, and book
verse bounds from the hierarchy. Serialized source files therefore contain no
`indexes` section, timestamps, duplicated verse objects, or stored reference
and range fields. The same input bytes always generate the same output bytes.

## Display options

Three checkboxes under the reference field decide how that text is written. Each
works on its own and any combination works together, over a single verse or a
range spanning chapters and books:

| Option | Writes |
| --- | --- |
| **View chapter headings** | `**Genesis 1**` above the verses of every chapter the passage includes, under the book's long name — a single chapter and a partial chapter are headed too |
| **View verse numbers** | each verse number as a superscript against the front of its own verse: `¹⁶For God so loved…` |
| **One verse per line** | every verse on a new line, preserving line breaks inside a verse |

All three open unchecked every time the prompt does: they describe the passage in
front of you rather than the next one. With none of them checked the passage is
written exactly as it is described above.

Verse numbers are written as superscript digits rather than as `<sup>` markup.
Logseq parses block content with mldoc, which reads a `<` at the start of a line
as block-level HTML, so a tag opening a paragraph — or, with one verse per line,
opening any verse — was pushed onto a line of its own above the text it belongs
to. Digits are plain text and parse the same wherever they fall. The digits are
wrapped in highlight markup — `^^¹⁶^^For God so loved…` — because that is what
gives the number an element of its own for a theme to color; read anywhere else,
the number is still a number.

The options add to the text and never replace it. Paragraph breaks, poetry
lineation and chapter separation stay as they are wherever an option does not
override them, verse numbers stay attached to their own verses when the index
omits one — Matthew 17:21 among them — and section headings are still left out.
Without a local text index the body stays empty and the
missing-index notice still appears: a heading or a verse number over a passage
that has no text would be metadata standing in for the passage.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| **Translation** (`biblePassageTranslation`) | `New English Translation (NET)` | The translation the command writes, chosen from the verse indexes in the plugin's own `resources` folder. |

Before 0.7.0 this setting was **Passage text index** (`biblePassageText`), a
typed path to one `*.text.json` file. It is gone, and a path left in your
settings file is ignored: choose the translation by name instead, and keep its
index in the plugin's `resources` folder. A registry entry may still state a
path in full if you keep an index elsewhere.

If you used the Passage command in Dark High Contrast 1.x, its setting was a
theme setting. Settings do not move between packages: set the translation once
under **Plugins → Passage → Settings**. Passages already written to your graph
are content and need no migration.

## Compatibility

Passage targets **Logseq 0.10.15 classic/file graphs on desktop**.

- DB graphs are not supported in this release.
- Mobile is not an advertised target.
- The plugin declares `effect: true`, which keeps its entry on the host's own
  origin. Without it `parent.document` is out of reach, and the `<` picker has no
  plugin API to reach it by instead.
- Passage works with any theme, or none. Its one piece of chrome, the reference
  dialog, carries a fallback for every colour it names.

## Install from the Logseq Marketplace

After the plugin is accepted into the marketplace:

1. Open **Plugins → Marketplace → Plugins**.
2. Search for **Passage** and install it.

## Load the repository as an unpacked plugin

1. Clone or download this repository.
2. In Logseq, enable **Settings → Advanced → Developer mode**.
3. Run `npm run build` from the repository root.
4. Open **Plugins**, choose **Load unpacked plugin**, and select
   `dist/logseq-passage/`.

No dependency installation or compilation is needed to use the plugin.

## Development

```sh
npm test --workspace packages/passage            # the package's own suites
npm run check --workspace packages/passage       # test, build and verify the ZIP
```

### Testing against the built plugin

`npm run build` stages the release into the repository root's `dist/logseq-passage/` and zips it. That
folder is also what you load as an unpacked plugin, so after the archive is
closed the build copies your local `resources/nrsvue.text.json` into it, if you
have one. The unpacked folder is then a complete working plugin — verses
included — across rebuilds, while the ZIP stays exactly the file list
the root `scripts/verify-release.mjs` asserts. A clean checkout and CI have no local index
and nothing is copied.

The copy happens strictly after archiving, and `verify-release.mjs` checks the
archive against its exact file list.

## Attribution

`resources/bible.books.json` carries book names, chapter counts, verse counts and
verse-id offsets, and no verse text. `resources/net.text.json` carries the NET
Bible's verse text, retrieved through the NET Bible API. See
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for both that and the
vendored Logseq SDK.

## License

MIT. Release tooling copies the repository root [`LICENSE`](../../LICENSE) into every staged package and archive.
