# Changelog

All notable changes to this package are documented here.

## 0.1.0 - 2026-09-14

- First release. Every Markdown table rendered in the main editor of a
  classic/file graph carries one settings control in its top-right corner,
  and behind it a **Full table search** toggle.
- Turning the toggle on inserts a full-width find-as-you-type field above the
  table and focuses it. Typing hides every body row whose rendered text does
  not contain what was typed; clearing the field restores them. Matching is a
  case-insensitive substring test with runs of whitespace collapsed to one
  space, and the header row is never hidden.
- The field carries a clear affordance, present only while it holds text,
  which empties it, restores every row and returns focus to the field. A
  polite live region reports how many rows match out of how many the table
  holds, and says so when none do.
- Rows are hidden, never removed, reordered or rewritten. No block is
  collapsed, and nothing — the toggle, the search string, or anything else —
  is written to the graph.
- The settings control sits beside Dark High Contrast's collapse control
  rather than over it, in CSS alone and with no theme required. This is a
  versioned, one-directional read-only hook; see
  [`docs/contracts/table-controls-v1.md`](../../docs/contracts/table-controls-v1.md).
- The panel and the field are rendered outside `div.table-wrapper`, which is
  an `overflow: auto` scroller, so the table's own horizontal scrolling never
  clips or moves either of them.
- Every control answers pointer and key events in the capture phase, so no
  interaction opens the block for editing, folds a bullet, or fires a Logseq
  shortcut.
- Scaffolded the `packages/plugin-able-table/` workspace and its release
  wiring: package and Marketplace metadata, the `able-table-v*` release tag
  namespace, and archive verification.
- `index.js` owns the plugin's lifecycle: it registers a style under the
  `able-table` key, observes the host document for re-renders, and on each
  pass marks every rendered table in the main editor with `data-able-table`,
  keyed by its block's UUID and its ordinal within that block, so a re-render
  finds its own toggle state and search string again. A table the pass no
  longer finds gives back its control, its field and its marks. Unloading
  disconnects the observer, removes every injected node, and clears every
  `data-able-*` attribute.
