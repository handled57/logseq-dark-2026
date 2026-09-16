# Changelog

All notable changes to this package are documented here.

## 0.2.0 - 2026-09-15

- A rendered table can now be filtered one column at a time from its own
  header. Clicking a column name — or pressing Enter or Space on it — opens a
  filter field in that header cell and focuses it; typing hides every row whose
  cell in that column does not match, by the same case-insensitive substring
  rule the full table search uses.
- The field is laid over the header cell rather than put in its place, so
  opening and closing one never reflows the table, and the markup Logseq
  rendered there — a link, code, emphasis — is never moved or rebuilt.
- A field that closes commits what it holds: the filter is shown in small text
  under the column name, and clicking that text drops the filter and restores
  the rows it hid. Clicking the column name again reopens the field holding the
  committed text, selected, so one keystroke refines or discards it. Escape
  restores the last committed filter, Enter commits what the field holds and
  leaves focus on the header, and a field that closes empty commits nothing.
- Filters on several columns combine with each other and with the full table
  search: a row is shown only when it satisfies all of them, whatever order
  they were applied in. Turning **Full table search** off clears the search
  field alone — the reader's column filters are their own and stay.
- Column filters live beside the search state in the runtime, keyed by block
  UUID, ordinal and column index. Every table opens unfiltered, a re-render
  finds its filters again, and nothing is written to the graph.
- The settings panel now says what the table under it offers. Logseq renders a
  header row only for a Markdown table that declares a header separator row; a
  table that renders none offers full table search alone, and the panel says
  so rather than leaving a reader clicking at nothing.
- Cells are matched to columns by index. A row with no cell at that index —
  a ragged or spanned row, which Markdown cannot write but pasted HTML can —
  is treated as not matching.
- Fixed: the full table search read a row's own `textContent`, which a browser
  concatenates from the cells with nothing between them, so `ada lovelace`
  matched nothing in a row rendering `| Ada | Lovelace |`. A row now reads as
  its cells with a space between them.

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
