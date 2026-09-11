# Third-party notices

This theme adapts colors and high-contrast interaction conventions from the **Dark High Contrast** theme in Microsoft Visual Studio Code.

- Source: `extensions/theme-defaults/themes/hc_black.json` in `microsoft/vscode`
- Project: <https://github.com/microsoft/vscode>
- License: MIT
- Copyright: Microsoft Corporation

The upstream source was read from the installed Visual Studio Code application when version 1.0.0 of this theme was prepared.

Visual Studio Code and VS Code are trademarks of Microsoft Corporation. This project is not affiliated with or endorsed by Microsoft.

## Bundled dependency

`lib/lsplugin.user.js` is the unmodified `dist/lsplugin.user.js` build of the Logseq plugin SDK, vendored so the theme installs without a build step.

- Package: `@logseq/libs` 0.0.17
- Project: <https://github.com/logseq/logseq/tree/master/libs>
- Copyright: Logseq, Inc. and contributors

That build embeds DOMPurify 2.3.8 (© Cure53 and contributors, Apache-2.0 / MPL-2.0), per its own bundled license header.
