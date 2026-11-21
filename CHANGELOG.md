# Changelog

## 0.1.5

- **Chat view:** read a live session as chat messages. Right-to-left languages display correctly.
- **New Session redesign:** tabs for Chat, Folder and Slack. Browse for any folder; org, agent and model always shown.
- **No more status flicker:** cards stay on "thinking" while Claude works, and switch to waiting only when it stops.
- **Ship it per-PR review:** each PR can have its own Slack channel and GitHub reviewers.
- **Slack watcher:** add context, guide a redraft with a hint, and tell the linked session what to do. Delegated work continues until it's finished, and follow-ups in the thread go to the session.
- **Local Whisper:** transcribe meetings on your Mac with whisper.cpp, with no API key.
- **Install as an app:** Settings, then App. Notifications show as Polyergon. Includes a test-notification button.
- **Settings:** asks before you leave with unsaved changes.
- **Clear errors** when Claude Code isn't installed. Finds `claude` in `~/.local/bin` and Homebrew paths.
- Terminal upgraded to xterm 6.

## 0.1.4

- **Fix: sessions went idle right away** when installed with `npx` or `npm install -g`. The terminal helper wasn't executable, so every session exited at start and had nothing to resume.
- **Version** shown next to the Polyergon name.

## 0.1.3

- **New Session:** org, agent and model on one row, so Just chat is visible without scrolling. Enter in the name field starts a chat.
- **API key sign-in:** the model list loads with your API key. If models can't load, you can still start with the default model.
- **Slack watcher:** auto mode never posts promises. Requests that need real work go to the linked session, which does the work and replies in the thread.

## 0.1.2

- **Auto-continue after usage limits:** when Claude hits its usage limit, the card shows when it resets and Polyergon sends "continue" a minute later.
- **Stall alerts:** a session that says it's working but makes no progress for 15 minutes gets flagged.
- **Safer "ready to merge":** every reviewer must be satisfied (people approved, Copilot reviewed the latest commit, no pending requests), plus green CI, no draft and no open threads. The pipeline shows what's blocking, with a spinner while CI runs.
- **Copilot re-review:** when Copilot's review is on an older commit, Polyergon asks it to review again.
- **Calmer colors:** blue for working, amber for waiting on you, green only for done.
- **Optional email updates:** a one-time, opt-in signup on Home and in Settings.

## 0.1.1

- **Task board:** To do, In progress, Your review, PR in review, Ready to merge, Done. Each task runs in its own session; cards move on their own, from first prompt to merged PR.
- **Review changes:** full-page diff of what a session changed (or its PR), with line comments you send back to the session, or approve.
- **Git worktrees:** run a session in its own branch and folder so parallel sessions in one repo don't collide.
- **More agents:** OpenCode, plus Codex and Gemini CLI when installed.
- **Ship it:** each step is Auto or Ask me (merging asks by default). Ready to merge now also requires no draft and no unresolved review threads.
- **Start from Slack:** begin a session from a channel, thread or DM.
- **Slack watcher:** reads threads, catches the last 24h on first run, knowledge sources and answer rules, activity log.
- **App window:** opens in its own window at polyergon.localhost; installable to the Dock.
- Settings is a full page; option to keep the Mac awake while sessions run.

## 0.1.0

First public release.
