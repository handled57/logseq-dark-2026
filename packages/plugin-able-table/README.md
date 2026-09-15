# Able Table for Logseq

Able Table will make a rendered Markdown table searchable and filterable in
place, without editing the block, restructuring the Markdown, or converting
the table to a query. Everything it does is display-only: no filter, no
search string, and no toggle state is ever written to the graph.

**This release is a scaffold.** It installs, runs its lifecycle, and marks
every rendered table so a later render can find its own state again — but it
changes nothing a reader sees. Search and column filtering land in later
releases.

## What this release does

- Registers a style under its own `able-table` key.
- Observes the host document for the re-renders Logseq performs during
  ordinary editing and navigation, coalesced to one pass per animation frame.
- On each pass, finds every table Logseq renders in the main editor
  (`#main-content-container div.table-wrapper > table`), and marks its
  wrapper with `data-able-table`, keyed by the table's block UUID and its
  ordinal position within that block. A table the pass no longer finds — the
  block was deleted, or its content no longer renders a table — releases its
  mark.
- Removes that mark, and nothing else, when the plugin unloads.

No control is drawn, no setting is offered, and no table is searched or
filtered yet.

## Compatibility

Able Table targets **Logseq 0.10.15 classic/file graphs on desktop**.

- DB graphs are not supported in this release.
- Mobile is not an advertised target.
- The plugin declares `effect: true`, which keeps its entry on the host's own
  origin. Without it, `parent.document` — where every rendered table lives —
  is out of reach.
- Able Table works with any theme, or none, and alongside Dark High Contrast,
  Passage and Anno with no attribute, style-key, id, or settings collision:
  everything it writes is namespaced `data-able-*`.

## Load the repository as an unpacked plugin

1. Clone or download this repository.
2. In Logseq, enable **Settings → Advanced → Developer mode**.
3. Run `npm run build` from the repository root.
4. Open **Plugins**, choose **Load unpacked plugin**, and select
   `dist/logseq-able-table/`.

No dependency installation or compilation is needed to use the plugin.

## Development

```sh
npm test --workspace packages/plugin-able-table            # the package's own suites
npm run check --workspace packages/plugin-able-table       # test, build and verify the ZIP
```

`test/package.test.mjs` covers the package's structure and metadata;
`test/able-table.test.mjs` drives the entry script against a stub host
document, from initial paint through re-render and teardown.

## Attribution

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the vendored Logseq
SDK.

## License

MIT. Release tooling copies the repository root [`LICENSE`](../../LICENSE) into every staged package and archive.
