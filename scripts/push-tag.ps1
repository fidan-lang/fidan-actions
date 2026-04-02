[CmdletBinding(SupportsShouldProcess = $true, DefaultParameterSetName = 'Release')]
param(
  [Parameter(Mandatory = $true, ParameterSetName = 'Release')]
  [string]$ReleaseVersion,

  [Parameter(Mandatory = $true, ParameterSetName = 'Major')]
  [string]$MajorTag,

  [string]$Target = 'HEAD',
  [string]$Remote = 'origin',
  [switch]$Force,
  [switch]$UpdateMatchingMajor
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & git @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Test-GitRefExists {
  param([Parameter(Mandatory = $true)][string]$Ref)

  & git rev-parse --verify --quiet $Ref *> $null
  return $LASTEXITCODE -eq 0
}

function ConvertTo-ReleaseTag {
  param([Parameter(Mandatory = $true)][string]$Value)

  $trimmed = $Value.Trim()
  if ($trimmed -notmatch '^v?\d+\.\d+\.\d+$') {
    throw "ReleaseVersion must look like 1.2.3 or v1.2.3. Got '$Value'"
  }

  if ($trimmed.StartsWith('v')) {
    return $trimmed
  }

  return "v$trimmed"
}

function ConvertTo-MajorTag {
  param([Parameter(Mandatory = $true)][string]$Value)

  $trimmed = $Value.Trim()
  if ($trimmed -notmatch '^v?\d+$') {
    throw "MajorTag must look like 1 or v1. Got '$Value'"
  }

  if ($trimmed.StartsWith('v')) {
    return $trimmed
  }

  return "v$trimmed"
}

function Get-MatchingMajorTag {
  param([Parameter(Mandatory = $true)][string]$ReleaseTag)

  if ($ReleaseTag -notmatch '^v(\d+)\.\d+\.\d+$') {
    throw "Cannot derive major tag from '$ReleaseTag'"
  }

  return "v$($Matches[1])"
}

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) {
  throw 'This script must run inside a git repository.'
}

Set-Location $repoRoot

$currentBranch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to determine current git branch.'
}

Write-Host "Current branch: $currentBranch"

switch ($PSCmdlet.ParameterSetName) {
  'Release' {
    $tag = ConvertTo-ReleaseTag -Value $ReleaseVersion
    if (Test-GitRefExists -Ref "refs/tags/$tag") {
      throw "Tag '$tag' already exists. Refusing to overwrite a release tag."
    }

    if ($PSCmdlet.ShouldProcess($tag, "Create and push release tag to $Remote")) {
      Invoke-Git -Arguments @('tag', '-a', $tag, $Target, '-m', "Release $tag")
      Invoke-Git -Arguments @('push', $Remote, "refs/tags/$tag")
      Write-Host "Pushed release tag $tag to $Remote ($Target)"
    }

    if ($UpdateMatchingMajor) {
      $major = Get-MatchingMajorTag -ReleaseTag $tag
      $pushArgs = @('push', $Remote, "refs/tags/$major")

      if ($PSCmdlet.ShouldProcess($major, "Move and push major tag to $Remote")) {
        if (Test-GitRefExists -Ref "refs/tags/$major") {
          Invoke-Git -Arguments @('tag', '-fa', $major, $Target, '-m', "Major tag $major -> $tag")
          $pushArgs += '--force'
        }
        else {
          Invoke-Git -Arguments @('tag', '-a', $major, $Target, '-m', "Major tag $major -> $tag")
        }
        Invoke-Git -Arguments $pushArgs
        Write-Host "Pushed major tag $major to $Remote ($Target)"
      }
    }
  }

  'Major' {
    $tag = ConvertTo-MajorTag -Value $MajorTag
    $pushArgs = @('push', $Remote, "refs/tags/$tag")

    if (Test-GitRefExists -Ref "refs/tags/$tag") {
      if (-not $Force) {
        throw "Major tag '$tag' already exists. Re-run with -Force to move it."
      }

      if ($PSCmdlet.ShouldProcess($tag, "Move and push major tag to $Remote")) {
        Invoke-Git -Arguments @('tag', '-fa', $tag, $Target, '-m', "Move major tag $tag")
        $pushArgs += '--force'
        Invoke-Git -Arguments $pushArgs
        Write-Host "Force-pushed major tag $tag to $Remote ($Target)"
      }
    }
    else {
      if ($PSCmdlet.ShouldProcess($tag, "Create and push major tag to $Remote")) {
        Invoke-Git -Arguments @('tag', '-a', $tag, $Target, '-m', "Create major tag $tag")
        Invoke-Git -Arguments $pushArgs
        Write-Host "Pushed major tag $tag to $Remote ($Target)"
      }
    }
  }
}
