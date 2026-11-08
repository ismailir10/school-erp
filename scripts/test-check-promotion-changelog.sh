#!/usr/bin/env bash
# Self-test for check-promotion-changelog.sh in a throwaway repo.
set -euo pipefail
SCRIPT="$(cd "$(dirname "$0")" && pwd)/check-promotion-changelog.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cd "$T"
git init -q -b main . && git config user.email t@t && git config user.name t
mkdir -p lib/changelog/data
printf '  {\n    id: "2026-11-01",\n    headline: "A",\n  },\n' > lib/changelog/data/part-1.ts
echo x > other.txt
git add -A && git commit -qm base

fail=0
expect() { # name want(0|1) base head
  if bash "$SCRIPT" "$3" "$4" >/dev/null 2>&1; then got=0; else got=1; fi
  if [ "$got" != "$2" ]; then echo "FAIL: $1 (want exit-fail=$2, got $got)"; fail=1; else echo "ok: $1"; fi
}

git checkout -qb no-entry && echo y >> other.txt && git commit -qam "code only"
expect "code change without an entry fails" 1 main no-entry

git checkout -qb edit-only main
sed -i 's/headline: "A"/headline: "B"/' lib/changelog/data/part-1.ts && git commit -qam "reword"
expect "editing an old entry does not count" 1 main edit-only

git checkout -qb with-entry main
printf '  {\n    id: "2026-11-08",\n    headline: "C",\n  },\n' >> lib/changelog/data/part-1.ts && git commit -qam "entry"
expect "a new release id passes" 0 main with-entry

git checkout -qb second-same-day main
printf '  {\n    id: "2026-11-01-2",\n    headline: "D",\n  },\n' >> lib/changelog/data/part-1.ts && git commit -qam "entry"
expect "a same-day -2 id passes" 0 main second-same-day

[ "$fail" = 0 ] && echo "test-check-promotion-changelog: all passed" || { echo "test-check-promotion-changelog: FAILED"; exit 1; }
