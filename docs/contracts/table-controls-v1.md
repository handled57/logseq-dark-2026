# Table controls v1 hook

A rendered Markdown table in Logseq's main editor can carry chrome from more
than one package at once. Dark High Contrast hangs a collapse control in the
corner of the table's wrapper; Able Table hangs a settings control in the same
corner. Neither package loads, imports, calls, or requires the other: what they
share is the one read-only hook written down here, and each side is tested
against it independently.

This contract is versioned. `v1` is what
`logseq-dark-high-contrast-theme` 2.18.0 publishes and what
`logseq-able-table` 0.1.0 reads.

## The hook

The theme publishes exactly three facts, and nothing else:

| Fact | Value |
| --- | --- |
| Marker | `data-hc-collapse`, an attribute on the theme's own control element |
| Placement | a **direct child** of the table's `div.table-wrapper` |
| Size | the control's box is `--hc-collapse-control-size`, declared on `:root` |

That is the whole of it. The attribute's value is not part of the hook, the
element's tag is not part of the hook, and where in the wrapper's child list the
control sits is not part of the hook — only that it is a direct child.

## The direction

The hook is **one-directional and read-only**.

- Able Table **may detect** the theme's control, in CSS alone, to step out of
  its way:

  ```css
  div.table-wrapper:has(> [data-hc-collapse]) > [data-able-settings] {
    right: calc(var(--hc-collapse-control-size, 1.25rem) + 0.5rem);
  }
  ```

- Able Table **must never** write, clear, move, restyle, or require
  `data-hc-collapse`, and must never read it from script. Nothing is measured,
  nothing is imported, and no theme is a dependency: the fallback in that
  `var()` is what the control is sized and offset by when no theme declares the
  variable.
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
  Able Table takes the corner, because nothing answers the `:has()` test.

## Drift

Both sides pin the hook in their own suite, so it cannot change silently:

- `packages/theme-dark-high-contrast/test/collapsible.test.mjs` asserts the
  attribute name and that the control is a direct child of `.table-wrapper`.
- `packages/theme-dark-high-contrast/test/theme.test.mjs` asserts the control
  is sized by `--hc-collapse-control-size` and that the variable is declared.
- `packages/plugin-able-table/test/able-table.test.mjs` asserts the offset rule
  and the unstyled fallback, and that the runtime never writes a `data-hc-*`
  attribute.

A future `v2` would be a new document. A reader that cannot find the hook
behaves as though no theme were installed rather than guessing.
