# Changelog

All notable changes to this package are documented here.

## 0.1.0 - 2026-09-06

- First release. **Anno: Import PDF** imports a PDF into the graph and opens
  the page it is annotated from. The command is on both the `/` menu and the
  command palette (`Cmd+Shift+P`), and both reach the same prompt.
- The prompt opens the system file chooser with it, and **Choose PDF…** reopens
  it. The page title fills itself in from the PDF's filename without its `.pdf`
  extension, re-fills while it has not been written by hand, and stays editable
  until the import.
- Importing writes the PDF to `assets/<page title>.pdf`, creates or uses the
  page of that title, and adds the asset link to it. Naming the asset after the
  page is what makes Logseq collect the PDF's highlights on `hls__<page title>`
  and store them in `assets/<page title>.edn`: Logseq derives both from the
  asset's own filename. Characters a filename cannot hold become spaces in the
  asset name; the page keeps the title exactly as it was typed.
- The asset is read back at its full length before the page is created, so a
  write the host will not make leaves no page pointing at a PDF that is not
  there.
- An asset already in the graph is never overwritten — highlights are recorded
  against that file — so the prompt stays open and asks for another title. A
  page that already exists is used as it stands, and a PDF already linked from
  it is not linked twice.
- Cancel, Escape, a click outside the prompt, and a cancelled file chooser all
  leave the graph untouched: no asset written, no page created.
- Everything the plugin writes into the host document is namespaced to Anno —
  `data-anno-*` attributes, the `anno-dialog` style key, and element ids
  beginning `anno-` — so it never reads, replaces or clears what a theme or
  another plugin wrote, and unloading it leaves their work intact.
- Enter and Escape are claimed on the host window before Logseq's own
  document-level shortcuts, and the prompt holds the focus while it is open, so
  the page title is typed into the prompt rather than into whatever is behind
  it.
