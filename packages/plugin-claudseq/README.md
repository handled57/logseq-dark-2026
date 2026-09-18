# Claudseq

A Claude Code pane in Logseq's left sidebar. Claudseq puts a chat with your
locally installed `claude` CLI below Favorites and Recent, and it looks and
works like Anthropic's Claude Code extension for VS Code. The pane shows what
Claude says and does as it happens. Claude asks you before it edits or runs
anything. Every past session in the folder can be reopened and resumed.

Claude works in your graph's folder, so it can read your pages, search them and,
with your permission, edit them. Claudseq itself writes nothing to your graph.

## Requirements

- Logseq 0.10.15 desktop on macOS, with a classic (file) graph. DB graphs, the
  web build and mobile are not supported.
- [Claude Code](https://code.claude.com/docs/en/overview) installed and signed
  in, so that `claude` runs in your terminal.
- Node.js 20 or later. Claudseq looks for it in `/opt/homebrew/bin`,
  `/usr/local/bin`, `~/.volta/bin` and `/opt/local/bin`. If yours is
  elsewhere, as with nvm, fnm or asdf, set **Node path** in Claudseq's
  settings.

## Install

1. **Install the plugin.** Load the unpacked `logseq-claudseq` folder from
   **Settings → Plugins → Load unpacked plugin**, or unzip a release archive
   into `~/.logseq/plugins/`. That folder is the one in the release archive,
   or `dist/logseq-claudseq/` in a clone after `npm run build`. The source
   folder, `packages/plugin-claudseq/`, lacks Logseq's SDK: loaded, it never
   starts, and Logseq reports that it takes too long to load.
2. **Allow Node, once.** The first time the pane opens, it asks to add Node
   to Logseq's command allowlist and shows the path it found. Press
   **Allow**.

That is all. There is nothing to run in a terminal.

### Why Claudseq asks

Claudseq runs `claude` through a small companion process called the bridge.
A Logseq plugin cannot start a program itself. What Logseq offers plugins
instead is `runCli`, which runs only the commands on its allowlist. Git is on
that list by default; Node is not. **Allow** adds the Node path to
`:commands-allowlist` in `~/Library/Application Support/Logseq/configs.edn`,
and the pane uses it for one thing: starting the bridge.

The list is Logseq's, not Claudseq's. Once Node is on it, Logseq lets any
plugin run that Node through `runCli`, as every plugin can already run Git.

## The bridge

The bridge, `bridge/claudseq-bridge.mjs`, is a Node script in the plugin's
folder. The pane starts it when no bridge answers, which is usually the
first time the pane opens after Logseq starts, and shows **Starting the
Claudseq bridge…** for about a second. Every Logseq window shares the one
bridge.

- It finds `claude` and your login shell's `PATH`, because Logseq started
  from the Dock has neither.
- It writes `~/.claudseq/bridge.json`, readable only by you, with its port
  and a random token that is new each time it starts.
- It stops when Logseq quits, however Logseq quits, and stops every `claude`
  it started. A reply Claude is still writing then ends. The session's
  transcript keeps everything up to that point, and your next message
  resumes it.
- If it stops while Logseq is open, the pane starts it again.

## Using the pane

- **Header.** It shows the session's title. **History** (the clock) lists past
  sessions and **New session** (the speech bubble) starts a fresh one. Click
  the header to fold the pane, as you would Favorites or Recent. Drag the
  pane's top edge to change its height, up to 60% of the window, so Favorites
  and Recent stay in reach.
- **Timeline.** Each thing Claude does is a dot on the line:
  - your messages;
  - its thinking, folded until you open it;
  - each tool call, with its input (**IN**) and result (**OUT**), and a dot
    that turns green on success or red on failure;
  - its replies, rendered as Markdown;
  - notes such as `Agent "…" finished`.

  An agent's own steps fold inside its Agent row.
- **Permission requests.** In Manual mode, Claude asks before it edits a file
  or runs a command. Choose **Allow**, **Allow for this session** or **Deny**.
  You can give a reason when you deny. "For this session" is never saved to a
  settings file.
- **Composer.** **Enter** sends and **Shift+Enter** starts a new line. While
  **Focus mode** is on, **⌘Esc** moves focus between the composer and the
  block you were editing.
- **Toolbar**, from left to right:
  - **+** mentions the page you have open, by its file path;
  - **/** lists Claude Code's slash commands;
  - **● N agents** appears while background agents run;
  - the **model and effort** pill picks either;
  - the **hand** button cycles the permission mode through Manual, Accept
    edits, Plan and Auto. In a narrow sidebar it shows only the hand; hover
    it for the mode's name;
  - **Send** becomes **Stop** while Claude is working.
- **History.** It lists this folder's sessions, newest first, from any Claude
  Code client, with a badge for where each started: CLI, VS Code, Claudseq and
  so on. Search filters the list. **Copy resume command** in a session's menu
  gives you `claude --resume <id>` for a terminal. Opening a session shows its
  transcript, and your next message resumes it.

Sessions Claudseq starts are ordinary Claude Code sessions. They appear in
`claude --resume` and in the VS Code extension's history too.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Working directory | empty | The folder Claude works in. Empty means the current graph's folder. |
| Model for new sessions | default | `default` follows your Claude Code configuration; otherwise `fable`, `opus`, `sonnet` or `haiku`. |
| Effort for new sessions | default | `low` to `max`. A change applies from the next session. |
| Permission mode for new sessions | default | `default` is Manual. The pane's mode button changes it too. |
| Focus mode | on | ⌘Esc moves focus between the composer and the block you were editing. The command palette lists it as **Claudseq: Focus or unfocus Claude**. Off removes both at once and leaves ⌘Esc to Logseq and other plugins. |
| Node path | empty | The Node.js, version 20 or later, that starts the bridge. Empty means the first one found in the places listed under Requirements. Logseq runs it through a shell, so it cannot contain spaces; a symlink to Node works. |

Whether the pane is folded, its height and which session was open are kept
with these settings, in Claudseq's own settings file under `~/.logseq/`.
Nothing goes into your graph.

## How it stays private

- The bridge listens on `127.0.0.1` only. It answers a request only when the
  `Host` header is exactly `127.0.0.1:<port>` and the request carries the
  token from `~/.claudseq/bridge.json`. A web page cannot read that file.
- The pane starts the bridge through Logseq's `runCli`, which goes through a
  shell. The bridge's path is quoted for it, and nothing you type is ever
  part of that command.
- The bridge starts `claude` directly, never through a shell. Your message
  reaches Claude only as data on its standard input.
- It never uses `bypassPermissions` and never grants it. "Allow for this
  session" is scoped to the running session only.
- History is read from Claude Code's own transcripts in `~/.claude/projects/`.
  The bridge never writes there.
- A session's `claude` process stops when you leave the session, after 30
  minutes with no pane attached, and when the bridge stops.

## Uninstall

1. Remove the plugin in Logseq.
2. To take Node off Logseq's allowlist, delete its path from
   `:commands-allowlist` in
   `~/Library/Application Support/Logseq/configs.edn`, then restart Logseq.
3. Delete `~/.claudseq/`, which holds only the bridge's config and log.

Your Claude Code sessions stay in `~/.claude/projects/`.

## Troubleshooting

- When the bridge will not start, the pane says why, with the last line of
  the bridge's log. The whole log is `~/.claudseq/bridge.log`. It also lists
  every request the bridge refused because of its origin or host.
- To ask a running bridge for its health, run
  `node <plugin folder>/bridge/claudseq-bridge.mjs status`.
- If the pane cannot find `claude`, install Claude Code and press **Retry**.
- If the pane says the bridge is an older version, which happens after
  Claudseq is updated while Logseq is open, quit and reopen Logseq.

## Left out on purpose

The VS Code extension has a few controls Claudseq does not reproduce:

- the microphone;
- the unlabelled stack icon in the header;
- the unlabelled clock in the toolbar.

A question Claude asks with its `AskUserQuestion` tool arrives as a
permission request, not a question form. Deny it with your answer as the
reason, or answer in your next message.

Claudseq is not published to the Logseq Marketplace.
