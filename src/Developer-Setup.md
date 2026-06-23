# Developer Machine Setup

This document describes how to set up a local development environment for contributing to `cdk-cross-account-plugin`.

## Prerequisites

- Node.js 18 or later (see below)
- npm 9 or later (bundled with Node.js)
- TypeScript — installed automatically as a dev dependency

## Install Node.js

Use [nvm](https://github.com/nvm-sh/nvm) (recommended) to manage Node.js versions:

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# Install and use Node.js 20 LTS
nvm install 20
nvm use 20
```

Alternatively, use the [NodeSource packages](https://github.com/nodesource/distributions) for Debian/Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

> **Note:** Avoid `sudo apt-get install nodejs` directly — this installs a very old version from the distro's package repository.

## Install Project Dependencies

```bash
npm install
```

This installs both production and development dependencies, including TypeScript.

## Build (Compile TypeScript)

The plugin ships compiled JavaScript in `lib/`. After making changes to `src/index.ts`, rebuild:

```bash
npm run build
```

Or watch for changes continuously:

```bash
npm run build-live
```

The compiled output is written to `lib/index.js`. This file is what consumers of the package actually execute, so it must be committed alongside source changes.

## Audit Dependencies

```bash
npm audit
```

All production dependencies are pinned to exact versions in `package.json` per org security policy. Run `npm audit fix` to apply safe lock-file-only upgrades when vulnerabilities are reported. Upgrades that require source changes (e.g. major version bumps) must be applied manually.

## Key Dependencies

| Package | Role |
| --- | --- |
| `@aws-sdk/client-sso` | AWS SSO credential resolution |
| `@aws-sdk/credential-providers` | Named profile + MFA credential resolution |
| `@smithy/shared-ini-file-loader` | Parses `~/.aws/config` to detect profile types |
| `@inquirer/prompts` | Interactive MFA token code prompt |
| `conf` | Persistent local credential cache |
| `@aws-cdk/cli-plugin-contract` | TypeScript types for the CDK plugin interface (dev only) |
