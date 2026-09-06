# logseq-dark-2026

An npm-workspace monorepo for Logseq packages. Each package under `packages/`
is installable on its own: plain HTML, JavaScript, CSS, JSON and SVG, with no
dependency installation, compilation, or runtime network access.

## Packages

| Package | Directory | Description |
| --- | --- | --- |
| `logseq-dark-high-contrast-theme` | [`packages/dark-high-contrast`](packages/dark-high-contrast) | Dark High Contrast, a Logseq theme adapting VS Code's Dark High Contrast palette. |
| `logseq-passage` | [`packages/passage`](packages/passage) | Passage, a plugin that inserts a Bible passage into a block. |

Install either on its own. They are not dependencies of each other: the theme
styles passage blocks whoever wrote them, and Passage writes markup that renders
with any theme, or none. What they share is a content shape, published as
[`docs/contracts/passage-v1.md`](docs/contracts/passage-v1.md) and tested from
both sides against the same fixtures.

## Commands

Root scripts aggregate every workspace that defines them:

```sh
npm test            # run all workspace test suites
npm run build       # build every workspace release archive
npm run check       # test, build and verify every workspace
```

Target a single package with npm's workspace flag:

```sh
npm run check --workspace packages/dark-high-contrast
```

## Documentation

- [`docs/contracts/passage-v1.md`](docs/contracts/passage-v1.md) — the passage
  block shape the theme and Passage agree on.

## Contributing

`CLAUDE.md` and `AGENTS.md` describe the development, validation and delivery
workflow. Each package keeps its own README, changelog and release metadata.
