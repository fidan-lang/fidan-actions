# fidan-actions

Reusable GitHub Actions for the **Fidan** ecosystem.

This repository is the home for automation building blocks that other Fidan
repositories can consume from GitHub Actions workflows.

The implemented setup action installs a checksum-verified release and caches the installation:

```yaml
uses: fidan-lang/fidan-actions/setup@v1
```

The setup action downloads a
specific Fidan version from the public distribution bucket, restores cached
artifacts when possible, and exposes the installed binary to downstream steps.

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

`setup/` is implemented. Tags `v1` and `v1.0.0` exist; unreleased source changes are not included in those tags. Pin the reviewed commit SHA for immutable workflows. `latest` selects stable SemVer releases; exact prereleases require an explicit version. The manifest and HTTPS distribution are trusted publisher inputs. Restored cache archives are rehashed against that manifest and their extracted executable bytes are compared before use; adjacent metadata is not an authenticity anchor. See [installation, recovery and trust boundaries](setup/README.md#integrity-and-installation-contract).

## License and branding

The software is available under the unmodified [Apache License 2.0](LICENSE),
with attribution in [NOTICE](NOTICE). Commercial use, modification, redistribution,
sale and hosting are permitted under that license. Branding is separate: see the
[Fidan trademark policy](https://github.com/fidan-lang/fidan/blob/main/TRADEMARKS.md).
Truthful descriptive references and independent forks are welcome; do not falsely
claim official affiliation or endorsement.
