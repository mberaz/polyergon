# Everything Polyergon does

A full list, grouped by area. Each area links to its guide.

## Sessions ([guide](guides/sessions.md))

- **Every session on one screen.** Real Claude Code and GitHub Copilot CLI terminals in the browser, side by side.
- **Know who needs you.** Each card shows **thinking**, **waiting for you** or **idle**, without flickering while Claude works. Waiting sessions glow green and can send a desktop and sound alert.
- **Cost and context.** Each card shows what the session cost and how close it is to auto-compacting. Auto-compact can run before the context fills.
- **New session, your way.** Three tabs: **Chat** (no folder), **Folder** (search, or **Browse…** for any folder) and **Slack** (start from a channel, thread or DM so the session has that context). Pick org, agent and model on one row.
- **Work on a separate copy.** Run a session in its own git worktree and branch, so parallel sessions in one repo don't collide.
- **Chat view.** Read a live session as chat messages instead of the terminal. Right-to-left languages (Hebrew, Arabic) display correctly. Claude's questions and permission prompts show as buttons you can click.
- **Resume anything.** Resume by session ID, resume one idle session, or all of them.
- **Usage limits handled.** When Claude hits its usage limit, the card shows when it resets and Polyergon sends "continue" a minute after.
- **Stall alerts.** A session that says it's working but makes no progress for 15 minutes gets flagged.
- **Review changes.** A full-page diff of what a session changed (or its PR), with line comments you send back to the session, or approve.
- **Task board.** To do, In progress, Your review, PR in review, Ready to merge, Done. Each task runs in its own session and moves on its own.
- **Search everything** with <kbd>⌘K</kbd>.
- **Remote Control.** Open a session from the Claude mobile app or claude.ai.

## Ship it: PRs that move on their own ([guide](guides/ship-it.md))

- **The loop you usually babysit:** open the PR, ask for review, fix review comments, fix failing CI, merge, and optional post-merge checks.
- **Auto or Ask me** for each step. Fix rounds are capped per PR (3 by default).
- **Every PR the session opens.** New PRs show up in about 15 seconds, each in its own panel.
- **Review setup per PR:** a Slack channel, people to DM (picked from your Slack workspace) and GitHub reviewers. Nothing is posted until you choose.
- **Drafts wait.** A draft isn't sent for review until it's marked ready.
- **Ready to merge means ready:** approved, CI green, no unresolved threads, no "changes requested", and reviewers you chose have reviewed. Copilot is asked to re-review the latest commit.
- **Live status per PR:** Claude is working on it now, queued, waiting for you, watching, or stopped, with when it was last checked.
- **Tell Claude about a PR**, like "let product know it's ready", from the PR's panel.
- **Post-merge checks (optional):** after merge, the session checks CI on main, the deploy and logs, plus your own instructions.
- **Close a PR** you're finished with. It folds into a green "finished" line; click it to bring it back.
- **Slack thread tracking:** who claimed the review, from replies and 👀 reactions.

## Slack ([guide](guides/slack.md))

- **Inbox:** mentions and DMs still waiting on you, each with a suggested reply. Reply, react, mark done, or hand it to a session.
- **Channel watcher:** finds unanswered questions in a channel and drafts replies from a session's knowledge plus your sources and rules.
- **Approve each reply, or answer automatically.** Questions that need real work go to the linked session, which does it and replies in the thread.
- **Tell it…** what to do now, in plain words ("answer Sam with the deploy status").
- **Redraft with a hint**, edit the context, and see every action in an activity log.
- **Follow-through:** follow-ups in a thread go to the session working on it. A stopped session is resumed first. Cards show working, needs you, or done.

## Meetings, beta, macOS ([guide](guides/meetings.md))

- **Record a call**, with a live transcript, running notes, answers to your questions and a summary.
- **Transcription your way:** free and offline with local Whisper (whisper.cpp), or OpenAI or Azure OpenAI. Choose the spoken language, or detect it.
- **Add context** from links, Slack channels, past meetings or sessions.
- **Search every recording**, continue a stopped one, and send the summary to Slack.

## Everything else

- **Orgs:** separate Claude accounts, each with its own login (or API key), Slack workspace, skills, plugins and automations.
- **Skills and plugins:** browse, write and install them per org.
- **PRs:** your open PRs, review requests and merges from GitHub (needs `gh`).
- **Usage:** token cost per session and per org.
- **Notes** with reminders, and a **Home** dashboard of everything that needs you.
- **Install as an app:** a Dock icon, and notifications that come from Polyergon (Settings → App).
- **Mac installer:** `curl -fsSL https://polyergon.ai/install.sh | bash` sets up everything and starts at login.
- **Local and private:** listens on 127.0.0.1 only, keys stay in a file only you can read, MIT licensed.
