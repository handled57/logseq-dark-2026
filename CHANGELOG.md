# Changelog

All notable changes to this project are documented here.

## 1.9.0 - 2026-09-05

- Render a visible property table below the block's admonition or passage
  rather than above it, with the table's left border on the divider between the
  icon and the content, and a small gap between the two. Logseq renders the
  table ahead of the block body, which left it sitting above the box it
  describes; the change is to the render only, so the properties stay first in
  the block's source and clicking into the block still shows them where Logseq
  writes them. The 2rem the box carries below it moves to the table, so the
  table stays with its own block rather than drifting towards the next one. It
  covers the six named admonitions and the passage block; a table hidden by a
  rule, and an ordinary block's table, are left where they are.

## 1.8.0 - 2026-09-05

- Set verse numbers in the theme's cyan, the color of the passage's own icon.
  The number is wrapped in highlight markup, which Logseq renders as a `mark`: a
  bare run of digits is nothing a stylesheet can reach, and a tag of its own is
  not available, because mldoc reads a `<` opening a line as block-level HTML.
  The digits stay inside the markup, so a passage read without the theme still
  reads as a passage.
- Set each verse number in a gutter of its own where every number in the block
  opens a line — what **One verse per line** writes, and what poetry set a verse
  to a paragraph already amounts to. A verse that wraps now lines up with the
  start of its own text rather than under its number, and the reference and any
  chapter headings hang out to the passage's left edge. A passage of running
  prose keeps its numbers inline: `index.js` reads the fact from the block's own
  source, because the render cannot be asked — inside `#+BEGIN_PASSAGE` the
  whole body is one paragraph of line breaks, where a number opening a line and
  a number following an edition's poetry break look alike.
- Write a passage reference back under the book's full name, in one of six
  forms: `Genesis`, `Genesis 1`, `Genesis 1-2`, `Genesis 1:1 - 2:1`,
  `Genesis 50:20 - Exodus 1:10`, `Genesis 1:1-10`. The dash is tight where what
  follows it is a bare number continuing the book and chapter already named, and
  spaced where it carries a chapter or a book of its own. The short name stays
  on `tags::`, where it is half of a page name an existing graph already
  carries, and a chapter heading was already written in full, so the two now
  agree.
- Resolve a book named on its own — `Genesis`, `gen.`, `1 Cor` — as the whole of
  that book, which the parser previously refused because a reference had to end
  in a number. A whole book runs from its first chapter to its last, taking each
  end chapter's own first and last verse, so the books that do not begin at 1:1
  are spanned correctly. A long name that ends in a digit is read as the book it
  names rather than as a chapter of another: `Psalm 151` is the book.

## 1.7.1 - 2026-09-05

- Write verse numbers as superscript digits rather than as `<sup>`, which fixes
  the number that opens a paragraph rendering on a line of its own above its
  verse. Logseq parses block content with mldoc, and mldoc reads a `<` at the
  start of a line as block-level HTML: the tag became a block of its own and
  pushed the verse onto the next line. With **One verse per line** on, that was
  every verse in the passage. Digits are plain text and parse the same wherever
  they fall.

## 1.7.0 - 2026-09-05

- Offer three passage display options in the reference prompt, under the field
  and each independently selectable: **View chapter headings** writes
  `**Genesis 1**` above the verses of every chapter the passage includes,
  **View verse numbers** puts each verse number in superscript against the verse
  it opens, and **One verse per line** starts every verse on a new line. The
  options combine, and work across chapter and book boundaries alike.
- Open the prompt with all three options unchecked every time: they are a choice
  about the passage in front of you rather than a setting, and with none of them
  checked the passage is written exactly as it was before.
- Keep paragraph breaks, poetry lineation and chapter separation as they were
  wherever an option does not override them, and keep the edition's own section
  headings out of the block. Without a local text index the command still writes
  the reference and its chapter tags and leaves the body empty — an option adds
  nothing to a passage that has no text.
- Keep a prompt button black with white text in every state, so a focused button
  is marked by the orange border alone and never by an orange fill.

## 1.6.0 - 2026-09-05

- Resolve the reference the Passage command asks for. Books are matched on
  their short or long name — case, spacing and punctuation ignored — plus the
  usual abbreviations, and a range may be written with a hyphen, an en dash or
  an em dash across verses, chapters and books alike: `John 3:16`, `Gen 50`,
  `Gen 1-3`, `Gen 50 - Ex 2`, `Genesis 50:1-10`, `Gen 1:1-2:3`,
  `Genesis 50:1 - Ex 2:25`.
- Write the reference back in canonical short-name form, and fill `tags::` with
  one namespaced tag per chapter the passage spans: `Gen 50 - Ex 2` becomes
  **Gen 50–Ex 2** under `tags:: Gen/50, Ex/1, Ex/2`.
- Keep the prompt open, with the reason under the field, for a reference that
  does not resolve: an unknown book, a chapter or verse the edition does not
  carry, or a range that runs backwards such as `Ex 2-Gen 50`.
- Write the passage text under the reference as plain prose — no verse numbers,
  no section headings, a blank line between paragraphs, and poetry keeps its
  lineation — when a local text index is present. The index is built by `scripts/build-bible-index.mjs` from an
  edition of your own; no verse text is committed here or shipped in the
  release. Without it the command still writes the reference and its tags, so
  the theme is fully usable installed from the Marketplace.
- Ship `resources/bible.books.json`, a manifest of 84 books, 1398 chapters and
  37758 verses carrying names, counts and verse-id offsets and no verse text.
  The generator repairs four defects in the source it is built from: `Bah` for
  Habakkuk, `Psalm` for the Psalms, the thirteen tail books named one
  deuterocanonical book out of step, and section headings and psalm
  superscriptions left at the end of the preceding verse.
- Make **Insert** the reference prompt's default action: Enter inserts and
  Escape cancels wherever the key lands, because the dialog now claims those
  two keys ahead of Logseq's own editor shortcuts, which previously saw Enter
  first and opened a new block behind the prompt.
- Add a **Passage text index** setting naming a `bible.text.json` outside the
  theme's own folder.

## 1.5.2 - 2026-09-05

- Write `tags::` and `type:: Passage` into every passage the `/passage` command
  and the `<` picker insert. The lines go at the top of the block, above
  `#+BEGIN_PASSAGE`, which is where Logseq itself puts a property drawer for a
  block with no title line and the only place it parses one; a key the block
  already declares is left alone.
- Default the property-hiding rule to `type: passage`, so a newly inserted
  passage renders as a bare passage rather than under a property table. An
  existing graph keeps whatever it is already configured with.
- Keep a block bulletless when a property drawer sits above its `#+BEGIN_`
  marker, which the source classifier previously read as ordinary prose.

## 1.5.1 - 2026-09-05

- Match the passage block to a rendered admonition exactly: the icon is drawn
  at the admonition's own 2rem size, vertically centered against the block
  rather than pinned near its top, and the divider between the icon and the
  text is restored. The divider is now a second pseudo-element, because the
  mask that paints the icon was clipping the border off the box that carried
  both. Passage text also takes the admonition's type size, indent, paragraph
  spacing and block margin.

## 1.5.0 - 2026-09-05

- Add a passage block: `#+BEGIN_PASSAGE` renders with the black surface, the
  transparent outer edge and the 4px accent divider of a named admonition, plus
  a cyan open-book icon the theme supplies inline, because Logseq's admonition
  list is closed and emits a bare `div.passage` for this block.
- Insert one from the `/passage` slash command or from a Passage entry added to
  the `<` command picker. Both prompt for a reference, write it in bold on the
  first line, and leave the cursor on the blank writing line beneath it.
- Hide a rendered passage block's bullet from the rendered DOM as well as from
  the stored source, so it never appears while the source lookup is in flight.

## 1.4.6 - 2026-09-04

- Remove the visible outer border from rendered tip, note, important, caution,
  pinned, and warning admonitions, and widen their icon divider to 4px using
  the matching semantic icon color.

## 1.4.5 - 2026-09-04

- Classify mounted blocks from their canonical stored Logseq source so Org
  markers such as `#+BEGIN_CENTER` remain detectable after rendering removes
  them from the content DOM.

## 1.4.4 - 2026-09-04

- Hide bullets when Logseq applies `#+BEGIN_CENTER` alignment directly to the
  block content wrapper rather than to one of its descendants.

## 1.4.3 - 2026-09-04

- Hide bullets on already-rendered Org `src`, `center`, and `verse` custom
  blocks directly from their rendered markers, including the inline text
  alignment Logseq emits for `#+BEGIN_CENTER`.

## 1.4.2 - 2026-09-04

- Recognize the uppercase CSS classes emitted by mldoc for rendered
  `#+BEGIN_CENTER` and `#+BEGIN_VERSE` blocks so their bullets stay hidden.

## 1.4.1 - 2026-09-04

- Keep `src`, `center`, and `verse` blocks bulletless in both rendered and edit
  states.

## 1.4.0 - 2026-09-04

- Keep bullets visible for ordinary prose while hiding them for empty,
  property-only, heading, reference, embed, command/macro, query, media, code,
  namespace, math, ClojureScript-eval, slide, flashcard, Zotero, quote, and
  advanced `<`-menu blocks in both rendered and edit states.
- Stop descendant hover and focus from revealing or recoloring ancestor
  bullets, and suppress both the border and hover fill of connector threads.
- Classify mounted blocks in the existing entry script so source-only forms
  remain distinguishable after Logseq renders them.

## 1.3.0 - 2026-09-04

- Accept any number of `key: value` pairs for property hiding instead of a
  single key and a list of its values. A block renders bare when its rendered
  properties match any one pair, so `type: foo, status: done, kind` now hides
  three unrelated families of block at once. Pairs are separated by commas,
  semicolons or newlines, and `key: *` (or a bare `key`) matches every value of
  that key.
- Replace the `Property key` / `Values that hide properties` settings with one
  `Properties that hide the property table` field. A graph configured under
  1.2.0 migrates its two old settings into the new field on first load, before
  the schema default could overwrite them.
- Resolve `data-hc-block-type` against the first configured key a block
  carries, making configuration order the precedence order for the styling
  hook.
- Cover the entry script with behavioral tests: `test/properties.test.mjs`
  runs `index.js` in a `vm` context against a stub host document and asserts
  the attributes each pass writes.

## 1.2.0 - 2026-09-03

- Hide a block's rendered property table when its `type` property matches a
  configured value, so tagged blocks render as bare content. Clicking into the
  block still shows the content and its properties as source, because Logseq
  swaps the whole rendered block for a textarea over the raw block content.
- Turn the package from a CSS-only theme into a theme that also ships an entry
  script. `effect` is now `true`, which is what keeps the entry on the host's
  `file://` origin; a side-effect-free package is served from
  `lsp://logseq.io/` and cannot read the host document.
- Expose `data-hc-block-type` on every block that carries the configured
  property, as a styling hook for rules keyed to a block's type.
- Vendor `@logseq/libs` under `lib/` so a release installs with no build or
  install step, and ship it through the release archive gate.
- Repaint the workbench chrome in the `#5b7e96` contrast border instead of
  white: both sidebars, the header and right-sidebar topbar, panels, menus,
  modals, notifications, tooltips, tables, code blocks, the settings and
  command-palette surfaces, and the resting borders of buttons, inputs and
  checkboxes. The ShUI `--border` / `--input` tokens move to the same color.
  Bullets, the editor caret, text and the orange focus ring are unchanged.

## 1.1.0 - 2026-09-03

- Raise the variable block to `html[data-theme][data-color]:root`, so the theme's
  `--ls-*` palette out-ranks the per-accent palette Logseq declares at
  `html[data-theme=dark][data-color=…]`. Every background token in the theme was
  previously losing that cascade and had no effect.
- Pin all 50 Radix `--lx-gray-*` / `--lx-accent-*` tokens Logseq reads ahead of
  `--ls-*`. Selecting any accent other than the default repainted roughly 130
  surfaces in that accent's ramp.
- Flatten block embeds and nested `.color-level` blocks onto the black surface
  instead of the stock green-tinted level tints.
- Repair surfaces that matched no theme rule: block hover highlight, inline code,
  table stripes, checkboxes and radios, scrollbars, closed bullet halos, the date
  picker, search-match highlighting, shortcut key chips, the PDF viewer and text
  layer, Logseq's CodeMirror skin, and the all-pages, settings, shortcut, themes,
  onboarding, dashboard, and sidebar-help screens.
- Extend the `forced-colors` override to the same specificity and to the Radix
  tokens.
- Add cascade regression tests that assert the theme out-ranks each upstream rule
  it replaces, and check the pinned selectors against an installed Logseq when
  `LOGSEQ_CSS` is set.
- Correct the palette test, which still expected the pre-`#5b7e96` border color,
  and tie the version assertion to the changelog so the two cannot drift again.
- Build and verify releases without the external `zip`/`unzip` binaries, so the
  release gate runs on Windows as well as CI.

## 1.0.0 - 2026-09-02

- Package the graph-level stylesheet as a CSS-only Logseq theme.
- Map the VS Code Dark High Contrast palette across classic Logseq workbench and editor surfaces.
- Add ShUI/Radix, sidebar, command palette, settings, notification, PDF, graph, and whiteboard coverage.
- Preserve the focused desktop width, hover-revealed bullets, and cyan block-ancestry treatment.
- Add accessibility checks, release packaging, documentation, and marketplace metadata.
