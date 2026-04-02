# Contributing to fidan-actions

Thank you for contributing to **fidan-actions**.

This repository exists to hold reusable GitHub Actions for the Fidan ecosystem.
The goal is not to ship one-off workflow snippets. The goal is to create clean,
reliable, cache-aware automation that other Fidan repositories can depend on.

## What Belongs Here

Good contributions for this repo include:

- reusable GitHub Actions
- action metadata and documentation
- caching and distribution helpers
- action test fixtures and validation workflows
- automation shared across `fidan`, `fidan.dev`, Dal, and related repos
- release-install logic for CI consumers

Changes to the compiler, runtime, language, website, or registry itself belong
in their respective repositories instead.

## Repository Direction

This is a multi-action repository.

The intended long-term usage is:

```yaml
uses: fidan-lang/fidan-actions/<action>@v1
```

Example:

```yaml
uses: fidan-lang/fidan-actions/setup@v1
```

Each action should:

- have a clear scope
- avoid hidden side effects
- document its inputs and outputs
- be safe for CI use
- be versionable and easy to cache

## Development Principles

Please keep this repository:

- clean
- modular
- easy to audit
- safe for public CI usage
- explicit about network/download behavior
- careful about version resolution and integrity checks

For actions in this repo, prefer:

- pinned versions where practical
- checksum or manifest validation for downloaded artifacts
- predictable cache keys
- explicit outputs over implicit behavior
- small, well-scoped actions over giant all-in-one automation blobs

## Contribution Guidelines

When contributing here:

- keep each action focused on one clear responsibility
- avoid duplicating setup logic across multiple actions if shared code is more maintainable
- document every input, output, and side effect
- explain cache behavior clearly
- avoid overly broad defaults that make CI behavior surprising
- prefer additive changes over disruptive repo-wide rewrites unless the rewrite is clearly worth it

## Pull Requests

Recommended process:

1. create a focused branch
2. make one coherent action or repo change at a time
3. update docs alongside behavior changes
4. explain how the action is meant to be used
5. note any security or caching implications

A good pull request here should explain:

- what action or shared behavior changed
- why the change is needed
- what repositories or workflows benefit from it
- whether inputs, outputs, or cache keys changed
- whether any migration is needed for existing users

## Security

This repository may eventually handle executable downloads, release manifests,
and CI setup logic.

If you discover a security issue, do not open a public exploit report.
See [SECURITY.md](SECURITY.md) for reporting guidance.

## Code of Conduct

Please keep collaboration respectful and constructive.
See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
