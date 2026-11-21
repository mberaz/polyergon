# Slack

Polyergon uses the Slack connector (or plugin) in Claude Code. If Claude Code can read your Slack, so can Polyergon.

## Inbox

**Slack** in the sidebar lists mentions and DMs still waiting on you. Each card has a suggested reply. You can:

- **Reply** (edit the suggestion first if you like), **react**, or **mark done**.
- **Ask session**: hand the message to a session that knows the work. It reads the thread, checks it against the code and drafts a reply. Nothing is posted until you approve.

## Channel watcher

A watcher keeps an eye on one channel, for example `#deployment` or `#support`.

**Automations → New watcher**, then choose:

- **Channel**.
- **Session** (🧠): whose knowledge the drafts use. That session also does the real work when a question needs it.
- **Mode**: **You approve each reply**, or **Answers automatically** (only new questions; older ones wait for you).
- **Every N minutes**.

### Context

Click **📚 Context** on the watcher:

- **Sources**: links, folders, other channels, notes, one per line.
- **Rules**: how to answer. For example: "Keep it short. Never say a deploy is done unless you verified it. Tag @devops for prod changes."

### Tell it what to do

The **Tell it…** box sends one instruction to the linked session:

> answer Sam with the deploy status, and say when the rollout will finish

### When a question needs real work

In auto mode, a request like "please roll out the new billing-service image" isn't answered with a promise. It goes to the linked session, which:

1. Does the work, keeps going until it's verified, and
2. asks you first before anything that changes production (deploy, set image, restart, delete), then
3. replies in the thread with what it verified.

The card shows **The session is working on it**, **Needs you** (an approval or a question, with **Open session**), or **✓ Done** with the reply. If the linked session isn't running, Polyergon resumes it first.

### Activity log

Every check, draft, reply and hand-off is in the watcher's **Activity log**.
