$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'install-fidan.mjs')
if ($LASTEXITCODE -ne 0) { throw "Fidan installer failed with exit code $LASTEXITCODE" }
