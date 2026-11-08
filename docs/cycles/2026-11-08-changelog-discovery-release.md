# Changelog discovery release note

## Context

The approved changelog discovery cycle is merged to staging. This record adds its public-facing update to Apa yang Baru before promoting the release.

## Spec

Publish one Indonesian note about month and module filters and release pagination. Use the second November 8 release identifier because an earlier promotion already used the date.

## Tasks

- [x] Add and validate the release entry.

## Implementation

- Plan: one copy-only data change. Reuse the existing release shape and module labels.
- Added release 2026-11-08-2 with the Umum module.

## Verification

- Local changelog Vitest: 38 passed in three files. Scoped lint passed.
- Full GitHub CI is required before merge under the approved verification plan.

## Ship Notes

- No migrations or environment changes.
- Merge this entry into staging, then include it in the staging to main promotion.
