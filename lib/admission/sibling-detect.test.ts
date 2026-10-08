import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  detectSibling,
  normalisePhone,
  type ParentTable,
} from "./sibling-detect";

type ParentRow = {
  id: string;
  tenantId: string;
  status: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  createdAt: Date;
};

function makeMockPrisma(parents: ParentRow[]): ParentTable {
  const mock = {
    parent: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            tenantId: string;
            status: string;
            email?: string;
            phone?: string;
          };
        }) => {
          const hit = parents.find(
            (p) =>
              p.tenantId === where.tenantId &&
              p.status === where.status &&
              (where.email === undefined || p.email === where.email) &&
              (where.phone === undefined || p.phone === where.phone)
          );
          return hit ? { id: hit.id } : null;
        }
      ),
      findMany: vi.fn(
        async ({
          where,
          orderBy,
        }: {
          where: {
            tenantId: string;
            status: string;
          };
          orderBy?: { createdAt: "asc" | "desc" };
        }) => {
          let rows = parents.filter(
            (p) =>
              p.tenantId === where.tenantId &&
              p.status === where.status &&
              (p.phone !== null || p.whatsapp !== null)
          );
          if (orderBy?.createdAt === "asc") {
            rows = [...rows].sort(
              (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
            );
          }
          return rows.map((p) => ({
            id: p.id,
            phone: p.phone,
            whatsapp: p.whatsapp,
            createdAt: p.createdAt,
          }));
        }
      ),
    },
  };
  return mock as unknown as ParentTable;
}

const T1 = "tenant-1";
const T2 = "tenant-2";

function parent(
  id: string,
  overrides: Partial<ParentRow> = {}
): ParentRow {
  return {
    id,
    tenantId: T1,
    status: "ACTIVE",
    email: null,
    phone: null,
    whatsapp: null,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("normalisePhone", () => {
  it("strips spaces, dashes, parens, and the + sign", () => {
    expect(normalisePhone("+62 812-3456-7890")).toBe("081234567890");
    expect(normalisePhone("(0812) 3456 7890")).toBe("081234567890");
  });

  it("canonicalises 62-prefix to 0-prefix when length is 11+", () => {
    expect(normalisePhone("+6281234567890")).toBe("081234567890");
    expect(normalisePhone("6281234567890")).toBe("081234567890");
  });

  it("leaves bare 08xxx unchanged", () => {
    expect(normalisePhone("081234567890")).toBe("081234567890");
  });

  it("prepends 0 for bare 8xx (no prefix)", () => {
    expect(normalisePhone("81234567890")).toBe("081234567890");
    expect(normalisePhone("812 3456 7890")).toBe("081234567890");
  });
});

describe("detectSibling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("(a) returns null on a clean DB with no Parent rows", async () => {
    const prisma = makeMockPrisma([]);
    const result = await detectSibling(
      { tenantId: T1, parentEmail: "x@y.com", parentPhone: "081234567890" },
      prisma
    );
    expect(result).toBeNull();
  });

  it("(b) email-only match returns parentId + matchReason 'email'", async () => {
    const prisma = makeMockPrisma([
      parent("p1", { email: "ibu@example.com" }),
    ]);
    const result = await detectSibling(
      { tenantId: T1, parentEmail: "ibu@example.com" },
      prisma
    );
    expect(result).toEqual({ parentId: "p1", matchReason: "email" });
  });

  it("(c) phone-only match returns parentId + matchReason 'phone'", async () => {
    const prisma = makeMockPrisma([
      parent("p2", { phone: "081234567890" }),
    ]);
    const result = await detectSibling(
      { tenantId: T1, parentPhone: "081234567890" },
      prisma
    );
    expect(result).toEqual({ parentId: "p2", matchReason: "phone" });
  });

  it("(d) email + phone both match same parent → email reason wins", async () => {
    const prisma = makeMockPrisma([
      parent("p3", { email: "shared@example.com", phone: "081234567890" }),
    ]);
    const result = await detectSibling(
      {
        tenantId: T1,
        parentEmail: "shared@example.com",
        parentPhone: "081234567890",
      },
      prisma
    );
    expect(result).toEqual({ parentId: "p3", matchReason: "email" });
  });

  it("(e) email matches Parent A, phone matches Parent B → returns A (email > phone)", async () => {
    const prisma = makeMockPrisma([
      parent("pA", { email: "a@example.com" }),
      parent("pB", { phone: "081234567890" }),
    ]);
    const result = await detectSibling(
      {
        tenantId: T1,
        parentEmail: "a@example.com",
        parentPhone: "081234567890",
      },
      prisma
    );
    expect(result).toEqual({ parentId: "pA", matchReason: "email" });
  });

  it("(f) tenant scoping — Parent in tenant X is NOT returned when query runs against tenant Y", async () => {
    const prisma = makeMockPrisma([
      parent("p4", { tenantId: T1, email: "ibu@example.com" }),
    ]);
    const result = await detectSibling(
      { tenantId: T2, parentEmail: "ibu@example.com" },
      prisma
    );
    expect(result).toBeNull();
  });

  it("(g) phone normalisation — +62 form matches stored 0-prefix form", async () => {
    const prisma = makeMockPrisma([
      parent("p5", { phone: "081234567890" }),
    ]);
    const result = await detectSibling(
      { tenantId: T1, parentPhone: "+62 812-3456-7890" },
      prisma
    );
    expect(result).toEqual({ parentId: "p5", matchReason: "phone" });
  });

  it("(h) email normalisation — Foo@Bar.com matches stored foo@bar.com", async () => {
    const prisma = makeMockPrisma([
      parent("p6", { email: "foo@bar.com" }),
    ]);
    const result = await detectSibling(
      { tenantId: T1, parentEmail: "Foo@Bar.com" },
      prisma
    );
    expect(result).toEqual({ parentId: "p6", matchReason: "email" });
  });

  it("(i) INACTIVE parent does NOT match", async () => {
    const prisma = makeMockPrisma([
      parent("p7", { status: "INACTIVE", email: "ibu@example.com" }),
    ]);
    const result = await detectSibling(
      { tenantId: T1, parentEmail: "ibu@example.com" },
      prisma
    );
    expect(result).toBeNull();
  });

  it("(j) phone tie-break — two parents share a phone; returns the older one (createdAt ASC)", async () => {
    const prisma = makeMockPrisma([
      parent("pOlder", {
        phone: "081234567890",
        createdAt: new Date("2026-01-01"),
      }),
      parent("pNewer", {
        phone: "081234567890",
        createdAt: new Date("2026-02-01"),
      }),
    ]);
    const result = await detectSibling(
      { tenantId: T1, parentPhone: "081234567890" },
      prisma
    );
    expect(result).toEqual({ parentId: "pOlder", matchReason: "phone" });
  });

  it("(k) applicant WhatsApp matches a Parent's phone (R2-ADMIN-1)", async () => {
    const prisma = makeMockPrisma([parent("p8", { phone: "08215678901" })]);
    const result = await detectSibling(
      { tenantId: T1, parentWhatsapp: "+62 821-5678-901" },
      prisma
    );
    expect(result).toEqual({ parentId: "p8", matchReason: "phone" });
  });

  it("(l) applicant phone matches a Parent's WhatsApp only", async () => {
    const prisma = makeMockPrisma([parent("p9", { whatsapp: "08215678901" })]);
    const result = await detectSibling(
      { tenantId: T1, parentPhone: "08215678901" },
      prisma
    );
    expect(result).toEqual({ parentId: "p9", matchReason: "phone" });
  });

  it("(m) WhatsApp-only applicant and WhatsApp-only Parent match across formats", async () => {
    const prisma = makeMockPrisma([parent("p10", { whatsapp: "8215678901" })]);
    const result = await detectSibling(
      { tenantId: T1, parentPhone: null, parentWhatsapp: "08215678901" },
      prisma
    );
    expect(result).toEqual({ parentId: "p10", matchReason: "phone" });
  });

  it("(n) a different WhatsApp number does not match", async () => {
    const prisma = makeMockPrisma([parent("p11", { whatsapp: "08215678901" })]);
    const result = await detectSibling(
      { tenantId: T1, parentWhatsapp: "08999999999" },
      prisma
    );
    expect(result).toBeNull();
  });
});
