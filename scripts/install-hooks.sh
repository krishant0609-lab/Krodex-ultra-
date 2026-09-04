#!/usr/bin/env bash
# KRODEX — pre-commit hook installer (Phase 14)
#
# One-shot install: symlinks `.git/hooks/pre-commit` to
# `scripts/check-secrets.sh`. Idempotent: re-running the
# installer after the hook is already installed is a no-op.
#
# Run once per clone:
#   bash scripts/install-hooks.sh
#
# The hook is opt-in (we do not auto-install it) so existing
# developer workflows are not disrupted by Phase 14. CI runs
# the same script via the workflow `.github/workflows/ci.yml`
# (added in a later phase if needed).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_PATH="$REPO_ROOT/.git/hooks/pre-commit"
TARGET="$REPO_ROOT/scripts/check-secrets.sh"

if [ ! -f "$TARGET" ]; then
  echo "install-hooks.sh: $TARGET not found" >&2
  exit 1
fi

# Make the script executable; on Windows the bit may be lost,
# so re-set it every run.
chmod +x "$TARGET"

if [ -L "$HOOK_PATH" ]; then
  CURRENT="$(readlink "$HOOK_PATH")"
  if [ "$CURRENT" = "$TARGET" ]; then
    echo "install-hooks.sh: pre-commit hook already installed"
    exit 0
  fi
  rm -f "$HOOK_PATH"
fi

if [ -f "$HOOK_PATH" ] && [ ! -L "$HOOK_PATH" ]; then
  # An existing non-symlink hook — back it up rather than
  # clobber it.
  mv "$HOOK_PATH" "$HOOK_PATH.bak"
  echo "install-hooks.sh: backed up existing pre-commit hook to $HOOK_PATH.bak"
fi

ln -s "$TARGET" "$HOOK_PATH"
echo "install-hooks.sh: pre-commit hook installed at $HOOK_PATH"
echo "To remove: rm $HOOK_PATH"
