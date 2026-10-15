/**
 * POST /api/admin/curriculum/import-promes
 *
 * Two-stage endpoint (preview / commit) for ingesting a PROMES xlsx
 * into the curriculum tables.
 *
 *   - Default (no `?commit=true`):
 *       multipart upload → parser → Zod row validation → conflict
 *       detection → JSON preview payload (no DB writes).
 *
 *   - `?commit=true`:
 *       same parse + validation + conflict detection. On clean state,
 *       opens an interactive `prisma.$transaction` that writes
 *       LearningObjective + AchievementIndicator rows AND a single
 *       `AuditLog` entry atomically. Any failure rolls the whole
 *       request back.
 *
 * Auth: requires `curriculum.write`. Tenant: every Prisma touch is
 * scoped to `session.tenantId`. The parent Semester is verified via
 * `findFirst({ tenantId })` before the parser even runs, so a caller
 * cannot import into another tenant's Semester id.
 *
 * File guards: 5 MiB cap (413) + content-type / .xlsx extension
 * allow-list (415). The parser's own typed `PromesParseError` paths
 * surface as 400 with an Indonesian user-message.
 *
 * Conflict policy (C2 — locked): hard reject 409 on any collision
 * against the `(tenantId, semesterId, ageGroup, element, number)`
 * unique key. No "overwrite" toggle — C3's CRUD UI handles surgical
 * edits (per cycle doc Assumption 4).
 */

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import {
  parsePromesWorkbook,
  PromesParseError,
} from "@/lib/curriculum/promes-parser";
import {
  promesImportRequestSchema,
  objectiveCreateSchema,
  indicatorCreateSchema,
  type CurriculumElementInput,
  type ObjectiveCreateInput,
  type IndicatorCreateInput,
  type PromesPreviewPayload,
  type PromesCommitPayload,
  type PromesConflictPolicy,
} from "@/lib/validations/curriculum";
import {
  CURRICULUM_WRITE_BUDGET,
  CURRICULUM_WRITE_WINDOW_MS,
  isUniqueViolation,
} from "../_helpers";
import { indexThemes, resolveThemeNames } from "@/lib/curriculum/theme-match";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB
// Row-count caps defend against parameter-exhaustion DoS: Postgres allows
// at most 65 535 bind parameters per statement, and `createMany` issues
// `cols × rows` params. With ~7 columns the LearningObjective ceiling is
// ~9 K rows; we cap well below that. 2 000 / 10 000 is also far above any
// realistic PROMES file (real artefacts hold ~150 IKTPs total).
const MAX_OBJECTIVE_ROWS = 2_000;
const MAX_INDICATOR_ROWS = 10_000;
const ACCEPTED_MIME_TYPES = new Set<string>([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
  // Some upload paths drop the MIME altogether — accept empty as long as
  // the filename's `.xlsx` extension carries the day below.
  "",
]);

function isAcceptedXlsx(file: File): boolean {
  if (ACCEPTED_MIME_TYPES.has(file.type)) return true;
  return file.name.toLowerCase().endsWith(".xlsx");
}

export async function POST(req: NextRequest) {
  // Auth before rate-limit so an unauthenticated burst can't drain the
  // shared per-tenant budget.
  const auth = await requirePermission("curriculum.write");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { success } = rateLimit(
    `curriculum-import-promes:${getClientIp(req)}`,
    CURRICULUM_WRITE_BUDGET,
    CURRICULUM_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan" },
      { status: 429 },
    );
  }

  // ── multipart parsing + file guards ────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Body multipart tidak valid." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Berkas xlsx wajib diunggah pada field 'file'." },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json(
      { error: "Berkas xlsx kosong." },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "Berkas xlsx melebihi batas 5 MB." },
      { status: 413 },
    );
  }
  if (!isAcceptedXlsx(file)) {
    return NextResponse.json(
      { error: "Format berkas tidak didukung. Unggah berkas .xlsx." },
      { status: 415 },
    );
  }

  const formObj = {
    semesterId: form.get("semesterId"),
    ageGroup: form.get("ageGroup"),
  };
  const requestParse = promesImportRequestSchema.safeParse({
    semesterId: typeof formObj.semesterId === "string" ? formObj.semesterId : "",
    ageGroup: typeof formObj.ageGroup === "string" ? formObj.ageGroup : "",
  });
  if (!requestParse.success) {
    return NextResponse.json(
      {
        error: "Validasi formulir gagal",
        errors: requestParse.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }
  const { semesterId, ageGroup } = requestParse.data;

  // ── tenant-scoped parent guard ─────────────────────────────────────
  const semester = await prisma.semester.findFirst({
    where: { id: semesterId, tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!semester) {
    return NextResponse.json(
      { error: "Semester tidak ditemukan atau nonaktif." },
      { status: 404 },
    );
  }

  // ── parse buffer (typed error surface) ─────────────────────────────
  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed: Awaited<ReturnType<typeof parsePromesWorkbook>>;
  try {
    parsed = await parsePromesWorkbook(buffer, { filename: file.name });
  } catch (err) {
    if (err instanceof PromesParseError) {
      return NextResponse.json(
        { error: err.userMessage, code: err.code },
        { status: 400 },
      );
    }
    throw err;
  }

  // ── flatten parsed rows + Zod row-level validate ───────────────────
  const objectiveRows: ObjectiveCreateInput[] = [];
  const indicatorRows: IndicatorCreateInput[] = [];
  // IKTP×Tema markers from the workbook's E+ columns. Written as
  // `IndicatorThemeLink` rows on commit (2026-07-31) — before that they
  // were parsed and discarded, which left the walas Penilaian Pekanan
  // picker permanently empty because it filters purely on theme link.
  const themeLinkPlan: Array<{
    element: CurriculumElementInput;
    objectiveNumber: number;
    order: number;
    themeNames: string[];
  }> = [];
  try {
    for (const [elementKey, objectives] of Object.entries(parsed.byElement)) {
      const element = elementKey as CurriculumElementInput;
      for (const o of objectives ?? []) {
        objectiveRows.push(
          objectiveCreateSchema.parse({
            semesterId,
            ageGroup,
            element,
            number: o.number,
            competencyText: o.competencyText,
            content: o.content,
          }),
        );
        for (const i of o.indicators) {
          indicatorRows.push(
            indicatorCreateSchema.parse({
              semesterId,
              ageGroup,
              element,
              objectiveNumber: o.number,
              content: i.content,
              order: i.order,
            }),
          );
          if (i.themeNames.length > 0) {
            themeLinkPlan.push({
              element,
              objectiveNumber: o.number,
              order: i.order,
              themeNames: i.themeNames,
            });
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Validasi baris PROMES gagal",
          errors: err.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }
    throw err;
  }

  if (objectiveRows.length === 0) {
    return NextResponse.json(
      {
        error:
          "Berkas PROMES tidak memiliki baris tujuan pembelajaran yang valid.",
      },
      { status: 400 },
    );
  }

  // Row-count caps. Reject mega-imports before any DB work — protects the
  // Postgres bind-parameter budget and the audit feed from a single
  // upload swamping the queue.
  if (
    objectiveRows.length > MAX_OBJECTIVE_ROWS ||
    indicatorRows.length > MAX_INDICATOR_ROWS
  ) {
    return NextResponse.json(
      {
        error:
          "Berkas PROMES terlalu besar. Maksimum 2.000 tujuan pembelajaran dan 10.000 indikator per impor.",
      },
      { status: 413 },
    );
  }

  // Intra-upload duplicate guard. The LearningObjective unique key is
  // (tenantId, semesterId, ageGroup, element, number) — the in-DB
  // constraint would catch a duplicate mid-transaction, but that path
  // surfaces as a 500 with no actionable message. Detect upfront and
  // return a clear 400 naming the offending (element, number) pair.
  const seenObjectiveKeys = new Map<string, number>();
  const intraDupes: Array<{
    element: CurriculumElementInput;
    number: number;
  }> = [];
  for (const o of objectiveRows) {
    const key = `${o.element}:${o.number}`;
    const prev = seenObjectiveKeys.get(key) ?? 0;
    seenObjectiveKeys.set(key, prev + 1);
    if (prev === 1) intraDupes.push({ element: o.element, number: o.number });
  }
  if (intraDupes.length > 0) {
    return NextResponse.json(
      {
        error:
          "Berkas PROMES memiliki nomor tujuan pembelajaran yang sama pada elemen yang sama. Perbaiki duplikat sebelum diimpor.",
        duplicates: intraDupes,
      },
      { status: 400 },
    );
  }

  // ── conflict detection (no DB writes yet) ──────────────────────────
  // Split by status so the operator can choose to skip-or-reactivate
  // INACTIVE conflicts (left over from a prior C3 IKTP soft-delete)
  // without being forced to block on the whole batch.
  const conflictKeys = objectiveRows.map((o) => ({
    element: o.element,
    number: o.number,
  }));
  const existing = await prisma.learningObjective.findMany({
    where: {
      tenantId: session.tenantId,
      semesterId,
      ageGroup,
      OR: conflictKeys.map((k) => ({
        element: k.element,
        number: k.number,
      })),
    },
    select: { id: true, element: true, number: true, content: true, status: true },
  });
  const conflicts: PromesPreviewPayload["conflicts"] = {
    active: existing
      .filter((e) => e.status === "ACTIVE")
      .map((e) => ({
        ageGroup,
        element: e.element as CurriculumElementInput,
        number: e.number,
        existingContent: e.content,
      })),
    inactive: existing
      .filter((e) => e.status === "INACTIVE")
      .map((e) => ({
        ageGroup,
        element: e.element as CurriculumElementInput,
        number: e.number,
        existingContent: e.content,
        existingId: e.id,
      })),
  };

  // ── resolve IKTP×Tema markers against this semester's Theme rows ────
  // Tenant + semester scoped: `IndicatorThemeLink` has no `tenantId` of
  // its own (bare join table, isolation is transitive through
  // indicator→objective→semester and theme→semester), so this query is
  // the tenant gate for every link written below.
  const semesterThemes = await prisma.theme.findMany({
    where: { tenantId: session.tenantId, semesterId, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  const themeIndex = indexThemes(semesterThemes);
  const themeLinkUnmatched: string[] = [];
  let themeLinkPairCount = 0;
  for (const plan of themeLinkPlan) {
    const resolved = resolveThemeNames(plan.themeNames, themeIndex);
    themeLinkPairCount += resolved.themeIds.length;
    for (const name of resolved.unmatched) {
      if (!themeLinkUnmatched.includes(name)) themeLinkUnmatched.push(name);
    }
  }

  // ── build preview shape (used by both preview AND commit responses) ─
  const previewByElement: PromesPreviewPayload["byElement"] = {};
  for (const [elementKey, objectives] of Object.entries(parsed.byElement)) {
    const element = elementKey as CurriculumElementInput;
    previewByElement[element] = (objectives ?? []).map((o) => ({
      number: o.number,
      competencyText: o.competencyText.trim(),
      content: o.content.trim(),
      indicators: o.indicators.map((i) => ({
        order: i.order,
        content: i.content.trim(),
        themeNames: i.themeNames,
      })),
    }));
  }

  const preview: PromesPreviewPayload = {
    semesterId,
    ageGroup,
    inferredAgeGroup: parsed.inferredAgeGroup,
    filename: file.name,
    byElement: previewByElement,
    counts: {
      objectives: objectiveRows.length,
      indicators: indicatorRows.length,
    },
    themeLinks: {
      matched: themeLinkPairCount,
      unmatched: themeLinkUnmatched,
    },
    conflicts,
  };

  // ── preview branch (no DB writes) ──────────────────────────────────
  // 409 only when there are ACTIVE conflicts (truly unresolvable without
  // tenant action). When only INACTIVE conflicts remain, return 200 so
  // the operator can choose `skip` or `reactivate` on commit.
  const reqUrl = new URL(req.url);
  const commit = reqUrl.searchParams.get("commit") === "true";
  const conflictPolicyRaw = reqUrl.searchParams.get("conflictPolicy") ?? "block";
  if (
    conflictPolicyRaw !== "block" &&
    conflictPolicyRaw !== "skip" &&
    conflictPolicyRaw !== "reactivate"
  ) {
    return NextResponse.json(
      { error: "conflictPolicy harus salah satu dari: block, skip, reactivate." },
      { status: 400 },
    );
  }
  const conflictPolicy = conflictPolicyRaw as PromesConflictPolicy;

  if (!commit) {
    return NextResponse.json(preview, {
      status: conflicts.active.length > 0 ? 409 : 200,
    });
  }

  // ── commit branch ──────────────────────────────────────────────────
  // ACTIVE conflicts always refuse — tenant must resolve in C3 CRUD
  // first. INACTIVE conflicts honour the policy.
  if (conflicts.active.length > 0) {
    return NextResponse.json(
      {
        error:
          "Konflik dengan tujuan pembelajaran yang sudah ada. Selesaikan konflik atau gunakan semester lain.",
        ...preview,
      },
      { status: 409 },
    );
  }
  if (conflicts.inactive.length > 0 && conflictPolicy === "block") {
    return NextResponse.json(
      {
        error:
          "Sebagian baris akan tertabrak tujuan pembelajaran INACTIVE. Pilih kebijakan skip atau reactivate untuk melanjutkan.",
        ...preview,
      },
      { status: 409 },
    );
  }

  // Pre-compute which objectiveRows to skip (conflictPolicy === "skip"
  // or "reactivate" both write only non-conflicting rows; reactivate
  // additionally flips inactive rows to ACTIVE inside the same tx).
  const inactiveKeys = new Set(
    conflicts.inactive.map((c) => `${c.element}:${c.number}`),
  );
  const inactiveIdsToReactivate =
    conflictPolicy === "reactivate"
      ? conflicts.inactive.map((c) => c.existingId)
      : [];
  const filteredObjectiveRows =
    conflicts.inactive.length > 0
      ? objectiveRows.filter((o) => !inactiveKeys.has(`${o.element}:${o.number}`))
      : objectiveRows;
  const filteredIndicatorRows =
    conflicts.inactive.length > 0
      ? indicatorRows.filter(
          (i) => !inactiveKeys.has(`${i.element}:${i.objectiveNumber}`),
        )
      : indicatorRows;

  // Assigned inside the transaction, read after it commits.
  let themeLinksCreated = 0;

  try {
    await prisma.$transaction(async (tx) => {
      if (filteredObjectiveRows.length > 0) {
        await tx.learningObjective.createMany({
          data: filteredObjectiveRows.map((o) => ({
            tenantId: session.tenantId,
            semesterId,
            ageGroup: o.ageGroup,
            element: o.element,
            number: o.number,
            competencyText: o.competencyText,
            content: o.content,
          })),
        });
      }

      // Reactivate INACTIVE conflicts in-place when policy === reactivate.
      if (inactiveIdsToReactivate.length > 0) {
        await tx.learningObjective.updateMany({
          where: {
            tenantId: session.tenantId,
            id: { in: inactiveIdsToReactivate },
          },
          data: { status: "ACTIVE" },
        });
      }

      // Resolve parent objective ids by composite key so the child
      // indicator inserts can carry the correct FK. `createMany` does
      // not return ids in Postgres, so the followup `findMany` is the
      // canonical pattern.
      const created = await tx.learningObjective.findMany({
        where: {
          tenantId: session.tenantId,
          semesterId,
          ageGroup,
        },
        select: { id: true, element: true, number: true },
      });
      const idByKey = new Map<string, string>();
      for (const row of created) {
        idByKey.set(`${row.element}:${row.number}`, row.id);
      }

      const indicatorData = filteredIndicatorRows.map((i) => {
        const objectiveId = idByKey.get(`${i.element}:${i.objectiveNumber}`);
        if (!objectiveId) {
          // Should not happen — every filteredIndicatorRow's parent was
          // inserted above OR pre-existed via reactivate. Throw to roll
          // the transaction back rather than insert an orphan.
          throw new Error(
            `internal: failed to resolve objectiveId for ${i.element}:${i.objectiveNumber}`,
          );
        }
        return {
          tenantId: session.tenantId,
          objectiveId,
          content: i.content,
          order: i.order,
        };
      });
      if (indicatorData.length > 0) {
        await tx.achievementIndicator.createMany({ data: indicatorData });
      }

      // ── IKTP×Tema links ───────────────────────────────────────────
      // `createMany` returns no ids in Postgres, so re-read the rows we
      // just wrote and key them by (objectiveId, order) — unique within
      // this import because every parent objective here is freshly
      // created (ACTIVE conflicts 409 upstream, INACTIVE ones had their
      // indicator rows filtered out).
      if (indicatorData.length > 0 && themeLinkPlan.length > 0) {
        const writtenObjectiveIds = Array.from(
          new Set(indicatorData.map((i) => i.objectiveId)),
        );
        const writtenIndicators = await tx.achievementIndicator.findMany({
          where: {
            tenantId: session.tenantId,
            objectiveId: { in: writtenObjectiveIds },
          },
          select: { id: true, objectiveId: true, order: true },
        });
        const indicatorIdByKey = new Map<string, string>();
        for (const row of writtenIndicators) {
          indicatorIdByKey.set(`${row.objectiveId}:${row.order}`, row.id);
        }

        const linkRows: Array<{ indicatorId: string; themeId: string }> = [];
        const seenPairs = new Set<string>();
        for (const plan of themeLinkPlan) {
          // Objectives skipped by the inactive-conflict filter have no
          // freshly written indicators — nothing to link.
          if (inactiveKeys.has(`${plan.element}:${plan.objectiveNumber}`)) {
            continue;
          }
          const objectiveId = idByKey.get(
            `${plan.element}:${plan.objectiveNumber}`,
          );
          if (!objectiveId) continue;
          const indicatorId = indicatorIdByKey.get(
            `${objectiveId}:${plan.order}`,
          );
          if (!indicatorId) continue;
          const { themeIds } = resolveThemeNames(plan.themeNames, themeIndex);
          for (const themeId of themeIds) {
            const pair = `${indicatorId}:${themeId}`;
            if (seenPairs.has(pair)) continue;
            seenPairs.add(pair);
            linkRows.push({ indicatorId, themeId });
          }
        }
        if (linkRows.length > 0) {
          // Composite PK (indicatorId, themeId) makes this idempotent.
          const linkResult = await tx.indicatorThemeLink.createMany({
            data: linkRows,
            skipDuplicates: true,
          });
          themeLinksCreated = linkResult.count;
        }
      }

      await recordAudit(
        {
          tenantId: session.tenantId,
          actorId: session.id,
          entity: "curriculum.import-promes",
          entityId: semesterId,
          action: "create",
          before: undefined,
          after: {
            semesterId,
            ageGroup,
            conflictPolicy,
            objectivesCreated: filteredObjectiveRows.length,
            objectivesReactivated: inactiveIdsToReactivate.length,
            objectivesSkipped:
              objectiveRows.length - filteredObjectiveRows.length - inactiveIdsToReactivate.length,
            indicatorsCount: filteredIndicatorRows.length,
            themeLinksCreated,
            themeLinksSkippedUnmatched: themeLinkUnmatched.length,
            filename: file.name,
          },
        },
        tx,
      );
    });
  } catch (err) {
    // TOCTOU: a concurrent import between our conflict SELECT and the
    // transaction createMany can produce a P2002 unique-key violation
    // from Postgres. Catch and translate to 409 with the same Indonesian
    // copy preview returned — the admin's next refresh will surface the
    // already-written rows as conflicts.
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        {
          error:
            "Konflik dengan tujuan pembelajaran yang sudah ada. Selesaikan konflik atau gunakan semester lain.",
          ...preview,
        },
        { status: 409 },
      );
    }
    // Any other thrown error inside $transaction triggers an automatic
    // rollback. Log only the error code/name to avoid leaking Prisma
    // constraint metadata into the server log.
    const code =
      err instanceof Error
        ? (err.name ?? "Error") +
          (err && typeof err === "object" && "code" in err
            ? `:${String((err as { code?: unknown }).code)}`
            : "")
        : "unknown";
    console.error("[import-promes] transaction failed", { code });
    return NextResponse.json(
      {
        error:
          "Gagal menyimpan PROMES. Tidak ada perubahan yang tertulis ke database.",
      },
      { status: 500 },
    );
  }

  const commitResponse: PromesCommitPayload = {
    semesterId,
    ageGroup,
    filename: file.name,
    conflictPolicy,
    counts: preview.counts,
    applied: {
      created: filteredObjectiveRows.length,
      reactivated: inactiveIdsToReactivate.length,
      skipped:
        objectiveRows.length - filteredObjectiveRows.length - inactiveIdsToReactivate.length,
      indicators: filteredIndicatorRows.length,
      themeLinks: themeLinksCreated,
      themeLinksUnmatched: themeLinkUnmatched,
    },
  };
  return NextResponse.json(commitResponse, { status: 201 });
}
