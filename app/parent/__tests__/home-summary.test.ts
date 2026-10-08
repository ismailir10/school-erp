import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), family: vi.fn(), outstanding: vi.fn(), attendance: vi.fn(), sessions: vi.fn(), notes: vi.fn(), development: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/parent-helpers", () => ({ getParentWithChildren: mocks.family, getParentOutstandingForStudents: mocks.outstanding }));
vi.mock("@/lib/db", () => ({ prisma: { studentAttendance: { findMany: mocks.attendance }, classSession: {findMany:mocks.sessions}, studentJournalNote: { findMany: mocks.notes } } }));
vi.mock("@/lib/curriculum/perkembangan-loader", () => ({ loadStudentPerkembangan: mocks.development }));
import ParentDashboard from "../page";

const children = [
  { studentId: "child-a", studentName: "Alya Nur Rahma", studentNickname: "Alya", className: "TK A", relationship: "IBU" },
  { studentId: "child-b", studentName: "Alya Nur Zahra", studentNickname: "Alya", className: "TK B", relationship: "IBU" },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-25T04:00:00Z"));
  mocks.session.mockResolvedValue({ role: "GUARDIAN", tenantId: "tenant-a" });
  mocks.family.mockResolvedValue({ parent: { id: "parent-a", name: "Ibu Rina" }, children });
  mocks.outstanding.mockResolvedValue({ count: 0, total: 0, nearestDue: null, items: [] });
  mocks.attendance.mockResolvedValue([]); mocks.sessions.mockResolvedValue([]);
  mocks.notes.mockResolvedValue([{ studentId: "child-a", body: "Berbagi mainan dengan teman.", createdAt: new Date("2026-09-24T04:00:00Z"), date: "2026-09-24" }]);
  mocks.development.mockResolvedValue({ hasActiveWeek: false, latestThisWeek: [] });
});
afterEach(() => vi.useRealTimers());

describe("parent home authoritative household summary", () => {
  it("scopes all summary queries to guardian-linked children and teacher-authored active notes", async () => {
    const html = renderToStaticMarkup(await ParentDashboard());
    expect(mocks.attendance).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ studentId: { in: ["child-a", "child-b"] }, student: { tenantId: "tenant-a" }, isVoided: false }) }));
    expect(mocks.notes).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "tenant-a", studentId: { in: ["child-a", "child-b"] }, status: "ACTIVE", authorRole: "TEACHER" } }));
    expect(mocks.outstanding).toHaveBeenCalledWith(["child-a", "child-b"], "tenant-a");
    expect(mocks.development.mock.calls).toEqual([["tenant-a", "child-a"], ["tenant-a", "child-b"]]);
    expect(html).toContain("Alya Nur Rahma");
    expect(html).toContain("Alya Nur Zahra");
    expect(html).toContain("Berbagi mainan dengan teman.");
    expect(html).toContain('/parent/student-journal?child=child-b&amp;view=notes');
  });

  it("distinguishes same-nickname siblings in each household bill action and destination", async () => {
    mocks.outstanding.mockResolvedValue({
      count: 2, total: 300_000, nearestDue: "2026-09-29",
      items: [
        { studentId: "child-a", dueDate: "2026-09-30", remaining: 100_000 },
        { studentId: "child-b", dueDate: "2026-09-29", remaining: 200_000 },
      ],
    });
    const html = renderToStaticMarkup(await ParentDashboard());
    const links = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
    for (const child of children) {
      const action = links.find(link => link.includes(`Tagihan ${child.studentName}`));
      expect(action).toBeDefined();
      expect(action).toContain(`href="/parent/invoices?child=${child.studentId}"`);
    }
    expect(html.indexOf("Tagihan Alya Nur Zahra")).toBeLessThan(html.indexOf("Tagihan Alya Nur Rahma"));
    expect(html).toContain("Tagihan 1 anak lainnya");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<div(?=[^>]*data-slot="collapsible-content")(?=[^>]*hidden="")[^>]*>/);
  });

  it("identifies same-nickname siblings in populated weekly development cards", async () => {
    mocks.development.mockResolvedValue({
      hasActiveWeek: true,
      latestThisWeek: [{
        date: "2026-09-25", indicatorContent: "Berbagi mainan", element: "RELIGIOUS_MORAL",
        source: "HOMEROOM", center: null, level: "BSH",
      }],
    });
    const html = renderToStaticMarkup(await ParentDashboard());
    const links = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
    for (const child of children) {
      const card = links.find(link => link.includes(`data-testid="home-perkembangan-card-${child.studentId}"`));
      expect(card).toBeDefined();
      expect(card).toContain(child.studentName);
      expect(card).toContain(`href="/parent/perkembangan/${child.studentId}"`);
      expect(card).toContain("Berbagi mainan");
      for (const sibling of children.filter(item => item.studentId !== child.studentId)) {
        expect(card).not.toContain(sibling.studentName);
      }
    }
  });

  it("never interprets absent attendance records as children being present", async () => {
    const html = renderToStaticMarkup(await ParentDashboard());
    expect(html).toContain("Alya Nur Rahma belum memiliki catatan kehadiran hari ini.");
    expect(html).toContain("Belum dicatat");
    expect(html).not.toContain("sudah hadir");
  });

  it.each([
    ["SICK", "Sakit"], ["PERMISSION", "Izin"], ["ABSENT", "Alpa"],
  ])("keeps the selected child's %s attendance action separate from a sibling's missing record", async (status, label) => {
    mocks.attendance.mockResolvedValue([{ studentId: "child-a", date: "2026-09-25", classSectionId:"class-a", sessionId:null, notes:null, classSection:{name:"TK A"}, status }]);
    const html = renderToStaticMarkup(await ParentDashboard());
    const links = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
    const action = links.find(link => link.includes("Periksa kehadiran Alya Nur Rahma"));
    expect(action).toBeDefined();
    expect(action).toContain('href="/parent/attendance?child=child-a"');
    expect(action).toContain(`${label} hari ini, sesuai catatan sekolah.`);
    expect(action).not.toContain("belum memiliki catatan");
    expect(action).not.toContain("Alya Nur Zahra");
    expect(html).toContain("Belum dicatat");
  });

  it("announces household attendance only when each child's saved record is present", async () => {
    mocks.attendance.mockResolvedValue(children.map(child => ({ studentId: child.studentId, date: "2026-09-25", classSectionId:"class-a", sessionId:null, notes:null, classSection:{name:"TK A"}, status: "PRESENT" })));
    const html = renderToStaticMarkup(await ParentDashboard());
    expect(html).toContain("2 anak");
    expect(html).toContain("sudah hadir.");
    expect(html).not.toContain("Belum dicatat");
  });

  it("propagates an unavailable invoice query to recovery instead of rendering a false paid summary", async () => {
    mocks.outstanding.mockRejectedValue(new Error("invoice read unavailable"));
    await expect(ParentDashboard()).rejects.toThrow("invoice read unavailable");
  });
});

it("keeps conflicting class attendance explicit in the home action and child card",async()=>{
 mocks.attendance.mockResolvedValue([
  {studentId:"child-a",classSectionId:"school",sessionId:null,date:"2026-09-25",status:"PRESENT",notes:null,classSection:{name:"TK A"}},
  {studentId:"child-a",classSectionId:"care",sessionId:null,date:"2026-09-25",status:"SICK",notes:null,classSection:{name:"Daycare"}},
 ]);
 const html=renderToStaticMarkup(await ParentDashboard());
 expect(html).toContain("Catatan berbeda");expect(html).not.toContain("sudah hadir.");
 const action=(html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g)??[]).find(link=>link.includes("Periksa kehadiran Alya Nur Rahma"));
 expect(action).toContain('href="/parent/attendance?child=child-a"');expect(action).toContain("Catatan berbeda antar kelas");
});

describe("parent home round-2 fixes", () => {
  it("R2-P-1: a child with past-due invoices gets a red 'N lewat tempo' and the danger tone, not a past 'jatuh tempo terdekat'", async () => {
    mocks.outstanding.mockResolvedValue({
      count: 3, total: 500_000, nearestDue: "2026-08-24",
      items: [
        { studentId: "child-a", dueDate: "2026-08-24", remaining: 100_000 },
        { studentId: "child-a", dueDate: "2026-09-10", remaining: 100_000 },
        { studentId: "child-a", dueDate: "2026-09-30", remaining: 100_000 },
        { studentId: "child-b", dueDate: "2026-09-30", remaining: 200_000 },
      ],
    });
    const html = renderToStaticMarkup(await ParentDashboard());
    const links = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
    const overdueRow = links.find(link => link.includes("Tagihan Alya Nur Rahma"))!;
    expect(overdueRow).toContain("3 tagihan");
    expect(overdueRow).toMatch(/text-status-absent-text[^>]*>2 lewat tempo</);
    expect(overdueRow).toContain("bg-status-absent-subtle");
    expect(overdueRow).not.toContain("jatuh tempo terdekat");
    // The sibling with only a future due date keeps the calm wording and tone.
    const calmRow = links.find(link => link.includes("Tagihan Alya Nur Zahra"))!;
    expect(calmRow).toContain("jatuh tempo terdekat");
    expect(calmRow).not.toContain("lewat tempo");
    expect(calmRow).not.toContain("bg-status-absent-subtle");
  });

  it("R2-P-1: a due date of today is not overdue yet (Jakarta calendar day)", async () => {
    mocks.outstanding.mockResolvedValue({
      count: 1, total: 100_000, nearestDue: "2026-09-25",
      items: [{ studentId: "child-a", dueDate: "2026-09-25", remaining: 100_000 }],
    });
    const html = renderToStaticMarkup(await ParentDashboard());
    expect(html).not.toContain("lewat tempo");
  });

  it("R2-P-8: when one child owes, the family header is dropped so the same total is not printed twice", async () => {
    mocks.outstanding.mockResolvedValue({
      count: 1, total: 750_000, nearestDue: "2026-09-30",
      items: [{ studentId: "child-a", dueDate: "2026-09-30", remaining: 750_000 }],
    });
    const html = renderToStaticMarkup(await ParentDashboard());
    expect(html).toContain("Tagihan Alya Nur Rahma");
    expect(html).not.toContain("Tagihan keluarga");
    expect(html.match(/750\.000/g)).toHaveLength(1);
  });

  it("R2-P-8: two children owing keep the family total above the per-child rows", async () => {
    mocks.outstanding.mockResolvedValue({
      count: 2, total: 300_000, nearestDue: "2026-09-29",
      items: [
        { studentId: "child-a", dueDate: "2026-09-30", remaining: 100_000 },
        { studentId: "child-b", dueDate: "2026-09-29", remaining: 200_000 },
      ],
    });
    expect(renderToStaticMarkup(await ParentDashboard())).toContain("Tagihan keluarga");
  });

  it("R2-P-8: spells the program out next to a bare class abbreviation", async () => {
    mocks.family.mockResolvedValue({
      parent: { id: "parent-a", name: "Ibu Rina" },
      children: [{ ...children[0], className: "KB", programName: "Kelompok Bermain" }],
    });
    const html = renderToStaticMarkup(await ParentDashboard());
    expect(html).toContain("KB · Kelompok Bermain");
  });

  it("R2-P-9: perkembangan chips are neutral below the top stage and the card explains they are stages, not grades", async () => {
    const entry = (level: string, indicatorContent: string) => ({
      date: "2026-09-25", indicatorContent, element: "RELIGIOUS_MORAL", source: "HOMEROOM", center: null, level,
    });
    mocks.development.mockResolvedValue({
      hasActiveWeek: true,
      latestThisWeek: [
        entry("CONSISTENT", "Mengucapkan salam"),
        entry("EMERGING", "Berbagi mainan"),
        entry("NEEDS_REINFORCEMENT", "Merapikan sepatu"),
      ],
    });
    const html = renderToStaticMarkup(await ParentDashboard());
    expect(html).toContain("Ini tahapan perkembangan, bukan nilai.");
    const chip = (label: string) => html.match(new RegExp(`<span class="[^"]*">${label}</span>`))![0];
    expect(chip("Mampu dan Konsisten")).toContain("bg-status-present-subtle");
    for (const label of ["Mampu Belum Konsisten", "Perlu Penguatan"]) {
      expect(chip(label)).toContain("bg-secondary");
      expect(chip(label)).not.toContain("status-late");
    }
    // Indicator text wraps to two lines instead of cutting off with an ellipsis.
    expect(html).toContain("line-clamp-2 text-xs text-foreground");
  });
});
