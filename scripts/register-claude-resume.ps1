# Registers the claude-resume:// link handler (scripts/claude-resume.ps1) for the current user.
# No admin rights needed. Run again after moving the repository.
#
#   powershell -ExecutionPolicy Bypass -File scripts\register-claude-resume.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\register-claude-resume.ps1 -Unregister
param([switch]$Unregister)

$key = 'HKCU:\Software\Classes\claude-resume'
if ($Unregister) {
  Remove-Item $key -Recurse -ErrorAction SilentlyContinue
  'Removed the claude-resume:// handler.'
  return
}

$handler = Join-Path $PSScriptRoot 'claude-resume.ps1'
New-Item "$key\shell\open\command" -Force | Out-Null
Set-ItemProperty $key '(default)' 'URL:Claude Code resume'
Set-ItemProperty $key 'URL Protocol' ''
Set-ItemProperty "$key\shell\open\command" '(default)' `
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$handler`" `"%1`""
"Registered claude-resume:// -> $handler"
