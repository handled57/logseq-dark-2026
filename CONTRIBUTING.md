# Contributing

## Prerequisites

- Node.js 22 and npm with workspace support.
- `zip` on macOS/Linux, or PowerShell's `Compress-Archive` on Windows. The build
  tries the platform-native choice first and the other supported archiver as a
  fallback.
- Git and, for repository delivery, GitHub CLI authentication.
- Logseq 0.10.15 desktop with a classic/file graph for manual acceptance.

Run `npm install` after cloning to validate the lockfile and prepare npm's
workspace view. The shipped packages have no production dependencies and do
not need installation or compilation at runtime.

## Ownership and sources of truth

The root is a private coordinator. Shared inputs live at the root; product
behavior lives in one package:

- Theme behavior: `packages/dark-high-contrast/theme.css` and `index.js`.
- Passage behavior: `packages/passage/index.js` and classic script
  `bible.js`; its distributable structural manifest is
  `resources/bible.books.json`.
- Package identity and exact archive allowlist: each package's `package.json`,
  cross-checked with its `manifest.json`.
- Shared SDK: `vendor/logseq/lsplugin.user.js`; never copy it into a source
  workspace.
- Shared release logic and test fixtures: `scripts/` and `test/support/`.
- Cross-package content semantics: `docs/contracts/passage-v1.md`.

Keep package-specific tests, README, changelog, icons, and notices in that
package. Update public documentation, changelog, and version metadata with
user-visible changes, which are released rather than accumulated; see
[Versions and releases](#versions-and-releases).

## Commands

Run the complete gate from the repository root before handoff:

```sh
npm run check
git diff --check
```

`npm run check` runs root infrastructure tests and all workspace tests, cleans
and builds all release outputs, and verifies every ZIP. Useful narrower commands
are:

```sh
npm test
npm run build
npm run verify:release
npm test --workspace packages/passage
npm run check --workspace packages/dark-high-contrast
```

A targeted build runs in the selected workspace context and removes only that
package's extracted directory and ZIP. An aggregate build owns the one full
`dist/` cleanup.

For theme cascade checks against the installed application stylesheet:

```sh
LOGSEQ_CSS=/path/to/Logseq/resources/app/css/style.css npm test
```

Without `LOGSEQ_CSS`, tests use the pinned upstream declarations in
`test/support/pinned-css.mjs`. This is useful regression coverage, not a claim
that Logseq rendered correctly.

## Manual Logseq acceptance

1. Run `npm run check`.
2. In Logseq, enable **Settings → Advanced → Developer mode**.
3. Open **Plugins → Load unpacked plugin** and choose the relevant extracted
   folder under `dist/`, not `packages/`.
4. Test Dark High Contrast by itself, Passage by itself, and both together when
   a change can affect their contract or host-DOM coexistence.
5. Restart or reload the package and check teardown/reload behavior. Exercise
   hover, focus, selection, narrow desktop layouts, and settings affected by the
   change.
6. Confirm the ZIP itself installs without `npm install`, compilation, a sibling
   workspace, or network access.

The built `dist/logseq-passage/` may contain a developer's ignored local
`resources/bible.text.json` for manual testing. The ZIP is created before that
local file is copied and archive verification rejects any licensed verse-text
file or unexpected archive member.

## Repository delivery

Changes follow the issue and linked-branch workflow:

1. Begin from the preceding clean, green integration point and inspect unrelated
   work before editing.
2. Create or use the scoped issue, label it, and create a topic branch that is
   formally attached in the issue's Development section.
3. Make the smallest coherent change and add regression tests.
4. Integrate the latest appropriate upstream branch without discarding either
   side, then run the complete gate.
5. Push the topic branch and leave the issue open for user testing. Do not merge,
   tag, or close it before approval.
6. After approval, merge into the integration branch, push, tag the release, and
   only then close the issue.

## Versions and releases

Theme and Passage versions are independent. A release changes only the selected
package's `package.json`, `manifest.json` when applicable, and changelog, then
builds and verifies that package's archive. The package-scoped tag names are
`theme-vX.Y.Z` and `passage-vX.Y.Z`. A tag must match both the selected
workspace's package version and the newest version in its changelog. The release
job runs the full repository gate, rebuilds and verifies the selected workspace,
and attaches only that workspace's ZIP to its GitHub release. Historical `v*`
tags remain in Git history but do not trigger the independent release workflow.

Every user-visible change to a package is released. Bump that package's version
in the topic branch alongside the change, so its changelog entry is a dated
version heading rather than an `Unreleased` one and the merge commit is
releasable; a fix is a patch, a feature a minor, a breaking change a major.
Shared release-tool changes do not require either package version to change.
Increment a package only when releasing that package, put the same version in
the newest changelog entry, merge the change, complete manual Logseq acceptance,
and then create its package-scoped tag. CI is responsible only for validation
and the GitHub release artifact. It does not perform Marketplace submission.
Publishing or updating a Marketplace listing remains a separate, deliberate
maintainer action.
