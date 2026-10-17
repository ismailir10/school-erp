#!/usr/bin/env bash
# audit-docs.sh — executable doc-staleness gate.
#
# Replaces the prose checklist that /audit-docs used to be. That version was
# instructions an LLM might follow; this one exits non-zero, runs inside the
# required "Checks" CI check, and therefore cannot be skipped.
#
#   bash scripts/audit-docs.sh           # audit; exit 1 on any fail
#   bash scripts/audit-docs.sh --write   # regenerate the counts block, then audit
#
# Design rule: docs must not hand-assert facts the code owns. Every derivable
# number lives in ONE generated block in CLAUDE.md; everything else is prose a
# human wrote on purpose. If you find yourself typing a count into a doc, put
# it in the block instead.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

WRITE=0
[ "${1:-}" = "--write" ] && WRITE=1

FAILS=0
WARNS=0
OKS=0
REPORT=""

row() { # status | check | detail
  REPORT="${REPORT}| ${2} | ${1} | ${3} |
"
  case "$1" in
    fail) FAILS=$((FAILS + 1)) ;;
    warn) WARNS=$((WARNS + 1)) ;;
    *) OKS=$((OKS + 1)) ;;
  esac
}

# ---------------------------------------------------------------- counts block

count_routes()    { find app/api -name route.ts -type f 2>/dev/null | wc -l | tr -d ' '; }
count_pages()     { find "app/$1" -name 'page.tsx' -type f 2>/dev/null | wc -l | tr -d ' '; }
count_ui()        { find components/ui -maxdepth 1 -name '*.tsx' -type f 2>/dev/null | wc -l | tr -d ' '; }
count_specs()     { find e2e -name '*.spec.ts' -type f 2>/dev/null | wc -l | tr -d ' '; }
count_cycles()    { find docs/cycles -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' '; }
count_archived()  { find docs/cycles/archive -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' '; }
count_standards() { find .claude/standards -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' '; }

generate_block() {
  cat <<EOF
| Surface | Count |
|---|---|
| \`app/api/**/route.ts\` | $(count_routes) |
| \`app/admin\` pages | $(count_pages admin) |
| \`app/teacher\` pages | $(count_pages teacher) |
| \`app/parent\` pages | $(count_pages parent) |
| \`components/ui/*.tsx\` | $(count_ui) |
| \`e2e/*.spec.ts\` | $(count_specs) |
| \`.claude/standards/*\` | $(count_standards) |
| \`docs/cycles\` active / archived | $(count_cycles) / $(count_archived) |
EOF
}

BEGIN_MARK='<!-- generated:counts — regenerate with `bash scripts/audit-docs.sh --write` -->'
END_MARK='<!-- /generated:counts -->'

if ! grep -qF "$BEGIN_MARK" CLAUDE.md 2>/dev/null; then
  row fail "Counts block" "CLAUDE.md is missing the generated:counts markers"
else
  CURRENT=$(awk -v b="$BEGIN_MARK" -v e="$END_MARK" \
    'index($0,b){f=1;next} index($0,e){f=0} f' CLAUDE.md)
  FRESH=$(generate_block)
  if [ "$CURRENT" = "$FRESH" ]; then
    row ok "Counts block" "in sync with the tree"
  elif [ "$WRITE" = "1" ]; then
    # The replacement is multi-line, so it cannot ride in on `awk -v` — BSD awk
    # and mawk both reject a newline inside a -v assignment. Pass it as a file.
    TMP=$(mktemp)
    BLOCK=$(mktemp)
    generate_block >"$BLOCK"
    awk -v b="$BEGIN_MARK" -v e="$END_MARK" -v blockfile="$BLOCK" '
      index($0,b) { print; while ((getline line < blockfile) > 0) print line; skip=1; next }
      index($0,e) { skip=0 }
      !skip { print }
    ' CLAUDE.md >"$TMP" && mv "$TMP" CLAUDE.md
    rm -f "$BLOCK"
    row ok "Counts block" "regenerated (--write)"
  else
    row fail "Counts block" "stale — run \`bash scripts/audit-docs.sh --write\`"
  fi
fi

# ------------------------------------------------------- referenced files exist

MISSING=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -e ".claude/standards/$f" ] || MISSING="$MISSING $f"
done < <(awk '/^\| File \| Covers/{f=1;next} /^$/{f=0} f && /^\|/' CLAUDE.md |
  grep -oE '`[a-z0-9-]+\.(md|html)`' | tr -d '`' | sort -u)
[ -z "$MISSING" ] && row ok "Standards files" "every row in the standards table exists" ||
  row fail "Standards files" "missing:$MISSING"

MISSING=""
while IFS= read -r s; do
  [ -z "$s" ] && continue
  [ -f ".claude/skills/$s/SKILL.md" ] || MISSING="$MISSING $s(no SKILL.md)"
  grep -q "$s" scripts/link-agent-skills.sh 2>/dev/null || MISSING="$MISSING $s(unlinked)"
done < <(awk '/^\| Skill \| Covers/{f=1;next} /^$/{f=0} f && /^\|/' CLAUDE.md |
  grep -oE '`better-[a-z]+`' | tr -d '`' | sort -u)
[ -z "$MISSING" ] && row ok "Interface-craft skills" "all present and linked" ||
  row fail "Interface-craft skills" "$MISSING"

# ------------------------------------------------------------- relative links

BROKEN=""
for doc in README.md CLAUDE.md docs/workflow/*.md; do
  [ -f "$doc" ] || continue
  dir=$(dirname "$doc")
  while IFS= read -r target; do
    [ -z "$target" ] && continue
    case "$target" in http*|\#*|mailto:*) continue ;; esac
    clean=${target%%#*}
    clean=${clean#./}
    [ -z "$clean" ] && continue
    [ -e "$dir/$clean" ] || BROKEN="$BROKEN $doc→$clean"
  done < <(grep -oE '\]\([^)]+\)' "$doc" 2>/dev/null | sed -E 's/^\]\(//; s/\)$//')
done
[ -z "$BROKEN" ] && row ok "Relative links" "every link in README, CLAUDE and docs/workflow resolves" ||
  row fail "Relative links" "broken:$BROKEN"

# --------------------------------------------------------------- docs/ shape

ALLOWED="adrs archive cycles runbooks uat workflow"
STRAY=""
for d in docs/*/; do
  n=$(basename "$d")
  case " $ALLOWED " in *" $n "*) ;; *) STRAY="$STRAY $n" ;; esac
done
[ -z "$STRAY" ] && row ok "docs/ directories" "exactly: $ALLOWED" ||
  row fail "docs/ directories" "unowned:$STRAY — fold into a cycle doc or docs/archive/"

# ---------------------------------------------------- ADR 60-day cutoff (warn)

# Portable date math: days-from-civil, no GNU/BSD `date` divergence.
days() { awk -v d="$1" 'BEGIN{
  split(d,a,"-"); y=a[1]; m=a[2]; dd=a[3];
  if (m<=2) y--;
  era = int((y>=0?y:y-399)/400); yoe = y - era*400;
  mp = (m+9)%12; doy = int((153*mp+2)/5) + dd-1;
  doe = yoe*365 + int(yoe/4) - int(yoe/100) + doy;
  print era*146097 + doe - 719468;
}'; }

TODAY=$(days "$(date +%Y-%m-%d)")
STALE=""
while IFS= read -r d; do
  [ -z "$d" ] && continue
  age=$((TODAY - $(days "$d")))
  [ "$age" -gt 60 ] && STALE="$STALE $d(${age}d)"
done < <(grep -oE '^\| 20[0-9]{2}-[0-9]{2}-[0-9]{2} \|' docs/adrs/active.md 2>/dev/null | tr -d '| ')
[ -z "$STALE" ] && row ok "ADR 60-day window" "no out-of-window rows" ||
  row warn "ADR 60-day window" "move to docs/adrs/archive.md:$STALE"

# ------------------------------------------------------ skill references resolve

# Every backticked `<plugin>:<skill>` token in the workflow docs (e.g.
# `superpowers:test-driven-development`, `feature-dev:code-reviewer`) must be
# declared in the tracked registry below. That makes CI deterministic without
# requiring every harness to install Claude-only plugins. When user plugin
# settings exist locally, this check also catches disabled or missing installs.
EXTERNAL_SKILL_REGISTRY=".claude/skills/external-skill-registry.tsv"
USER_SETTINGS="${AUDIT_SKILL_SETTINGS:-$HOME/.claude/settings.json}"
PLUGINS=""
if [ -f "$USER_SETTINGS" ]; then
  PLUGINS=$(python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except Exception as error:
    print(error, file=sys.stderr)
    sys.exit(1)
for key, enabled in data.get("enabledPlugins", {}).items():
    plugin, _, marketplace = key.partition("@")
    print(plugin + "\t" + marketplace + "\t" + str(bool(enabled)).lower())
' "$USER_SETTINGS" 2>/dev/null)
  if [ "$?" -ne 0 ]; then
    row fail "Skill plugin settings" "cannot parse $USER_SETTINGS"
  fi
fi

# The only non-skill colon token is a CSS utility in the vendored accessibility skill.
SKILL_TOKENS=$(grep -hoE '`[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*`' .claude/skills/*/SKILL.md CLAUDE.md docs/workflow/*.md 2>/dev/null | tr -d '`' | grep -v '^focus:outline-none$' | sort -u)
BROKEN=""
while IFS= read -r tok; do
  [ -z "$tok" ] && continue
  plugin=${tok%%:*}
  skill=${tok#*:}
  if ! awk -F'\t' -v p="$plugin" -v s="$skill" '
    $0 !~ /^#/ && $1 == p && $2 == s { found=1 }
    END { exit found ? 0 : 1 }
  ' "$EXTERNAL_SKILL_REGISTRY" 2>/dev/null; then
    BROKEN="$BROKEN $tok(not-in-registry)"
    continue
  fi

  match=$(printf '%s\n' "$PLUGINS" | awk -F'\t' -v p="$plugin" '$1==p{print;exit}')
  if [ -f "$USER_SETTINGS" ] && [ -z "$match" ]; then
    BROKEN="$BROKEN $tok(plugin-not-configured)"
  elif [ -n "$match" ]; then
    marketplace=$(printf '%s' "$match" | cut -f2)
    enabled=$(printf '%s' "$match" | cut -f3)
    if [ "$enabled" != "true" ]; then
      BROKEN="$BROKEN $tok(plugin-disabled)"
      continue
    fi
    PLUGIN_DIR="$HOME/.claude/plugins/cache/$marketplace/$plugin"
    SKILL_HIT=$(find "$PLUGIN_DIR" -type d -path '*/skills/'"$skill" 2>/dev/null)
    AGENT_HIT=$(find "$PLUGIN_DIR" \( -path '*/agents/'"$skill"'.md' -o -type d -path '*/agents/'"$skill" \) 2>/dev/null)
    [ -z "$SKILL_HIT" ] && [ -z "$AGENT_HIT" ] && BROKEN="$BROKEN $tok(not-found)"
  fi
done <<< "$SKILL_TOKENS"

[ -z "$BROKEN" ] && row ok "Skill references resolve" "every plugin:skill token is in the tracked registry; local plugin installs checked when settings exist" ||
  row fail "Skill references resolve" "broken:$BROKEN"

# --------------------------------------------------- standards-table paths exist

# Converts a staged-file glob from docs/workflow/build.md's routing tables into a tracked-file
# test. Source docs should resolve against committed paths, not generated artifacts,
# ignored caches, or sibling worktrees that happen to sit under the checkout.
path_glob_exists() {
  local tok="$1" prefix rest items suffix item candidate pat hit
  case "$tok" in
    *'{'*) # brace group, e.g. components/{teacher,parent}/** — try each alternative
      prefix=${tok%%\{*}
      rest=${tok#*\{}
      items=${rest%%\}*}
      suffix=${rest#*\}}
      for item in $(printf '%s' "$items" | tr ',' ' '); do
        candidate="${prefix}${item}${suffix}"
        pat=$(printf '%s' "$candidate" | sed 's/\*\*/*/g')
        hit=$(git ls-files -- "$pat")
        [ -n "$hit" ] && return 0
      done
      return 1
      ;;
    *)
      pat=$(printf '%s' "$tok" | sed 's/\*\*/*/g')
      hit=$(git ls-files -- "$pat")
      [ -n "$hit" ]
      ;;
  esac
}

MISSING=""
CHECKED=0
while IFS= read -r tok; do
  [ -z "$tok" ] && continue
  case "$tok" in
    */*) ;;                     # looks like a path
    *.ts|*.tsx|*.css) ;;        # or a bare file with a real source extension
    *) continue ;;              # otherwise it's prose (`bg-status-*`, `text-wrap`, …) — skip
  esac
  CHECKED=$((CHECKED + 1))
  path_glob_exists "$tok" || MISSING="$MISSING $tok"
done < <(awk '
  /^\| Staged file glob \| Load \|/ { f=1; next }
  /^\| Frontend task touches \| Also invoke \|/ { f=1; next }
  /^$/ { f=0 }
  f && /^\|/ { print }
' docs/workflow/build.md | awk -F'|' '{print $2}' | grep -oE '`[^`]+`' | tr -d '`' | sort -u)

# An empty table would pass vacuously, which is how this check went blind once the tables moved.
if [ "$CHECKED" = "0" ]; then
  row fail "Standards-table paths exist" "no load-on-demand table found in docs/workflow/build.md"
elif [ -z "$MISSING" ]; then
  row ok "Standards-table paths exist" "every staged-file glob in docs/workflow/build.md matches tracked source ($CHECKED)"
else
  row fail "Standards-table paths exist" "no match on disk:$MISSING"
fi

# ------------------------------------- SessionStart hook messages reach the assistant

# Claude Code only folds a SessionStart hook's STDOUT into the assistant's context;
# stderr is silently dropped. A hook script that echoes an `Assistant:`-directed
# message to `>&2` is writing guidance nobody will ever read.
PROJECT_SETTINGS=".claude/settings.json"
if [ ! -f "$PROJECT_SETTINGS" ]; then
  row warn "SessionStart hook stdout" "no .claude/settings.json — skipping"
else
  HOOK_CMDS=$(python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except Exception:
    sys.exit(0)
for entry in data.get("hooks", {}).get("SessionStart", []):
    for h in entry.get("hooks", []):
        cmd = h.get("command", "")
        if cmd:
            print(cmd)
' "$PROJECT_SETTINGS" 2>/dev/null)

  BROKEN=""
  while IFS= read -r cmd; do
    [ -z "$cmd" ] && continue
    script=$(printf '%s\n' "$cmd" | awk '{print $2}')
    [ -z "$script" ] && continue
    [ -f "$script" ] || continue
    matches=$(grep -E 'Assistant:' "$script" 2>/dev/null)
    case "$matches" in
      *'>&2'*) BROKEN="$BROKEN $script" ;;
    esac
  done < <(printf '%s\n' "$HOOK_CMDS")

  [ -z "$BROKEN" ] && row ok "SessionStart hook stdout" "no Assistant: guidance sent to stderr" ||
    row fail "SessionStart hook stdout" "stderr-only assistant message in:$BROKEN"
fi

# --------------------------------------------- File Structure paths still exist

MISSING=""
for p in app/admin app/teacher app/parent app/api components/ui lib prisma proxy.ts e2e docs .claude .githooks scripts; do
  [ -e "$p" ] || MISSING="$MISSING $p"
done
[ -z "$MISSING" ] && row ok "File Structure paths" "all present" ||
  row fail "File Structure paths" "missing:$MISSING"

# ------------------------------------------------- nothing tracked but missing

DANGLING=0
while IFS= read -r f; do [ -e "$f" ] || DANGLING=$((DANGLING + 1)); done < <(git ls-files)
[ "$DANGLING" = "0" ] && row ok "Tracked paths exist" "no dangling entries in the index" ||
  row fail "Tracked paths exist" "$DANGLING tracked path(s) missing on disk"

# ------------------------------------------- public-repo hygiene (this is PUBLIC)

LEAKED=$(git ls-files | grep -E '(^|/)\.env' | grep -v '^\.env\.example$' || true)
[ -z "$LEAKED" ] && row ok "No env files tracked" "only .env.example" ||
  row fail "No env files tracked" "$(echo "$LEAKED" | tr '\n' ' ')"

ACCT=$(git ls-files | grep -E 'verify-accounts\.json$' | grep -v example || true)
[ -z "$ACCT" ] && row ok "No account file tracked" "verify-accounts.json is local-only" ||
  row fail "No account file tracked" "$ACCT names real accounts on a public repo"

# README is the public front page — keep it a front page.
README_LINES=$(wc -l <README.md | tr -d ' ')
LONGEST=$(awk '{ if (length($0) > m) m = length($0) } END { print m+0 }' README.md)
if [ "$README_LINES" -le 120 ] && [ "$LONGEST" -le 600 ]; then
  row ok "README size budget" "${README_LINES} lines, longest ${LONGEST} chars"
else
  row fail "README size budget" "${README_LINES} lines (max 120), longest line ${LONGEST} chars (max 600) — move detail to docs/runbooks/ or CLAUDE.md"
fi

# ------------------------------------------------------------------- output

printf '### /audit-docs report — %s\n\n| Check | Status | Detail |\n|---|---|---|\n%s\n' \
  "$(date +%Y-%m-%d)" "$REPORT"
printf '**Summary:** %d ok, %d warn, %d fail\n' "$OKS" "$WARNS" "$FAILS"

[ "$FAILS" -gt 0 ] && exit 1
exit 0
