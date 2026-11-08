#!/usr/bin/env bash
# A promotion PR (anything merging into main) must add a changelog entry.
# Usage: check-promotion-changelog.sh <base-ref> [head-ref]   (default head: HEAD)
# Passes when the diff base...head adds at least one release `id:` under lib/changelog/data/.
# Writing rules: docs/workflow/changelog.md.
set -euo pipefail

BASE="${1:?usage: check-promotion-changelog.sh <base-ref> [head-ref]}"
HEAD_REF="${2:-HEAD}"

ADDED=$(git diff "$BASE...$HEAD_REF" -U0 -- lib/changelog/data \
  | grep -cE '^\+[[:space:]]*id: "[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?"' || true)

if [ "$ADDED" -lt 1 ]; then
  echo "::error::Promotion without a changelog entry: $BASE...$HEAD_REF adds no release to lib/changelog/data/."
  echo "Add one entry for this promotion (docs/workflow/changelog.md), ship it to staging, then re-run."
  exit 1
fi
echo "Changelog OK: $ADDED new release entr$([ "$ADDED" = 1 ] && echo y || echo ies)."
