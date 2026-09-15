# Able Table for Logseq

Able Table makes a rendered Markdown table searchable in place, without
editing the block, restructuring the Markdown, or converting the table to a
query. Everything it does is display-only: no filter, no search string, and no
toggle state is ever written to the graph.

## Searching a table

Every Markdown table in the main editor carries a small **⋯** control in its
top-right corner. Press it — with the pointer, or with Enter or Space from the
keyboard — and a panel opens beneath it holding one toggle:

**Full table search** puts a find-as-you-type field across the top of the
table and focuses it. Type, and every row that does not match disappears as
you go; backspace, and the rows come back.

- Matching is a **case-insensitive substring test** over the row's rendered
  text, with runs of whitespace collapsed to one space. `ada` finds
  `Ada Lovelace`. There is no tokenising, no fuzzy matching and no regular
  expression support — one predictable rule is the point.
- The **header row is never hidden**, so a table with nothing matching still
  reads as a table rather than as an error.
- The field says how many rows match out of how many the table holds, and
  announces it politely to a screen reader as the count changes.
- The **×** beside the field empties it and brings every row back. It is there
  only while the field holds something.
- Turning **Full table search** off takes the field away, clears it, and
  restores every row.

Dismiss the panel with Escape, with a click anywhere outside it, or by
pressing the control again. Escape and a second press hand focus back to the
control; a click outside leaves focus wherever you clicked it.

## What it never does

- **Nothing reaches the graph.** No block content, property or Markdown change
  comes from opening the panel, toggling, typing, clearing, or unloading.
- **No row is removed, reordered or rewritten.** A hidden row is marked
  `data-able-filtered` and hidden by the plugin's own registered style;
  dropping the mark is all it takes to restore it.
- **No block is collapsed and no bullet is folded.** Every control answers
  pointer and key events in the capture phase, before Logseq's own handlers
  see them, so nothing you do to a table opens its block for editing or fires
  a shortcut.
- Editing a block replaces its render, which takes the controls with it; the
  table comes back searched when the render comes back.

## Where it works

Scope is `#main-content-container div.table-wrapper > table`: Markdown tables
in the main editor. Query-result tables, the All Pages table, and sidebar,
whiteboard and dialog renders are left exactly as Logseq draws them.

## Alongside Dark High Contrast

[Dark High Contrast](../theme-dark-high-contrast/) hangs its own collapse
control in the same corner. Able Table's control steps left of it when it is
there and takes the corner when it is not, in CSS alone — nothing is measured,
and neither package requires or modifies the other. The
[table controls v1 hook](../../docs/contracts/table-controls-v1.md) is the
whole of what they share, and both sides pin it in their own tests.

With no theme installed, Able Table draws and places its own control.

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

`test/package.test.mjs` covers the package's structure, its metadata, and the
one-directional theme hook; `test/able-table.test.mjs` drives the entry script
against a stub host document, from initial paint through the panel, the
search field, re-render and teardown.

## Attribution

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the vendored Logseq
SDK.

## License

MIT. Release tooling copies the repository root [`LICENSE`](../../LICENSE) into every staged package and archive.
