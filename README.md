# fidan-actions

Reusable GitHub Actions for the **Fidan** ecosystem.

This repository is the home for automation building blocks that other Fidan
repositories can consume from GitHub Actions workflows.

Planned usage looks like this:

```yaml
uses: fidan-lang/fidan-actions/setup@v1
```

The first action planned here is a setup/install action that will download a
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

## Planned Structure

As this repository grows, it will typically contain action folders such as:

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

This repository is being prepared as the shared action home for the Fidan org.
The `setup` action is the first planned action, but the repo itself is meant to
host multiple reusable actions over time.
