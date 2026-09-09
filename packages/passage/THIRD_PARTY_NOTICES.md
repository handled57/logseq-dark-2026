# Third-party notices

## Bundled Bible text

`resources/net.text.json` carries the verse text of the **New English
Translation (NET)**, retrieved through the NET Bible API and reformatted into
this plugin's own index. The text is copyright The NET Bible®,
<https://netbible.com>, and is used under the terms published with the service.

- Service: <https://labs.bible.org/api_web_service>
- Copyright and permissions: <https://netbible.com/copyright/>

No other translation's verse text is committed to this repository or included in
a release archive.

## Bundled dependency

`lib/lsplugin.user.js` is the unmodified `dist/lsplugin.user.js` build of the Logseq plugin SDK, vendored so the plugin installs without a build step.

- Package: `@logseq/libs` 0.0.17
- Project: <https://github.com/logseq/logseq/tree/master/libs>
- Copyright: Logseq, Inc. and contributors

That build embeds DOMPurify 2.3.8 (© Cure53 and contributors, Apache-2.0 / MPL-2.0), per its own bundled license header.
