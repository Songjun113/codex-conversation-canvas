param([switch]$AutoStart)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
& $node standalone/build.mjs
if ($LASTEXITCODE -ne 0) { throw 'Canvas build failed.' }
$scriptDir = Join-Path $env:APPDATA 'Codex++\user_scripts'
if (-not (Test-Path -LiteralPath $scriptDir)) { throw 'Codex++ userscript directory was not found.' }
$target = Join-Path $scriptDir 'conversation-canvas.user.js'
$backupDir = Join-Path $env:LOCALAPPDATA 'conversation-canvas\backups'
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
if (Test-Path -LiteralPath $target) {
    Copy-Item -LiteralPath $target -Destination (Join-Path $backupDir ("canvas-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.js'))
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'public\canvas.desktop.user.js') -Destination $target -Force
if ($AutoStart) {
    $startup = [Environment]::GetFolderPath('Startup')
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $startup 'Conversation Canvas.lnk'))
    $shortcut.TargetPath = (Get-Command pwsh -ErrorAction Stop).Source
    $shortcut.Arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "' + (Join-Path $PSScriptRoot 'start-desktop.ps1') + '"'
    $shortcut.WorkingDirectory = $PSScriptRoot
    $shortcut.WindowStyle = 7
    $shortcut.Save()
}
& (Join-Path $PSScriptRoot 'start-desktop.ps1')
