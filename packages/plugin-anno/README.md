# Anno for Logseq

Import a PDF into your graph and land on the page you will annotate it from.
One command, one prompt: choose the file, name the page.

Anno is a plugin, not a theme. It writes an asset and an ordinary Logseq link
and styles nothing; the annotating itself is Logseq's own PDF viewer, unchanged.

## Importing a PDF

- Type `/` and choose **Anno: Import PDF**.
- Or press `Cmd+Shift+P` (`Ctrl+Shift+P` on Windows and Linux) and choose
  **Anno: Import PDF** from the command palette.

Either one opens the same prompt, and the system file chooser opens with it,
because choosing the PDF is the first thing the command is for. **Choose PDF…**
reopens the chooser for a second look; cancelling it leaves the prompt open with
nothing chosen.

**Page title** fills itself in from the PDF's filename, without its `.pdf`
extension, and you can rewrite it before importing. Choosing a different PDF
re-fills a title you have not written; one you have typed is left alone.

**Import** — or Enter — writes the PDF into the graph and opens the page.
**Cancel**, Escape, or a click outside the prompt leaves the graph exactly as it
was: no file imported, no page created.

## What the import does

Given the title `Moby Dick`, Anno:

1. writes the PDF to `assets/Moby Dick.pdf` inside your graph folder;
2. creates the page **Moby Dick**, or uses it if you already have one; and
3. opens that page and adds the block `![Moby Dick](../assets/Moby Dick.pdf)`.

Click that link and Logseq's PDF viewer opens. Every highlight you make in it is
collected by Logseq on the page **hls__Moby Dick**, and its data is stored in
`assets/Moby Dick.edn` beside the PDF.

That page name is not a coincidence, and it is the reason the prompt asks for a
title rather than accepting the filename: Logseq derives the highlight store and
the annotation page from the asset's own filename, so naming the asset after the
page is what puts the annotations under the name you chose. Import the same PDF
as `Whaling notes` instead and the highlights are collected on
**hls__Whaling notes**.

### Titles and filenames

A page title may hold characters a filename may not — `/`, `:`, `?`, `*` among
them. Anno puts a space in place of each one when it names the asset, so a page
called `Reading/Moby Dick: a log` keeps that title and its PDF is
`assets/Reading Moby Dick a log.pdf`, annotated on
**hls__Reading Moby Dick a log**. The page is still a page under the `Reading`
namespace; only the file beside it is renamed.

A title made entirely of such characters names no file, and the prompt says so
rather than importing.

### A PDF that is already there

Anno never overwrites an asset: a PDF already at that name has highlights
recorded against it, and replacing the file underneath them would leave the
highlights pointing into a document that is no longer there. The prompt stays
open and asks for a different title.

A *page* that already exists is used as it stands — the PDF is added to it, and
nothing on it is replaced. Importing the same PDF onto the page it is already
linked from adds no second link.

## Templates

Anno's settings include an **Annotation page template** dropdown. Its choices
are the names in `template` properties on blocks and pages in the current
graph, plus **No template**, which keeps the plain-page behavior described
above.

When a template is selected, Anno applies it only when the import creates a new
page. A page that already exists is never templated or replaced. Anno also
makes sure the new page carries Logseq's PDF metadata: if the template does not
provide `file` or `file-path`, Anno adds the missing property with the imported
PDF's link or relative asset path. A template's own value for either property
is left unchanged.

The **Annotation/highlight template** dropdown uses the same choices. When
selected, Anno copies that template's properties directly onto each new PDF
annotation block Logseq creates. It does not add template blocks or blank child
blocks, and it leaves the highlight's quoted text, UUID, and existing PDF
properties intact. The source's `template` marker is not copied. Existing
annotation blocks are not changed, and **No template** leaves new highlights in
Logseq's normal form.

## Compatibility

Anno targets **Logseq 0.10.15 classic/file graphs on desktop**.

- DB graphs are not supported in this release.
- Mobile is not an advertised target: the import writes into the graph folder
  through the desktop app's own file bridge.
- The plugin declares `effect: true`, which keeps its entry on the host's own
  origin. Without it both the host document, where the prompt is drawn, and the
  host's file bridge, which the asset is written through, are out of reach.
- Anno works with any theme, or none. Its one piece of chrome, the import
  prompt, carries a fallback for every colour it names.
- Template choices are read when the plugin starts. Reload Anno after adding or
  renaming a template so the dropdown reflects the graph.

## Install from the Logseq Marketplace

After the plugin is accepted into the marketplace:

1. Open **Plugins → Marketplace → Plugins**.
2. Search for **Anno** and install it.

## Load the repository as an unpacked plugin

1. Clone or download this repository.
2. In Logseq, enable **Settings → Advanced → Developer mode**.
3. Run `npm run build` from the repository root.
4. Open **Plugins**, choose **Load unpacked plugin**, and select
   `dist/logseq-anno/`.

No dependency installation or compilation is needed to use the plugin.

## Development

```sh
npm test --workspace packages/plugin-anno            # the package's own suites
npm run check --workspace packages/plugin-anno       # test, build and verify the ZIP
```

`test/package.test.mjs` covers the package's structure and metadata;
`test/anno.test.mjs` drives the entry script against a stub host document and
file bridge, from either command through to the asset and the page it writes.

## Attribution

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the vendored Logseq
SDK.

## License

MIT. Release tooling copies the repository root [`LICENSE`](../../LICENSE) into every staged package and archive.
