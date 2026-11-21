# Getting started

Ten minutes from nothing to your first sessions on one screen.

## 1. Install

On a Mac, the installer sets up Node if needed, starts Polyergon at login, and opens it:

```bash
curl -fsSL https://polyergon.ai/install.sh | bash
```

Already have Node 20 or newer? You can also run:

```bash
npx polyergon
```

Polyergon opens at `http://localhost:3030`. Run the installer again any time to update.

## 2. Make sure Claude Code works

Polyergon runs the Claude Code you already have. In Terminal:

```bash
claude --version
```

If that fails, install Claude Code and sign in:

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
```

Using an API key instead of a Claude login? Set it in **Settings → Sign-in**.

## 3. Install it as an app

**Settings → App → Install Polyergon.** You get a Dock icon and its own window, and notifications come from Polyergon. Click **Send test notification** to check that they arrive.

## 4. Start a session

Click **New session**:

- **Chat**: a plain conversation, no folder.
- **Folder**: search your projects, or **Browse…** for any folder. Tick **Work on a separate copy** to give the session its own branch.
- **Slack**: start from a Slack channel, thread or DM. The session begins with that conversation as context.

Pick the org, agent and model, then **Start**.

## 5. Let it tell you when it needs you

Cards turn green and say **waiting for you** when Claude needs an answer. Turn on desktop and sound alerts in **Settings → Notifications**.

## Next

- [Sessions](sessions.md): Chat view, review changes, the task board, worktrees.
- [Ship it](ship-it.md): let PRs move on their own.
- [Slack](slack.md): an inbox that drafts, and a channel watcher.
- [Meetings](meetings.md): record, transcribe and summarize.
- [Examples](../examples.md): recipes people use every day.
