$ErrorActionPreference = 'Stop'

$required = @(
  'FIDAN_URL',
  'FIDAN_SHA256',
  'FIDAN_BINARY_RELPATH',
  'FIDAN_INSTALL_DIR',
  'GITHUB_PATH'
)
foreach ($name in $required) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $name"
  }
}

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("fidan-setup-" + [System.Guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $workDir 'fidan.tar.gz'
$extractDir = Join-Path $workDir 'extract'
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
New-Item -ItemType Directory -Force -Path $env:FIDAN_INSTALL_DIR | Out-Null

Invoke-WebRequest -Uri $env:FIDAN_URL -OutFile $archivePath
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
if ($hash -ne $env:FIDAN_SHA256.ToLowerInvariant()) {
  throw "Checksum mismatch for downloaded Fidan archive. Expected $($env:FIDAN_SHA256), got $hash"
}

tar -xzf $archivePath -C $extractDir

$candidate = Join-Path $extractDir $env:FIDAN_BINARY_RELPATH
if (-not (Test-Path -LiteralPath $candidate)) {
  $dirs = Get-ChildItem -LiteralPath $extractDir -Directory
  if ($dirs.Count -ge 1) {
    $nested = Join-Path $dirs[0].FullName $env:FIDAN_BINARY_RELPATH
    if (Test-Path -LiteralPath $nested) {
      $candidate = $nested
    }
  }
}

if (-not (Test-Path -LiteralPath $candidate)) {
  throw "Downloaded archive does not contain expected binary: $($env:FIDAN_BINARY_RELPATH)"
}

$installPath = Join-Path $env:FIDAN_INSTALL_DIR $env:FIDAN_BINARY_RELPATH
$installParent = Split-Path -Parent $installPath
New-Item -ItemType Directory -Force -Path $installParent | Out-Null
Copy-Item -LiteralPath $candidate -Destination $installPath -Force
Add-Content -LiteralPath $env:GITHUB_PATH -Value $installParent
Remove-Item -LiteralPath $workDir -Recurse -Force
