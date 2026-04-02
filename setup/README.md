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

## Notes

This first version is intentionally minimal:

- it installs a host-matching release archive
- it resolves `latest` from the release manifest
- it validates SHA-256 checksums
- it caches the extracted install directory by platform/triple/version

Future versions can extend this with:

- channel support
- manifest signing
- stronger archive-layout validation
- richer version selection strategies
