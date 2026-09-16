# Able Table for Logseq

Able Table makes a rendered Markdown table searchable, filterable and sortable
in place, without editing the block, restructuring the Markdown, or converting
the table to a query. Everything it does is display-only: no filter, no search
string, no sort and no toggle state is ever written to the graph. What you set
a table to is [remembered between sessions](#what-is-remembered), outside the
graph, so a table you tune once stays tuned.

## Searching a table

Every Markdown table in the main editor carries a small **⋯** control in its
top-right corner, beside the collapse control. Press it — with the pointer, or
with Enter or Space from the keyboard — and a panel opens beneath it holding
the table's two switches, **Full table search** and **Columns**. Each is
that table's own, and each is [remembered](#what-is-remembered) for the next
time you open it.

**Full table search** puts a find-as-you-type field across the top of the
table and focuses it. Type, and every row that does not match disappears as
you go; backspace, and the rows come back.

- Matching is a **case-insensitive substring test** over the row's cells, read
  with a space between them and runs of whitespace collapsed to one. `ada`
  finds `Ada Lovelace`, and so does `ada lovelace` in a row whose first two
  cells are `Ada` and `Lovelace`. There is no tokenising, no fuzzy matching
  and no regular expression support — one predictable rule is the point.
- The **header row is never hidden**, so a table with nothing matching still
  reads as a table rather than as an error.
- The field says how many rows match out of how many the table holds, and
  announces it politely to a screen reader as the count changes.
- The **×** beside the field empties it and brings every row back. It is there
  only while the field holds something.
- Turning **Full table search** off takes the field away, clears it, and
  restores every row.

Dismiss the panel with Escape, with a click anywhere outside it, by opening a
column's menu, or by pressing the control again. Escape and a second press hand
focus back to the control; a click outside leaves focus wherever you clicked
it.

## Sorting and filtering a column

Turn **Columns** on in the same panel, and every column header takes a
control of its own — a funnel — inside the cell's right-hand divider and
on the line the column name is set on, drawn in cyan. It is that colour under
every theme, so one colour always means "filter this column", whatever else the
theme you run is accented with; on a light Logseq it is taken down to a deeper
cyan, where the brighter one would be lost against a near-white header. A
header row with column menus on opens its names at the top of the row rather
than centring them, so a name that wraps — or one carrying a filter underneath
it — never pulls its neighbours off the line their own funnels are on. Hovering
the header, opening the menu or giving the control focus outlines the box it
stands in.
Press it — with the pointer, or with Enter or Space — and a menu opens under
it. It reads **Sort A-Z**, **Sort Z-A**, a rule, **Find in column**, and —
only while that column has a filter — **Clear filter**:

**Find in column** closes the menu and opens a field over the column name,
holding whatever that column last searched for, selected, so one keystroke
refines or replaces it. Type, and every row whose cell **in that column** does
not match disappears. Matching is the same case-insensitive substring test the
full table search uses, read off that one cell rather than off the whole row.

**Sort A-Z** and **Sort Z-A** order the whole table by that column, in place.
The rows move; nothing is hidden, added or renumbered.

- Values are compared by your own locale's collation, **case- and
  accent-insensitively**, with **runs of digits read as numbers**: `Item 2`
  comes before `Item 10`, and a column of numbers sorts as numbers rather than
  as text. One predictable rule, as with the search.
- **Rows that read the same keep the order Logseq rendered them in**, so
  sorting one column never shuffles what you could already see in the others,
  and sorting the same column twice gives the same table both times.
- **A table is sorted by one column at a time.** Sorting by another column
  replaces the sort rather than adding to it.
- The sorted column's control shows an **arrow** — ↑ or ↓ — in place of the
  funnel, its header carries `aria-sort` for a screen reader, and the direction
  that is on is ticked in the menu.
- **Pressing the direction that is on drops the sort** and gives the rows back
  in the order Logseq rendered them. So does turning **Columns** off or
  removing the column it was sorted by.

**Clear filter** is there only while that column has one, and drops it.

The field is laid over the header cell rather than put in its place, and stops
short of the filter control, so the column keeps its width, the menu stays
reachable, and whatever Logseq rendered in that header — a link, code,
emphasis — is still exactly where it was when the field goes.

- **Losing focus commits** what the field holds. The filter is shown in small
  text under the column name, so you can see at a glance which columns are
  narrowing the table and by what. A field that closes empty commits nothing.
- **Click the committed filter** to drop it and bring back the rows it hid —
  the same thing **Clear filter** does, without opening the menu. It never
  reopens the field.
- **Escape** closes the field and restores the last committed filter. **Enter**
  commits what the field holds and closes it. Both leave focus on the filter
  control, so the next thing is a keystroke away.
- **Several columns filter together.** A row is shown only when it satisfies
  every committed column filter *and* the full table search. The order they
  were applied in does not matter, and dropping the last one restores every
  row.
- **The column name itself is still Logseq's.** Clicking it opens the block for
  editing exactly as it always did; only the filter control belongs to Able
  Table.
- **Sorting and filtering are independent.** A sorted table is searched and
  filtered exactly as an unsorted one is; a hidden row is hidden where the sort
  put it, and comes back in that place.
- Turning **Full table search** off clears the search field alone. Turning
  **Columns** off takes away every control, menu, field and committed
  filter on that table, restores every row it was hiding, and puts the rows
  back in the order Logseq rendered them — nothing is left narrowing or
  reordering what you read once the affordance that would drop it is gone.

A long filter wraps under the column name over a line or two, and can change
how the table shares its width between columns. It never widens the table or
puts a horizontal scrollbar on a table that had none. Turning **Columns**
on reserves the strip the filter control stands in, which can also change that
share; nothing moves as you use the menus.

The funnel is drawn with the **Tabler Icons** face Logseq already loads for its
own interface, so nothing is downloaded and no font ships in the plugin. The
runtime asks the host whether that face is really loaded and uses it only then;
a host without it draws a vertical ellipsis (**⋮**) instead, rather than the
empty box a missing icon font would otherwise leave.

### What a column filter needs

- **A header row.** Logseq renders one only for a Markdown table that declares
  a header separator row — the `| --- | --- |` line. A table that renders no
  header row has no column names to sort or filter by, so it is offered no
  **Columns** switch at all, and the settings panel says why.
- **A cell at that index.** Cells are matched to columns by position, so a row
  with no cell at the filtered column's index — a ragged or spanned row, which
  Markdown cannot write but pasted HTML can — counts as not matching and is
  hidden. Spanned and ragged tables are not a supported shape.

## What is remembered

Tune a table once and it stays tuned. The next time it renders — after a page
change, a reload, or a restart of Logseq — it comes back the way you left it.

Per table, that is: both panel switches, the full table search text, the sorted
column and its direction, and every committed column filter. What is *not* kept
is the transient half — whether the settings panel was open, which field was
mid-edit, and which column's menu was down — so a table you return to is set
the way you set it without any of its menus waiting for you.

- **It is kept outside your graph.** Able Table writes this to its own settings
  file in Logseq's configuration directory — `settings/logseq-able-table.json`,
  beside Logseq's own preferences — and never to your Markdown, a block, or a
  property. A graph synced to another machine carries none of it, which is the
  right answer for a display preference: the graph is your notes, not your view
  of them.
- **Each table is its own.** Settings are held per graph, per block, and per
  table within that block, so two tables never share them and the same block in
  two graphs never collides.
- **A table you have not tuned is not written down at all**, and one you set
  back to its defaults drops out again.
- **A table that has changed shape degrades gracefully.** If the column it was
  sorted by is gone, it opens in the order Logseq rendered it; if a filtered
  column is gone, that one filter is dropped. Everything else you set is kept.
- **A settings file that is unreadable or has been hand-edited into a shape
  Able Table does not recognise is treated as absent**, so the table opens at
  its defaults rather than failing.
- **Unloading the plugin does not clear it.** An ordinary reload unloads and
  reloads every plugin, and your tables have to come back.

To forget everything at once, quit Logseq and delete that file.

## What it never does

- **Nothing reaches the graph.** No block content, property or Markdown change
  comes from opening the panel, toggling, typing, filtering a column, sorting,
  clearing, or unloading. The Markdown behind a sorted table still holds its
  rows in the order you wrote them. What a table is set to is remembered
  [outside the graph](#what-is-remembered), never in it.
- **No row is removed or rewritten.** A hidden row is marked
  `data-able-filtered` and hidden by the plugin's own registered style;
  dropping the mark is all it takes to restore it.
- **A sort moves the rendered rows and nothing else.** Each row is stamped with
  the position it was rendered in, within the group it was rendered in, before
  the first move, so dropping the sort puts every one of them back and takes
  the stamp off again.
- **No block is collapsed and no bullet is folded.** Every control answers
  pointer and key events in the capture phase, before Logseq's own handlers
  see them, so nothing you do to one of Able Table's controls opens its block
  for editing or fires a shortcut. What is not one of its controls — the column
  name, the cells, the rest of the block — is left entirely to Logseq.
- **No header is rewritten.** The filter control, the field and the committed
  filter are added to the header cell; none of them replaces what Logseq
  rendered there.
- Editing a block replaces its render, which takes the controls with it; the
  table comes back searched and filtered when the render comes back.
- **Unloading the plugin gives the host document back exactly as it found
  it**: every `data-able-*` mark cleared, every control removed, every hidden
  row shown and every moved row returned. The one thing it leaves is its own
  settings file, which is what makes a reload come back sticky.

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
  everything it writes into the host document is namespaced `data-able-*`, and
  what it remembers goes in its own plugin settings file.

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
against a stub host document, from initial paint through the panel, the search
field, column filters, column sorting, re-render and teardown.

## Attribution

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the vendored Logseq
SDK.

## License

MIT. Release tooling copies the repository root [`LICENSE`](../../LICENSE) into every staged package and archive.
