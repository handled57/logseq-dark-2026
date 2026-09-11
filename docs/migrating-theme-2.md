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

Passage validates references and writes the reference and chapter tags
immediately, and from 0.7.0 it ships the New English Translation, so verse text
is written with no further setup. Another translation is built locally and
chosen by name; see
[Choosing a translation](../packages/plugin-passage/README.md#choosing-a-translation).

## Choose the translation instead of a path

Logseq settings are package-scoped, so the old theme setting cannot migrate
itself into the new Passage package — and there is no longer a path to migrate.
Dark High Contrast 1.x had a **Passage text index** (`biblePassageText`) path;
Passage 0.7.0 replaced it with a **Translation** dropdown and ignores any path
left in a settings file.

1. Install Passage.
2. Open **Plugins → Passage → Settings**.
3. Choose the translation and test one reference.

If you kept a text index of your own, build it into Passage's `resources` folder
under the translation's abbreviation rather than pointing at it. Do not copy
`hiddenProperties` to Passage; it stays with Dark High Contrast. Do not rewrite
existing passage blocks.
