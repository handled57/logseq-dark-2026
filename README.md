# logseq-dark-2026

An npm-workspace monorepo for three independently installable Logseq packages.
All ship as plain HTML, JavaScript, CSS, JSON, and SVG: no production
dependencies, compilation, remote imports, or runtime network access.

## Packages

| Marketplace package | npm workspace | Version | Install it when you want |
| --- | --- | --- | --- |
| **Dark High Contrast** | [`packages/dark-high-contrast`](packages/dark-high-contrast) | `2.1.0` | A pure-black, accessible theme for Logseq classic/file graphs. |
| **Passage** | [`packages/passage`](packages/passage) | `0.2.0` | `/Passage` and `< Passage` commands that write canonical Bible passage blocks from a local text index. |
| **Anno** | [`packages/anno`](packages/anno) | `0.1.0` | An **Anno: Import PDF** command that imports a PDF and opens the page its highlights are collected on. |

Install any one package by itself or install them together. None of them calls
another. Dark High Contrast styles any
block that follows the [Passage v1 content contract](docs/contracts/passage-v1.md);
Passage writes that ordinary Logseq markup readably with any theme, or none.

Passage uses a local `bible.text.json` when one is available. Its release
contains the book, chapter, and verse-count manifest needed to validate and
canonicalize a reference. To insert text, build or supply a local index as
described in the [Passage setup guide](packages/passage/README.md#passage-text).

Anno needs nothing beyond an open file graph. It imports a PDF into that graph's
`assets/` folder under the page title you give it, which is what puts Logseq's
own highlights for that PDF on a page of the same name; see the
[Anno guide](packages/anno/README.md#what-the-import-does).

## Install

When the packages are available in the Logseq Marketplace, install each one
separately under **Plugins → Marketplace**: Dark High Contrast is a theme,
Passage and Anno are plugins. Selecting the theme does not install a command.

For development or pre-Marketplace testing, build the repository and load the
package's extracted folder—not its source workspace—from Logseq's **Load
unpacked plugin** dialog:

```sh
npm run build
# load dist/logseq-dark-high-contrast-theme/, dist/logseq-passage/ and/or dist/logseq-anno/
```

The extracted folder contains the shared license and vendored Logseq SDK that
are intentionally absent from each source workspace. See
[CONTRIBUTING.md](CONTRIBUTING.md#manual-logseq-acceptance) for the complete
unpacked-install and acceptance procedure.

## Commands

Use Node.js 22 and an npm version that supports workspaces. The root coordinator
owns no runtime source or dependencies.

```sh
npm test             # root infrastructure tests, then every workspace's tests
npm run build        # clean dist/ once and build every extracted package and ZIP
npm run check        # test, build, and verify every release archive
git diff --check     # reject whitespace errors
```

Target one package with npm's workspace flag. Its build removes only its own
outputs from `dist/`:

```sh
npm test --workspace packages/passage
npm run check --workspace packages/dark-high-contrast
```

Every ZIP has an exact package-owned allowlist plus the root `LICENSE` and
`vendor/logseq/lsplugin.user.js`. Verification checks that list, metadata, and
byte parity with canonical source files.

## Repository map

| Owner | What belongs there |
| --- | --- |
| Root | Workspace coordination, shared release tooling and tests, the license, vendored SDK, CI, and repository-wide documentation. |
| `packages/dark-high-contrast/` | Theme CSS, property/classification runtime, theme metadata, tests, screenshots, changelog, and package README. |
| `packages/passage/` | Passage command, reference parser, text-index manifest, plugin metadata, tests, changelog, and package README. |
| `packages/anno/` | Anno's PDF import command, its prompt, plugin metadata, tests, changelog, and package README. |
| `docs/contracts/` | Versioned, runtime-neutral agreements that more than one package consumes. |
| `test/support/` | Reusable test fixtures; package-specific assertions stay in their workspace. |
| `scripts/` | Workspace discovery and release construction/verification shared by all packages. |

## Documentation

- [Contributing](CONTRIBUTING.md) — prerequisites, commands, unpacked testing,
  releases, and manual acceptance.
- [Architecture](docs/architecture.md) — runtime boundaries, host-DOM ownership,
  palette and rail constraints, observers, the content contract, and packaging.
- [Add a package](docs/adding-a-package.md) — the complete package checklist.
- [Migrate Dark High Contrast 1.x to 2.0.0](docs/migrating-theme-2.md) — retained
  settings and content, the separate Passage install, and local text-index path.
- [Passage v1 content contract](docs/contracts/passage-v1.md) — the stable block
  shape the theme and Passage test independently.

GitHub Actions currently validates pushes and pull requests and creates GitHub
release assets for configured tags. It does not submit packages to the Logseq
Marketplace.
