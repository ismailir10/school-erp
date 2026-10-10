#!/usr/bin/env bash
# link-agent-skills.sh — point Codex's gitignored .agents/skills/* at the
# canonical .claude/skills/* so every harness reads ONE source of truth.
#
# Why this exists: Codex resolves its slash-command skills from .agents/skills/,
# which is gitignored (harness-local) and therefore drifts from .claude/skills/.
# A stale .agents/skills/ship/SKILL.md is how a fixed canonical skill fails to
# reach Codex. Because .agents is gitignored we cannot commit the symlinks; this
# script (idempotent) recreates them at setup + SessionStart instead.
#
# Scope: the workflow skills Codex invokes, plus the vendored interface-craft
# skills /build loads on frontend tasks (see .claude/skills/VENDORED.md).
# Adding a new skill Codex must see? add its name to the right list below.

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/.claude/skills"
DST="$ROOT/.agents/skills"

# working-principles, spec, build, verify-local and ship are vendored from agent-workflow
# (scripts/sync-agent-workflow.sh); audit-docs and uat are this repo's own.
WORKFLOW_SKILLS="working-principles spec build verify-local ship audit-docs uat"
# Vendored `interfaces` collection — better-interface is user-invoked, the other
# six auto-trigger on frontend diffs. Codex needs all seven or /build's
# frontend dispatch table silently no-ops there.
INTERFACE_SKILLS="better-interface better-ui better-typography better-colors better-accessibility better-layout better-writing"

[ -d "$SRC" ] || { echo "link-agent-skills: $SRC missing — nothing to link." >&2; exit 0; }

mkdir -p "$DST"
linked=0
for s in $WORKFLOW_SKILLS $INTERFACE_SKILLS; do
  if [ -d "$SRC/$s" ]; then
    # Replace any existing dir/symlink with a fresh relative symlink to canonical.
    rm -rf "$DST/$s"
    ln -sfn "../../.claude/skills/$s" "$DST/$s"
    linked=$((linked + 1))
  fi
done

echo "link-agent-skills: linked $linked skill(s) .agents/skills → .claude/skills"
