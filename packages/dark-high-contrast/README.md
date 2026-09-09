# Dark High Contrast for Logseq

A Logseq theme that adapts the visual language of Visual Studio Code's built-in **Dark High Contrast** theme to Logseq's classic/file-graph interface.

![Dark High Contrast running in Logseq](screenshots/logseq-dark-high-contrast.png)

## Highlights

- Pure-black editor canvas with white text and structural borders.
- Orange keyboard-focus rings and cyan structural context.
- VS Code-inspired semantic colors for links, references, properties, tasks, and code.
- Compact workbench treatment for the header, sidebars, command palette, menus, dialogs, and settings.
- High-contrast coverage for queries, tables, notifications, PDF controls, graph filters, and whiteboard tools.
- Every block in the main editor hangs its bullet on one vertical rail in the margin left of the page, each bullet on the middle of its block's first line and drawn at the size of that line, with the content column keeping its usual nesting.
- Headings and blocks with children are colored by how deep they sit: red at the top level, then orange, yellow, green, blue, indigo and violet, each block painting its own bullet and its own stretch of the rail. Ordinary leaf prose keeps its white bullet on the cyan line.
- Proportional Inter typography for notes; monospace remains limited to code and keyboard labels.
- Optionally hides the property table on blocks matching any number of property pairs (see below).
- Styles a passage block so it reads as one of Logseq's named admonitions, with verse numbers set in a gutter beside the text where the passage takes a line to a verse. Writing one is the [Passage](../passage) plugin's job, and the theme does not require it.
- Sizes named-admonition and passage icons at 1.5 times the first line's font and aligns them with that line while their semantic divider continues through the full block height.
- Folds a long rendered box — an admonition, a passage, a table, a quote, a code block, a math block, a piece of media, a block or page embed — on a control of its own, without folding the block that holds it or touching a line of its source.
- Sets the emoji a block opens with in a gutter of its own, left of the block's text, so it reads as that block's icon and the lines under it stay in one column. The emoji is left exactly where it is written.
- Left-clicking a block bullet expands or collapses that block rather than opening it. Shift-click still opens the block in the sidebar, and right-clicking offers **Open**, immediately above **Open in sidebar**, to open the block in the main editor.
- No build runtime, tracking, remote imports, or network access.

## Color palette

`theme.css` is the source of truth for this palette. The chart shows every fixed color expression used by the theme; the tables below consolidate aliases that resolve to the same value and explain where each color appears.

![Every opaque, HSL-component, and alpha color used by Dark High Contrast](screenshots/color-palette.svg)

<!-- fixed-color-values:start -->

### Core VS Code High Contrast colors

| Color | Tokens | Used for |
| --- | --- | --- |
| `#000000` | `--vscode-hc-black` | Primary canvas; editor, menus, dialogs, controls, code, whiteboards, and selected surfaces. |
| `#ffffff` | `--vscode-hc-white` | Primary text and icons, strong borders, bullets, scrollbars, and inverted selection backgrounds. |
| `#f38518` | `--vscode-hc-focus`, `--vscode-hc-orange` | Keyboard focus, active bullets, hover borders, editor focus, and primary interaction emphasis. |
| `#5b7e96` | `--vscode-hc-border` | Structural borders, guides, dividers, inactive controls, and the gray/accent ramps. |
| `#569cd6` | `--vscode-hc-blue` | Tags and syntax keywords. |
| `#1aebff` | `--vscode-hc-bright-blue` | Hovered links and tags and the brightest accent-scale text. |
| `#3794ff` | `--vscode-hc-link` | Links, whiteboard blue strokes, and quick-link hover states. |
| `#7ca668` | `--vscode-hc-green` | Comments and idle file-sync status. |
| `#ce9178` | `--vscode-hc-string` | Inline code and string syntax. |
| `#c586c0` | `--vscode-hc-purple` | Purple whiteboard strokes and syntax accents. |
| `#9cdcfe` | `--vscode-hc-cyan` | Page and block references, passage icons and verse numbers, and variable/property syntax. |
| `#4ec9b0` | `--vscode-hc-type` | Type and class-name syntax. |
| `#ffff00` | `--vscode-hc-yellow` | Clozes, marks, search matches, warnings, pending sync, and operators. |
| `#f48771` | `--vscode-hc-error` | Errors, destructive states, failed sync, and red whiteboard strokes. |
| `#cca700` | `--vscode-hc-warning` | Reserved VS Code warning token. |
| `#75beff` | `--vscode-hc-info` | Reserved VS Code information token. |
| `#d7d7d7` | `--vscode-hc-muted` | Secondary text, tertiary borders, and gray whiteboard strokes. |
| `#a0a0a0` | `--vscode-hc-disabled` | Disabled text and control borders. |
| `#0c0c0c` | `--vscode-hc-panel` | Secondary surfaces, properties, quotes, inline code, and nested panels. |
| `#151515` | `--vscode-hc-elevated` | Elevated and tertiary surfaces. |

### Bullet-rail hierarchy colors

Every heading, and every block with children, takes the color of its own depth
on the rail; the same color paints that block's bullet and the stretch of line
it is responsible for. Depth 1 is a top-level block. The eight colors repeat
below the eighth level — depth 9 is magenta again — and a block deeper than
depth 13, the twelfth level below the top and the last one the rail places,
hangs from that level's rail position and keeps its color.

| Depth | Color | Tokens |
| --- | --- | --- |
| 1, 9 | `#dc267f` magenta | `--hc-rail-depth-1`, `--hc-rail-magenta` |
| 2, 10 | `#ea5c00` orange | `--hc-rail-depth-2`, `--hc-rail-orange` |
| 3, 11 | `#994f00` brown | `--hc-rail-depth-3`, `--hc-rail-brown` |
| 4, 12 | `#ffb000` amber | `--hc-rail-depth-4`, `--hc-rail-amber` |
| 5, 13 | `#40b0a6` teal | `--hc-rail-depth-5`, `--hc-rail-teal` |
| 6 | `#75beff` blue | `--hc-rail-depth-6`, `--hc-rail-blue`, `--vscode-hc-info` |
| 7 | `#b180d7` indigo | `--hc-rail-depth-7`, `--hc-rail-indigo` |
| 8 | `#b66dff` violet | `--hc-rail-depth-8`, `--hc-rail-violet` |

These eight are the rail's own colors rather than the VS Code palette above:
they are chosen to stay apart from one another for a reader with a common color
vision deficiency, which a literal red-to-violet sweep does not. No text is ever
set in them — a bullet and a hairline are non-text interface components, so each
one clears the 3:1 that asks for; seven of the eight clear 4.5:1 as well, and
the brown, at 3.47:1, is used only as a bullet and a line.

Blocks that carry no hierarchy of their own — ordinary prose without children —
keep a white bullet, and paint their stretch of rail in the **Default rail
color** setting instead. That defaults to `#5b7e96`, the same
`--vscode-hc-border` the editor, the left menu and the sidebars are drawn with.

A bullet also says whether anything is folded away underneath it: a block whose
children are showing is drawn as an empty ring, while a collapsed block and a
block with no children of its own stay filled. Hovering a bullet adds a halo
around it without changing what is inside it.

A page's properties are the page's front matter rather than a block of its text,
so they render with no bullet and no rail segment, and the rail opens at the
first content block below them.

### Neutral surfaces and structural ramps

| Color | Tokens or selectors | Used for |
| --- | --- | --- |
| `#101010` | `--ls-table-tr-even-background-color` | Alternating table rows. |
| `#1f1f1f` | `--ls-quaternary-background-color`, `--ls-quaternary-background-color1`, `--ls-bg-quaternary`, `--ls-block-highlight-color`, `--ls-color-level-3`, `--lx-gray-04` | Selected and highlighted blocks, and intermediate raised surfaces. |
| `#282828` | `--ls-quinary-background-color`, `--ls-color-level-4`, `--lx-gray-05`, `--ls-wb-background-color-gray` | Higher neutral surfaces and gray whiteboard objects. |
| `#333333` | `--ls-senary-background-color`, `--ls-color-level-5`, `--lx-gray-06` | High neutral surface steps. |
| `#3d3d3d` | `--ls-color-level-6`, `--lx-gray-07` | Strongest neutral surface before structural borders. |
| `#7d9db4` | `--lx-gray-10` | Radix gray solid-fill hover step. |
| `#001019` | `--lx-accent-02` | Subtle accent background. |
| `#001d2e` | `--lx-accent-03` | Accent component background. |
| `#002a42` | `--lx-accent-04` | Hovered accent component background. |
| `#003656` | `--lx-accent-05` | Active or selected accent component background. |
| `#003e6b` | `--lx-accent-06`, `--ls-highlight-color-blue`, `--ph-highlight-color-blue`, `--ls-whiteboard-quick-links-background`, `--ls-wb-background-color-blue` | Strong blue accent fill, blue highlights, PDF highlights, and whiteboard quick links. |
| `#ffa04d` | `--lx-accent-10` | Bright orange solid-fill hover step. |

### Semantic, syntax, highlight, PDF, whiteboard, and admonition colors

| Color | Tokens or selectors | Used for |
| --- | --- | --- |
| `#3b0d08` | `--ls-error-background-color`, `--ls-wb-background-color-red` | Dark error notifications and red whiteboard objects. |
| `#332a00` | `--ls-warning-background-color`, `--ls-wb-background-color-yellow` | Dark warning notifications and yellow whiteboard objects. |
| `#14240f` | `--ls-success-background-color`, `--ls-wb-background-color-green` | Dark success notifications and green whiteboard objects. |
| `#b7d6a8` | `--ls-success-text-color`, `--ls-wb-stroke-color-green` | Success foreground and green whiteboard strokes. |
| `#5a5200` | `--ls-highlight-color-yellow`, `--ph-highlight-color-yellow` | Yellow text and PDF highlights. |
| `#661d1d` | `--ls-highlight-color-red`, `--ph-highlight-color-red` | Red text and PDF highlights. |
| `#164a22` | `--ls-highlight-color-green`, `--ph-highlight-color-green` | Green text and PDF highlights. |
| `#522251` | `--ls-highlight-color-purple`, `--ph-highlight-color-purple` | Purple text and PDF highlights. |
| `#66224c` | `--ls-highlight-color-pink` | Pink text highlights. |
| `#454545` | `--ls-highlight-color-gray` | Gray text highlights. |
| `#ff9ed2` | `--ls-wb-stroke-color-pink` | Pink whiteboard strokes. |
| `#3b193a` | `--ls-wb-background-color-purple` | Purple whiteboard objects. |
| `#4a1735` | `--ls-wb-background-color-pink` | Pink whiteboard objects. |
| `#b5cea8` | `.cm-number`, `.hljs-number`, `.token.number` | CodeMirror, Highlight.js, and Prism numeric literals. |
| `#ebbc00` | `.admonitionblock.note` → `--hc-admonition-accent` | Note icon and four-pixel divider. |
| `#eb9091` | `.admonitionblock.important` → `--hc-admonition-accent` | Important icon and four-pixel divider. |
| `#fa934e` | `.admonitionblock.caution`, `.admonitionblock.warning` → `--hc-admonition-accent` | Caution/warning icons and four-pixel dividers. |
| `#264f78` | `.cm-s-lsradix … .CodeMirror-selected` and selection pseudo-elements | Selected text in Logseq's CodeMirror editor. |

### HSL control tokens

Logseq's newer controls consume these as HSL components, for example `hsl(var(--accent))`.

| Components | Tokens | Used for |
| --- | --- | --- |
| `0 0% 0%` | `--background`, `--card`, `--popover`, `--primary`, `--accent-foreground`, `--destructive-foreground`, `--ls-button-background-hsl` | Black control surfaces and dark foregrounds on bright semantic fills. |
| `0 0% 100%` | `--foreground`, `--card-foreground`, `--popover-foreground`, `--primary-foreground`, `--secondary-foreground` | White control text. |
| `0 0% 5%` | `--secondary` | Secondary control surfaces. |
| `0 0% 8%` | `--muted` | Muted control surfaces. |
| `0 0% 84%` | `--muted-foreground` | Muted control text. |
| `195 65% 65%` | `--accent` | Cyan control accent. |
| `9 87% 70%` | `--destructive` | Destructive control fill. |
| `204 24% 47%` | `--border`, `--input` | Control and input borders. |
| `29 90% 52%` | `--ring` | Control focus rings. |

### Alpha overlays

The chart renders these over a checkerboard so the opacity remains visible.

| Color expression | Token or selector | Used for |
| --- | --- | --- |
| `rgb(255 255 255 / 0%)` | `--lx-gray-01-alpha` | Fully transparent gray-scale base. |
| `rgb(255 255 255 / 4%)` | `--lx-gray-02-alpha` | Subtle gray-scale overlay. |
| `rgb(255 255 255 / 8%)` | `--lx-gray-03-alpha` | Gray component overlay. |
| `rgb(255 255 255 / 12%)` | `--lx-gray-04-alpha`; ordinary bullet halo | Gray hover overlay and faint bullet halo. |
| `rgb(255 255 255 / 16%)` | `--lx-gray-05-alpha` | Gray active-component overlay. |
| `rgb(255 255 255 / 20%)` | `--lx-gray-06-alpha` | Gray subtle-border overlay. |
| `rgb(255 255 255 / 26%)` | `--lx-gray-07-alpha` | Gray strong-border overlay. |
| `rgb(91 126 150 / 80%)` | `--lx-gray-08-alpha` | Translucent structural border. |
| `rgb(91 126 150 / 90%)` | `--lx-gray-09-alpha` | Translucent solid gray fill. |
| `rgb(125 157 180 / 92%)` | `--lx-gray-10-alpha` | Translucent gray hover fill. |
| `rgb(215 215 215 / 95%)` | `--lx-gray-11-alpha` | Nearly opaque secondary text. |
| `rgb(255 255 255 / 100%)` | `--lx-gray-12-alpha` | Opaque high-contrast text. |
| `rgb(0 62 107 / 8%)` | `--lx-accent-01-alpha` | Faintest blue accent overlay. |
| `rgb(0 62 107 / 16%)` | `--lx-accent-02-alpha` | Subtle blue accent overlay. |
| `rgb(0 62 107 / 28%)` | `--lx-accent-03-alpha` | Blue component overlay. |
| `rgb(0 62 107 / 40%)` | `--lx-accent-04-alpha` | Blue hover overlay. |
| `rgb(0 62 107 / 55%)` | `--lx-accent-05-alpha` | Blue active-component overlay. |
| `rgb(0 62 107 / 70%)` | `--lx-accent-06-alpha` | Strong blue accent overlay. |
| `rgb(91 126 150 / 60%)` | `--lx-accent-07-alpha` | Translucent accent border. |
| `rgb(243 133 24 / 45%)` | `--lx-accent-08-alpha` | Translucent orange focus overlay. |
| `rgb(243 133 24 / 80%)` | `--lx-accent-09-alpha` | Orange active-fill overlay. |
| `rgb(255 160 77 / 85%)` | `--lx-accent-10-alpha` | Bright orange hover-fill overlay. |
| `rgb(26 235 255 / 90%)` | `--lx-accent-11-alpha` | Bright cyan accent text overlay. |
| `rgb(255 255 255 / 95%)` | `--lx-accent-12-alpha` | Nearly opaque accent text. |
| `rgb(0 0 0 / 78%)` | `.ui__modal-overlay`, `.ui__dialog-overlay` | Screen scrim behind modal surfaces. |
| `rgb(255 255 255 / 30%)` | `.bullet-container:not(.typed-list).bullet-closed` | Stronger halo for a closed bullet. |

<!-- fixed-color-values:end -->

### Dynamic and platform colors

These values cannot have a single fixed swatch:

- `transparent` removes fills or reserves invisible borders without introducing a color.
- `inherit` and `currentColor` reuse the surrounding foreground; the pinned admonition uses `currentColor` for its icon and divider.
- In Windows forced-colors mode, `Canvas`, `CanvasText`, `LinkText`, `Highlight`, and `HighlightText` defer to the user's operating-system contrast palette.

## Folding a rendered box

Every rendered box in the main editor that can be read on its own carries a small expand/collapse control in its top right corner: named admonitions and passage blocks, tables, quotes, code blocks, math blocks, rendered media, and block and page embeds. Pressing it folds that one box away.

This is not the bullet's fold. The block keeps its properties and its children, no descendant is unrendered, and nothing is written to the graph — clicking into the block still shows the whole of its source, exactly as it is written. Every box opens expanded, each one answers only for itself, and a fold lasts as long as the graph is open.

What a folded box keeps:

| Box | Folded |
| --- | --- |
| Named admonition | Its icon and divider, and the first line of its text |
| Passage | Its icon and divider, and the reference line |
| Table | Its head, or its first row where the markup writes none, in the same columns |
| Quote | Its panel and its edge, at one line's height |
| Code block, math block, media, block/page embed | A one-line box carrying the word for what is inside it |

The control is a button: it takes Tab, answers Enter and Space, and shows the theme's orange focus ring. Pressing it never opens the block for editing and never folds the block the way its bullet does. Boxes rendered outside the main editor — in the sidebars, in a whiteboard, in a dialog — are left exactly as Logseq draws them, and where one box holds another, only the outer one takes a control.

## A leading emoji as a block icon

A block that opens with an emoji sets that emoji in a gutter of its own, to the left of the block's text, the way a passage sets a verse number:

```text
📌 Important note
```

renders the pin in the gutter and `Important note` in the block's ordinary text column, with a line long enough to wrap coming back to that same column rather than under the pin.

The emoji is not moved, copied or replaced. It is still the first character of the block's source and of the text the block renders — the theme only marks the block so `theme.css` can hang the first line back out of the text column. Clicking into the block shows the line exactly as it was typed, and nothing is written to the graph.

- What counts as the icon is one emoji grapheme, however many code points it takes: a variation selector, a skin tone, a flag, a keycap and a ZWJ sequence like 👩‍💻 are each one icon.
- A character that only becomes an emoji when it is asked to — `©`, `™`, a bare `❤` — stays text.
- The space between the emoji and the text is not part of the icon. The gutter is one emoji and the single space that ordinarily follows it, so the text begins in the block's own column. Several literal spaces are still rendered as they are written, exactly as Logseq renders them without this feature — the theme adds no indent of its own.
- An emoji anywhere else in the line stays inline, and a block that opens with anything else is untouched.
- A block that renders as something with an icon or a layout of its own — an admonition, a passage, a code block, a query, an embed, a piece of media — keeps that structure; a leading emoji never overrides it.
- The bullet on the rail is Logseq's own and is left alone. Folding, hovering, clicking, dragging and the hierarchy colors all behave as they did.

Turn it off in **Plugins → Dark High Contrast → Settings** under **Leading emoji as a block icon**, and every emoji goes back into its line. The gutter is `--hc-block-icon-gutter`, `1.5em` by default, so a graph that sets its notes in a face with a wider or narrower emoji can retune it from `custom.css`.

## Hiding properties by property value

Blocks whose rendered properties match any one of the configured `key: value` pairs render as bare content: the whole property table is hidden. Clicking into such a block still shows its content *and* its properties as source, because Logseq replaces the entire rendered block with a textarea over the raw block content, and custom properties are part of that content — nothing needs to be un-hidden.

Configure it in **Plugins → Dark High Contrast → Settings** under **Properties that hide the property table**. The field takes any number of pairs, separated by commas, semicolons or newlines:

```text
type: foo, status: done, kind: reference
```

- A block is hidden as soon as it matches **any one** pair; the same key may appear as often as you like (`type: foo, type: bar`).
- Keys and values are matched case-insensitively against the rendered property table.
- `key: *`, or a bare `key` with no value, matches every value of that key.
- Leave the field empty to render every block normally.

The default is `type: passage`, which hides the drawer on the one block type this theme writes itself. A graph configured under 1.2.0 keeps its behavior: the old **Property key** and **Values that hide properties** settings are folded into this field the first time 1.3.0 loads.

Every block carrying one of the configured keys also gets `data-hc-block-type` set to that property's value, so `theme.css` can key rules to a block's type:

```css
.ls-block[data-hc-block-type="foo"] .block-content { opacity: 0.8; }
```

When a block carries more than one configured key, the first key in the settings field wins, so configuration order is precedence order.

### Where a visible table renders

A property table the configuration does not hide renders *below* the block's admonition or passage, set off from it by a small gap, with its left border lined up with the box's own text. Logseq renders the table ahead of the block body, which leaves it above the box its properties describe and reading as though it belonged to whatever came before. This is a change to the render only: the properties stay first in the block's source, and clicking into the block still shows them written where Logseq writes them.

It covers the six named admonitions — `tip`, `note`, `important`, `caution`, `warning` and `pinned` — and the theme's own passage block. A table that a rule hides, and every ordinary block's table, is left exactly where it is.

## Passage blocks

A **passage block** holds a quoted passage under a bold reference:

```text
type:: Passage
#+BEGIN_PASSAGE
**John 3:16**

For God so loved the world…
#+END_PASSAGE
```

It renders bulletless, on the black admonition surface, with a cyan open-book icon and the same 4px accent divider the named admonitions carry. The icon is a 1.5em square, scaling from the first line's font size and vertically centered with that line, while the text keeps the same indent, so a passage and an admonition line up beside each other.

`PASSAGE` is not one of the admonition names compiled into Logseq's parser, and that list cannot be extended by a theme, a setting or a plugin. Logseq renders the block as a plain `div.passage` with no icon and no container styling, so the theme reproduces the admonition treatment on its own selectors and supplies the icon itself, inlined as an SVG mask so its color stays a palette token. The block is styled to *match* the admonitions; it is not parsed as one.

Verse numbers are read from the block's own source. Where every number in a block opens a line, each is set in a gutter of its own beside the text, so a verse that wraps lines up with the start of its own text rather than under its number, and the reference and any chapter headings stay flush with the passage's left edge. A passage of running prose keeps its numbers inline where the sentences put them. The theme answers that question once per block because CSS cannot: inside `#+BEGIN_PASSAGE` mldoc parses the whole body as one paragraph of inline nodes separated by line breaks.

`type:: Passage` is what the default **Properties that hide the property table** rule matches, so the drawer is hidden and the block renders as a bare passage; it is also what `data-hc-block-type="passage"` is taken from. The match is case-insensitive, so the rule and the property agree however either is written.

### Writing one

Writing a passage belongs to the [**Passage**](../passage) plugin, which installs, updates and unloads on its own. It resolves a typed reference against its own index of books and chapters, writes it back canonically with one namespaced tag per chapter, and — with a local text index you build yourself — writes the verse text under it, optionally with chapter headings, verse numbers, or a line to a verse.

Neither package needs the other. The theme styles whatever passage blocks a graph holds, whoever wrote them; Passage writes ordinary Logseq markup that renders readably with any theme, or none. What the two agree on is a block shape, published as [`docs/contracts/passage-v1.md`](../../docs/contracts/passage-v1.md) and tested from both sides against the same fixtures.

Through version 1.10.1 the Passage command was part of this theme. Upgrading to 2.0.0 leaves every passage already in your graph exactly as it is; to keep the commands, install Passage and choose its **Translation** once under its own settings.

## Compatibility

Version 2.1.0 targets **Logseq 0.10.15 classic/file graphs on desktop**.

Left-clicking a block bullet expands or collapses that block, the way the fold
arrow beside it does; a block with nothing to fold stays where it is. To open a
block in the main editor, right-click its bullet and choose **Open**. The entry
sits immediately above Logseq's existing **Open in sidebar** action; that
action, shift-clicking a bullet, dragging a bullet, and the rest of the menu
keep their normal behavior.

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
3. Run `npm run build` from the repository root.
4. Open **Plugins**, choose **Load unpacked plugin**, and select
   `dist/logseq-dark-high-contrast-theme/`.
5. Open the theme selector and choose **Dark High Contrast**.

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
- Every rendered block in the main editor keeps a bullet, and every bullet stands in the same column: Logseq's own bullet is pulled left by the indentation its nesting level applied plus the margin the rail stands in, so the content column keeps the hierarchy Logseq renders. A line runs behind the bullets, from the centre of the first bullet to the end of the last block, each block painting the stretch of it its own row covers.
- A bullet sits on the middle of its block's first line of text, wherever that line begins. A heading's bullet drops by 1.75 times the size Logseq gives that heading level, both in view and while the heading is being typed; a quote, a passage, an admonition, a code block and a table drop their bullet into the box the block opens with. A block whose first line is a picture keeps its bullet at the top of the block.
- A bullet is drawn at the size of the line it hangs beside. Ordinary prose is the baseline, and a first line set larger than that takes a proportionally larger bullet: a heading's bullet — halo, dot and rings alike — is drawn at the multiple Logseq sets that heading level in, so an `h1` bullet is twice an ordinary one and an `h6` bullet three quarters of it. The bullet grows around the rail rather than off it, so its centre stays on the line, and a block whose first line is ordinary text — including one opening with a quote, a passage, an admonition, a code block or a table — keeps exactly the bullet it had.
- A bullet folds and unfolds its block on a left click, so the rail reads as a control column rather than a set of links; navigating into a block moves to **Open** on the bullet's context menu. Whiteboard bullets keep Logseq's own gestures.
- A block that carries the hierarchy — one whose first line is a heading, or one with children of its own — takes the color of its depth for its bullet and for its own stretch of the rail: red at the top level, then orange, yellow, green, blue, indigo and violet, repeating below the seventh level. A child's segment is always the child's color, never its parent's, and a folded parent keeps its color while its children are out of the DOM. Ordinary leaf prose keeps the white bullet on the cyan line it has always had. The full mapping is in [Bullet-rail hierarchy colors](#bullet-rail-hierarchy-colors).
- Hovering a block lights its own bullet in the color that block paints the rail with — cyan for ordinary prose, its own depth's color for a heading or a parent. An ancestor holding the hovered block keeps its bullet plain, the way the block highlight already behaves.
- How far left the rail stands is one number, `--hc-rail-offset`. It defaults to 80px, drops to 48px on a window narrower than 1100px, and to 24px on the full-width route, where the only space left of the tree is the scroll container's own padding. A graph that wants the rail nearer its text can set it in `custom.css`.
- The rail is the page's own tree in the main editor. Sidebars, whiteboards, dialogs and linked references keep Logseq's layout, as do embedded and queried trees rendered inside a block. Document mode and Logseq's right-hand fold button both re-measure indentation, so the rail steps aside for them and bullets render as Logseq draws them.
- Outside the rail, bullets follow the older rule: untyped bullets are visible for ordinary prose blocks, while empty, property-only, heading, reference, embed, command/macro, query, media, code (including `src`), `center`, `verse`, `passage`, namespace, math, ClojureScript-eval, slide, flashcard, Zotero, quote, and other advanced `<`-menu blocks remain bulletless.
- A numbered list keeps its number beside its content and takes an ordinary bullet on the rail.
- Hovering a block outlines it without filling it. The raised `#1f1f1f` fill is kept for the deliberate, persistent states: a selected block and Logseq's own block highlight.
- The active block receives a steel-blue outline; hovering a child never reveals or recolors ancestor bullets, and Logseq's connector/thread lines remain hidden — the rail replaces them.
- A block nested deeper than twelve levels hangs from the twelfth level's position rather than its own.
- An admonition centres a short text against its icon, so its bullet marks the head of its box rather than that first line.
- A folded rendered box hides what it holds outright rather than scrolling it, so nothing of it overflows the box and no space is left standing for it. A code block's editor is hidden rather than removed from the layout, because one measured while it was out of the layout comes back blank.
- A block icon's gutter is carved out of the block's own text column rather than the margin left of it: the text is indented by the gutter and the first line hangs back out of it. Nothing of the icon reaches the rail, so the bullet, the fold arrow and the hierarchy color are exactly where they were, at every nesting depth and on the full-width route.

## Development

The committed `theme.css` and `index.js` are canonical. The repository keeps one vendored Logseq SDK at `vendor/logseq/lsplugin.user.js`; release tooling copies it into the staged package as `lib/lsplugin.user.js`.

This theme is one workspace of the [logseq-dark-2026](https://github.com/handled57/logseq-dark-2026) monorepo, and lives in `packages/dark-high-contrast/`. Run its scripts from this directory, or from the repository root with `--workspace packages/dark-high-contrast`:

```sh
npm test
npm run build
npm run verify:release
```

`npm run build` creates a self-contained Marketplace ZIP and extracted package in the repository root's `dist/`. Load the extracted `dist/logseq-dark-high-contrast-theme/` folder for unpacked testing. The theme itself has no production dependencies; its archive includes the shared SDK and root license.

`package.json` sets `"effect": true`. That flag is load-bearing rather than descriptive: Logseq rewrites a side-effect-free package's entry to `lsp://logseq.io/`, a different origin from the host window, which would put `parent.document` out of reach. With `effect: true` the entry stays on the app's own `file://` origin and the entry script can read and annotate the host DOM.

Logseq resolves backgrounds through `var(--lx-…, var(--ls-…, var(--rx-…)))` and re-declares both layers per accent color, so a theme rule only lands when it out-ranks the upstream selector. `test/cascade.test.mjs` asserts that pairing for each surface the theme replaces. Point `LOGSEQ_CSS` at an installed `style.css` to also check the pinned upstream selectors against the shipping app:

```sh
LOGSEQ_CSS=/path/to/Logseq/resources/app/css/style.css npm test
```

## Accessibility

The test suite checks the principal text/background combinations against WCAG contrast thresholds, and every bullet-rail hierarchy color for contrast against the black canvas and for separation from the colors of the levels beside it. The stylesheet also includes visible `:focus-visible` treatment, inverted selection, reduced-motion handling, and a forced-colors fallback.

## Attribution

The palette and interaction conventions are adapted from Microsoft's MIT-licensed Visual Studio Code Dark High Contrast theme. Visual Studio Code and VS Code are trademarks of Microsoft Corporation. This project is independent and is not affiliated with or endorsed by Microsoft.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the source and license notice.

## License

MIT
