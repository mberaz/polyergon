#!/usr/bin/env node
// Polyergon launcher: checks the machine, then starts the production server.
const { existsSync, chmodSync, readdirSync } = require('fs')
const { execFileSync } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')
const fail = (msg) => { console.error(`polyergon: ${msg}`); process.exit(1) }

const major = Number(process.versions.node.split('.')[0])
if (major < 20) fail(`Node 20 or newer is required (found ${process.versions.node}).`)

if (!existsSync(path.join(root, '.next', 'BUILD_ID')) || !existsSync(path.join(root, '.server-dist', 'server.js'))) {
  fail('No production build found. Run `npm run build` first.')
}

// node-pty's helper loses its exec bit on install, which makes every session exit
// at once. npx and global installs hoist node-pty next to us, so resolve it.
try {
  const prebuilds = path.join(path.dirname(require.resolve('node-pty/package.json', { paths: [root] })), 'prebuilds')
  for (const dir of readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, dir, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
} catch { /* no prebuilds dir: node-pty was built from source */ }

try {
  execFileSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { stdio: 'ignore' })
} catch {
  console.warn('polyergon: `claude` was not found on PATH. Install Claude Code: https://docs.claude.com/en/docs/claude-code')
}

process.env.NODE_ENV = 'production'
process.env.POLYERGON_ROOT = root // the updater needs to know where it's installed
if (!process.env.POLYERGON_NO_OPEN) process.env.POLYERGON_OPEN = '1'
require(path.join(root, '.server-dist', 'server.js'))
