# Changelog

All notable changes to this package are documented here.

## Unreleased

- Scaffolded the `packages/plugin-able-table/` workspace and its release
  wiring: package and Marketplace metadata, the `able-table-v*` release tag
  namespace, and archive verification. No table behavior ships yet.
- `index.js` establishes the plugin's lifecycle: it registers a style under
  the `able-table` key, observes the host document for re-renders, and on
  each pass marks every rendered table in the main editor with
  `data-able-table`, keyed by its block's UUID and its ordinal within that
  block. A table the pass no longer finds releases its mark. Unloading
  disconnects the observer and clears every `data-able-*` attribute.
