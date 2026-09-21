# Changelog

All notable changes to this package are documented here.

## 0.2.0 - 2026-09-18

- **Choose Node and Claude Code in Claudseq's settings**
  ([#78](https://github.com/handled57/logseq-dark-2026/issues/78)).
  **Node path** ends with a **Choose the folder with node…** link. It opens
  your system's folder picker and fills in the `node` in the folder you pick:
  Logseq gives plugins a folder picker but no file picker. A Node that
  Logseq can't run, such as one in a folder with a space, is refused with the
  reason.
- **New setting: Claude Code path**, for a `claude` the bridge doesn't find
  by itself. It has a chooser too. It must be a file named `claude`, or
  `claude.exe` or `claude.cmd` on Windows; the bridge runs nothing else.
  Leave it empty to let the bridge look, as before. After updating, quit and
  reopen Logseq: a bridge started by an earlier version ignores this setting.

## 0.1.1 - 2026-09-18

- **Claudseq works on Windows and Linux** as well as macOS
  ([#77](https://github.com/handled57/logseq-dark-2026/issues/77)). Installed
  on Windows, 0.1.0 found no Node, so nothing worked.
  - **Windows.** The pane starts the bridge with the `node` on your PATH,
    where Node's installer puts it; Logseq's `runCli` cannot run a path with
    a space, such as `C:\Program Files\nodejs\node.exe`. The bridge finds
    `claude.exe` from Claude Code's installer and `claude.cmd` from npm.
    Logseq starts it in a console window, which the bridge closes within a
    second or two; it then runs without one. It stops about 20 seconds after
    the last Logseq window lets go of it, as when Logseq quits, and stops
    every `claude` it started with it. The focus shortcut is **Ctrl+Shift+M**,
    because Ctrl+Esc opens the Start menu.
  - **Linux.** The pane looks for Node in `/usr/local/bin`, `/usr/bin`,
    Volta, Linuxbrew and snap. A Node path with a capital letter is refused
    with the reason: Logseq lowercases a command before it checks that it
    exists. The focus shortcut is **Ctrl+Shift+M**.
  - The **Node path** and **Working directory** settings take a Windows path.
    A Node path the pane cannot use now says why, rather than being ignored.
  - History, resuming and the **+** mention match a folder however its path
    is written: with either slash and any case of letter on Windows, and with
    or without a separator at its end everywhere.
  - Messages name each platform's own paths: Logseq's `configs.edn` and the
    bridge's log.
- **The bridge keeps its files in `~/.logseq/claudseq/`**, inside Logseq's
  own folder, rather than `~/.claudseq/`. If you ran 0.1.0, quit and reopen
  Logseq after updating, then delete `~/.claudseq/`.
- A bridge that stops while no session is open is noticed and started again
  at once, not at the next request.

## 0.1.0 - 2026-09-18

- **A Claude Code pane in the left sidebar.** Claudseq sits below Favorites
  and Recent and works like the Claude Code extension for VS Code. The header
  shows the session's title, with History and New session buttons, and folds
  the pane when clicked. Below it are a timeline of Claude's work and a
  composer. Its top edge drags to resize it, up to 60% of the window.
- **The timeline** shows:
  - your messages;
  - folded thinking;
  - each tool call with its IN and OUT, and a dot that turns green or red;
  - replies rendered as Markdown;
  - notes when agents finish;
  - a footer when a turn is interrupted or fails.

  An agent's steps fold inside its Agent row. A reply is drawn as it streams.
- **Focus mode**, on by default, works like the VS Code extension's Focus
  view. Each run of Claude's thinking and tool calls between two messages
  folds into one line that says what it holds, or what is running now, and
  opens to show it. `/focus` in the pane, or the Focus mode setting, turns
  it off.
- **Permission requests** appear as a card with Allow, Allow for this session
  and Deny, plus an optional reason. What you allow for the session is never
  saved to a settings file, and bypassing permissions is never offered.
- **The composer.** Enter sends, Shift+Enter starts a new line, and ⌘Esc moves
  focus between the composer and the block you were editing. The toolbar
  holds:
  - an @-mention of the open page;
  - `/focus` and Claude Code's slash commands;
  - a count of running agents;
  - a model and effort picker;
  - the permission mode (Manual, Accept edits, Plan, Auto);
  - Send, which becomes Stop.
- **History** lists every Claude Code session in the folder, from any client,
  with search, a badge for where each started, and a command to resume it in
  a terminal. Opening one shows its transcript, and the next message resumes
  it. Sessions started in Claudseq also appear in `claude --resume` and in
  the VS Code extension.
- **The bridge**, `bridge/claudseq-bridge.mjs`, is a Node script that runs
  `claude` for the pane. There is nothing to install: the pane starts it
  through Logseq's `runCli` whenever none answers. The first time, the pane
  asks before it adds Node to Logseq's command allowlist, which `runCli`
  requires. A **Node path** setting covers a Node the pane does not find by
  itself.
- The bridge stops when Logseq quits, however Logseq quits, and stops every
  `claude` it started. If it stops while Logseq is open, the pane starts it
  again. When it cannot start, the pane says why, with the last line of its
  log.
- The bridge listens on 127.0.0.1 only. Every request needs the exact host and
  a private token, which is new each time the bridge starts. It starts
  `claude` without a shell and stops each one when its session closes, after
  30 minutes unattended, or when the bridge stops.
- **Nothing is written to the graph.** The pane's own state goes into its
  settings file under `~/.logseq/`, and history is read from Claude Code's
  transcripts, never written.
