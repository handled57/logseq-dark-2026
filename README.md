# Dark High Contrast for Logseq

A Logseq theme that adapts the visual language of Visual Studio Code's built-in **Dark High Contrast** theme to Logseq's classic/file-graph interface.

![Dark High Contrast running in Logseq](screenshots/logseq-dark-high-contrast.png)

## Highlights

- Pure-black editor canvas with white text and structural borders.
- Orange keyboard-focus rings and cyan structural context.
- VS Code-inspired semantic colors for links, references, properties, tasks, and code.
- Compact workbench treatment for the header, sidebars, command palette, menus, dialogs, and settings.
- High-contrast coverage for queries, tables, notifications, PDF controls, graph filters, and whiteboard tools.
- Proportional Inter typography for notes; monospace remains limited to code and keyboard labels.
- Optionally hides the property table on blocks of a chosen type (see below).
- No build runtime, tracking, remote imports, or network access.

## Hiding properties by type

Blocks whose `type` property matches a configured value render as bare content: the whole property table is hidden. Clicking into such a block still shows its content *and* its properties as source, because Logseq replaces the entire rendered block with a textarea over the raw block content, and custom properties are part of that content — nothing needs to be un-hidden.

Configure it in **Plugins → Dark High Contrast → Settings**:

- **Property key** — the property that decides the treatment. Defaults to `type`; leave it empty to render every block normally.
- **Values that hide properties** — comma-separated values of that property. Defaults to `foo`. Use `*` to hide properties on every block carrying the key.

Every block carrying the key also gets `data-hc-block-type` set to that property's value, so `theme.css` can key rules to a block's type:

```css
.ls-block[data-hc-block-type="foo"] .block-content { opacity: 0.8; }
```

## Compatibility

Version 1.2.0 targets **Logseq 0.10.15 classic/file graphs on desktop**.

- DB graphs are not supported in this release.
- Mobile is not an advertised target; narrow desktop windows receive a layout smoke test.
- Logseq accent colors are overridden, including the Radix `--lx-*` scales the app reads ahead of its own theme variables, so the High Contrast palette stays consistent whichever accent is selected in Settings.
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
- The active block receives a steel-blue outline; matching ancestor bullets show its hierarchy without outlining every parent block.

## Development

The committed `theme.css` and `index.js` are canonical; `lib/lsplugin.user.js` is a vendored copy of the Logseq plugin SDK and is not edited here.

```sh
npm test
npm run build
npm run verify:release
```

`npm run build` creates a self-contained marketplace ZIP in `dist/`. The theme itself has no production dependencies; the SDK ships in-tree.

`package.json` sets `"effect": true`. That flag is load-bearing rather than descriptive: Logseq rewrites a side-effect-free package's entry to `lsp://logseq.io/`, a different origin from the host window, which would put `parent.document` out of reach. With `effect: true` the entry stays on the app's own `file://` origin and the entry script can read and annotate the host DOM.

Logseq resolves backgrounds through `var(--lx-…, var(--ls-…, var(--rx-…)))` and re-declares both layers per accent color, so a theme rule only lands when it out-ranks the upstream selector. `test/cascade.test.mjs` asserts that pairing for each surface the theme replaces. Point `LOGSEQ_CSS` at an installed `style.css` to also check the pinned upstream selectors against the shipping app:

```sh
LOGSEQ_CSS=/path/to/Logseq/resources/app/css/style.css npm test
```

## Accessibility

The test suite checks the principal text/background combinations against WCAG contrast thresholds. The stylesheet also includes visible `:focus-visible` treatment, inverted selection, reduced-motion handling, and a forced-colors fallback.

## Attribution

The palette and interaction conventions are adapted from Microsoft's MIT-licensed Visual Studio Code Dark High Contrast theme. Visual Studio Code and VS Code are trademarks of Microsoft Corporation. This project is independent and is not affiliated with or endorsed by Microsoft.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the source and license notice.

## License

MIT
