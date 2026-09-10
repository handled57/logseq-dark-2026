# Architecture

## Package boundaries

This repository contains three runtimes, not one application split across
folders. Dark High Contrast, Passage and Anno have separate Logseq identities,
settings, entry scripts, metadata, versions, archives, and lifecycles. None
imports another or relies on sibling-package files.

The theme and Passage have one product-level agreement, the versioned
[Passage v1 content contract](contracts/passage-v1.md). Passage writes ordinary
block source; the theme independently reads that source and styles the render.
The shared fixtures in the contract are driven by tests in both workspaces. Anno
is party to no contract: what it writes is an asset and a plain Logseq link, and
what reads them is Logseq itself.

## Host origin and `effect: true`

All three packages inspect or augment Logseq's host document. Logseq 0.10.15
moves a side-effect-free plugin entry to the `lsp://logseq.io/` origin, where
browser same-origin rules prevent access to `parent.document` and to the host's
own `parent.apis` bridge. Consequently every package's and manifest's metadata
retains `effect: true`. This is a runtime capability decision, not release-tool
boilerplate.

Passage needs host access because Logseq offers no plugin API for the `<` picker;
it inserts its namespaced menu entry while that picker exists. The theme needs
host access to classify rendered blocks and to hide only configured property
tables. Anno needs it twice over: it draws its prompt in the host document, and
the only route a plugin has to the graph folder is `parent.apis.doAction`, the
host's IPC bridge, because no plugin API writes an asset. A future package that
does not need host access should decide `effect` from its own requirements
rather than copying this setting automatically.

## Theme cascade and bullet rail

`packages/dark-high-contrast/theme.css` is the canonical palette and stylesheet.
Logseq often resolves a color through `--lx-*`, then `--ls-*`, then `--rx-*`,
and per-accent rules can outrank a simple theme declaration. Palette changes
therefore preserve exact High Contrast constants and enough selector specificity
to win the relevant cascade. `test/cascade.test.mjs` compares critical rules
with pinned Logseq 0.10.15 declarations and can also read the installed CSS via
`LOGSEQ_CSS`.

The main-editor bullet rail repositions Logseq's own bullet; it never clones
one. For each nesting level, the control column moves left by that level's
`29px` indentation plus `--hc-rail-offset`, then returns the same distance as
margin so the content hierarchy does not move. The rail is scoped to the page
tree, stops short of embeds, queries, references, sidebars, dialogs, document
mode, and right-side fold controls, and uses smaller offsets for narrow and
full-width layouts. `--hc-rail-bullet-y` aligns a bullet and fold arrow with the
first rendered line, including headings and boxed block types, and
`--hc-rail-bullet-scale` sizes the bullet by that line's font-size multiple:
`--hc-rail-bullet-size` and `--hc-rail-bullet-dot` derive Logseq's 16px halo and
6px dot from it, the rings scale with it, and half of the growth is taken back
as margin so the bullet centre stays on the rail. All three are declared on the
row alongside `--hc-rail-bullet-y`, because a custom property substitutes
against the element it is declared on: derived from `:root`, the two sizes would
resolve against the root's scale and never follow a heading's. The scale
defaults to `1`, so every surface the rail does not reach is untouched. These numbers derive from pinned
upstream declarations; change arithmetic, selectors, and cascade tests
together.

The rail's bullets carry the hierarchy; its line does not. The line's two
pseudo-elements paint in `--hc-rail-default-color` at every depth, so the whole
rail is the one color a reader configures. `--hc-rail-depth-color` is declared
once per nesting level beside that level's `--hc-rail-indent`, cycling the eight
ROYGBIV tokens `--hc-rail-depth-1`…`--hc-rail-depth-8` so adjacent levels never
share a hue and the cycle starts again below the eighth — depth 9 is depth 1's
magenta. A row that carries the hierarchy — Logseq's own `haschild="true"`,
which holds while a block is folded, or a first line that renders or is being
typed as a heading — copies that color into `--hc-rail-bullet-color`; every
other row keeps a white bullet. That variable is declared on a block's own
control column, which no descendant block sits inside, so a child's bullet
always takes the child's depth rather than its parent's. All eight hues are the rail's own additions to
the VS Code palette, chosen to stay apart under the common color vision
deficiencies rather than to walk the spectrum evenly; `test/theme.test.mjs`
pins each literal, its position in the cycle, and the 3:1 a non-text interface
component owes the canvas.

The bullet's inside is a fourth variable, `--hc-rail-bullet-fill`, which follows
`--hc-rail-bullet-color` everywhere except on a block whose children are
showing: `[haschild="true"]` with a `.bullet-container` Logseq has not marked
`.bullet-closed` sets the fill to `transparent`, so an open block is a ring, a
folded one stays filled, and a leaf is unchanged. Both the rest state and the
hover state paint from that one variable, the hover with `!important`, because
upstream repaints a hovered bullet's inside from `.bullet-link-wrap:hover` with
an important declaration of its own; the halo and the scale it adds are left
alone.

`--hc-rail-default-color` is the line, and the only part of the rail a reader
configures. theme.css declares it as `--vscode-hc-border`, the structural
border the editor, the left menu and the sidebars are drawn with, and `index.js`
writes the **Rail color** setting over it as an inline custom property,
so it out-ranks the stylesheet without depending on the order the theme and its
entry are loaded in. That inline style goes on `body`, not on the root element:
the palette's selector list includes `html[data-theme][data-color]:root body`,
so on a graph with an accent set the body re-declares every palette variable and
a value inherited from `html` never reaches a block. The eight depth colors the
bullets carry are not the setting's to change.

The rail is the page's own tree and nothing above it. Logseq renders a page's
properties as its first block, marked `pre-block` in view and while they are
being typed; that row keeps its place in the column so the content column does
not shift, and gives up its bullet and both ends of its line. The rail therefore
opens at the first bullet under the properties, which is why two selectors
suppress the upward segment: the page's first block, and the block following a
`pre-block` first block.

Because the rail paints its line behind the bullets, each row is its own
stacking context. That matters to the editor's popups: Logseq opens the `/`
command menu and its siblings inside the block being edited without a stacking
level, so the following blocks — every `.ls-block` is positioned — paint their
text over an otherwise opaque menu. The theme gives `.absolute-modal
[data-modal-name]` Logseq's `--ls-z-index-level-1`, and lifts the containing
`.ls-block` to the same level so the popup escapes its row's isolation. The lift
is on the block, which Logseq already positions, rather than on the row, which
would otherwise become the containing block everything absolutely positioned
inside it is measured from. Both levels stay below the sticky header at
`z-index: 10`.

Lifting the block carries its children with it, so the popup is still painted
over by the edited block's own subtree: the isolated row is a stacking context
that is not positioned, which orders it against the block's positioned
descendants by tree order, and Logseq's `.block-children-container` comes after
it. The theme orders that container under the row while a popup is open, off
the same `:has()` as the lift, so the block is always the stacking context
holding it. It is paint order alone — the container is positioned upstream, so
nothing moves when a popup opens.

Those popups' section headings are a second upstream assumption the theme
cannot inherit: Logseq draws `.ui__ac-group-name` at a fifth of
`--popover-foreground`, a fade that reads on its own near-black background but
disappears on this one. The theme replaces the colour rather than the alpha, so
a per-accent foreground cannot thin it again, and pays back in weight what the
shared colour costs: at Logseq's heading size, bold is what still separates a
heading from the commands under it. Size and padding remain Logseq's.

## Anno's import and the highlight page

Logseq derives a PDF's whole annotation identity from one filename. Opening
`../assets/<name>.pdf` gives its viewer the key `<name>`, which makes
`assets/<name>.edn` the highlight store and `hls__<name>` the page every
highlight is collected on; the key is that basename run through
sanitize-filename. Anno therefore names the asset after the page title the
prompt asks for, replacing each character a filename cannot hold with a space so
the name it writes is already the name Logseq would derive. The page keeps the
title exactly as typed, which leaves a `/` in it a Logseq namespace rather than
a directory.

The import is ordered and refuses rather than overwrites. The prompt resolves
the graph and rejects a name already on disk before it closes, so a title that
cannot work is corrected in the prompt instead of failing behind it; the asset
is then written before the page is created, so no page ever links a PDF that was
not written. An existing page is used as it stands and an existing link is not
repeated. `mkdir-recur`, `stat` and `writeFile` are the three host actions
involved, and `writeFile` takes the graph's repo URL, an absolute path, and the
PDF's bytes as an `ArrayBuffer`.

The host bridge reports a failure by resolving with it, not by rejecting:
`ipcMain.handle('main', ...)` catches whatever its handler throws and returns
the exception, and it names `stat` among the actions whose failure is ordinary
enough not to log. A caller that reads only whether the promise settled
therefore reads every failure as a success — a missing asset as one already in
the graph, a refused write as a completed one. Anno reads the resolved value
instead: a stat counts only when it carries a numeric `size`, and the asset is
stat-ed again after the write and must come back at the length that was sent
before a page is allowed to link it.

## Host-DOM annotation and cleanup

Each runtime owns a namespace. Passage writes `data-passage-*`, element ids
beginning `passage-`, and the `passage-dialog` style key. Anno writes
`data-anno-*`, element ids beginning `anno-`, and the `anno-dialog` style key.
Dark High Contrast writes `data-hc-*` and the `hc-hidden-properties` style key.
None reads, clears, or reuses another's annotations.

The theme and Passage perform an initial repaint and observe the host document
with `MutationObserver` because Logseq replaces rendered nodes during normal
editing and navigation, and settings changes repaint without reload. Anno
annotates nothing there and so watches nothing: its prompt is built when a
command asks for it and removed when it closes. On `beforeunload`, each package
disconnects any observer it has, removes its own nodes and attributes, clears
its own style, and settles any open prompt without writing. Tests cover initial
paint, mutations, settings, malformed settings, and cleanup.

Dark High Contrast also replaces one host gesture rather than annotating it: a
capture-phase `click` listener on the host document folds the block whose bullet
was left-clicked, in place of the navigation Logseq's own handler performs.
Capture on the document precedes React's root container, so stopping the event
there needs no patch of Logseq's; the collapse itself is
`logseq.Editor.setBlockCollapsed(uuid, { flag: 'toggle' })`, the same handlers
the fold arrow calls. The listener is registered beside the observer and removed
in the same teardown, so unloading returns the bullet to Logseq.

The theme also adds nodes of its own rather than only attributes: each pass
marks every render in `#main-content-container` that can be folded on its own
with `data-hc-collapsible`, hangs one `data-hc-collapse` button inside it, and
writes `data-hc-collapsed` on the boxes the reader has folded. The pass reads
the editor in document order, so a box is always reached before anything it
holds and only the outer of a nested pair takes a control; a marked host that no
longer answers to any kind gives its control back in the same pass, which is
what keeps the mutation observer from feeding itself. The folded state is a
`Set` in the runtime keyed by the block's UUID, the kind of content and which
one of that kind it is inside the block: nothing reaches the graph, and a
re-render of the same page finds the same boxes again. Both the press and the
click on a control are taken in the capture phase, so neither Logseq's
edit-on-click nor the bullet fold above ever sees them, and `beforeunload`
removes every control along with the attributes.

## Passage parser and local text

`packages/passage/bible.js` is a classic browser script loaded before
`index.js`. It deliberately avoids module imports or a build step and exposes
the parser/formatter surface the entry consumes.

A translation is two files under one abbreviation:
`resources/<abbreviation>.books.json`, which holds structural book and verse
metadata only, and `resources/<abbreviation>.text.json`, which holds the verse
text. Both name the translation inside, and `resources/translations.json` is the
registry that names both of them per translation and that the runtime reads at
startup to build its **Translation** dropdown: it is kilobytes where an index is
megabytes, so no verse is read to learn what is on offer.

Selecting a translation selects the pair. The manifest read is keyed to the
selection and starts again when it changes, so a reference is never resolved
against one translation's canon and filled from another's text, and a file whose
declared translation is not the selected one is refused as though absent. Every
manifest ships in the archive; the default translation's verse index ships with
them, and every other one is ignored by Git and local to a developer's checkout,
where the build may copy such a file into the already archived extracted folder
for manual testing. Verification rejects missing or unexpected ZIP members.

## Shared release infrastructure

`scripts/release-support.mjs` discovers npm workspaces from `packages/*` and
normalizes their package metadata and output paths. Each package owns the exact
list in `package.json#release.files`. `build-release.mjs` copies those canonical
sources into `dist/<package-name>/`, then adds the root `LICENSE` and the single
vendored SDK from `vendor/logseq/lsplugin.user.js` and creates the ZIP.

`verify-release.mjs` reads the archive directly and proves:

- its members equal the allowlist plus the two shared files;
- package and manifest identities agree;
- every package-owned archived byte equals its canonical source; and
- the shared license and SDK equal their root sources.

The extracted folders and ZIPs are generated outputs. Source workspaces do not
carry `LICENSE` or `lib/`; that absence is tested so the release copier remains
the only source of shared-package material.
