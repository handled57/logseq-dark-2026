# Migrate Dark High Contrast 1.x to 2.0.0

Version 2.0.0 moves the theme into its own monorepo workspace and moves the
Passage command into a separately installable plugin. The visual theme identity
remains **Dark High Contrast**, with package id
`logseq-dark-high-contrast-theme`.

## What remains compatible

- Existing passage blocks are graph content and remain unchanged. Blocks
  written by the theme through 1.10.1 already follow the Passage v1 contract;
  the 2.0.0 theme continues to classify and style them without Passage running.
- `hiddenProperties` and the older property-key/value migration remain owned by
  the same theme package id. Updating the theme retains those theme settings.
- The selected theme name and existing `custom.css` are not changed by either
  package. Remove duplicate old theme rules from `custom.css` only after making
  a backup and confirming the packaged theme is active.

## Install Passage separately

Dark High Contrast 2.0.0 no longer registers `/Passage` or the `< Passage`
picker entry. Install the **Passage** plugin (`logseq-passage`) separately if
you want to create new passage blocks. The theme works without it; Passage also
works with another theme or with no theme selected.

Passage can validate references and write the reference and chapter tags
immediately, but a local text index is required to insert verse text. Follow
the [Passage text setup](../packages/passage/README.md#passage-text) for building
or supplying an index.

## Copy the text-index path manually

Logseq settings are package-scoped, so the old theme setting cannot migrate
itself into the new Passage package. If Dark High Contrast 1.x had a custom
**Passage text index** (`biblePassageText`) path:

1. Before removing the old version, copy the complete path from its setting.
2. Install Passage.
3. Open **Plugins → Passage → Settings**.
4. Paste the path into **Passage text index** and test one reference.

Only the setting path moves. Do not copy `hiddenProperties` to Passage; it stays
with Dark High Contrast. Do not rewrite existing passage blocks.
