$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$node = Get-Command node -ErrorAction Stop
& $node.Source standalone/build.mjs
if ($LASTEXITCODE -ne 0) { throw 'Canvas build failed.' }
& $node.Source standalone/server.mjs
