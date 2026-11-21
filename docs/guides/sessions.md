# Sessions

## The cards

Each session is a card in the sidebar:

| Status | Meaning |
|---|---|
| **thinking** (blue) | Claude is working. |
| **waiting for you** (green) | Claude finished, or is asking you something. |
| **idle** (gray) | The session isn't running. Click **Resume**. |

The card also shows the cost so far and how full the context is. Turn on **auto-compact** in Settings to compact before the context fills.

## Terminal view and Chat view

Sessions open in a real terminal. Click **Chat view** (top right) to read the same session as chat messages:

- Hebrew, Arabic and other right-to-left text displays correctly.
- When Claude asks a question or asks permission, the options show as buttons. Click one to answer.
- Write in the box at the bottom to send a message.

Click **Terminal view** to go back.

## Separate copies (worktrees)

Running several sessions in one repo? In **New session → Folder**, tick **Work on a separate copy**. The session gets its own branch and folder, so sessions don't step on each other's changes.

## Review changes

Open a session and click **Review**. You get a full-page diff of what it changed, or of its PR. Comment on any line, then send all comments back to the session, or approve.

## Task board

The **Board** turns tasks into sessions:

1. Add a task to **To do**.
2. Start it: a session picks it up (**In progress**).
3. When it's done, it waits in **Your review**.
4. Its PR moves through **PR in review** and **Ready to merge**, then **Done**.

## Usage limits and stalls

- When Claude hits its usage limit, the card shows when it resets. Polyergon sends "continue" a minute after.
- If a session says it's working but nothing changes for 15 minutes, you get a stall alert.

## Resume

- **Resume** on an idle card restarts that session where it left off.
- **New session → Resume by ID** resumes any Claude session by its ID.
- After a restart, Polyergon doesn't resume everything on its own. Resume the ones you need.

## Tips

- <kbd>⌘K</kbd> searches sessions, PRs, notes and meetings.
- Rename a session from its card menu. The name also shows in the Claude mobile app.
- Use **Remote Control** (📱 on the card) to continue a session from your phone.
