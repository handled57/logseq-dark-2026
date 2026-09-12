# Development guide

## Project

This repository is an npm-workspace monorepo of Logseq packages. `packages/theme-dark-high-contrast/` holds **Dark High Contrast**, a Logseq theme for classic/file graphs on desktop. It targets Logseq 0.10.15 and adapts Visual Studio Code's Dark High Contrast palette. `packages/plugin-passage/` holds **Passage** and `packages/plugin-anno/` holds **Anno**, plugins for the same target.

The root `package.json` is a private coordinator: it declares `workspaces: ["packages/*"]`, aggregates each package's scripts, and owns no sources and no dependencies. Every package is intentionally installable without dependency installation or compilation. Keep release artifacts self-contained and package-specific, and do not add runtime network access, tracking, or remote CSS imports.

## Source of truth

Paths below are relative to `packages/theme-dark-high-contrast/` unless noted.

- `theme.css` is the canonical stylesheet.
- `index.js` is the canonical entry script for property-table hiding, `data-hc-block-type` annotations, and the collapse control it hangs on every foldable render.
- `index.html` loads the entry script.
- `../../vendor/logseq/lsplugin.user.js` is the one canonical vendored Logseq SDK file. Root release tooling copies it into each archive as `lib/lsplugin.user.js`; source workspaces do not contain `lib/`.
- `package.json` and `manifest.json` define package and Marketplace metadata.
- `test/theme.test.mjs` checks package structure, workspace layout, required selectors, palette values, accessibility, and release metadata.
- `test/cascade.test.mjs` checks selector specificity against pinned Logseq CSS behavior.
- `test/properties.test.mjs` behaviorally tests `index.js` against a stub host document.
- `test/collapsible.test.mjs` drives the same entry over a stub page tree for the collapse control: which renders earn one, where it is hung, and that folding one touches nothing else.
- `../plugin-anno/index.js` is Anno's canonical runtime: the **Anno: Import PDF** command, its prompt, and the asset-naming rule that decides which page Logseq collects a PDF's highlights on. `../plugin-anno/test/package.test.mjs` checks its structure and metadata; `../plugin-anno/test/anno.test.mjs` drives that runtime against a stub host document and file bridge.
- Each package's `package.json#release.files` is its exact package-owned archive allowlist.
- Root `scripts/build-release.mjs` creates extracted packages and Marketplace ZIPs in root `dist/`; aggregate builds clean once and targeted workspace builds remove only their own outputs.
- Root `scripts/verify-release.mjs` verifies exact archive contents, metadata agreement, and byte parity with canonical sources.
- Root `test/support/` owns reusable host-document, classic-script, ZIP, and pinned-CSS test helpers; package-specific assertions remain in their workspaces.
- The repository root holds shared release inputs (`LICENSE` and `vendor/logseq/lsplugin.user.js`) as well as coordinator tooling and documentation.
- Root `README.md` is the repository and independent-installation overview;
  `CONTRIBUTING.md` owns prerequisites, commands, manual acceptance, and release
  workflow.
- `docs/architecture.md` records runtime and release invariants;
  `docs/adding-a-package.md` is the package-integration checklist; and
  `docs/migrating-theme-2.md` owns the 1.x-to-2.0.0 user migration.
- `docs/contracts/passage-v1.md` is the normative cross-package content
  contract. Package READMEs explain their own setup and behavior; do not make a
  root document the only source for package-specific use.

Read the package's `README.md` and `CHANGELOG.md` before changing public behavior. Keep both synchronized with user-visible changes.

## Design and compatibility constraints

- Unless otherwise specified, references to admonitions also include `bible_passage` blocks.
- Preserve the exact High Contrast palette constants unless the task explicitly changes the palette.
- Logseq resolves many colors through `--lx-*`, then `--ls-*`, then `--rx-*`. Theme selectors must retain enough specificity to beat Logseq's per-accent declarations.
- Keep `package.json` `effect: true`. Logseq otherwise moves the entry to the `lsp://logseq.io/` origin, preventing `index.js` from reading `parent.document`.
- Preserve classic/file-graph support. DB graphs and mobile are not advertised targets.
- Keep the main editor at the full available width on desktop viewports.
- In the main editor's page tree, every rendered block hangs its own bullet on the configured rail layout. Flat is the default: one line runs behind all bullets from the centre of the first bullet to the centre of the last, and Logseq's control column is pulled left by the indentation of its nesting level (one rule per level, `29px` each) plus `--hc-rail-offset`, which defaults to `.8em`. Connect the dots uses the same depth compensation to align all bullets in that column; it draws 2px vertical rails only between consecutive visible blocks at the same depth. Both halves of a depth change are hidden, so expanded descendants interrupt a sibling rail. No curves or horizontal arms connect nesting columns. Every visible segment begins and ends at a bullet. The runtime skips front matter, embedded blocks and hidden descendants, and keeps each content root independent. It adds no child-group padding. Both layouts hand the control column's negative margin back on its right, so the content hierarchy never moves.
- A bullet sits `--hc-rail-bullet-y` below the top of its row, on the middle of the block's first line: `12px` for ordinary prose, `1.75em` of the heading's own size for a heading (view and editor), and further for the box a quote, passage, admonition, code block or table opens with. The native fold arrow beside a rail bullet is hidden and disabled while its 22px box remains in layout to preserve the bullet column; the bullet itself folds the block. An ordered list's number and both ends of the line are measured from the same variable. Hovering a block preserves its bullet shape, size and color. The rail's arithmetic is derived from pinned upstream declarations in `test/cascade.test.mjs`.
- The rail reaches `#main-content-container .page-blocks-inner .content:not(.doc-mode)` only, excludes blocks inside a `.block-content-wrapper` (embeds, queries, references), and steps aside for `main.ls-fold-button-on-right` and document mode, both of which re-measure that indentation. Sidebars, whiteboards, and dialogs render outside the scope.
- Every bullet, in both layouts, takes the colour of its own depth: `--hc-rail-depth-1` to `--hc-rail-depth-8` in brightness order, amber at the top level, repeating below the eighth. Bullet colour is decided by nesting depth alone — heading status decides nothing about colour, and whether Logseq marks a block `haschild="true"` decides only whether a ring is drawn around it (see below), not its colour. The colour is declared on the block's own control column, so a child's bullet never takes its parent's.
- In Connect the dots, every bullet and its rail take the block's depth colour, so both endpoints match. In Flat, the rail's line takes no depth colour. Every block paints its stretch in `--hc-rail-default-color`, the rail line and the theme's one configurable colour: it defaults to `--vscode-hc-border`, and `index.js` writes the **Rail color** setting over it inline on the host's `body` — the palette's selector list declares every variable on `:root body` too, so a value set on the root element never reaches a block. The eight depth colours the bullets carry are not the setting's to change.
- Every bullet on the rail uses a 10px dot inside Logseq's transparent 16px control, regardless of heading size or folded state. Only its position follows the first line. Collapsed parents have a crisp 2px outer ring with a 2px gap; expanded parents use a hollow 2px ring with a 13px outer diameter; an opaque black backing masks the rail inside the ring and gap. There is no glow, including on hover. Fill is declared on the block's own control column; upstream's important hover fill is answered from the same solid fill variable.
- Page properties, which Logseq renders as a `pre-block` first block, carry neither a bullet nor a rail segment in view or while being edited. The rail opens at the first content block below them. Empty blocks interrupt the rail and carry no segment in either layout.
- Untyped bullets are always visible for ordinary prose blocks. Structural and special blocks, including `src`, `center`, and `verse`, are marked with `data-hc-hide-bullet` and remain bulletless in every interaction state *outside the rail*; on the rail they show a bullet like any other block. Child hover never reveals ancestor bullets. Nested connector/thread lines remain transparent — the rail replaces them.
- Every render in the main editor that can be read on its own — a named admonition, a passage, a table, a quote, a code block, a math block, a piece of media, a block or page embed — carries one `data-hc-collapse` button, hung inside the outermost box of a nested pair and last among its children. Folding is display-only: no block is collapsed, no descendant is unrendered, and nothing is written to the graph. The state lives in the runtime, keyed by block UUID, kind and ordinal, so every box opens expanded and a re-render finds it again. A folded box hides what it holds rather than removing it from the layout, and a block being edited shows the whole of its content.
- Keep proportional typography for notes and monospace limited to code and keyboard-oriented UI.
- Property rules are case-insensitive `key: value` pairs separated by commas, semicolons, or newlines. Matching any pair hides the table. Bare keys and `key: *` are wildcards. Configuration order determines the `data-hc-block-type` precedence.
- Do not claim a visual behavior is confirmed from source or automated tests alone. Render in Logseq or an appropriate browser fixture when visual acceptance matters, and state clearly when that check was not possible.

## Change workflow

Automate the complete lifecycle when the user asks for an implementation and repository delivery:

1. Start from a clean, current `main`. Inspect and preserve unrelated user changes.
2. Create a GitHub issue describing the change and acceptance criteria, and apply appropriate labels.
3. Create a topic branch and formally link it to the related issue in GitHub's Development section; a matching branch name, commit reference, or issue comment is not sufficient. Do not develop directly on `main`.
4. Make the smallest coherent change. For a bug, search for other occurrences of the same root cause and fix in-scope instances.
5. Add or update regression tests for changed behavior.
6. Integrate the latest `origin/main`. Resolve conflicts by understanding both sides; never discard user or upstream work automatically.
7. Run the full validation gate.
8. Update documentation and the changelog. When the change is user-visible, also bump the package's `package.json` version in the same branch and close its `## Unreleased` section into a dated `## X.Y.Z - YYYY-MM-DD` heading, so the merge commit is a releasable commit.
9. Push the topic branch to `origin` and stop there. Leave the branch unmerged and the issue open, and report what the user should test.

## Delivery handoff

Completed work waits for the user's testing. Do not merge a topic branch into `main`, tag a release, or close an issue until the user says the change is good.

A short confirmation such as `continue`, `close`, `done`, `ship it`, `looks good`, or any similar approval means the change passed their testing. On that signal, finish delivery: merge the topic branch into `main`, tag the package release as described below, push commits and tags to `origin`, and close the issue with the validating commit or release.

## Releases

Every user-visible change ships as a release. Finished work must not sit under
`## Unreleased`: the version bump belongs in the topic branch (step 8), and the
tag goes on the merge commit once the user approves. Semantic versioning
decides the number — a bug fix is a patch, a feature is a minor, a breaking
change is a major.

Theme, Passage and Anno versions and release tags are independent, and each
package is tagged in its own namespace: `theme-vX.Y.Z`, `passage-vX.Y.Z` and
`anno-vX.Y.Z`. Pushing
such a tag runs `.github/workflows/publish.yml`, which calls
`scripts/select-release.mjs` to select exactly one workspace, then builds and
attaches only that package's archive. Selection asserts that the tag version,
that package's `package.json` version, and the newest versioned heading in its
`CHANGELOG.md` all agree, so confirm those three before tagging:

```sh
node scripts/select-release.mjs theme-vX.Y.Z
```

A legacy `vX.Y.Z` tag publishes nothing; the workflow does not trigger on it.
GitHub release automation does not submit a package to the Logseq Marketplace,
which remains a separate maintainer action.

Do not create a release tag for documentation-only or internal maintenance
unless the user explicitly requests a release. Never rewrite shared history or
use destructive Git commands to resolve conflicts.

## Validation

Run the complete local gate before merging or releasing:

```sh
npm run check
git diff --check
```

At the root, `npm run check` runs every workspace's tests, builds each release archive, and verifies it. Target one package with npm's workspace flag:

```sh
npm run check --workspace packages/theme-dark-high-contrast
```

When an installed Logseq 0.10.15 stylesheet is available, also validate the pinned upstream selectors:

```sh
LOGSEQ_CSS=/path/to/Logseq/resources/app/css/style.css npm test
```

For CSS changes, inspect the relevant selector cascade and test both the default state and interactive states such as hover, focus, selection, and narrow desktop layouts. For `index.js` changes, test initial rendering, repainting, settings changes, malformed/empty settings, and cleanup of previously written attributes.

Before handing work back for testing, confirm:

- the worktree contains no unintended generated or unrelated files;
- the topic branch contains the intended commit and is pushed to `origin`;
- every related GitHub issue has appropriate labels and is still open;
- every topic branch reads back as formally linked to its related GitHub issue.

After the user approves and you complete the merge, confirm:

- `main` contains the intended commit;
- `origin/main` and the release tag point to the expected commits;
- the Release workflow succeeded and its GitHub release carries that package's
  archive;
- the GitHub issue is closed only after delivery succeeds.
