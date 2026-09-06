# logseq-dark-2026

An npm-workspace monorepo for Logseq packages. Each package under `packages/`
is installable on its own: plain HTML, JavaScript, CSS, JSON and SVG, with no
dependency installation, compilation, or runtime network access.

## Packages

| Package | Directory | Description |
| --- | --- | --- |
| `logseq-dark-high-contrast-theme` | [`packages/dark-high-contrast`](packages/dark-high-contrast) | Dark High Contrast, a Logseq theme adapting VS Code's Dark High Contrast palette. |

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

## Contributing

`CLAUDE.md` and `AGENTS.md` describe the development, validation and delivery
workflow. Each package keeps its own README, changelog and release metadata.
