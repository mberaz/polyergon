# Examples

Recipes for the things Polyergon does best. Each one takes a minute to set up.

## Ship a feature without babysitting the PR

1. Start a session in your repo with **Work on a separate copy** ticked.
2. Ask: *"Add rate limiting to the /export endpoint, with tests."*
3. Click **Ship it**. Choose `#backend-prs` as the review channel. Keep the default steps.
4. Go do something else. The session opens the PR, posts it for review, fixes the review comments and CI, and asks you before merging.

## One session, four PRs, four review setups

A migration touched infrastructure, an API and the app. In one session's Ship it:

- `infra#512` → channel `#team-prs`.
- `api#88` → DM Alex.
- `app#1204` (draft) → channel `#frontend-prs`, posted only when it's marked ready.
- `worker#341` → GitHub reviewer `dana-dev`, no Slack.

Click **Choose** on each new PR panel to set it.

## Let product know, from the PR

On the PR's panel, type in **Tell Claude about this PR**:

> let Maya and Noam know in one group DM that the export limit should be a setting

The session creates the group DM, sends it, and reports the link back.

## Check the deploy after every merge

In Ship it **Steps**, set **Post-merge checks** to **Auto**, and in **Also**:

> use the post-merge-verify skill; compare error rates for 15 minutes before and after

## A #deployment channel that answers itself

1. **Automations → New watcher** on `#deployment`, linked to the session that runs your deploys.
2. Mode: **Answers automatically**.
3. **📚 Context → Rules:** *"Never say something is deployed unless you checked it. For prod changes, ask me first."*

Questions get answered from what the session knows. "Please roll out X" goes to the session, which does it (asking you before the production step) and replies with proof.

## Start from a Slack thread

**New session → Slack**, pick the thread where someone reported a bug. The session starts with the whole thread as context:

> Reproduce this, find the cause, and propose a fix.

## A meeting in Hebrew with an English summary

Settings → Meetings: **Local Whisper**, spoken language **Hebrew**. Record the meeting, then ask:

> Summarize in English: decisions, owners and dates.

## Read a Hebrew conversation properly

Open the session and click **Chat view**. Right-to-left text lines up correctly, and you can answer Claude's questions with buttons.
