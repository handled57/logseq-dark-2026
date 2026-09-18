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
- Node.js 20 or later on your login `PATH`. The bridge is a Node script.

## Install

1. **Install the plugin.** Load the unpacked `logseq-claudseq` folder from
   **Settings → Plugins → Load unpacked plugin**, or unzip a release archive
   into `~/.logseq/plugins/`.
2. **Install the bridge, once.** A Logseq plugin cannot start programs, so
   Claudseq runs `claude` through a small companion process called the bridge.
   Until the bridge is installed, the pane shows the exact command. It looks
   like this:

   ```sh
   node ~/.logseq/plugins/logseq-claudseq/bridge/claudseq-bridge.mjs install
   ```

   `install` finds `claude` on your login `PATH` and copies the bridge to
   `~/.claudseq/`. It writes `~/.claudseq/bridge.json`, readable only by you,
   with a random token and the port. Then it registers a login agent,
   `io.github.handled57.logseq-claudseq`, so the bridge starts now and at every
   login.
3. **Press Retry** in the pane, or reload the plugin.

Run `install` again after updating Claudseq, if the pane says the bridge is
out of date, or after moving `claude`. Reinstalling issues a new token, which
the pane picks up by itself.

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
- **Composer.** **Enter** sends and **Shift+Enter** starts a new line. **⌘Esc**
  moves focus between the composer and the block you were editing.
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

Whether the pane is folded, its height and which session was open are kept
with these settings, in Claudseq's own settings file under `~/.logseq/`.
Nothing goes into your graph.

## How it stays private

- The bridge listens on `127.0.0.1` only. It answers a request only when the
  `Host` header is exactly `127.0.0.1:<port>` and the request carries the
  token from `~/.claudseq/bridge.json`. A web page cannot read that file.
- It starts `claude` directly, never through a shell. Your message reaches
  Claude only as data on its standard input.
- It never uses `bypassPermissions` and never grants it. "Allow for this
  session" is scoped to the running session only.
- History is read from Claude Code's own transcripts in `~/.claude/projects/`.
  The bridge never writes there.
- A session's `claude` process stops when you leave the session, after 30
  minutes with no pane attached, and when the bridge stops.

## Uninstall

```sh
node ~/.claudseq/claudseq-bridge.mjs uninstall
```

This unloads the login agent and deletes `~/.claudseq`. Then remove the plugin
in Logseq. Your Claude Code sessions stay in `~/.claude/projects/`.

## Troubleshooting

- `node ~/.claudseq/claudseq-bridge.mjs status` asks the running bridge for its
  health.
- The bridge logs to `~/.claudseq/bridge.log`, including any request it
  refused because of its origin or host.
- If the pane cannot find `claude`, install Claude Code and run `install`
  again.

## Left out on purpose

The VS Code extension has a few controls Claudseq does not reproduce:

- the microphone;
- the unlabelled stack icon in the header;
- the unlabelled clock in the toolbar.

A question Claude asks with its `AskUserQuestion` tool arrives as a
permission request, not a question form. Deny it with your answer as the
reason, or answer in your next message.

Claudseq is not published to the Logseq Marketplace.
