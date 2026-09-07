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

## Passage parser and local text

`packages/passage/bible.js` is a classic browser script loaded before
`index.js`. It deliberately avoids module imports or a build step and exposes
the parser/formatter surface the entry consumes. The shipped
`resources/bible.books.json` contains structural book and verse metadata only.

Text lives, if present, in ignored `resources/bible.text.json` or at the
absolute path in the `biblePassageText` setting. The build may copy the
package-local file into the already archived extracted folder for manual
testing. Verification rejects missing or unexpected ZIP members.

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
