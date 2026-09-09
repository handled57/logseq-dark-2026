# Changelog

All notable changes to this package are documented here.

## 0.7.0 - 2026-09-09

- Replace the typed Passage text-index path with a **Bible JSON file** chooser.
  The setting no longer asks for a translation-specific filename; selecting a
  compatible Bible text JSON file supplies passage text as before.

## 0.6.1 - 2026-09-09

- Run the NET source-index tests by file path so they work in clean Linux
  release runners as well as local development environments.

## 0.6.0 - 2026-09-08

- Replace the translation source-index schema with a compact hierarchy that
  stores each verse once and derives references, book bounds, book and chapter
  metadata, and paragraph membership during lookup. NRSVue and NET now share
  schema version 2, with canonical `chapterNum` and `paragraphNum` names and no
  serialized reverse indexes or generation timestamp.
- Add a source-index lookup helper and a one-time converter for older NRSVue
  indexes. Verse lookup works by reference or stable verse ID, book lookup
  returns its derived bounds and canonical reference, poetry lineation and
  numbering gaps are preserved, and the existing Passage runtime artifacts are
  generated without changing their supported content.

## 0.5.0 - 2026-09-08

- Add a standard-library Python generator that downloads the 66-book NET Bible
  through the NET Bible API and writes a Passage-compatible `NET.index.json`.

## 0.4.0 - 2026-09-08

- Rename the local Bible resource files the generator reads and writes —
  `bible.index.json` to `nrsvue.index.json`, and `bible.text.json` to
  `nrsvue.text.json` — to name the translation the shipped index is built
  from. The committed manifest, `bible.books.json`, is unchanged. A
  previously built `bible.text.json` is no longer picked up automatically;
  rename it or rebuild it under the new name.

## 0.3.0 - 2026-09-07

- Add **Passage: Insert a passage** to Logseq's global command palette, available
  through **Cmd+Shift+P** on macOS and **Ctrl+Shift+P** on Windows and Linux.
  The `/` slash-command and `<` command-picker entries remain unchanged.

## 0.2.1 - 2026-09-07

- Rename the command shown in the `/` slash-command menu and the `<` command
  picker to **Passage: Insert a passage**. Passage insertion and its dialog,
  reference resolution, content and options are unchanged.

## 0.2.0 - 2026-09-06

- Remove Bible provenance metadata from the generated `bible.books.json` and
  `bible.text.json` schemas, and treat supplied Bible JSON as ready for use.
- Standardize the generator's Bible input option as `--input` and describe the
  input solely by its structure throughout documentation, runtime comments and
  tests.

## 0.1.0 - 2026-09-05

- First release as a package of its own. The Passage command, its reference
  parser, its Bible manifest and its index generator were part of the Dark High
  Contrast theme through 1.10.1; they are now `logseq-passage`, installable and
  releasable without the theme. What the command writes has not changed, so a
  passage already in your graph is a passage still: the block shape both
  packages agree on is published as
  [`docs/contracts/passage-v1.md`](../../docs/contracts/passage-v1.md).
- Everything the plugin writes into the host document is namespaced to Passage —
  `data-passage-*` attributes, the `passage-dialog` style key, and element ids
  beginning `passage-` — so it never reads, replaces or clears what a theme
  wrote, and unloading either package leaves the other's work intact.
- The reference dialog paints itself, with a fallback for every colour it names,
  so the prompt is legible with any theme selected or none. It also holds the
  focus while it is open: the block behind it is still in edit mode, and the
  host puts the caret back in its own textarea once the command menu closes,
  which sent the reference into the block and left Insert disabled and Enter
  with a blank field to read.
- Passage keeps the invoking block's edit session open while it writes. Logseq
  routes `updateBlock` for the currently edited block into the live editor
  state, so the host's eventual textarea save contains the passage instead of
  overwriting it and making the inserted text appear and then vanish. Passage
  also restores the caret in that live editor instead of calling `editBlock`:
  re-entering the already active block can reload its older database content
  before the live state has been saved.
- Enter and Escape are claimed on the host window before Logseq's document-level
  editor shortcuts. Pressing Enter now follows the same insertion path as
  clicking **Insert**, without the host creating a block behind the prompt.
- `npm run build` now copies a local `resources/bible.text.json` into
  `dist/logseq-passage/` after the archive is closed, so the folder you load as
  an unpacked plugin keeps its verse text across rebuilds. The copy happens
  after zipping, while `scripts/verify-release.mjs` continues to enforce the
  archive's declared file list.
- The **Passage text index** setting (`biblePassageText`) is now a Passage
  setting. A path configured under the theme is not carried across: re-enter it
  once under **Plugins → Passage → Settings**. Passages already written need no
  migration.
