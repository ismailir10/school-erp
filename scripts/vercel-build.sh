#!/usr/bin/env bash
# vercel-build.sh — build step for Vercel deploys.
#
# Applies Prisma migrations on the `staging` and `main` branches. Both
# deploy targets are now live: staging gets migrations on every push,
# main gets them on the staging→main promote PR. No other branch reaches
# this script: vercel.json's ignoreCommand (scripts/vercel-ignore.sh) skips
# every non-staging/main build. The `*)` arm below is a safety net only.
#
# This is the enforcement arm for the staging→main promote flow:
# `prisma migrate deploy` is idempotent (only applies new migrations)
# and will fail the deploy loudly if prod schema has drifted. Do not
# skip or silently continue — a schema/code mismatch in prod is a P0.

set -eu

echo "vercel-build: VERCEL_GIT_COMMIT_REF=${VERCEL_GIT_COMMIT_REF:-unset} VERCEL_ENV=${VERCEL_ENV:-unset}"

# Demo auth trusts an unsigned user-id cookie. The runtime refuses it on Vercel
# (lib/security/demo-mode.ts); failing the build makes the misconfiguration
# loud instead of silently half-applied (payment clients also read DEMO_MODE).
if [ "${DEMO_MODE:-}" = "true" ]; then
  echo "vercel-build: DEMO_MODE=true on a Vercel deploy — refusing to build. Remove it from the project env." >&2
  exit 1
fi

case "${VERCEL_GIT_COMMIT_REF:-}" in
  staging|main)
    echo "vercel-build: branch is ${VERCEL_GIT_COMMIT_REF} — running prisma migrate deploy"
    npx prisma migrate deploy
    ;;
  *)
    echo "vercel-build: branch is ${VERCEL_GIT_COMMIT_REF:-unknown} — skipping migrate deploy (preview/feature branches use the staging DB directly)"
    ;;
esac

npx prisma generate
next build
