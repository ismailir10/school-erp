import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  admission: { count: vi.fn(), findMany: vi.fn() },
  enrollmentApplication: { count: vi.fn(), findMany: vi.fn() },
  leaveRequest: { count: vi.fn(), findMany: vi.fn() },
  invoice: { count: vi.fn(), findMany: vi.fn() },
  payrollRun: { count: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { INQUIRY_WINDOW_DAYS, loadAdminQueueSources } from "../queue-sources";
import { buildAdminWorkQueue } from "../admin-work-queue";
import { stageWhere } from "@/lib/admission/stage";

const NOW = new Date("2026-09-29T03:00:00.000Z");
const admin = (permissions: string[]) => ({ role: "SCHOOL_ADMIN", tenantId: "t1", permissions });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const model of Object.values(db)) {
    model.count.mockResolvedValue(0);
    model.findMany.mockResolvedValue([]);
  }
});

describe("admin work queue: new admission inquiries (X-6)", () => {
  it("queries only this tenant's recent leads in the Baru stage", async () => {
    db.admission.count.mockResolvedValue(2);
    db.admission.findMany.mockResolvedValue([
      { id: "a1", childName: "Zahra", parentName: "Ibu Nur", createdAt: new Date("2026-09-28T05:00:00.000Z") },
    ]);
    const sources = await loadAdminQueueSources(admin(["admissions.view", "admissions.edit"]), { take: 5 });

    const where = db.admission.count.mock.calls[0][0].where;
    // Same definition of "not yet followed up" as the list's Baru stage (formulir sent, cancelled and
    // converted leads drop off; legacy visit steps stay).
    expect(where).toMatchObject({ tenantId: "t1", AND: [stageWhere("BARU")] });
    expect(where.createdAt.gte.toISOString()).toBe(
      new Date(NOW.getTime() - INQUIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(db.admission.findMany.mock.calls[0][0]).toMatchObject({ where, take: 5, orderBy: { createdAt: "asc" } });

    expect(sources.inquiries).toEqual({
      status: "ready",
      count: 2,
      records: [{ id: "a1", childName: "Zahra", parentName: "Ibu Nur", createdAt: "2026-09-28T05:00:00.000Z" }],
    });
    expect(buildAdminWorkQueue(sources).find((i) => i.kind === "inquiry")).toMatchObject({
      id: "inquiry:a1",
      title: "Tindak lanjuti pertanyaan Zahra",
      href: "/admin/admissions",
      state: "INQUIRY",
    });
  });

  it("does not query or reveal inquiries to a role without admissions edit access", async () => {
    const sources = await loadAdminQueueSources(admin(["admissions.view"]), { take: 5 });
    expect(sources.inquiries).toEqual({ status: "hidden" });
    expect(db.admission.count).not.toHaveBeenCalled();
  });

  it("reports the source as unavailable instead of an empty queue when the query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.admission.count.mockRejectedValue(new Error("db down"));
    const sources = await loadAdminQueueSources(admin(["admissions.view", "admissions.edit"]), { take: 5 });
    expect(sources.inquiries).toEqual({ status: "unavailable" });
  });
});
