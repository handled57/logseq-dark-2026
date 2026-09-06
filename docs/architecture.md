# Architecture

## Package boundaries

This repository contains two runtimes, not one application split across
folders. Dark High Contrast and Passage have separate Logseq identities,
settings, entry scripts, metadata, versions, archives, and lifecycles. Neither
imports the other or relies on sibling-package files.

Their only product-level agreement is the versioned
[Passage v1 content contract](contracts/passage-v1.md). Passage writes ordinary
block source; the theme independently reads that source and styles the render.
The shared fixtures in the contract are driven by tests in both workspaces.

## Host origin and `effect: true`

Both packages inspect or augment Logseq's host document. Logseq 0.10.15 moves a
side-effect-free plugin entry to the `lsp://logseq.io/` origin, where browser
same-origin rules prevent access to `parent.document`. Consequently both
package and manifest metadata retain `effect: true`. This is a runtime
capability decision, not release-tool boilerplate.

Passage needs host access because Logseq offers no plugin API for the `<` picker;
it inserts its namespaced menu entry while that picker exists. The theme needs
host access to classify rendered blocks and to hide only configured property
tables. A future package that does not need host access should decide `effect`
from its own requirements rather than copying this setting automatically.

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

## Host-DOM annotation and cleanup

Each runtime owns a namespace. Passage writes `data-passage-*`, element ids
beginning `passage-`, and the `passage-dialog` style key. Dark High Contrast
writes `data-hc-*` and the `hc-hidden-properties` style key. Neither reads,
clears, or reuses the other's annotations.

Each entry script performs an initial repaint and observes the host document
with `MutationObserver` because Logseq replaces rendered nodes during normal
editing and navigation. Settings changes repaint without reload. On
`beforeunload`, each package disconnects its observer, removes its own nodes and
attributes, clears its own style, and settles any open prompt without writing.
Tests cover initial paint, mutations, settings, malformed settings, and cleanup.

## Passage parser and local text

`packages/passage/bible.js` is a classic browser script loaded before
`index.js`. It deliberately avoids module imports or a build step and exposes
the parser/formatter surface the entry consumes. The shipped
`resources/bible.books.json` contains structural book and verse metadata only.

Licensed text lives, if present, in ignored `resources/bible.text.json` or at
the absolute path in the `biblePassageText` setting. The build may copy the
package-local file into the already archived extracted folder for manual
testing; it is never in the release allowlist. Verification rejects missing or
unexpected ZIP members, which prevents that local text from entering an
archive.

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
