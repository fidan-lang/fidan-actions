# Security Policy

## Scope

This repository contains reusable GitHub Actions for the **Fidan** ecosystem.

Security reports for this repo should focus on action behavior and CI-safety,
including:

- downloaded binaries or archives
- release manifest resolution
- checksum validation
- cache behavior and cache poisoning risks
- PATH/environment modification performed by actions
- shell-script execution or unsafe interpolation in action logic
- supply-chain risks introduced by dependencies or installers
- accidental exposure of secrets or sensitive workflow data

Issues in the Fidan compiler, runtime, website, docs platform, or Dal registry
should still be reported against their respective repositories when the problem
belongs there.

## Supported Versions

Security fixes are generally applied to the latest default branch state and the
currently supported published action tags.

Older experimental snapshots or stale forks may not receive fixes.

## Reporting a Vulnerability

If you discover a security issue, please **do not open a public GitHub issue**.

Instead, report it privately with:

- a clear description of the issue
- affected action name and version/tag if known
- reproduction steps
- proof-of-concept details when appropriate
- expected impact
- any relevant workflow or runner context

If the issue involves downloaded Fidan artifacts, manifests, or release
resolution, mention the exact version/channel and platform involved.

## Disclosure Process

After a report is received:

1. The issue will be investigated.
2. A fix or mitigation will be prepared if needed.
3. Public disclosure may follow after a fix is available or the risk is
   otherwise addressed.

Responsible disclosure is appreciated.

## Thanks

Thank you for helping keep the Fidan automation and CI ecosystem safe.
