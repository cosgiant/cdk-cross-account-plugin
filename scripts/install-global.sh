#!/usr/bin/env bash
set -euo pipefail

# Installs this plugin globally from the cosgiant fork, pinned to a tag.
#
# Why this script exists instead of `npm install -g github:...#<tag>`:
# npm's global-install path for git dependencies leaves a dangling symlink
# to its own (self-deleting) temp clone cache on at least npm 10.8.2 — the
# package silently fails to load with no error at install time. Cloning
# into a persistent directory and running `npm install -g .` from inside
# it does not hit that code path.
#
# AWS CDK's plugin loader resolves plugin names via Node's standard module
# resolution starting from aws-cdk's own install directory, so the plugin
# MUST be installed globally (a project-local node_modules is never seen).
#
# `npm install -g .` links rather than copies the directory into the
# global node_modules, so the clone below must live somewhere permanent —
# NOT a mktemp dir that gets cleaned up after this script exits.

REF="${1:-v3.0.4}"
REPO_URL="https://github.com/cosgiant/cdk-cross-account-plugin.git"
INSTALL_DIR="${HOME}/.cdk-cross-account-plugin"

echo "📦 Cloning cdk-cross-account-plugin@${REF} into ${INSTALL_DIR}..."
rm -rf "$INSTALL_DIR"
git clone --quiet --branch "$REF" --depth 1 "$REPO_URL" "$INSTALL_DIR"

echo "📥 Installing production dependencies..."
(cd "$INSTALL_DIR" && npm install --omit=dev --no-audit --no-fund --silent)

echo "🔗 Linking globally..."
(cd "$INSTALL_DIR" && npm install -g . --no-audit --no-fund --silent)

echo "✅ cdk-cross-account-plugin@${REF} installed globally (source kept at ${INSTALL_DIR})."
