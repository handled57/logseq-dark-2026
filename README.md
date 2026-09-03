# Dark High Contrast for Logseq

A CSS-only Logseq theme that adapts the visual language of Visual Studio Code's built-in **Dark High Contrast** theme to Logseq's classic/file-graph interface.

![Dark High Contrast running in Logseq](screenshots/logseq-dark-high-contrast.png)

## Highlights

- Pure-black editor canvas with white text and structural borders.
- Orange keyboard-focus rings and cyan structural context.
- VS Code-inspired semantic colors for links, references, properties, tasks, and code.
- Compact workbench treatment for the header, sidebars, command palette, menus, dialogs, and settings.
- High-contrast coverage for queries, tables, notifications, PDF controls, graph filters, and whiteboard tools.
- Proportional Inter typography for notes; monospace remains limited to code and keyboard labels.
- No JavaScript, build runtime, tracking, remote imports, or network access.

## Compatibility

Version 1.0.0 targets **Logseq 0.10.15 classic/file graphs on desktop**.

- DB graphs are not supported in this release.
- Mobile is not an advertised target; narrow desktop windows receive a layout smoke test.
- Logseq accent colors are overridden so the High Contrast palette stays consistent.
- Host-DOM surfaces from Awesome UI, Awesome Props, Full House, Panel Coloring, and Toolbar Enhance receive a compatibility smoke test. A plugin rendered inside its own iframe remains responsible for its own colors.

## Install from the Logseq Marketplace

After the theme is accepted into the marketplace:

1. Open **Plugins → Marketplace → Themes**.
2. Search for **Dark High Contrast** and install it.
3. Open **Settings → General → Theme** and select **Dark High Contrast**.

## Load the repository as an unpacked theme

1. Clone or download this repository.
2. In Logseq, enable **Settings → Advanced → Developer mode**.
3. Open **Plugins**, choose **Load unpacked plugin**, and select the repository folder.
4. Open the theme selector and choose **Dark High Contrast**.

No dependency installation or compilation is needed to use the theme.

## Migrating from `custom.css`

If you previously pasted this theme into a graph's `logseq/custom.css`:

1. Back up that file.
2. Load and select the packaged theme.
3. Remove the duplicated Dark High Contrast rules from `custom.css` while retaining unrelated graph-specific rules.
4. Restart Logseq and confirm that the selected theme still renders correctly.

The plugin never edits or replaces a graph's `custom.css` automatically.

## Intentional layout choices

- On desktop, ordinary pages use 80% of the available main column. Logseq's full-width route remains full width.
- Untyped block bullets stay hidden until their block or an ancestor is hovered or focused.
- The active block receives a cyan outline; cyan ancestor bullets show its hierarchy without outlining every parent block.

## Development

The committed `theme.css` is the canonical stylesheet.

```sh
npm test
npm run build
npm run verify:release
```

`npm run build` creates a self-contained marketplace ZIP in `dist/`. The theme itself has no production dependencies.

## Accessibility

The test suite checks the principal text/background combinations against WCAG contrast thresholds. The stylesheet also includes visible `:focus-visible` treatment, inverted selection, reduced-motion handling, and a forced-colors fallback.

## Attribution

The palette and interaction conventions are adapted from Microsoft's MIT-licensed Visual Studio Code Dark High Contrast theme. Visual Studio Code and VS Code are trademarks of Microsoft Corporation. This project is independent and is not affiliated with or endorsed by Microsoft.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the source and license notice.

## License

MIT
