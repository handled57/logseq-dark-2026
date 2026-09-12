# Changelog

All notable changes to this project are documented here.

## 2.11.0 - 2026-09-11

- Draw every rail bullet as a solid 10px dot, uniformly sized across headings,
  prose, expanded parents and folded parents. Preserve first-line alignment.
- Add a crisp ring only to collapsed parents. Remove container halos and glow,
  and prevent hover enlargement.
- Order hierarchy colors from brightest to darkest, starting with amber, blue
  and teal at the top levels.

## 2.10.0 - 2026-09-10

- Align a page's title with the text of the blocks below it. Logseq leaves the
  title at the page's own left edge while holding every block's text 22px
  further right — past the fold arrow's box, the bullet and the gutter between
  the bullet and the text — which the bullet rail made plainer by moving the
  bullet out of that column but not the column itself. The title is now indented
  to the column its prose stands in, on its own box, so the background it is
  hovered and edited in travels with it. The column is `--hc-title-indent`, 24px
  by default, and can be retuned from `custom.css`. Document mode and the
  right-hand fold layout re-measure the tree and keep Logseq's own alignment, as
  do journal headings on the Journals route; the rail, the blocks and the
  sidebars are unchanged.

## 2.9.1 - 2026-09-10

- Keep the property-toggle dot hidden until its block is hovered or the control
  receives keyboard focus. Its pointer target, keyboard operation and rail
  geometry are unchanged.

## 2.9.0 - 2026-09-10

- Add a cyan property-toggle dot immediately right of each eligible block
  bullet. It shows or hides that block's rendered property table without
  changing the graph, keeps the choice across rerenders and navigation for the
  current Logseq session, and overrides configured property-hiding rules until
  the theme unloads. The button supports pointer, Enter and Space operation,
  reports the table's current visibility to assistive technology, and is kept
  out of sidebars, embeds, queries, whiteboards, document mode, right-side fold
  layouts and page front matter.

## 2.8.0 - 2026-09-09

- Give the outline a block takes on hover, on selection and under Logseq's own
  highlight room around the text it encloses. It stood one pixel off the
  block's own box, which read as a line ruled through the paragraph rather than
  a border around a block; it now stands off by `--hc-block-outline-pad`, 6px
  by default, and a selected block's raised fill reaches that border with it.
  Logseq sizes a block's content box itself and lays it out border-box, so the
  room is taken outside that box rather than as padding: nothing the block
  holds moves or rewraps when the pointer arrives, and every bullet stays on
  the middle of its block's first line. Blocks are spaced by `--hc-block-gap`,
  the padding twice over plus the 4px they had, so two blocks selected one
  after the other keep their outlines apart. Each row now paints its stretch of
  the rail down the whole gap below it, to the top of the next row, rather than
  a fixed 8px past its own foot, so the line stays unbroken however far apart
  the blocks are spaced. A child block is nested inside its parent rather than
  laid out after it, so that gap never fell between a parent and its first
  child, whose border was drawn through its parent's; every nested group now
  opens on the gap too, counted so a parent and its first child stand exactly
  as far apart as two siblings. The orange border a block wears while it is
  being edited moves out to that same padding, so a block keeps its border in
  one place whether it is being read or written; it is an outline now rather
  than a border on the editor's own box, which had been narrowing the text by a
  pixel as the block opened. Both variables can be retuned from `custom.css`.

## 2.7.1 - 2026-09-09

- Stop a table's narrow columns collapsing until their headings break mid-word.
  Logseq breaks a block's text anywhere it has to, and a cell inheriting that
  reported a narrowest width of one character, so the automatic layout was free
  to squeeze a `Level` column down to `Lev/el` while a column holding a whole
  sentence kept the width of the table. A cell now breaks at word boundaries,
  which gives every column a floor of its own longest word and leaves the wide
  column to wrap instead. A single run too long for its column — a URL, a hash
  — still breaks within the line, and a table wider than the block it sits in
  still scrolls.

## 2.7.0 - 2026-09-09

- Set block headings 20% below the sizes Logseq gives them: an `h1` renders at
  `1.6em` of the block's text rather than `2em`, and every level down to `h6`
  comes to the same fraction of its own size. The levels keep the proportions
  they had to one another, the sizes hold while a heading is being typed as
  well as in the page view, and because the margin above a heading is its own
  font size, the space a run of headings takes comes down with them. Page
  titles and headings quoted inside a block reference are unchanged.
- Measure a heading's rail bullet from that same scale, so it still drops to
  the middle of the heading's first line and is still drawn at the weight of
  it. The scale is `--hc-heading-scale`, `0.8` by default: a graph can retune
  it — or restore Logseq's sizes with `1` — from `custom.css`, and the bullets
  follow.

## 2.6.0 - 2026-09-09

- Draw the bullet rail's line in one color the whole way down the page. The
  line no longer changes hue with nesting depth: every block paints its stretch
  in the color the settings name, so a deep tree reads as one rail rather than
  a ladder of eight colors. The bullets are unchanged and still carry the
  hierarchy — a heading or a block with children takes the color of its own
  depth, ordinary prose keeps a white bullet, an open block is still a ring —
  and hovering a block now lights its bullet in that bullet's own color rather
  than the line's.
- Rename the **Default rail color** setting to **Rail color**: it now sets the
  whole rail rather than the stretches no hierarchy color reached. Values
  already configured are kept.

## 2.5.0 - 2026-09-08

- Set the emoji a block opens with in a gutter of its own, left of the block's
  text, so it reads as that block's icon. `📌 Important note` renders the pin
  beside the text rather than in it, and a line long enough to wrap comes back
  to the text's column instead of under the pin. The emoji is not moved, copied
  or replaced: it is still the first character of the block's source and of the
  text the block renders, clicking in shows the line as it was typed, and
  nothing is written to the graph. One emoji grapheme is one icon however many
  code points it takes — a variation selector, a skin tone, a flag, a keycap or
  a ZWJ sequence — while a character that is only an emoji when asked, `©` or a
  bare `❤`, stays text. A block that renders as an admonition, a passage, a
  code block, a query, an embed or a piece of media keeps its own icon and
  layout, and Logseq's bullet is untouched. Add a **Leading emoji as a block
  icon** setting, on by default, that puts every emoji back in its line when it
  is turned off, and `--hc-block-icon-gutter`, `1.5em`, for a graph that wants
  the gutter retuned from `custom.css`.

## 2.4.0 - 2026-09-07

- Repaint the bullet rail's hierarchy in eight colors instead of seven:
  `#dc267f` magenta, `#ea5c00` orange, `#994f00` brown, `#ffb000` amber,
  `#40b0a6` teal, `#75beff` blue, `#b180d7` indigo and `#b66dff` violet, one
  per nesting level in that order. The cycle repeats every eight levels — a
  depth-9 block is magenta again — and the eight are chosen to stay apart from
  one another for a reader with a common color vision deficiency, which the
  previous seven-hue spectrum did not. `--hc-red` and `--hc-indigo` are
  replaced by the eight `--hc-rail-*` hue tokens the depths read through.
- Add a **Default rail color** setting for the base rail line: the color a
  block that carries no hierarchy of its own — ordinary prose, rather than a
  heading or a block with children — paints its stretch of rail with. It
  defaults to `#5b7e96`, the `--vscode-hc-border` the editor, the left menu and
  the sidebars are drawn with, replacing the cyan that line used to take.
  Leaving it empty keeps that border color, and the eight hierarchy colors are
  unaffected by it.
- Draw a block whose children are showing as an empty ring, so a bullet says at
  a glance whether anything is folded away under it. A collapsed block and a
  block with no children of its own keep the bullet they had.
- Keep a bullet's inside its own color while the pointer is on it. Logseq
  repaints it in the stock bullet gray on hover, which took a depth's color off
  the one bullet being looked at; the halo and the slight growth it adds are
  unchanged.
- Start the rail at the first block of a page's own text. A page's properties
  are its front matter rather than a block of it, so that row now renders with
  no bullet and no rail segment, in view and while the properties are being
  typed, and nothing is drawn above the first content bullet.
## 2.3.1 - 2026-09-07

- Keep the `/` command menu above the children of the block it is opened in.
  The menu stopped the blocks *after* the edited one from reading through it,
  but not that block's own child blocks, which went on painting their text over
  it — the same defect, one level in, and a parent block is where the menu is
  used most. A block's children are now ordered under the row holding the popup
  for as long as it is open. Every other popup the editor opens — `[[`, `((`,
  the template, property and date pickers and the code block mode picker —
  is fixed with it. Nothing moves when a popup opens, and with no popup open a
  block paints exactly as before.

## 2.3.0 - 2026-09-07

- Fold a rendered box without folding the block that holds it. Every
  admonition, passage, table, quote, code block, math block, piece of media and
  block or page embed in the main editor now carries an expand/collapse control
  in its top right corner. It is the render that folds, not the block: the
  block keeps its properties and its children, nothing is written to the graph,
  and clicking into the block still shows the whole of its source. Each box
  answers only for itself, and every box opens expanded.
- Fold to something still worth reading. An admonition keeps its icon, its
  divider and the first line of what it says; a passage keeps its icon and its
  reference line; a table keeps its head, or its first row where the markup
  writes none, in the columns it was laid out in. A quote, a code block, a math
  block, a piece of media and an embed fold to a one-line box carrying the word
  for what is inside them — nothing of the hidden content reads through, and no
  space is left standing for it.
- The control is operated by pointer or keyboard, takes the theme's orange
  focus ring, and keeps both of Logseq's own gestures out of it: pressing it
  neither opens the block for editing nor folds it the way its bullet does.

## 2.2.1 - 2026-09-07

- Keep the `/` command menu, and every other popup the editor opens over a
  block, above the text of the blocks below it. The menu was already painted
  opaque black; what read through it was the text of the following blocks, drawn
  on top of it because Logseq gives the popup no stacking level of its own and
  every block is a positioned element. The popup and the block it opens in now
  sit on Logseq's own first z-index level, above the page and below the header
  and every dialog. The `[[`, `((`, template, property, date-picker and code
  block mode popups are fixed with it, and the menu's layout, keyboard
  navigation, scrolling, filtering and row states are unchanged.
- Brighten the section headings inside those popups — BASIC and TIME & DATE in
  the `/` menu — to full white and set them bold. Logseq draws them at a fifth
  of the popover foreground, which over the theme's black left them barely
  visible. They keep Logseq's smaller size, so weight is now what tells a
  heading from a command.

## 2.2.0 - 2026-09-07

- Color the bullet rail by hierarchy. A block that carries the structure of the
  page — one whose first line is a heading, or one with children of its own —
  paints its bullet and its own stretch of the rail in the color of its depth:
  red at the top level, then orange, yellow, green, blue, indigo and violet, the
  seven repeating below the seventh level so no two adjacent levels ever share a
  hue. A child's segment is always the child's color rather than its parent's,
  and a folded parent keeps its color while its children are out of the
  document. Ordinary leaf prose keeps the white bullet on the cyan line it
  already had, and a hovered bullet now lights in whichever of the two colors
  its own block paints the rail with.

- Add two colors the VS Code High Contrast palette does not carry, `--hc-red`
  and `--hc-indigo`, so the red at the top of the spectrum reads apart from the
  orange a level below it and the indigo stands between the blue and the violet.
  Both clear 6:1 against the black canvas.

## 2.1.0 - 2026-09-06

- Fold a block by left-clicking its bullet. The click that opened the block's
  own page now expands or collapses it through Logseq's own collapse handling,
  and a bullet never navigates: a block with no children keeps its click and
  stays where it is. Opening a block in the main editor is the **Open** entry
  on the bullet's context menu. Shift-click still opens the block in the
  sidebar, right-click still opens the menu, dragging a bullet still moves the
  block, and whiteboard bullets are left to Logseq.

- Draw a block's rail bullet at the size of its own first line. Ordinary prose
  keeps the bullet it had, and a larger first line takes a proportionally larger
  bullet: halo, dot, rings and hover ring all scale by the multiple Logseq sets
  that line in, so an `h1` bullet is twice an ordinary one and an `h6` bullet
  three quarters of it. A scaled bullet grows around the rail, keeping its
  centre on the line and on its block's first line at every nesting level.

- Add **Open** immediately above **Open in sidebar** in the context menu opened
  from every block bullet. It opens that block in the main editor, matching the
  bullet's ordinary click behavior, and uses Logseq's native block-menu hook so
  ordinary, special, top-level, and nested blocks all receive it. Observe the
  body-level menu portal so the entry is moved into position for every block,
  rather than only when a special block happens to trigger another repaint.
- Align the icons in `tip`, `note`, `important`, `caution`, `warning`, and
  `pinned` admonitions with the first rendered line while preserving the
  full-height semantic divider. The passage icon follows the same alignment
  while its separate divider continues through the full passage block.
- Scale named-admonition and passage glyphs as 1.5em squares based on their
  first-line font size. Their fixed icon columns, content indents, and
  full-height four-pixel dividers remain unchanged.

## 2.0.0 - 2026-09-05

- **Breaking.** Inserting a passage is no longer part of this theme. The
  Passage command, its reference parser, its Bible manifest and its index
  generator now ship as [`logseq-passage`](../plugin-passage), installable on its own;
  install it alongside the theme to keep the `/passage` and `<` commands. This
  theme still paints passage blocks exactly as it did — a passage already in
  your graph is a passage still, whether Passage is installed or not, because
  what the two agree on is a block shape rather than a runtime. That shape is
  published as [`docs/contracts/passage-v1.md`](../../docs/contracts/passage-v1.md).
- **Breaking.** The **Passage text index** setting (`biblePassageText`) moved
  with the command. A path configured here is not carried across: re-enter it
  once under **Plugins → Passage → Settings**. **Properties that hide the
  property table** (`hiddenProperties`) is unchanged, keeps its `type: passage`
  default, and still migrates a 1.2.0 key-and-values configuration.
- The theme's entry script now writes and clears `data-hc-*` attributes and one
  `hc-hidden-properties` style key, and nothing else. It no longer registers a
  slash command, injects a menu entry, opens a dialog, or reads any file, so a
  graph running both packages has neither one clearing the other's work on
  unload.
- The release archive no longer carries `bible.js` or `resources/`, and the
  theme's third-party notices no longer cover the Bible manifest; both moved to
  the Passage package's own.

## 1.10.1 - 2026-09-05

- Hovering a block no longer fills it with the raised gray background. The
  hover outline stays, so the pointer still marks the block it is over, but
  scanning down a page no longer washes each block in turn. The `#1f1f1f` fill
  is now reserved for the deliberate, persistent states: a selected block and
  Logseq's own block highlight. A visible property table still drops its border
  while its own block is hovered, and now keeps it when the hovered block is a
  descendant rather than the block the table belongs to.

## 1.10.0 - 2026-09-05

- Hang every block's bullet on one vertical rail in the margin left of the main
  editor, with a cyan line running behind the bullets from the centre of the
  first to the end of the last block. Only the bullet moves: Logseq's own
  control column is pulled left by the indentation its nesting level applied
  plus the margin the rail stands in, and is handed the same distance back on
  its other side, so the content column keeps the hierarchy Logseq renders, and
  the bullet stays the real one — its click, right-click menu, drag and
  collapsed-state styling are Logseq's own. Each bullet sits on the middle of
  its block's first line of text, wherever that line starts: a heading's bullet
  drops by 1.75 times the size Logseq gives that heading level, in view and in
  the editor, and a quote, a passage, an admonition, a code block and a table
  each drop their bullet into the box they open with. Hovering a block lights
  its own bullet in the rail's cyan; an ancestor holding the hovered block keeps
  its bullet plain. Every rendered block takes a bullet, including the empty,
  code, `center`, `verse` and passage blocks the theme leaves bulletless
  elsewhere; a collapsed block still renders no descendants, so none appear on
  the rail. A numbered list keeps its number beside its content and takes an
  ordinary bullet on the rail. How far left the rail stands is one number,
  `--hc-rail-offset`, which a graph can retune from `custom.css`; a full-width
  page and a narrow window are given less of it so the rail always fits in the
  margin Logseq leaves. The rail covers pages, journals, narrow layouts and the
  full-width route; sidebars, whiteboards, dialogs, linked references, and the
  embedded and queried trees rendered inside a block keep Logseq's own layout,
  as do document mode and the right-hand fold button, both of which re-measure
  the indentation the rail is drawn from.

## 1.9.0 - 2026-09-05

- Render a visible property table below the block's admonition or passage
  rather than above it, with the table's left border lined up with the box's own
  text and a small gap between the two. Logseq renders the
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
  a number following a poetry break look alike.
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
  wherever an option does not override them, and keep section headings out of
  the block. Without a local text index the command still writes
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
  does not resolve: an unknown book, a chapter or verse absent from the index,
  carry, or a range that runs backwards such as `Ex 2-Gen 50`.
- Write the passage text under the reference as plain prose — no verse numbers,
  no section headings, a blank line between paragraphs, and poetry keeps its
  lineation — when a local text index is present. The index is built by `scripts/build-bible-index.mjs` from an
  input file. Without it the command still writes the reference and its tags, so
  the theme is fully usable installed from the Marketplace.
- Ship `resources/bible.books.json`, a manifest of 84 books, 1398 chapters and
  37758 verses carrying names, counts and verse-id offsets and no verse text.
  The generator repairs four defects in its input: `Bah` for
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
