# Changelog

All notable changes to this package are documented here.

## 0.1.0 - 2026-09-17

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
- **Permission requests** appear as a card with Allow, Allow for this session
  and Deny, plus an optional reason. What you allow for the session is never
  saved to a settings file, and bypassing permissions is never offered.
- **The composer.** Enter sends, Shift+Enter starts a new line, and ⌘Esc moves
  focus between the composer and the block you were editing. The toolbar
  holds:
  - an @-mention of the open page;
  - Claude Code's slash commands;
  - a count of running agents;
  - a model and effort picker;
  - the permission mode (Manual, Accept edits, Plan, Auto);
  - Send, which becomes Stop.
- **History** lists every Claude Code session in the folder, from any client,
  with search, a badge for where each started, and a command to resume it in
  a terminal. Opening one shows its transcript, and the next message resumes
  it. Sessions started in Claudseq also appear in `claude --resume` and in
  the VS Code extension.
- **The bridge**, `bridge/claudseq-bridge.mjs`, is a Node script you install
  once as a login agent. It runs `claude` for the pane. It listens on
  127.0.0.1 only, and every request needs a private token and the exact host.
  It starts `claude` without a shell and stops each one when its session
  closes, after 30 minutes unattended, or at shutdown. `install`, `uninstall`
  and `status` manage it.
- **Nothing is written to the graph.** The pane's own state goes into its
  settings file under `~/.logseq/`, and history is read from Claude Code's
  transcripts, never written.
