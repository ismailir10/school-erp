import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), family: vi.fn(), rows: vi.fn(), sessions: vi.fn(), notes: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`redirect:${url}`); } }));
vi.mock("@/lib/parent-helpers", () => ({
  getParentWithChildren: mocks.family,
  resolveSelectedChild: (children: Array<{ studentId: string }>, id: string) => children.find((c) => c.studentId === id) ?? children[0],
}));
vi.mock("@/lib/db", () => ({ prisma: { studentAttendance: { findMany: mocks.rows }, classSession: { findMany: mocks.sessions }, studentJournalNote: { findMany: mocks.notes } } }));
vi.mock("@/components/parent/child-selector-tabs", () => ({ ChildSelectorTabs: () => null }));
import Page from "../page";

const child = { studentId: "child", studentName: "Alya Putri", studentNickname: "Alya", className: "TK A", programName: "TK" };
const record = (date: string, status: string) => ({ studentId: "child", classSectionId: "school", sessionId: null, date, status, notes: null, classSection: { name: "TK A" } });

beforeEach(() => {
  vi.resetAllMocks();
  // Wednesday 2026-09-23, 11:00 WIB: Mon-Tue are past, Wed is today, Thu-Fri are future.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T04:00:00Z"));
  mocks.session.mockResolvedValue({ role: "GUARDIAN", tenantId: "tenant" });
  mocks.family.mockResolvedValue({ parent: { id: "parent" }, children: [child] });
  mocks.rows.mockResolvedValue([record("2026-09-21", "PRESENT"), record("2026-09-22", "SICK")]);
  mocks.sessions.mockResolvedValue([]);
  mocks.notes.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("parent attendance week grid", () => {
  it("labels only the data row 'Status' and gives every cell text for screen readers", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ child: "child", week: "2026-09-21" }) }));
    const table = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    expect(table.match(/>Status</g)).toHaveLength(1);
    expect(table).toContain('<span class="sr-only">Hari</span>');
    expect(table).toContain('<th scope="row"');
    expect(table).toContain('<span class="sr-only">Hadir</span>');
    expect(table).toContain('<span class="sr-only">Sakit</span>');
  });

  it("tells an unrecorded day (today or past) apart from a day that has not happened yet", async () => {
    mocks.rows.mockResolvedValue([record("2026-09-21", "PRESENT")]);
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ child: "child", week: "2026-09-21" }) }));
    const table = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    // Tue (past) + Wed (today) have no record; Thu + Fri are in the future.
    expect(table.match(/Belum dicatat/g)).toHaveLength(2);
    expect(table.match(/Belum berlangsung/g)).toHaveLength(2);
  });
});
