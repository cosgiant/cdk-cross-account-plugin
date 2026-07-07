# Upstream Relationship

This repository is an organizational fork of
[Cumulus-Technology/cdk-cross-account-plugin](https://github.com/Cumulus-Technology/cdk-cross-account-plugin),
maintained by the cosgiant engineering team.

## Why a separate repo (not a GitHub fork)

This repository was established before a GitHub fork was practical. It is treated as a
**vendor fork**: cosgiant's version is the authoritative source for all internal consumers.
The GitHub fork relationship (parent/fork label) has no effect on the git history or the
ability to contribute back upstream.

## Upstream source

| Field            | Value |
| ---------------- | ----- |
| Upstream repo    | `Cumulus-Technology/cdk-cross-account-plugin` |
| Upstream package | `npm install -g cdk-cross-account-plugin` (unmaintained since ~2022) |
| cosgiant version | v3.x — see [releases](https://github.com/cosgiant/cdk-cross-account-plugin/releases) |
| Open upstream PR | [Cumulus-Technology/cdk-cross-account-plugin#3](https://github.com/Cumulus-Technology/cdk-cross-account-plugin/pull/3) |

## Adding the upstream remote

To track upstream changes in a local clone:

```bash
git remote add upstream https://github.com/Cumulus-Technology/cdk-cross-account-plugin.git
git fetch upstream
```

## Sync policy

Upstream is effectively unmaintained (no releases since 2022, no aws-sdk v3 migration).
cosgiant's version has diverged significantly:

- aws-sdk v2 → v3 migration
- ESM compatibility fix (`conf` / `@inquirer/prompts` replaced with CJS-compatible alternatives)
- Prototype-pollution hardening in `JsonStore`
- Node 22 minimum (matches AWS CDK CLI's own requirement)
- Full unit + integration test suite

When (if) Cumulus-Technology merges the upstream PR, evaluate cherry-picking their changes back:

```bash
git fetch upstream
git log upstream/master ^main --oneline   # see what upstream has that we don't
```

Only cherry-pick commits that are additive and don't conflict with cosgiant's fixes.

## Contributing back to upstream

Upstream contributions should be submitted from a personal fork of
`Cumulus-Technology/cdk-cross-account-plugin` by a cosgiant engineer. The open PR (#3)
was submitted this way. Reference the cosgiant fork in the PR description so maintainers
can see the production context.
