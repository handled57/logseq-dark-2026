# Table controls v1 hook

A rendered Markdown table in Logseq's main editor can carry chrome from more
than one package at once. Dark High Contrast hangs a collapse control in the
corner of the table's wrapper; Able Table hangs a settings control in the same
corner. Neither package loads, imports, calls, or requires the other: what they
share is the one read-only hook written down here, and each side is tested
against it independently.

This contract is versioned. `v1` is what
`logseq-dark-high-contrast-theme` 2.18.0 publishes and what
`logseq-able-table` 0.1.0 reads. The bullet line below was added to `v1` in
`logseq-able-table` 0.4.0; it names something 2.18.0 already declared, so no
theme changed to publish it and nothing that read `v1` before had to change.

## The hook

The theme publishes exactly four facts, and nothing else:

| Fact | Value |
| --- | --- |
| Marker | `data-hc-collapse`, an attribute on the theme's own control element |
| Placement | a **direct child** of the table's `div.table-wrapper` |
| Size | the control's box is `--hc-collapse-control-size`, declared on `:root` |
| Bullet line | a block's bullet sits `--hc-rail-bullet-y` below the top of its row, declared on the row and inherited by everything rendered in the block |

That is the whole of it. The attribute's value is not part of the hook, the
element's tag is not part of the hook, and where in the wrapper's child list the
control sits is not part of the hook — only that it is a direct child. Which
value `--hc-rail-bullet-y` holds for a given block is not part of the hook
either, beyond the one a block opening with a table takes: what is published is
that the name means that distance, and that a block whose bullet the theme does
not move declares nothing.

## The direction

The hook is **one-directional and read-only**.

- Able Table **may detect** the theme's control, in CSS alone, to step out of
  its way:

  ```css
  div.table-wrapper:has(> [data-hc-collapse]) > [data-able-settings] {
    right: calc(var(--hc-collapse-control-size, 1.25rem) + 0.5rem);
  }
  ```

- Able Table **may read** the bullet line, in CSS alone, to begin its own
  chrome where the block's first line is:

  ```css
  [data-able-search] {
    margin: var(--hc-rail-bullet-y, 0px) 0 0.25rem;
  }
  ```

  A table block's bullet hangs a way into the box the table opens with. The
  full table search field takes that box's place at the top of the block, so it
  starts on the same line; the fallback of none leaves it at the top of the
  block, where a host that moves no bullet draws its own.

- Able Table **must never** write, clear, move, restyle, or require
  `data-hc-collapse`, and must never read it from script. Nothing is measured,
  nothing is imported, and no theme is a dependency: the fallback in each
  `var()` is what the chrome is sized, offset and placed by when no theme
  declares the variable.
- The theme **reads nothing of Able Table's**. It does not know the plugin
  exists, its control is never moved or restyled by it, and removing Able Table
  returns the corner to the theme with no change on either side.
- Neither package's teardown touches the other's nodes or attributes. Attribute
  namespaces are owned as
  [`passage-v1.md`](passage-v1.md#attribute-ownership) sets out: `data-hc-*` is
  the theme's, `data-able-*` is Able Table's.

## Compatibility rules

- **Able Table works with no theme installed.** The settings control takes the
  wrapper's top-right corner and is drawn entirely by Able Table's own
  registered style, at the `1.25rem` fallback size.
- **The theme works with no Able Table installed.** Its collapse control keeps
  the corner it has always had.
- **With both installed, neither control overlaps or moves the other.** Able
  Table steps left by the width of the theme's control plus the `0.5rem` its
  own padding adds.
- **A theme that is not Dark High Contrast is simply a theme with no hook.**
  Able Table takes the corner, because nothing answers the `:has()` test, and
  its field opens at the top of the block, because nothing declares a drop.
- **A theme may make each block a stacking context.** Dark High Contrast
  isolates every row so the rail's line paints behind its bullets. A panel or a
  menu that overhangs its block cannot be lifted out of such a context by any
  `z-index` of its own, so Able Table raises the **host's** block — Logseq's
  `.ls-block`, which is nothing of this hook's — for as long as one is open,
  and nothing here asks a theme to stop isolating.

## Drift

Both sides pin the hook in their own suite, so it cannot change silently:

- `packages/theme-dark-high-contrast/test/collapsible.test.mjs` asserts the
  attribute name and that the control is a direct child of `.table-wrapper`.
- `packages/theme-dark-high-contrast/test/theme.test.mjs` asserts the control
  is sized by `--hc-collapse-control-size`, that the variable is declared, and
  that `--hc-rail-bullet-y` is declared on the row and carries the table
  block's value.
- `packages/plugin-able-table/test/able-table.test.mjs` asserts the offset rule
  and the unstyled fallback, and that the runtime never writes a `data-hc-*`
  attribute.
- `packages/plugin-able-table/test/package.test.mjs` pins the whole set of
  theme names the runtime reads, and that each one is read with a fallback of
  Able Table's own, so a third cannot be reached for without amending this
  document.

A future `v2` would be a new document. A reader that cannot find the hook
behaves as though no theme were installed rather than guessing.
