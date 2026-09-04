#!/usr/bin/env bash
# KRODEX — secret scanner (Phase 14)
#
# Scans the staged git diff for common secret-bearing patterns
# and refuses to commit if any are found. Designed to be invoked
# from a git pre-commit hook (see scripts/install-hooks.sh) or
# directly via `bash scripts/check-secrets.sh`.
#
# Patterns are deliberately conservative: a false positive
# (developer adding an obvious dummy key with "replace-me" in
# the value) is acceptable; a false negative (committing a real
# key) is not. The check is the second line of defense — the
# .env / .env.local files are already gitignored, and CI's
# `npm run security:check` is the first.
#
# Exit codes:
#   0 — clean (no obvious secret patterns in the staged diff)
#   1 — at least one suspicious line was found
#   2 — invocation error (e.g. not a git repository)

set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "check-secrets.sh: not a git repository" >&2
  exit 2
fi

# Get the staged diff. When there is no staged content (e.g.
# during a `git commit --amend` with nothing staged), exit clean.
DIFF="$(git diff --cached --diff-filter=ACMR --no-color 2>/dev/null || true)"
if [ -z "$DIFF" ]; then
  exit 0
fi

# Match on the + side of the diff only — we are not auditing
# deletions (they remove secrets, not introduce them). Filter
# out lines that are clearly non-secret (placeholders).
ADDED="$(printf '%s\n' "$DIFF" | grep '^+' | grep -v '^+++' || true)"

# Patterns we consider secret-bearing. The list is intentionally
# short: every pattern has produced a real incident at some
# point. We do not enumerate every API key convention.
PATTERNS=(
  '(api[_-]?key|apikey)[[:space:]]*[:=][[:space:]]*"[A-Za-z0-9_\-]{20,}"'
  '(api[_-]?key|apikey)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9_\-]{20,}'
  '(password|passwd|pwd)[[:space:]]*[:=][[:space:]]*"[^"]{8,}"'
  '(secret)[[:space:]]*[:=][[:space:]]*"[A-Za-z0-9_\-]{16,}"'
  '(secret)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9_\-]{16,}'
  '-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----'
  'ghp_[A-Za-z0-9]{36}'
  'sk-[A-Za-z0-9]{32,}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'AKIA[0-9A-Z]{16}'
)

# Filter out the obvious "replace-me" placeholder values that
# the .env.example uses. We do this with a single sed pass to
# keep the script POSIX-portable.
FILTERED_ADDED="$(printf '%s\n' "$ADDED" \
  | grep -vE 'replace-me|REPLACE_ME|changeme|CHANGEME' \
  || true)"

HITS=0
for pat in "${PATTERNS[@]}"; do
  if printf '%s\n' "$FILTERED_ADDED" | grep -E -q -- "$pat"; then
    HITS=1
    echo
    echo "check-secrets.sh: suspicious line(s) matched pattern: $pat"
    printf '%s\n' "$FILTERED_ADDED" \
      | grep -E -- "$pat" \
      | head -10 \
      | sed 's/^/  /'
    echo
  fi
done

if [ "$HITS" -ne 0 ]; then
  echo "check-secrets.sh: refusing to commit. Review the lines above."
  echo "If this is a false positive (e.g. documentation example),"
  echo "either move the example to a non-committed file or escape"
  echo "the pattern (e.g. wrap the value in single quotes or"
  echo "prepend a comment like \"// placeholder, not a real key\")."
  exit 1
fi

exit 0
