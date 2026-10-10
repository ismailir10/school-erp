#!/usr/bin/env bash
# Uploads PR highlight screenshots and prints the markdown to embed them in the PR body.
#
#   bash scripts/pr-screenshots.sh <pr-number> <image> [image]
#
# Images go to the `pr-assets` branch (an orphan branch that is never merged, so the base branch history stays
# free of binaries) under <pr-number>/, and are linked by commit SHA so the PR keeps rendering them after later
# uploads. The repo's push triggers must not include `pr-assets`; CI and deploys built for main/develop/staging
# ignore it. Screenshots must show dummy data only.
set -euo pipefail

pr="${1:?usage: pr-screenshots.sh <pr-number> <image> [image]}"; shift
[ $# -ge 1 ] || { echo "usage: pr-screenshots.sh <pr-number> <image> [image]" >&2; exit 1; }
[ $# -le 2 ] || echo "pr-screenshots: more than 2 images; a highlight is 1-2 shots. Uploading all of them anyway." >&2

repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
branch="pr-assets"

if ! gh api "repos/$repo/git/ref/heads/$branch" >/dev/null 2>&1; then
  tree=$(gh api "repos/$repo/git/trees" \
    -f 'tree[][path]=README.md' -f 'tree[][mode]=100644' -f 'tree[][type]=blob' \
    -f 'tree[][content]=Screenshots embedded in PR descriptions. Never merged. Safe to prune old folders.' -q .sha)
  commit=$(gh api "repos/$repo/git/commits" -f message="Start $branch for PR screenshots" -f tree="$tree" -q .sha)
  gh api "repos/$repo/git/refs" -f ref="refs/heads/$branch" -f sha="$commit" >/dev/null
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
stamp=$(date -u +%Y%m%d-%H%M%S)
for img in "$@"; do
  [ -f "$img" ] || { echo "pr-screenshots: no such file: $img" >&2; exit 1; }
  name="$stamp-$(basename "$img" | tr ' ' '-')"
  path="$pr/$name"
  base64 < "$img" | tr -d '\n' | jq -Rs --arg m "PR #$pr: $name" --arg b "$branch" \
    '{message: $m, branch: $b, content: .}' > "$tmp"
  sha=$(gh api -X PUT "repos/$repo/contents/$path" --input "$tmp" -q .commit.sha)
  caption=$(basename "$img" | sed -E 's/\.[^.]+$//; s/[-_]+/ /g')
  echo "![$caption](https://github.com/$repo/blob/$sha/$path?raw=true)"
done
