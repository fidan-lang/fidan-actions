# fidan-actions

Reusable GitHub Actions for the **Fidan** ecosystem.

This repository is the home for automation building blocks that other Fidan
repositories can consume from GitHub Actions workflows.

The implemented setup action installs a checksum-verified release and caches the installation:

```yaml
uses: fidan-lang/fidan-actions/setup@v1
```

The setup action downloads a
specific Fidan version from the public distribution bucket, restore cached
artifacts when possible, and expose the installed binary to downstream steps.

## Scope

This repository is for **GitHub Actions and CI automation** only.

Good fits for this repo include:

- reusable setup/install actions
- cache-aware download actions
- release/distribution helper actions
- workflow utilities shared across Fidan repositories
- CI helpers for docs, packages, or release automation

Compiler, runtime, language, toolchain, and package-manager changes still
belong in the main Fidan repository.

## Structure

The current action is organized as:

```text
setup/
  action.yml
  README.md
  scripts/
```

Each action should be self-contained, documented, and versioned in a way that
other repositories can consume safely.

## Related Repositories

- Fidan language: `https://github.com/fidan-lang/fidan`
- Fidan website and docs: `https://github.com/fidan-lang/fidan.dev`
- Dal registry and tooling: `https://github.com/fidan-lang/dal`

## Status

`setup/` is implemented. Tags `v1` and `v1.0.0` exist; this audit branch is not released. Pin the reviewed commit SHA for immutable workflows. `latest` selects stable SemVer releases; exact prereleases require an explicit version. The manifest and HTTPS distribution are trusted publisher inputs; GitHub cache scope remains a trust boundary.
