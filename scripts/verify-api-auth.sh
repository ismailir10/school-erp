#!/usr/bin/env bash
# verify-api-auth.sh
#
# Every app/api/**/route.ts MUST either:
#   - reference a session helper: getSession(, requireAdmin(, requireSuperAdmin(,
#     requireTeacher(, requireParent(, requireGuardian(, requireAuth(,
#     requireTeacherForClass(, requireGuardianForStudent(,
#     requireNoteAccessForStudent(, requireDayMarkWriter(, or requirePermission(
#   - OR declare itself public with a top-of-file `// @public` sentinel comment.
#
# Rationale: proxy.ts short-circuits /api/* before any auth check (each route
# handles its own session). Hotfix #118 found one leaking route; this gate
# catches future drift. A `// @public` sentinel is a deliberate, searchable
# marker — not invisible like a missing guard.

set -euo pipefail

AUTH_PATTERN='getSession\(|requireAdmin\(|requireSuperAdmin\(|requireTeacher\(|requireParent\(|requireGuardian\(|requireAuth\(|requireTeacherForClass\(|requireGuardianForStudent\(|requireNoteAccessForStudent\(|requireDayMarkWriter\(|requirePermission\(|// @public'

missing=()
total=0

while IFS= read -r -d '' f; do
  total=$((total+1))
  if ! grep -qE "$AUTH_PATTERN" "$f"; then
    missing+=("$f")
  fi
done < <(find app/api -name "route.ts" -print0)

# Guard against silent-pass if the script runs from the wrong directory.
if [ "$total" -eq 0 ]; then
  echo "✗ No app/api/**/route.ts files found — run from the repo root." >&2
  exit 2
fi

if [ ${#missing[@]} -gt 0 ]; then
  echo "✗ API routes missing session helper OR '// @public' sentinel:"
  printf '    - %s\n' "${missing[@]}"
  echo ""
  echo "Fix: call a session helper (getSession, requireAdmin, etc.) at the"
  echo "     top of the handler, OR add '// @public' on line 1 if the route"
  echo "     is intentionally unauthenticated (webhook, health check)."
  exit 1
fi

echo "✓ API auth coverage OK: $total / $total routes have session helper or @public sentinel."
