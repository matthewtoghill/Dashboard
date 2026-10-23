# Opens a Claude Code session from a claude-resume://<session id> link, in Windows Terminal
# (or a PowerShell window when Windows Terminal isn't installed).
# Registered as the link handler by register-claude-resume.ps1.
#
# Any web page can fire this link, so the link only carries a session id: the folder comes from
# the Dashboard API, and only sessions the Dashboard knows about are opened.
param([string]$Url)

$ErrorActionPreference = 'Stop'
try {
  $port = if ($env:DASHBOARD_PORT) { $env:DASHBOARD_PORT } else { 3444 }
  $id = [uri]::UnescapeDataString(($Url -replace '^claude-resume:/*', '').TrimEnd('/'))
  if ($id -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
    throw "Not a Claude session id: $id"
  }

  $session = (Invoke-RestMethod "http://127.0.0.1:$port/api/claude/sessions").sessions |
    Where-Object sessionId -eq $id
  if (-not $session) { throw "The Dashboard has no Claude session $id." }
  if (-not (Test-Path -LiteralPath $session.cwd -PathType Container)) {
    throw "The session's folder no longer exists: $($session.cwd)"
  }

  if (Get-Command wt.exe -ErrorAction SilentlyContinue) {
    Start-Process wt.exe -ArgumentList @('-d', "`"$($session.cwd)`"", 'claude', '--resume', $id)
  } else {
    Start-Process powershell.exe -WorkingDirectory $session.cwd -ArgumentList @('-NoExit', '-Command', "claude --resume $id")
  }
} catch {
  # The handler runs without a console window, so show errors in a dialog
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($_.Exception.Message, 'Open Claude session') | Out-Null
}
