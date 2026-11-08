# November 8 promotion changelog

## Context

The next promotion includes Gerbang, staff attendance, sentra rotation, separate TK A and TK B themes, and the new Apa yang Baru page.

## Spec

Add one Indonesian release entry to Apa yang Baru for the November 8 promotion. Describe the changes each portal can use.

## Tasks

- [x] Write and validate the release entry.

## Implementation

- Plan: use the existing release data format for this copy-only change.
- Added the November 8 entry to `lib/changelog/data/part-3.ts`.

## Verification

- `vitest run lib/changelog` passed 22 tests across 2 files.
- design-system: copy-only release data. The existing page, layout, and controls are reused.

## Ship Notes

Merge the entry into staging before opening the promotion PR. Confirm the entry date matches the promotion date. No migrations or configuration changes in this cycle.
