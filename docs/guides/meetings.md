# Meetings (beta, macOS)

Record a call and get a live transcript, running notes, answers to your questions, and a summary.

## Set up once

1. **Audio:** install `ffmpeg` and [BlackHole](https://github.com/ExistentialAudio/BlackHole) so Polyergon hears both you and the other side:

   ```bash
   brew install ffmpeg blackhole-2ch
   ```

2. **Transcription:** in **Settings → Meetings**, pick one:
   - **Local Whisper (free, offline):** `brew install whisper-cpp`, then click **Download model** (about 550 MB). Nothing leaves your Mac.
   - **OpenAI** or **Azure OpenAI**: paste a key.

3. **Spoken language:** leave **Detect automatically**, or pick the main language (for example Hebrew). Pick it if words come out in the wrong language. English terms inside still come through.

## Record

**Meetings → New meeting**, give it a title, and **Start**. While it records:

- The transcript updates every few seconds.
- Notes build up as the meeting goes.
- Ask a question about what was said ("what did we decide about the rollout?").
- Add context: links, Slack channels, past meetings or a session, so the notes know what you know.

**Stop** when you're done. You get a summary with decisions and action items.

## After

- Search every recording.
- Continue a stopped meeting.
- Send the summary to a Slack channel.
