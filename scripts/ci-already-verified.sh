#!/usr/bin/env bash
# On a push to a base branch, decides whether this exact code already passed the same CI jobs on its PR, so the
# push can skip re-running them. Writes skip=true|false to $GITHUB_OUTPUT. Fails open: any doubt → skip=false.
#
#   bash scripts/ci-already-verified.sh <workflow file> "<job name>" ["<job name>" ...]
#
# "Exact code" means the pushed commit's tree equals the merged PR head's tree, which holds when the PR was up to
# date with the base at merge (squash or merge commit alike). Job names are the display names (`name:`), and every
# one must have concluded `success` in a pull_request run of <workflow file> on that head.
# Needs GH_TOKEN (and GH_REPO) in the step env, with contents, pull-requests and actions read permissions.
set -uo pipefail

out=${GITHUB_OUTPUT:-/dev/stdout}
decide() { echo "skip=$1" >> "$out"; echo "ci-already-verified: skip=$1 ($2)"; exit 0; }

[ "${GITHUB_EVENT_NAME:-}" = "push" ] || decide false "not a push"
wf=${1:-}; [ -n "$wf" ] || decide false "no workflow named"
shift; [ $# -ge 1 ] || decide false "no jobs named"
repo=${GITHUB_REPOSITORY:?}
sha=${GITHUB_SHA:?}

pr=$(gh api "repos/$repo/commits/$sha/pulls" \
  -q '[.[] | select(.merged_at != null)][0] | "\(.number) \(.head.sha)"' 2>/dev/null) || decide false "PR lookup failed"
[ -n "$pr" ] && [ "$pr" != "null null" ] || decide false "no merged PR for ${sha:0:7}"
number=${pr% *}
head=${pr#* }

tree=$(gh api "repos/$repo/git/commits/$sha" -q .tree.sha 2>/dev/null) || decide false "tree lookup failed"
head_tree=$(gh api "repos/$repo/git/commits/$head" -q .tree.sha 2>/dev/null) || decide false "head tree lookup failed"
[ "$tree" = "$head_tree" ] || decide false "code differs from PR #$number head ${head:0:7}: the base moved before merge"

runs=$(gh api "repos/$repo/actions/workflows/$wf/runs?head_sha=$head&event=pull_request&per_page=20" \
  -q '.workflow_runs[].id' 2>/dev/null) || decide false "run lookup failed"
[ -n "$runs" ] || decide false "no pull_request run of $wf on ${head:0:7}"

passed=""
for id in $runs; do
  passed+=$(gh api "repos/$repo/actions/runs/$id/jobs" \
    -q '.jobs[] | select(.conclusion == "success") | .name' 2>/dev/null)$'\n' || decide false "job lookup failed"
done
for job in "$@"; do
  grep -qxF "$job" <<< "$passed" || decide false "\"$job\" did not pass on PR #$number head ${head:0:7}"
done

decide true "PR #$number head ${head:0:7} has the same code and passed: $*"
