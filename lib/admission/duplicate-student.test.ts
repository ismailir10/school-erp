import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { student: { findMany } } }));

import { findDuplicateStudents } from "./duplicate-student";

const probe = (o: Partial<Parameters<typeof findDuplicateStudents>[1]> = {}) => ({
  childName: "Aisyah Putri",
  dateOfBirth: "2021-03-15",
  phones: [] as string[],
  emails: [] as string[],
  ...o,
});

const student = (o: Record<string, unknown> = {}) => ({
  id: "stu-1",
  name: "Aisyah Putri",
  dateOfBirth: null,
  guardians: [] as Array<{ parent: Record<string, string | null> }>,
  ...o,
});
const guardian = (o: Record<string, string | null> = {}) => ({
  parent: { name: "Bu Lama", phone: null, whatsapp: null, email: null, ...o },
});

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

describe("findDuplicateStudents", () => {
  it("looks only inside the tenant, by case-insensitive name, newest first", async () => {
    await findDuplicateStudents("t-1", probe({ childName: "  Aisyah Putri " }));
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ tenantId: "t-1", name: { equals: "Aisyah Putri", mode: "insensitive" } });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("does not query for a blank name", async () => {
    expect(await findDuplicateStudents("t-1", probe({ childName: "   " }))).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("matches the same name and the same date of birth, ignoring case and inner spaces", async () => {
    findMany.mockResolvedValue([student({ name: " aisyah   PUTRI", dateOfBirth: "2021-03-15" })]);
    expect(await findDuplicateStudents("t-1", probe())).toHaveLength(1);
  });

  it("does not match the same name with a different birth date and no shared guardian", async () => {
    findMany.mockResolvedValue([student({ dateOfBirth: "2019-01-01", guardians: [guardian({ phone: "0877" })] })]);
    expect(await findDuplicateStudents("t-1", probe({ phones: ["0812"] }))).toEqual([]);
  });

  it("does not match a different name that merely came back from the query", async () => {
    findMany.mockResolvedValue([student({ name: "Aisyah Putra", dateOfBirth: "2021-03-15" })]);
    expect(await findDuplicateStudents("t-1", probe())).toEqual([]);
  });

  it("matches through a guardian phone or WhatsApp in any written form", async () => {
    findMany.mockResolvedValue([student({ guardians: [guardian({ whatsapp: "+62 812-3456-7890" })] })]);
    expect(await findDuplicateStudents("t-1", probe({ dateOfBirth: null, phones: ["081234567890"] }))).toHaveLength(1);
  });

  it("matches through a guardian email regardless of case", async () => {
    findMany.mockResolvedValue([student({ guardians: [guardian({ email: "Ahmad@Test.com" })] })]);
    expect(await findDuplicateStudents("t-1", probe({ dateOfBirth: null, emails: ["ahmad@test.com"] }))).toHaveLength(1);
  });

  it("caps the result at five", async () => {
    findMany.mockResolvedValue(Array.from({ length: 9 }, (_, i) => student({ id: `s${i}`, dateOfBirth: "2021-03-15" })));
    expect(await findDuplicateStudents("t-1", probe())).toHaveLength(5);
  });

  it("returns only id, name, birth date and guardian names", async () => {
    findMany.mockResolvedValue([
      student({
        dateOfBirth: "2021-03-15",
        nik: "3201",
        guardians: [guardian({ phone: "0899", email: "secret@lama.com", whatsapp: "0898" })],
      }),
    ]);
    const [c] = await findDuplicateStudents("t-1", probe());
    expect(c).toEqual({ id: "stu-1", name: "Aisyah Putri", dateOfBirth: "2021-03-15", guardianNames: ["Bu Lama"] });
    expect(JSON.stringify(c)).not.toMatch(/0899|0898|secret@|3201/);
  });
});
