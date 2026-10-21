# setup

Install the Fidan CLI in GitHub Actions.

## Purpose

This action resolves a Fidan version from the public release manifest, downloads
the matching archive for the current runner, validates its checksum, installs
it into a local directory, restores/saves cache when enabled, and exposes the
binary through both `PATH` and an explicit output.

## Usage

```yaml
- name: Setup Fidan
  uses: fidan-lang/fidan-actions/setup@v1
  with:
    version: latest
```

Pin a version explicitly:

```yaml
- name: Setup Fidan
  uses: fidan-lang/fidan-actions/setup@v1
  with:
    version: 1.0.0
```

Then call the CLI normally:

```yaml
- name: Check docs fences
  run: fidan --help
```

## Inputs

- `version`
  - exact version such as `1.0.0`
  - or `latest`
  - default: `latest`
- `manifest-url`
  - URL of the Fidan release manifest JSON
  - default: `https://releases.fidan.dev/manifest.json`
- `install-dir`
  - install directory used on the runner
  - default: `${{ runner.temp }}/fidan`
- `cache`
  - enable or disable action-level caching
  - default: `true`

## Outputs

- `fidan-bin`
- `install-dir`
- `version-resolved`
- `host-triple`
- `cache-hit`

## Integrity and installation contract

The release manifest fetched over HTTPS is the publisher trust anchor. Its archive
SHA-256 authenticates downloaded bytes; an alternate `manifest-url` explicitly
selects a different trusted publisher. This is checksum integrity, not detached
signature verification. Pin a reviewed action commit SHA for immutable workflows.
`latest` selects stable SemVer releases; prereleases require an explicit version.

Restored caches are untrusted. Cache key v3 includes the manifest URL, host triple,
version and expected archive digest. The installation retains the archive, checks
it against the newly resolved digest, re-extracts the expected executable and
compares its exact bytes with the installed file before exposing PATH/outputs.
Changing an executable and its adjacent metadata cannot self-attest. A corrupt,
missing or legacy cache fails closed; evict that cache and retry to reinstall.

Extraction accepts bounded regular files/directories only, checks tar headers and
rejects traversal, special/link entries, duplicate paths and ambiguous binaries.
Compressed/expanded limits are 128/512 MiB, with at most 10,000 archive entries.
Install paths and metadata cannot traverse symbolic links.

Installation stages the verified archive, metadata and executable under an
exclusive process guard. A journal and backups cover publication; the executable
is published last and a commit marker finishes the transaction. Before that point,
ordinary write/rename failures roll back the previous bytes and executable mode.
On a later attempt, a dead same-host owner can be recovered before any download.
Concurrent installers fail rather than interleave. No cross-file power-loss or
filesystem-fsync atomicity is claimed. A locked file or persistent permission failure
that also prevents rollback retains backups and the guard, reports failure and
blocks verification; inspect and recover those files before using the directory.
Unknown/missing owner information, another host or a reused PID also fails closed
for manual inspection. Do not delete recovery state without checking its owner.

A failure writing GitHub PATH/outputs after the commit does not undo installation:
the new archive/metadata/binary remain a consistent verified set. Cleanup failure
after commit warns and retains a committed guard; it does not report a rolled-back
transaction. Real Windows/macOS/Linux runner tests remain required for OS file-lock
and rename behavior. Local checks:

```sh
node --test setup/test/setup.test.mjs
```
