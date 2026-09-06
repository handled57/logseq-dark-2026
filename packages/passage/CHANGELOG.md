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
  so the prompt is legible with any theme selected or none.
- The **Passage text index** setting (`biblePassageText`) is now a Passage
  setting. A path configured under the theme is not carried across: re-enter it
  once under **Plugins → Passage → Settings**. Passages already written need no
  migration.
