#!/usr/bin/env bash
# Run regression probes in a disposable tracked-source copy, never the worktree.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 2
AUDIT_TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$AUDIT_TEST_ROOT"' EXIT
python3 - "$AUDIT_TEST_ROOT" <<'PY'
from pathlib import Path
import shutil
import subprocess
import sys
root = Path(sys.argv[1])
files = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
for filename in files.decode().split('\0'):
    if not filename:
        continue
    source = Path(filename)
    target = root / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.is_symlink():
        target.symlink_to(source.readlink())
    elif source.is_file():
        # Most audit checks need names/existence only. Copy content only for
        # documents, workflow scripts/config, and hooks the audit actually reads.
        if (filename in {"README.md", "CLAUDE.md", "docs/adrs/active.md"}
                or filename.startswith((".claude/", ".githooks/", "scripts/", "docs/workflow/"))):
            shutil.copy2(source, target)
        else:
            target.touch()
PY
cd "$AUDIT_TEST_ROOT"
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR
git init -q
git add -f .
# Model CI: no user plugin installation or configuration. Never change HOME.
export AUDIT_SKILL_SETTINGS="$AUDIT_TEST_ROOT/no-user-settings.json"
cp docs/workflow/build.md build.original
cp .claude/skills/external-skill-registry.tsv registry.original
expect_failure() {
  local name="$1" detail="$2"
  if bash scripts/audit-docs.sh > audit.out 2>&1; then
    echo "FAIL: $name unexpectedly passed"
    exit 1
  fi
  if ! grep -F "$detail" audit.out >/dev/null; then
    cat audit.out
    echo "FAIL: $name failed for the wrong reason"
    exit 1
  fi
  echo "ok: $name"
  cp build.original docs/workflow/build.md
  cp registry.original .claude/skills/external-skill-registry.tsv
}
bash scripts/audit-docs.sh > audit.out
echo 'ok: clean tree validates declared references without host settings'
python3 - <<'PY'
from pathlib import Path
p=Path('docs/workflow/build.md')
p.write_text(p.read_text().replace('superpowers:test-driven-development','suprpowers:test-driven-development'))
PY
expect_failure 'unknown plugin rejected in CI' 'suprpowers:test-driven-development(not-in-registry)'
python3 - <<'PY'
from pathlib import Path
p=Path('.claude/skills/external-skill-registry.tsv')
p.write_text(''.join(line for line in p.read_text().splitlines(True) if not line.startswith('superpowers\ttest-driven-development\t')))
PY
expect_failure 'missing skill declaration rejected' 'superpowers:test-driven-development(not-in-registry)'
python3 - <<'PY'
from pathlib import Path
p=Path('docs/workflow/build.md')
p.write_text(p.read_text().replace('`proxy.ts`','`untracked-proxy.ts`'))
Path('untracked-proxy.ts').touch()
PY
expect_failure 'untracked artifact cannot satisfy standards path' 'no match on disk: untracked-proxy.ts'
python3 - <<'PY2'
from pathlib import Path
p=Path('docs/workflow/build.md')
p.write_text(p.read_text().replace('| Staged file glob | Load |','| Glob | Standard |').replace('| Frontend task touches | Also invoke |','| Touches | Invoke |'))
PY2
expect_failure 'missing load-on-demand table rejected' 'no load-on-demand table found in docs/workflow/build.md'
printf '{invalid\n' > "$AUDIT_SKILL_SETTINGS"
expect_failure 'invalid host settings rejected' '| Skill plugin settings | fail |'
rm "$AUDIT_SKILL_SETTINGS"
python3 - <<'PY'
from pathlib import Path
p=Path('scripts/check-role.sh')
s=p.read_text()
lines=s.splitlines(True)
for i,line in enumerate(lines):
    if 'echo ' in line and 'Assistant:' in line:
        lines[i]=line.rstrip('\n')+' >&2\n'
        break
p.write_text(''.join(lines))
PY
expect_failure 'stderr guidance rejected' 'stderr-only assistant message in: scripts/check-role.sh'
echo 'Summary: 7 audit regression checks passed'
