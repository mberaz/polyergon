# Polyergon

Run many Claude Code (and GitHub Copilot CLI) sessions side by side in one local web app, and record meetings with a live AI assistant.

> Status: early (v0.1). Tested on macOS. Linux should work for sessions but is untested. Windows is not supported.

## Features

- **Sessions:** real terminals for Claude Code or Copilot CLI in the browser. See which sessions are thinking, waiting for you, or idle. Resume, restart, compact, rename and reorder them.
- **Notifications:** desktop and sound alerts when a session needs your input.
- **Models and orgs:** pick the model per session. Keep separate Claude accounts or orgs apart, each with its own config folder and default model.
- **Auto-compact:** compact Claude's context automatically at a token limit you choose.
- **PR inbox:** your open PRs, review requests and recent merges from GitHub, linked to the session that worked on them (needs `gh`).
- **Usage:** token usage and cost per session and per org.
- **Meetings (beta, macOS):** record a call, get a live transcript, running notes, answers to your questions, and a summary. Add context to the meeting from links, files, Slack/Notion/Drive, past meetings or your sessions. Search every past recording.

## Requirements

- Node.js 20 or newer
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and logged in (and/or GitHub Copilot CLI)
- Optional: [`gh`](https://cli.github.com) for the PR inbox
- Optional, meetings: `ffmpeg`, [BlackHole](https://github.com/ExistentialAudio/BlackHole), and an OpenAI or Azure OpenAI key for transcription

## Install

```bash
git clone https://github.com/polyergon/polyergon.git
cd polyergon
npm ci
npm run build
npm start          # opens Polyergon in its own window
```

Polyergon opens in its own window (no address bar) at `http://polyergon.localhost:3030`. To keep it in the Dock, choose **Install Polyergon** from Chrome's menu.

Development mode with hot reload: `npm run dev`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3030` | Port to listen on |
| `POLYERGON_DATA_DIR` | `~/.claude-session-manager` | Where sessions, names, notes, meetings and settings are stored |
| `POLYERGON_NO_OPEN` | unset | Set to `1` to not open the browser on start |
| `POLYERGON_WINDOW` | unset | Set to `browser` to open a normal browser tab instead of the Polyergon app window |
| `POLYERGON_ALLOWED_HOSTS` | unset | Extra host names allowed to reach the app (comma-separated) |

Auto-compact, notifications and the transcription key are set in the app under **Settings**.

## Security

- Polyergon listens on `127.0.0.1` only. Requests from other websites are rejected (Origin and Host checks).
- Sessions ask before running commands or editing files, as Claude Code and Copilot normally do. **Settings → Skip permission prompts** turns that off (`--permission-mode bypassPermissions` for Claude, `--allow-all` for Copilot). Only use it with folders you trust.
- The meeting assistant runs headless with permission prompts off, so it can load links and connector content you add. Meeting audio becomes its input, so do not record meetings with people you do not trust.
- Your transcription key is stored on your machine only, in a file readable by your user only, and is never sent to the browser.

Report vulnerabilities to **security@polyergon.ai**. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
