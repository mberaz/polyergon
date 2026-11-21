-- Polyergon Installer: runs https://polyergon.ai/install.sh without Terminal.
property extraEnv : ""
set logFile to (POSIX path of (path to temporary items)) & "polyergon-install.log"
try
	display dialog "Polyergon runs your Claude Code sessions from one screen." & return & return & "This installs it in your home folder (no admin password), starts it when you log in, and opens it." buttons {"Cancel", "Install"} default button "Install" with title "Install Polyergon" with icon note
on error
	return
end try
set progress total steps to -1
set progress description to "Installing Polyergon…"
set progress additional description to "Downloading and setting up. This takes a minute or two."
try
	do shell script "export PATH=\"$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"; " & extraEnv & " POLYERGON_NO_OPEN=1 /bin/bash -c \"$(/usr/bin/curl -fsSL https://polyergon.ai/install.sh)\" > " & quoted form of logFile & " 2>&1"
on error errMsg
	set tailLog to do shell script "tail -n 6 " & quoted form of logFile & " 2>/dev/null || true"
	display dialog "Polyergon could not be installed." & return & return & tailLog & return & return & "Full log: " & logFile buttons {"OK"} default button "OK" with title "Install Polyergon" with icon stop
	return
end try
set appUrl to do shell script "grep -o 'http://localhost:[0-9]*' " & quoted form of logFile & " | tail -1"
set extraNote to ""
if (do shell script "grep -c 'Claude Code is not installed' " & quoted form of logFile & " || true") is not "0" then
	set extraNote to return & return & "One more step: install Claude Code. In Terminal run:" & return & "curl -fsSL https://claude.ai/install.sh | bash"
end if
display dialog "Polyergon is installed and running." & extraNote & return & return & "Tip: in Polyergon, Settings → App → Install Polyergon adds it to your Dock." buttons {"Open Polyergon"} default button "Open Polyergon" with title "Install Polyergon" with icon note
open location appUrl
