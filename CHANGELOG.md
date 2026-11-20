# Changelog

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
