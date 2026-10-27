import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { Client } from "pg";
import { test as base, expect, type APIRequestContext, type APIResponse } from "@playwright/test";

// Real PostgreSQL regression: a class moving between streams and a student
// enrolling elsewhere must not each pass a check against the other's old state.
// Row locks park the first HTTP transaction AFTER its reads. pg_stat_activity
// proves the requests reached the barrier; no sleep chooses the commit order.
type Reply = { status: number; body: Record<string, unknown> };
type Door = "class roster" | "student detail";
type Fixture = {
  studentId: string;
  sourceId: string;
  targetId: string;
  nextProgramId: string;
};

function localDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname)) {
    throw new Error("Concurrency tests require DATABASE_URL pointing at disposable local PostgreSQL.");
  }
  return connectionString;
}

async function reply(response: Promise<APIResponse>): Promise<Reply> {
  const result = await response;
  return { status: result.status(), body: await result.json() };
}

async function checked(response: Promise<APIResponse>, status = 200): Promise<Record<string, unknown>> {
  const result = await reply(response);
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  return result.body;
}

function enroll(request: APIRequestContext, door: Door, studentId: string, classId: string) {
  return reply(door === "class roster"
    ? request.post(`/api/admin/classes/${classId}/enrollments`, {
      data: { studentId, ageOverrideReason: "Isolated concurrency regression fixture" },
    })
    : request.post(`/api/students/${studentId}/enroll`, {
      data: { classSectionId: classId, ageOverrideReason: "Isolated concurrency regression fixture" },
    }));
}

/** Return the actual backend PID waiting on this barrier, or null if HTTP won. */
async function waitingOn(observer: Client, blockingPid: number, response: Promise<Reply>): Promise<number | null> {
  let completed = false;
  void response.then(() => { completed = true; }, () => { completed = true; });
  const deadline = Date.now() + 3500;
  while (Date.now() < deadline) {
    const waiting = await observer.query<{ pid: number }>(`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND $1::integer = ANY(pg_blocking_pids(pid))
      ORDER BY pid
    `, [blockingPid]);
    if (waiting.rows[0]) return waiting.rows[0].pid;
    if (completed) return null;
    await pause(20); // Poll a PostgreSQL condition; elapsed time never releases a barrier.
  }
  throw new Error(`No PostgreSQL lock wait observed behind backend ${blockingPid}`);
}

async function createFixture(request: APIRequestContext): Promise<Fixture> {
  const [campuses, programs, years] = await Promise.all([
    checked(request.get("/api/config/campuses?status=ACTIVE")),
    checked(request.get("/api/programs")),
    checked(request.get("/api/academic-years")),
  ]);
  const rows = (value: Record<string, unknown>) =>
    (Array.isArray(value) ? value : value.data) as { id: string; type?: string; status: string }[];
  const campus = rows(campuses).find((row) => row.status === "ACTIVE");
  const semester = rows(programs).find((row) => row.status === "ACTIVE" && row.type === "SEMESTER");
  const yearRound = rows(programs).find((row) => row.status === "ACTIVE" && row.type === "YEAR_ROUND");
  const year = rows(years).find((row) => row.status === "ACTIVE");
  expect(campus, "Seed must contain an active campus").toBeTruthy();
  expect(semester, "Seed must contain a SEMESTER program").toBeTruthy();
  expect(yearRound, "Seed must contain a YEAR_ROUND program").toBeTruthy();
  expect(year, "Seed must contain an active academic year").toBeTruthy();

  const suffix = randomUUID().slice(0, 8);
  const student = await checked(request.post("/api/students", {
    data: { name: `E2E Stream Race ${suffix}`, status: "ACTIVE" },
  }), 201);
  const createClass = (programId: string, label: string) => checked(request.post("/api/admin/classes", {
    data: {
      campusId: campus!.id, programId, academicYearId: year!.id,
      name: `E2E Stream ${label} ${suffix}`, ageGroup: "A", capacity: 5, slotTemplate: "FULL_DAY",
    },
  }), 201);
  const source = await createClass(semester!.id, "source");
  const target = await createClass(yearRound!.id, "target");
  const fixture = {
    studentId: String(student.id), sourceId: String(source.id),
    targetId: String(target.id), nextProgramId: yearRound!.id,
  };
  const initial = await enroll(request, "class roster", fixture.studentId, fixture.sourceId);
  expect(initial.status, JSON.stringify(initial.body)).toBe(201);
  return fixture;
}

async function cleanup(request: APIRequestContext, fixture: Fixture) {
  for (const classId of [fixture.sourceId, fixture.targetId]) {
    const removed = await reply(request.delete(`/api/admin/classes/${classId}/enrollments?studentId=${fixture.studentId}`));
    expect([200, 404], JSON.stringify(removed.body)).toContain(removed.status);
  }
  await checked(request.put(`/api/students/${fixture.studentId}`, { data: { status: "INACTIVE" } }));
  for (const classId of [fixture.sourceId, fixture.targetId]) {
    await checked(request.delete(`/api/admin/classes/${classId}`));
  }
}

async function assertStreamInvariant(observer: Client, studentId: string) {
  const duplicates = await observer.query(`
    SELECT c."academicYearId", p.type, COUNT(*)::integer AS count
    FROM "StudentEnrollment" e
    JOIN "ClassSection" c ON c.id = e."classSectionId"
    JOIN "Program" p ON p.id = c."programId"
    WHERE e."studentId" = $1 AND e.status = 'ACTIVE'
    GROUP BY c."academicYearId", p.type HAVING COUNT(*) > 1
  `, [studentId]);
  expect(duplicates.rows, "At most one ACTIVE placement per program type and academic year").toEqual([]);
}

// These are HTTP/database tests. An API context keeps them independent of the
// browser binary while using the same seeded demo identity as browser E2E.
const test = base.extend<{ admin: APIRequestContext }>({
  admin: async ({ request, playwright, baseURL }, provide) => {
    const users = await checked(request.get("/api/auth/users"));
    const admin = (users as unknown as { id: string; role: string }[]).find((user) => user.role === "SUPER_ADMIN");
    expect(admin, "Seed must contain a real super admin").toBeTruthy();
    const context = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Cookie: `school-erp-session=${admin!.id}` },
    });
    try {
      await provide(context);
    } finally {
      await context.dispose();
    }
  },
});

test.describe("Class program changes versus concurrent enrollment", () => {
  for (const door of ["class roster", "student detail"] as const) {
    for (const first of ["program change", "enrollment"] as const) {
      test(`${door}: ${first} commits first without duplicate streams`, async ({ admin }) => {
        const observer = new Client({ connectionString: localDatabaseUrl(), application_name: "e2e-stream-observer" });
        const barrier = new Client({ connectionString: localDatabaseUrl(), application_name: "e2e-stream-barrier" });
        await observer.connect();
        await barrier.connect();
        let fixture: Fixture | undefined;
        const pending: Promise<Reply>[] = [];
        try {
          fixture = await createFixture(admin);
          await barrier.query("BEGIN");
          const pid = (await barrier.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
          // UPDATE waits on source; either enrollment door waits on target
          // (SELECT FOR UPDATE or the foreign-key KEY SHARE check at INSERT).
          await barrier.query('SELECT id FROM "ClassSection" WHERE id = $1 FOR UPDATE', [
            first === "program change" ? fixture.sourceId : fixture.targetId,
          ]);
          const move = () => reply(admin.patch(`/api/admin/classes/${fixture!.sourceId}`, {
            data: { programId: fixture!.nextProgramId },
          }));
          const add = () => enroll(admin, door, fixture!.studentId, fixture!.targetId);
          const leading = first === "program change" ? move() : add();
          pending.push(leading);
          const leadingPid = await waitingOn(observer, pid, leading);
          expect(leadingPid, "First HTTP transaction must reach the held class row").not.toBeNull();

          const trailing = first === "program change" ? add() : move();
          pending.push(trailing);
          // On the broken implementation the second request completes instead
          // of waiting. Still release the first, then assert the actual bad
          // HTTP outcome/invariant, so this reproduces corruption on old code.
          const trailingPid = await waitingOn(observer, leadingPid!, trailing);
          await barrier.query("COMMIT");
          const [leadingResult, trailingResult] = await Promise.all([leading, trailing]);
          await assertStreamInvariant(observer, fixture.studentId);
          expect(leadingResult.status, JSON.stringify(leadingResult.body)).toBe(first === "program change" ? 200 : 201);
          expect(trailingResult.status, JSON.stringify(trailingResult.body)).toBe(409);
          expect(trailingResult.body.code).toBe(first === "program change" ? "ALREADY_ENROLLED" : "PROGRAM_TYPE_CONFLICT");
          expect(trailingPid, "Competing transaction must wait for the topology holder").not.toBeNull();
        } finally {
          await barrier.query("ROLLBACK").catch(() => {});
          await Promise.allSettled(pending);
          try {
            if (fixture) await cleanup(admin, fixture);
          } finally {
            await barrier.end();
            await observer.end();
          }
        }
      });
    }

    test(`${door}: school and daycare placements remain allowed`, async ({ admin }) => {
      const observer = new Client({ connectionString: localDatabaseUrl() });
      await observer.connect();
      let fixture: Fixture | undefined;
      try {
        fixture = await createFixture(admin);
        const added = await enroll(admin, door, fixture.studentId, fixture.targetId);
        expect(added.status, JSON.stringify(added.body)).toBe(201);
        await assertStreamInvariant(observer, fixture.studentId);
        const types = await observer.query<{ type: string }>(`
          SELECT p.type FROM "StudentEnrollment" e
          JOIN "ClassSection" c ON c.id = e."classSectionId"
          JOIN "Program" p ON p.id = c."programId"
          WHERE e."studentId" = $1 AND e.status = 'ACTIVE' ORDER BY p.type
        `, [fixture.studentId]);
        expect(types.rows.map((row) => row.type)).toEqual(["SEMESTER", "YEAR_ROUND"]);
      } finally {
        try {
          if (fixture) await cleanup(admin, fixture);
        } finally {
          await observer.end();
        }
      }
    });
  }
});
