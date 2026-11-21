#!/bin/bash
# Polyergon installer for macOS:  curl -fsSL https://polyergon.ai/install.sh | bash
# Installs Node (if needed) and Polyergon under ~/.polyergon, starts it at login,
# and opens it. No sudo. Run it again to update.
# Install a specific build: POLYERGON_PKG=<npm spec or tarball URL> (default: latest GitHub release)
# Uninstall: launchctl bootout gui/$(id -u)/ai.polyergon; rm -rf ~/.polyergon ~/Library/LaunchAgents/ai.polyergon.plist
set -euo pipefail

BASE="${POLYERGON_HOME:-$HOME/.polyergon}"
PORT="${POLYERGON_PORT:-3030}"
LABEL="${POLYERGON_LABEL:-ai.polyergon}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/Polyergon.log"

say() { printf '\033[1m==>\033[0m %s\n' "$1"; }
die() { printf '\033[31mpolyergon:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "This installer is for macOS. Elsewhere, run: npx polyergon"

# Node 20+: use yours if you have it, otherwise a private copy in $BASE/node
NODE=""
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then
  NODE="$(command -v node)"
elif [ -x "$BASE/node/bin/node" ]; then
  NODE="$BASE/node/bin/node"
else
  case "$(uname -m)" in arm64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) die "Unsupported Mac CPU: $(uname -m)" ;; esac
  say "Installing Node 22 (private copy in $BASE/node)"
  DIST="https://nodejs.org/dist/latest-v22.x"
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "$DIST/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  FILE="$(grep -o "node-v[0-9.]*-darwin-$ARCH.tar.gz" "$TMP/SHASUMS256.txt" | head -1)"
  [ -n "$FILE" ] || die "Could not find a Node download for darwin-$ARCH"
  curl -fsSL "$DIST/$FILE" -o "$TMP/$FILE"
  (cd "$TMP" && grep " $FILE\$" SHASUMS256.txt | shasum -a 256 -c - >/dev/null) || die "Node download failed its checksum"
  mkdir -p "$BASE/node"
  tar -xzf "$TMP/$FILE" -C "$BASE/node" --strip-components=1
  NODE="$BASE/node/bin/node"
fi
NPM="$(dirname "$NODE")/npm"
say "Using Node $("$NODE" -v)"

# Latest GitHub release (available the moment it's cut; npm lags), else npm
PKG="${POLYERGON_PKG:-$(curl -fsSL https://api.github.com/repos/polyergon/polyergon/releases/latest 2>/dev/null | grep -o 'https://github.com/[^"]*\.tgz' | head -1)}"
PKG="${PKG:-polyergon@latest}"
say "Installing Polyergon ($(basename "$PKG" .tgz))"
mkdir -p "$BASE/app"
PATH="$(dirname "$NODE"):$PATH" "$NPM" install --prefix "$BASE/app" --no-fund --no-audit --loglevel=error "$PKG" >/dev/null
BIN="$BASE/app/node_modules/polyergon/bin/polyergon.js"
[ -f "$BIN" ] || die "Install failed: $BIN is missing"

# Start at login and keep running. Sessions need claude, git and gh on PATH.
say "Starting Polyergon at login (port $PORT)"
mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
SVC_PATH="$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$(dirname "$NODE")"
DATA_ENV=""
[ -n "${POLYERGON_DATA_DIR:-}" ] && DATA_ENV="<key>POLYERGON_DATA_DIR</key><string>$POLYERGON_DATA_DIR</string>"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$BIN</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PORT</key><string>$PORT</string>
    <key>POLYERGON_NO_OPEN</key><string>1</string>
    <key>POLYERGON_LABEL</key><string>$LABEL</string>
    <key>PATH</key><string>$SVC_PATH</string>
    $DATA_ENV
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

URL="http://localhost:$PORT"
for _ in $(seq 1 60); do curl -fsS -o /dev/null "$URL" 2>/dev/null && break; sleep 1; done
curl -fsS -o /dev/null "$URL" 2>/dev/null || die "Polyergon did not start. See $LOG"

if ! PATH="$SVC_PATH" command -v claude >/dev/null 2>&1; then
  printf '\nClaude Code is not installed yet. Install it, then sign in:\n  curl -fsSL https://claude.ai/install.sh | bash\n'
fi
printf '\n\033[1mPolyergon is running at %s\033[0m\nTo add it to your Dock: Settings → App → Install Polyergon.\nUpdate any time by running this installer again.\n' "$URL"
[ -n "${POLYERGON_NO_OPEN:-}" ] || open "$URL"
