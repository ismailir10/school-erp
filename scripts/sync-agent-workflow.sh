#!/usr/bin/env bash
# Vendors the shared agent-workflow skills into this repo and pins the upstream commit.
#
#   bash scripts/sync-agent-workflow.sh               # update to upstream main
#   bash scripts/sync-agent-workflow.sh --ref <ref>   # update to a branch, tag or commit
#   bash scripts/sync-agent-workflow.sh --check       # offline: fail if a vendored file was edited by hand
#
# Vendored files are never edited in place. Change them upstream, then re-sync. Repo-specific rules live in
# AGENTS.md § Repo profile and docs/workflow/*.md, which this script never touches.
set -euo pipefail

UPSTREAM="${AGENT_WORKFLOW_REPO:-ismailir10/agent-workflow}"
LOCK_NAME=".agent-workflow.lock"
SCRIPT_PATH="scripts/sync-agent-workflow.sh"

root=$(git rev-parse --show-toplevel)
cd "$root"

# The skills directory is wherever the lock already is; otherwise .agents/skills when the repo tracks it as a real
# directory, else .claude/skills.
skills_dir=""
for d in .agents/skills .claude/skills; do
  if [ -f "$d/$LOCK_NAME" ]; then skills_dir=$d; break; fi
done
if [ -z "$skills_dir" ]; then
  if [ -d .agents/skills ] && [ ! -L .agents/skills ] && [ -n "$(git ls-files .agents/skills | head -1)" ]; then
    skills_dir=.agents/skills
  else
    skills_dir=.claude/skills
  fi
fi
lock="$skills_dir/$LOCK_NAME"

if [ "${1:-}" = "--check" ]; then
  [ -f "$lock" ] || { echo "agent-workflow: no $lock — run: bash $SCRIPT_PATH" >&2; exit 1; }
  if ! grep -E '^[0-9a-f]{64}  ' "$lock" | shasum -a 256 -c --quiet - ; then
    echo "agent-workflow: vendored files differ from $(grep '^ref=' "$lock")." >&2
    echo "  Do not edit them here. Change agent-workflow upstream and re-sync, or put repo-specific rules in" >&2
    echo "  AGENTS.md § Repo profile / docs/workflow/*.md." >&2
    exit 1
  fi
  echo "agent-workflow: vendored files match $(grep '^ref=' "$lock")"
  exit 0
fi

ref=main
if [ "${1:-}" = "--ref" ]; then ref="${2:?--ref needs a value}"; fi

sha=$(gh api "repos/$UPSTREAM/commits/$ref" -q .sha)
short=${sha:0:7}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
gh api "repos/$UPSTREAM/tarball/$sha" > "$tmp/src.tgz"
mkdir "$tmp/src" && tar -xzf "$tmp/src.tgz" -C "$tmp/src" --strip-components=1

header="<!-- Vendored from agent-workflow@$short by $SCRIPT_PATH. Do not edit here: change it upstream and re-sync. Repo specifics belong in AGENTS.md § Repo profile and docs/workflow/. -->"

# Skills this script managed last time but upstream no longer ships are removed.
if [ -f "$lock" ]; then
  for old in $(sed -n 's/^skill=//p' "$lock"); do
    [ -d "$tmp/src/skills/$old" ] || { rm -rf "${skills_dir:?}/$old"; echo "removed $skills_dir/$old"; }
  done
fi

mkdir -p "$skills_dir" scripts
managed=()
for src in "$tmp"/src/skills/*/; do
  name=$(basename "$src")
  dest="$skills_dir/$name"
  rm -rf "$dest" && mkdir -p "$dest"
  cp -R "$src". "$dest/"
  # Stamp the header right after the SKILL.md frontmatter so the harness still parses it.
  awk -v h="$header" 'NR==1 && $0=="---" {fm=1} {print} fm && NR>1 && $0=="---" && !done {print ""; print h; done=1}' \
    "$dest/SKILL.md" > "$dest/SKILL.md.tmp" && mv "$dest/SKILL.md.tmp" "$dest/SKILL.md"
  managed+=("$name")
done
# Helper scripts ship as scripts/<name>; ones upstream dropped are removed.
if [ -f "$lock" ]; then
  for old in $(sed -n 's/^script=//p' "$lock"); do
    [ -f "$tmp/src/bin/$(basename "$old")" ] || { rm -f "$old"; echo "removed $old"; }
  done
fi
scripts=()
for src in "$tmp"/src/bin/*.sh; do
  dest="scripts/$(basename "$src")"
  cp "$src" "$dest" && chmod +x "$dest"
  scripts+=("$dest")
done

{
  echo "# Written by $SCRIPT_PATH. Do not edit."
  echo "repo=$UPSTREAM"
  echo "ref=$sha"
  echo "synced=$(date -u +%Y-%m-%d)"
  for n in "${managed[@]}"; do echo "skill=$n"; done
  for s in "${scripts[@]}"; do echo "script=$s"; done
  { for n in "${managed[@]}"; do find "$skills_dir/$n" -type f; done; printf '%s\n' "${scripts[@]}"; } \
    | LC_ALL=C sort | while read -r f; do shasum -a 256 "$f"; done
} > "$lock"

echo "agent-workflow: synced ${managed[*]} into $skills_dir at $short"
