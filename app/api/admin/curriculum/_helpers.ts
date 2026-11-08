/**
 * Shared internals for `app/api/admin/curriculum/**` route handlers.
 *
 * The helpers here exist so each route file can stay short: parent-tenant
 * guards, the semester / subTheme select shape used by the list endpoint,
 * and the standard rate-limit budget for curriculum writes.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * Narrow a thrown value to Prisma's documented `P2002` unique-constraint
 * violation. Centralised so each route doesn't redeclare a fragile
 * `typeof err === "object" && err.code === "P2002"` duck-type check.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/**
 * Audit action discriminator. When a PUT changes only `status`, the action
 * is `"status:ACTIVE"` / `"status:INACTIVE"` so the activity feed reads as
 * a soft-delete or reactivation. When the same body also rewrites other
 * fields (rename + reactivate), the action falls back to plain `"update"`
 * because labelling a mixed change as a pure status flip would mislead
 * reviewers reading the audit log later.
 */
export function auditActionForUpdate(
  body: Record<string, unknown>,
): string {
  const keys = Object.keys(body).filter((k) => body[k] !== undefined);
  if (keys.length === 1 && keys[0] === "status") {
    return `status:${String(body.status)}`;
  }
  return "update";
}

export const CURRICULUM_WRITE_BUDGET = 30 as const; // 30 writes / min / IP
export const CURRICULUM_WRITE_WINDOW_MS = 60_000 as const;

/**
 * Confirm a parent row exists, is ACTIVE, and belongs to the caller's tenant
 * before a child write proceeds. Returns the row id when valid; a 400
 * NextResponse otherwise. Caller short-circuits on the response.
 *
 * `entityLabel` is included in the user-facing error copy (Indonesian).
 */
export async function ensureActiveParent(
  table:
    | "semester"
    | "theme"
    | "subTheme"
    | "academicYear"
    | "learningObjective",
  id: string,
  tenantId: string,
  entityLabel: string,
): Promise<{ id: string } | NextResponse> {
  const where = { id, tenantId, status: "ACTIVE" as const };
  let row: { id: string } | null;
  switch (table) {
    case "semester":
      row = await prisma.semester.findFirst({ where, select: { id: true } });
      break;
    case "theme":
      row = await prisma.theme.findFirst({ where, select: { id: true } });
      break;
    case "subTheme":
      row = await prisma.subTheme.findFirst({ where, select: { id: true } });
      break;
    case "academicYear":
      row = await prisma.academicYear.findFirst({ where, select: { id: true } });
      break;
    case "learningObjective":
      row = await prisma.learningObjective.findFirst({
        where,
        select: { id: true },
      });
      break;
  }
  if (!row) {
    return NextResponse.json(
      { error: `${entityLabel} tidak ditemukan atau nonaktif.` },
      { status: 400 },
    );
  }
  return row;
}

export const semesterListSelect = {
  id: true,
  academicYearId: true,
  number: true,
  startDate: true,
  endDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  academicYear: { select: { id: true, name: true, status: true } },
  _count: { select: { themes: true } },
} as const;

export const themeListSelect = {
  id: true,
  semesterId: true,
  name: true,
  ageGroup: true,
  order: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { subThemes: true } },
} as const;

export const subThemeListSelect = {
  id: true,
  themeId: true,
  name: true,
  order: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { weeks: true } },
} as const;

export const weekListSelect = {
  id: true,
  subThemeId: true,
  number: true,
  startDate: true,
  endDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const learningObjectiveListSelect = {
  id: true,
  semesterId: true,
  ageGroup: true,
  element: true,
  number: true,
  competencyText: true,
  content: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const achievementIndicatorListSelect = {
  id: true,
  objectiveId: true,
  content: true,
  order: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  // Include link rows so client can hydrate theme-link checkbox state on
  // initial load — required for the admin objectives page (C3/T5).
  themeLinks: { select: { themeId: true } },
} as const;
