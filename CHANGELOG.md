# Changelog

All notable changes to this project are documented here.

## 1.2.0 - 2026-09-03

- Hide a block's rendered property table when its `type` property matches a
  configured value, so tagged blocks render as bare content. Clicking into the
  block still shows the content and its properties as source, because Logseq
  swaps the whole rendered block for a textarea over the raw block content.
- Turn the package from a CSS-only theme into a theme that also ships an entry
  script. `effect` is now `true`, which is what keeps the entry on the host's
  `file://` origin; a side-effect-free package is served from
  `lsp://logseq.io/` and cannot read the host document.
- Expose `data-hc-block-type` on every block that carries the configured
  property, as a styling hook for rules keyed to a block's type.
- Vendor `@logseq/libs` under `lib/` so a release installs with no build or
  install step, and ship it through the release archive gate.
- Repaint the workbench chrome in the `#5b7e96` contrast border instead of
  white: both sidebars, the header and right-sidebar topbar, panels, menus,
  modals, notifications, tooltips, tables, code blocks, the settings and
  command-palette surfaces, and the resting borders of buttons, inputs and
  checkboxes. The ShUI `--border` / `--input` tokens move to the same color.
  Bullets, the editor caret, text and the orange focus ring are unchanged.

## 1.1.0 - 2026-09-03

- Raise the variable block to `html[data-theme][data-color]:root`, so the theme's
  `--ls-*` palette out-ranks the per-accent palette Logseq declares at
  `html[data-theme=dark][data-color=…]`. Every background token in the theme was
  previously losing that cascade and had no effect.
- Pin all 50 Radix `--lx-gray-*` / `--lx-accent-*` tokens Logseq reads ahead of
  `--ls-*`. Selecting any accent other than the default repainted roughly 130
  surfaces in that accent's ramp.
- Flatten block embeds and nested `.color-level` blocks onto the black surface
  instead of the stock green-tinted level tints.
- Repair surfaces that matched no theme rule: block hover highlight, inline code,
  table stripes, checkboxes and radios, scrollbars, closed bullet halos, the date
  picker, search-match highlighting, shortcut key chips, the PDF viewer and text
  layer, Logseq's CodeMirror skin, and the all-pages, settings, shortcut, themes,
  onboarding, dashboard, and sidebar-help screens.
- Extend the `forced-colors` override to the same specificity and to the Radix
  tokens.
- Add cascade regression tests that assert the theme out-ranks each upstream rule
  it replaces, and check the pinned selectors against an installed Logseq when
  `LOGSEQ_CSS` is set.
- Correct the palette test, which still expected the pre-`#5b7e96` border color,
  and tie the version assertion to the changelog so the two cannot drift again.
- Build and verify releases without the external `zip`/`unzip` binaries, so the
  release gate runs on Windows as well as CI.

## 1.0.0 - 2026-09-02

- Package the graph-level stylesheet as a CSS-only Logseq theme.
- Map the VS Code Dark High Contrast palette across classic Logseq workbench and editor surfaces.
- Add ShUI/Radix, sidebar, command palette, settings, notification, PDF, graph, and whiteboard coverage.
- Preserve the focused desktop width, hover-revealed bullets, and cyan block-ancestry treatment.
- Add accessibility checks, release packaging, documentation, and marketplace metadata.
