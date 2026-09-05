# Development guide

## Project

This repository packages **Dark High Contrast**, a Logseq theme for classic/file graphs on desktop. It targets Logseq 0.10.15 and adapts Visual Studio Code's Dark High Contrast palette.

The package is intentionally installable without dependency installation or compilation. Keep release artifacts self-contained and do not add runtime network access, tracking, or remote CSS imports.

## Source of truth

- `theme.css` is the canonical stylesheet.
- `index.js` is the canonical entry script for property-table hiding and `data-hc-block-type` annotations.
- `index.html` loads the entry script.
- `lib/lsplugin.user.js` is a vendored Logseq SDK file. Do not edit it as application source.
- `package.json` and `manifest.json` define package and Marketplace metadata.
- `test/theme.test.mjs` checks package structure, required selectors, palette values, accessibility, and release metadata.
- `test/cascade.test.mjs` checks selector specificity against pinned Logseq CSS behavior.
- `test/properties.test.mjs` behaviorally tests `index.js` against a stub host document.
- `scripts/build-release.mjs` creates the Marketplace ZIP in `dist/`.
- `scripts/verify-release.mjs` verifies the ZIP contents and metadata.

Read `README.md` and `CHANGELOG.md` before changing public behavior. Keep both synchronized with user-visible changes.

## Design and compatibility constraints

- Preserve the exact High Contrast palette constants unless the task explicitly changes the palette.
- Logseq resolves many colors through `--lx-*`, then `--ls-*`, then `--rx-*`. Theme selectors must retain enough specificity to beat Logseq's per-accent declarations.
- Keep `package.json` `effect: true`. Logseq otherwise moves the entry to the `lsp://logseq.io/` origin, preventing `index.js` from reading `parent.document`.
- Preserve classic/file-graph support. DB graphs and mobile are not advertised targets.
- Preserve the full-width route while keeping the intentional 80% desktop editor width for ordinary pages.
- Untyped bullets are always visible for ordinary prose blocks. Structural and special blocks, including `src`, `center`, and `verse`, are marked with `data-hc-hide-bullet` and remain bulletless in every interaction state; child hover never reveals ancestor bullets. Nested connector/thread lines remain transparent.
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
8. Update documentation, changelog, and version metadata when the change is user-visible or released.
9. Push the topic branch to `origin` and stop there. Leave the branch unmerged and the issue open, and report what the user should test.

## Delivery handoff

Completed work waits for the user's testing. Do not merge a topic branch into `main`, tag a release, or close an issue until the user says the change is good.

A short confirmation such as `continue`, `close`, `done`, `ship it`, `looks good`, or any similar approval means the change passed their testing. On that signal, finish delivery: merge the topic branch into `main`, tag a release when appropriate, push commits and tags to `origin`, and close the issue with the validating commit or release.

Do not create a release tag for documentation-only or unreleased maintenance unless the user explicitly requests a release. Never rewrite shared history or use destructive Git commands to resolve conflicts.

## Validation

Run the complete local gate before merging or releasing:

```sh
npm run check
git diff --check
```

`npm run check` runs all tests, builds the release archive, and verifies it. When an installed Logseq 0.10.15 stylesheet is available, also validate the pinned upstream selectors:

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
- `origin/main` and any requested tags point to the expected commits;
- the GitHub issue is closed only after delivery succeeds.
