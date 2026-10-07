$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$health = $null
try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:47835/health' -TimeoutSec 2 } catch {}
if ($health.product -eq 'conversation-canvas' -and $health.mode -eq 'desktop') {
    Write-Host 'Canvas desktop service is already running.'
    exit 0
}
if ($health) { throw 'Port 47835 is occupied. Stop the standalone canvas process, then retry.' }
$node = (Get-Command node -ErrorAction Stop).Source
& $node standalone/build.mjs
if ($LASTEXITCODE -ne 0) { throw 'Canvas build failed.' }
$logDir = Join-Path $env:LOCALAPPDATA 'conversation-canvas'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$child = Start-Process -FilePath $node -ArgumentList @('standalone/desktop.mjs') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'desktop.log') -RedirectStandardError (Join-Path $logDir 'desktop-error.log') -PassThru
Start-Sleep -Seconds 2
if ($child.HasExited) { throw "Canvas service stopped. See $logDir\desktop-error.log" }
Write-Host 'Canvas service started. Click the branch icon in Codex.'
