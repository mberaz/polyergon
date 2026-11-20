import { spawn, type ChildProcess } from 'child_process'
import { getSettings } from './settingsStore'

// Settings → "Keep Mac awake": runs `caffeinate -i` (no idle sleep; the screen can still
// lock and turn off) for as long as the server runs. Settings are saved by an API route
// (separate module copy), so re-read them every 15s.
// ponytail: macOS only; closing the lid still sleeps (needs sudo pmset, which we don't do).
class KeepAwake {
  private proc: ChildProcess | null = null

  start() {
    if (process.platform !== 'darwin') return
    this.apply()
    setInterval(() => this.apply(), 15_000).unref()
  }

  private apply() {
    const want = getSettings().power.keepAwake
    if (want && !this.proc) {
      this.proc = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' })
      this.proc.on('exit', () => { this.proc = null })
    } else if (!want && this.proc) {
      this.proc.kill()
      this.proc = null
    }
  }
}

export const keepAwake = new KeepAwake()
