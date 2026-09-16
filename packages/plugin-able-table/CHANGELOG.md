# Changelog

All notable changes to this package are documented here.

## 0.4.0 - 2026-09-16

- A table's settings are now **sticky**. Both panel switches, the full table
  search text, the sorted column and its direction, and every committed column
  filter survive a reload and a restart of Logseq, so a table you tune once is
  still tuned the next time you open the graph. What is not kept is the
  transient half — whether the panel was open, which field was mid-edit and
  which column's menu was down — so a table you return to is set the way you
  set it, without any of its menus waiting for you.
- **None of it goes into your graph.** Able Table writes this to its own
  settings file in Logseq's configuration directory, beside Logseq's own
  preferences, and still changes no Markdown, no block and no property. A graph
  synced to another machine carries none of it. Settings are held per graph,
  per block and per table within that block, so two tables never share them and
  the same block in two graphs never collides — and a table left at its
  defaults is not written down at all.
- A table that has changed shape since it was last opened degrades the way an
  edit already does: a sorted column that is gone opens in the order Logseq
  rendered it, and a filtered column that is gone drops that one filter. A
  settings file that is unreadable, or hand-edited into a shape Able Table does
  not recognise, is treated as absent and the table opens at its defaults.
- Unloading the plugin still clears every `data-able-*` mark, removes every
  control and disconnects the observer — it just no longer takes what your
  tables were set to with it, since an ordinary reload unloads and reloads
  every plugin.
- **Fixed:** a committed filter on a column that stopped being rendered — a
  block edited to drop a column — was kept and matched against a cell that was
  no longer there, hiding every row in the table. That filter is now dropped on
  its own, and the rest of the table's settings are left standing.
- The full table search field's hint is now **Find in table** rather than
  **Find in table 1**: the number told you nothing you could not see. Its
  `aria-label` still names the table, because a screen reader meets the field
  with nothing around it.
- The column menu is reordered and reads **Sort A-Z**, **Sort Z-A**, a rule,
  **Find in column**, and — only while that column has one — **Clear filter**.
  How the table is ordered comes first because it is what every column is
  asked and costs nothing to undo; **Search column** is renamed **Find in
  column**, matching the field above the table.

## 0.3.0 - 2026-09-16

- A rendered table can now be **sorted by any one of its columns**. The menu
  behind a column's control holds **Sort A-Z** and **Sort Z-A**, which order
  the whole table by that column in place. Values are compared by the reader's
  own locale collation, case- and accent-insensitively — the way the search
  matches — with runs of digits read as numbers, so `Item 2` comes before
  `Item 10` and a column of numbers sorts as numbers. Rows that read the same
  in the sorted column keep the order Logseq rendered them in, so sorting one
  column never shuffles what the reader could already see in the others.
- A table is sorted by one column at a time: sorting by another replaces the
  sort, and pressing the direction that is already on drops it. The sorted
  column's control draws an arrow in place of its funnel, its header carries
  `aria-sort`, and the direction that is on is ticked in the menu as a radio.
- Sorting is display-only, like everything else here. It moves the rows Logseq
  rendered, within the group it rendered them in, and stamps each one with the
  position it arrived in before the first move — so dropping the sort, turning
  the columns switch off, losing the sorted column or unloading the plugin
  hands every row back where it was and takes the stamp with it. Nothing is
  written to the graph: the Markdown behind a sorted table still holds its rows
  in the order they were typed, and the next load opens it unsorted.
- The settings panel's second switch is now called **Columns** rather than
  **Column menus**, because the menu it turns on does more than search.

## 0.2.0 - 2026-09-16

- A rendered table can now be filtered one column at a time. The settings panel
  holds a second switch, **Column menus**; turn it on and every column header
  takes a filter control inside the cell's right-hand divider, drawn at full
  strength in cyan so it reads as something to press rather than as part of the
  column name, with a menu of its own behind it. It is that colour under every
  theme rather than the theme's own accent, and is taken down to a deeper cyan
  on a light host, where the brighter one would be lost. It fills the strip the
  header reserves for it, so being legible costs the table no width it had not
  already given up. It is set on the line the column name is set on, and stays
  there when that name wraps or takes a filter underneath it: a header row with
  column menus on opens its names at the top of the row rather than centring
  them, so every funnel reads as belonging to the name beside it.
- That control is a funnel from **Tabler Icons**, the face Logseq already loads
  for its own interface: naming it downloads nothing, ships no font with the
  plugin, and adds no dependency. Because a private-use glyph has no fallback,
  the runtime asks the host whether the face is really loaded and uses it only
  then — and asks again on each pass, so a face that arrives late still reaches
  the controls already drawn. A host without it keeps a vertical ellipsis.
- **Search column** closes that menu and opens a field over the column name,
  holding whatever the column last searched for, selected, so one keystroke
  refines or replaces it. Typing hides every row whose cell in that column does
  not match, by the same case-insensitive substring rule the full table search
  uses. **Clear filter** is offered only while that column has one, and drops
  it.
- The field is laid over the header cell rather than put in its place, and
  stops short of the control's strip, so the column keeps its width, the menu
  stays reachable, and the markup Logseq rendered there — a link, code,
  emphasis — is never moved or rebuilt.
- A field that closes commits what it holds: the filter is shown in small text
  under the column name, where clicking it drops the filter and restores the
  rows it hid. Escape closes the field and restores the last committed filter,
  Enter commits what it holds, and both leave focus on the control. A field
  that closes empty commits nothing.
- The column name itself is left to Logseq: clicking it opens the block for
  editing exactly as it always did. Only the control, its menu, the field and
  the committed filter answer to this plugin, and all four take their events in
  the capture phase.
- The menu is rendered beside the table rather than inside it — the wrapper is
  an `overflow: auto` scroller that would clip it — measured against the
  control it belongs to and held inside the block, so a menu on the last column
  opens inward and one on a narrow first column does not run off the other
  edge. Scrolling the table closes it.
- Filters on several columns combine with each other and with the full table
  search: a row is shown only when it satisfies all of them, whatever order
  they were applied in. Turning **Full table search** off clears the search
  field alone; turning **Column menus** off takes away every control, menu,
  field and committed filter on that table and restores every row it was
  hiding.
- Column filters live beside the search state in the runtime, keyed by block
  UUID, ordinal and column index. Every table opens unfiltered, a re-render
  finds its filters again, and nothing is written to the graph.
- A table that renders no header row — Markdown writes one only where a header
  separator row is declared — is offered no **Column menus** switch at all, and
  the panel says why.
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
