# Changelog

All notable changes to this package are documented here.

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
- The block leaves edit mode before the passage is written. The host saves the
  textarea it was editing back to the block whenever that session ends, which
  landed after the insertion and replaced the passage with the line that had
  been there: the passage appeared and then vanished, leaving an empty block
  out of edit mode.
- Enter and Escape are claimed on the host window before Logseq's document-level
  editor shortcuts. Pressing Enter now follows the same insertion path as
  clicking **Insert**, without the host creating a block behind the prompt.
- `npm run build` now copies a local `resources/bible.text.json` into
  `dist/logseq-passage/` after the archive is closed, so the folder you load as
  an unpacked plugin keeps its verse text across rebuilds. The verse text is
  still never committed and never packaged: the copy happens after zipping, and
  `scripts/verify-release.mjs` fails the release if verse text is ever found in
  the archive.
- The **Passage text index** setting (`biblePassageText`) is now a Passage
  setting. A path configured under the theme is not carried across: re-enter it
  once under **Plugins → Passage → Settings**. Passages already written need no
  migration.
