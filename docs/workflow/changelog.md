# Changelog — how we write "Apa yang Baru"

The in-app page `/changelog` lists what changed for users, one entry per `main` promotion. Data lives in
`lib/changelog/` (`releases.ts` merges `data/part-*.ts`); the limits below are enforced by
`lib/changelog/__tests__/schema.test.ts`. Wording follows [voice.md](../../.claude/standards/voice.md) and its
glossary (Tagihan, Hadir, Rapor, Bu Guru ...).

## When

Every promotion (`/ship --to-main`) adds exactly one entry **before** the promotion PR opens: a small
`docs(changelog)` cycle PR to `staging`. The promotion check (`scripts/check-promotion-changelog.sh`, run by the
`Checks` job on `staging` → `main` PRs) fails if `lib/changelog/` has no new entry since `main`.

## Shape

| Field | Rule |
|---|---|
| `id` | Promotion date `YYYY-MM-DD`; a second promotion the same day adds `-2`. Newest first. |
| `headline` | The theme of the release, ≤ 60 chars, sentence case, no full stop. "Gerbang absensi staf", not "Update 8 Nov". |
| `items` | 1-7 items (aim for 2-5). One item = one thing a user can now see or do. |
| item `text` | One sentence, ≤ 140 chars, starts with who/what changed for the user. |
| item `kind` | `baru` a capability that did not exist · `lebih-baik` an existing thing is faster, clearer or simpler · `diperbaiki` something was wrong and now works. |
| item `audience` | `admin` · `guru` · `orang-tua` · `semua`. Pick the portal that sees it; `semua` only when all three do. |

## Include

- Anything a user can see, tap or receive that behaves differently (screens, buttons, notifications, emails, PDFs,
  amounts, dates).
- A fix, **only** if a user could have hit the bug. Say what works now, not what was broken.
- Group a run of small fixes in one area into a single `diperbaiki` item ("Beberapa perbaikan tampilan di ponsel kecil").

## Skip

Dependency bumps, refactors, tests, CI, docs, internal tooling, performance work nobody can feel, anything behind a
flag that is off. If the whole promotion is like this, the entry is one item:
`MAINTENANCE_ITEM` from `lib/changelog/schema.ts`, headline "Pemeliharaan".

## Words

- User words, never code words: "Tagihan", not "invoice"; "halaman", not "route"; no table, endpoint, flag, PR or
  commit vocabulary. No `#123`, links or backticks (tests reject them).
- Name the thing and the benefit; cut the history. Lead with the verb: "Guru bisa …", "Admin bisa …", "Orang tua
  melihat …".
- Parent-facing items are warm and child-framed; admin items are neutral and short (voice.md personas).
- Same tone for every item of a kind; no exclamation marks, no emoji, no "akhirnya".

| Instead of | Write |
|---|---|
| "Fix N+1 on student list" | (skip: nobody feels it) or "Daftar siswa terbuka lebih cepat." |
| "Billing skips student on leave (#698)" | "Tagihan tidak dibuat untuk siswa yang sedang cuti." |
| "Refactor attendance gate" | (skip) |
| "Geofence check-in for staff" | "Guru dan staf absen masuk dari lokasi sekolah; di luar area, absen ditolak." |

## Process

1. List what shipped: `git log --no-merges --format='%s' origin/main..origin/staging` plus the cycle docs it names.
2. Cut to what users feel; merge near-duplicates; write 1-7 items; pick the headline last.
3. Add the entry at the top of the newest `lib/changelog/data/part-*.ts`, run `npx vitest run lib/changelog`.
4. Ship it to `staging` through its own small PR, then open the promotion.
