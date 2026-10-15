import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { appFindUnique, appUpdate, getSession, isAdminRole, programFindMany, queryRaw, auditCreate, feeFindFirst, feeFindUnique, feeUpdate, executeRaw, mergeJsonKey } =
  vi.hoisted(() => ({
    mergeJsonKey: vi.fn(),
    appFindUnique: vi.fn(),
    appUpdate: vi.fn(),
    getSession: vi.fn(),
    isAdminRole: vi.fn(),
    programFindMany: vi.fn(),
    queryRaw: vi.fn(),
    executeRaw: vi.fn(),
    auditCreate: vi.fn(),
    feeFindFirst: vi.fn(),
    feeFindUnique: vi.fn(),
    feeUpdate: vi.fn(),
  }));

vi.mock("@/lib/db", () => {
  const client = {
    enrollmentApplication: { findUnique: appFindUnique, update: appUpdate },
    program: { findMany: programFindMany },
    enrollmentFee: { findFirst: feeFindFirst, findUnique: feeFindUnique, update: feeUpdate },
    auditLog: { create: auditCreate },
    webhookEvent: { findMany: vi.fn() },
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    $transaction: async (fn: (tx: unknown) => unknown) => fn(client),
  };
  return { prisma: client };
});
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));
vi.mock("@/lib/enrollment/json-merge", () => ({ mergeJsonKey }));

import { PATCH } from "../route";
import { AUTO_WAIVE_NOTE } from "@/lib/enrollment/fee-snapshot";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const ctx = { params: Promise.resolve({ id: "ea-1" }) };
const patch = (body: unknown) =>
  PATCH(
    new NextRequest("http://localhost/api/enrollments/ea-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx,
  );

const PROGRAMS = [
  { id: "p-kb", code: "KB", name: "KB", enrollmentFee: 500_000 },
  { id: "p-kb2", code: "KB2", name: "KB 2", enrollmentFee: 500_000 },
  { id: "p-tk", code: "TK", name: "TK", enrollmentFee: 800_000 },
  { id: "p-dc", code: "DCARE", name: "Day Care", enrollmentFee: 200_000 },
  { id: "p-free", code: "FREE", name: "Gratis", enrollmentFee: 0 },
];

function appRow(over: Record<string, unknown> = {}) {
  return {
    id: "ea-1",
    tenantId: "t-1",
    status: "INVITED",
    studentId: null,
    programId: "p-kb",
    dcareAddon: false,
    studentData: { childName: "Aisyah", birthPlace: "Bekasi", address: { perumahan: "Taman Aster", kodePos: "17530" } },
    ayahData: { name: "Bapak Ahmad", phone: "081234567890", email: "ahmad@example.com" },
    ibuData: { name: "Ibu Fatimah" },
    consentData: null,
    ...over,
  };
}

function feeRow(over: Record<string, unknown> = {}) {
  return {
    status: "UNPAID",
    method: null,
    baseAmount: 500_000,
    discountPercent: 10,
    discountReason: "Saudara kandung",
    amount: 450_000,
    paidAt: null,
    note: null,
    linkError: null,
    lastCheckedAt: null,
    paymentUrl: "https://pay.example/old",
    sessionExpiresAt: new Date(Date.now() + 3_600_000),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view", "admissions.edit"] });
  isAdminRole.mockReturnValue(true);
  queryRaw.mockResolvedValue([{ id: "ea-1" }]);
  appFindUnique.mockResolvedValue(appRow());
  appUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "ea-1", status: (data.status as string) ?? "INVITED" }));
  programFindMany.mockResolvedValue(PROGRAMS);
  feeFindFirst.mockResolvedValue(null);
  mergeJsonKey.mockResolvedValue(true);
});

const written = () => appUpdate.mock.calls[0][0].data as Record<string, unknown>;
const nothingWritten = () => {
  expect(appUpdate).not.toHaveBeenCalled();
  expect(auditCreate).not.toHaveBeenCalled();
  expect(feeUpdate).not.toHaveBeenCalled();
  expect(queryRaw).not.toHaveBeenCalled();
};

describe("PATCH /api/enrollments/[id] — validated staff edit", () => {
  it("saves a half-filled partial and merges it over what is stored", async () => {
    const res = await patch({ ayahData: { phone: "0812 3456 7890" }, studentData: { birthPlace: "Jakarta" } });
    expect(res.status).toBe(200);
    expect(written().ayahData).toEqual({ name: "Bapak Ahmad", phone: "0812 3456 7890", email: "ahmad@example.com" });
    expect(written().studentData).toEqual({
      childName: "Aisyah",
      birthPlace: "Jakarta",
      address: { perumahan: "Taman Aster", kodePos: "17530" },
    });
    expect(written()).not.toHaveProperty("ibuData");
  });

  it.each([
    ["phone", { ayahData: { phone: "abc" } }, "ayahData.phone"],
    ["office phone", { ibuData: { employerPhone: "12" } }, "ibuData.employerPhone"],
    ["email", { ibuData: { email: "not-an-email" } }, "ibuData.email"],
    ["date", { studentData: { dateOfBirth: "15/03/2021" } }, "studentData.dateOfBirth"],
    ["parent date", { ayahData: { dateOfBirth: "2021-3-1" } }, "ayahData.dateOfBirth"],
    ["agama", { studentData: { agama: "MARS" } }, "studentData.agama"],
    ["kewarganegaraan", { studentData: { kewarganegaraan: "XX" } }, "studentData.kewarganegaraan"],
    ["gender", { studentData: { childGender: "X" } }, "studentData.childGender"],
    ["education", { ayahData: { education: "PHD" } }, "ayahData.education"],
    ["income", { ibuData: { income: "kaya" } }, "ibuData.income"],
    ["name length", { studentData: { childName: "a".repeat(81) } }, "studentData.childName"],
    ["weight ceiling", { studentData: { weightKg: 9999 } }, "studentData.weightKg"],
    ["address length", { studentData: { address: { kodePos: "1".repeat(11) } } }, "studentData.address.kodePos"],
    ["region length", { ayahData: { address: { kelurahan: "k".repeat(81) } } }, "ayahData.address.kelurahan"],
    ["province length", { ibuData: { address: { provinsi: "p".repeat(61) } } }, "ibuData.address.provinsi"],
    ["onlyParent", { consentData: { onlyParent: "wali" } }, "consentData.onlyParent"],
    ["dcare type", { dcareAddon: "yes" }, "dcareAddon"],
  ])("400 on a malformed %s, with the field path, and nothing is written", async (_label, body, field) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validasi gagal");
    expect(json.errors.map((e: { field: string }) => e.field)).toContain(field);
    expect(json.errors.every((e: { message: string }) => e.message.length > 0)).toBe(true);
    nothingWritten();
  });

  it("reports every bad field at once and writes none of the good ones", async () => {
    const res = await patch({ ayahData: { phone: "abc", name: "Valid Name" }, ibuData: { email: "x" } });
    expect(res.status).toBe(400);
    const fields = (await res.json()).errors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(expect.arrayContaining(["ayahData.phone", "ibuData.email"]));
    nothingWritten();
  });

  it("a blank string or null clears the field; nothing else on the blob moves", async () => {
    const res = await patch({ ayahData: { phone: "  ", email: null }, studentData: { address: { kodePos: "" } } });
    expect(res.status).toBe(200);
    expect(written().ayahData).toEqual({ name: "Bapak Ahmad" });
    expect(written().studentData).toEqual({ childName: "Aisyah", birthPlace: "Bekasi", address: { perumahan: "Taman Aster" } });
  });

  it("saves the region keys next to the stored address and clears one by name", async () => {
    const res = await patch({
      studentData: { address: { kelurahan: "Citarum", kotaKab: "Kota Bandung", provinsi: "Jawa Barat", kodePos: "" } },
    });
    expect(res.status).toBe(200);
    expect(written().studentData).toEqual({
      childName: "Aisyah",
      birthPlace: "Bekasi",
      address: { perumahan: "Taman Aster", kelurahan: "Citarum", kotaKab: "Kota Bandung", provinsi: "Jawa Barat" },
    });
  });

  it("drops an unknown address key instead of storing it", async () => {
    const res = await patch({ studentData: { address: { kelurahan: "Citarum", negara: "ID" } } });
    expect(res.status).toBe(200);
    expect(written().studentData).toEqual({
      childName: "Aisyah",
      birthPlace: "Bekasi",
      address: { perumahan: "Taman Aster", kodePos: "17530", kelurahan: "Citarum" },
    });
  });

  it("clearing the last address field removes the empty address object", async () => {
    appFindUnique.mockResolvedValue(appRow({ studentData: { childName: "Aisyah", address: { kodePos: "17530" } } }));
    await patch({ studentData: { address: { kodePos: "" } } });
    expect(written().studentData).toEqual({ childName: "Aisyah" });
  });

  it("mirrors a changed childName onto the column; a cleared name empties it", async () => {
    await patch({ studentData: { childName: "  Budi Santoso  " } });
    expect(written().childName).toBe("Budi Santoso");
    expect((written().studentData as { childName: string }).childName).toBe("Budi Santoso");

    appUpdate.mockClear();
    await patch({ studentData: { childName: "" } });
    expect(written().childName).toBe("");
    expect(written().studentData).not.toHaveProperty("childName");
  });

  it("does not touch the childName column when the name is not in the patch", async () => {
    await patch({ studentData: { birthPlace: "Jakarta" } });
    expect(written()).not.toHaveProperty("childName");
  });

  it("drops keys the strict schema does not know, inside the blobs and at the top level", async () => {
    const res = await patch({
      studentData: { birthPlace: "Jakarta", hacked: "x", accessToken: "SECRET", studentId: "s-1" },
      ayahData: { name: "Pak Baru", signatureToken: "FORGED", role: "ADMIN" },
      tenantId: "other",
      status: undefined,
      studentId: "s-evil",
    });
    expect(res.status).toBe(200);
    const text = JSON.stringify(written());
    expect(text).not.toMatch(/hacked|SECRET|FORGED|ADMIN|s-evil|other/);
    expect(written()).not.toHaveProperty("tenantId");
    expect(written()).not.toHaveProperty("studentId");
    expect((written().ayahData as { name: string }).name).toBe("Pak Baru");
  });

  it("a smuggled blank unknown key cannot delete stored data", async () => {
    appFindUnique.mockResolvedValue(appRow({ ayahData: { name: "A", signatureToken: "kept" } }));
    await patch({ ayahData: { signatureToken: "", name: "B" } });
    expect(written().ayahData).toEqual({ name: "B", signatureToken: "kept" });
  });

  it("writes an audit row with field NAMES only, in the same transaction, and no values", async () => {
    await patch({ ayahData: { phone: "081299998888" }, studentData: { birthPlace: "Surabaya" } });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const row = auditCreate.mock.calls[0][0].data;
    expect(row).toMatchObject({ tenantId: "t-1", actorId: "u-1", entity: "EnrollmentApplication", entityId: "ea-1", action: "update" });
    expect(row.after.fields.sort()).toEqual(["ayahData.phone", "studentData.birthPlace"]);
    expect(JSON.stringify(row)).not.toMatch(/081299998888|Surabaya/);
  });

  it("no audit row and no write when the values are already what is stored", async () => {
    const res = await patch({ ayahData: { phone: "081234567890" } });
    expect(res.status).toBe(200);
    expect(appUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it.each(["INVITED", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED"])("allows editing at %s before conversion", async (status) => {
    appFindUnique.mockResolvedValue(appRow({ status }));
    expect((await patch({ ayahData: { phone: "081200000000" } })).status).toBe(200);
    expect(appUpdate).toHaveBeenCalled();
  });

  it("is frozen after conversion: 409 for any form field, nothing written", async () => {
    appFindUnique.mockResolvedValue(appRow({ status: "ACCEPTED", studentId: "s-1" }));
    for (const body of [{ studentData: { childName: "X" } }, { programId: "p-tk" }, { dcareAddon: true }, { consentData: { onlyParent: "ayah" } }]) {
      expect((await patch(body)).status).toBe(409);
    }
    nothingWritten();
  });

  it("409 when the application was converted between the first read and the lock", async () => {
    appFindUnique.mockResolvedValueOnce(appRow()).mockResolvedValueOnce(appRow({ studentId: "s-1" }));
    expect((await patch({ ayahData: { phone: "081200000000" } })).status).toBe(409);
    expect(appUpdate).not.toHaveBeenCalled();
  });

  it("404 across tenants, with nothing written", async () => {
    appFindUnique.mockResolvedValue(appRow({ tenantId: "other" }));
    expect((await patch({ ayahData: { phone: "081200000000" } })).status).toBe(404);
    nothingWritten();
  });

  it("404 when the locked, tenant-scoped read finds no row", async () => {
    queryRaw.mockResolvedValue([]);
    expect((await patch({ ayahData: { phone: "081200000000" } })).status).toBe(404);
    expect(appUpdate).not.toHaveBeenCalled();
  });

  it("403 for a viewer without admissions.edit, before anything is read", async () => {
    getSession.mockResolvedValue({ id: "u-2", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    expect((await patch({ ayahData: { phone: "081200000000" } })).status).toBe(403);
    expect(appFindUnique).not.toHaveBeenCalled();
    nothingWritten();
  });

  it("scopes the write to the session tenant", async () => {
    await patch({ ayahData: { phone: "081200000000" } });
    expect(appUpdate.mock.calls[0][0].where).toEqual({ id: "ea-1", tenantId: "t-1" });
  });

  it("audits a status transition by name", async () => {
    appFindUnique.mockResolvedValue(appRow({ status: "SUBMITTED" }));
    await patch({ status: "ACCEPTED" });
    expect(auditCreate.mock.calls[0][0].data.after.fields).toEqual(["status"]);
  });

  it("audits who fills the form (an enum) with old and new value when onlyParent changes", async () => {
    appFindUnique.mockResolvedValue(appRow({ consentData: { onlyParent: "ayah", ayah: { name: "A" } } }));
    await patch({ consentData: { onlyParent: "ibu" } });
    const after = auditCreate.mock.calls[0][0].data.after;
    expect(after.fields).toEqual(["consentData.onlyParent"]);
    expect(after.onlyParent).toEqual({ from: "ayah", to: "ibu" });
  });

  it("jsonb key reordering of a stored consent is not reported as a change", async () => {
    appFindUnique.mockResolvedValue(appRow({ consentData: { ibu: { signedAt: "t", name: "I" }, ayah: { name: "A", signatureToken: "x" } } }));
    await patch({ consentData: { onlyParent: "" } });
    expect(appUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("documentsReceived is passed the tenant and audited by name", async () => {
    await patch({ documentsReceived: { kk: true } });
    expect(mergeJsonKey.mock.calls[0][4]).toEqual({ requireInvited: false, tenantId: "t-1" });
    expect(auditCreate.mock.calls[0][0].data.after).toEqual({ fields: ["documentsReceived"], documents: ["kk"] });
  });

  it("rate-limits per staff member", async () => {
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await patch({ ayahData: { phone: "081234567890" } })).status;
    expect(last).toBe(429);
  });
});

const FINANCE = { id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view", "admissions.edit", "fees.edit"] };

describe("PATCH /api/enrollments/[id] — repricing", () => {
  beforeEach(() => getSession.mockResolvedValue(FINANCE));

  function withFee(fee: Record<string, unknown> | null) {
    if (!fee) {
      feeFindFirst.mockResolvedValue(null);
      return;
    }
    // Honour a `status` filter like the database would (the permission guard asks for UNPAID only).
    feeFindFirst.mockImplementation(async ({ where }: { where: { status?: string } }) =>
      where.status && where.status !== fee.status ? null : { id: "fee-1" },
    );
    feeFindUnique.mockResolvedValue(fee);
    feeUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...fee, ...data }));
  }
  const feeData = () => feeUpdate.mock.calls[0][0].data as Record<string, unknown>;

  it("reprices an UNPAID fee for a new program: keeps the discount, drops the stale link, keeps the gateway session", async () => {
    withFee(feeRow());
    const res = await patch({ programId: "p-tk" });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(feeData()).toMatchObject({ baseAmount: 800_000, amount: 720_000, paymentUrl: null, sessionExpiresAt: null, linkError: null });
    // 10% staff discount survives; the gateway session id is never cleared.
    expect(feeData()).not.toHaveProperty("discountPercent");
    expect(feeData()).not.toHaveProperty("discountReason");
    expect(feeData()).not.toHaveProperty("gatewaySessionId");
    expect(feeData()).not.toHaveProperty("status");

    expect(json.feeNote).toBe("repriced");
    expect(json.fee).toMatchObject({ status: "UNPAID", baseAmount: 800_000, amount: 720_000, discountPercent: 10, discountReason: "Saudara kandung", linkActive: false });
    expect(JSON.stringify(json)).not.toMatch(/pay\.example/);
    expect(written().programId).toBe("p-tk");
  });

  it("takes the per-fee advisory lock before reading or writing the fee", async () => {
    withFee(feeRow());
    await patch({ programId: "p-tk" });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(feeFindUnique.mock.invocationCallOrder[0]);
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(feeUpdate.mock.invocationCallOrder[0]);
  });

  it("adds the Day Care fee when the add-on is ticked", async () => {
    withFee(feeRow());
    const json = await (await patch({ dcareAddon: true })).json();
    expect(feeData()).toMatchObject({ baseAmount: 700_000, amount: 630_000 });
    expect(json.feeNote).toBe("repriced");
    expect(written().dcareAddon).toBe(true);
  });

  it("audits the reprice on the fee (no PII), next to the application audit", async () => {
    withFee(feeRow());
    await patch({ programId: "p-tk" });
    const rows = auditCreate.mock.calls.map((c) => c[0].data);
    expect(rows.map((r) => `${r.entity}:${r.action}`).sort()).toEqual(["EnrollmentApplication:update", "EnrollmentFee:fee.reprice"]);
    const fee = rows.find((r) => r.entity === "EnrollmentFee");
    expect(fee.before).toMatchObject({ amount: 450_000 });
    expect(fee.after).toMatchObject({ amount: 720_000 });
  });

  it("keeps a working payment link when the new price is the same amount", async () => {
    withFee(feeRow());
    const json = await (await patch({ programId: "p-kb2" })).json();
    expect(json.feeNote).toBe("repriced");
    expect(feeData()).not.toHaveProperty("paymentUrl");
    expect(json.fee.linkActive).toBe(true);
  });

  it("closes an UNPAID fee as WAIVED when the new program is free (nothing to collect)", async () => {
    withFee(feeRow());
    const json = await (await patch({ programId: "p-free" })).json();
    expect(feeData()).toMatchObject({
      baseAmount: 0,
      amount: 0,
      status: "WAIVED",
      method: "WAIVED",
      markedBy: "u-1",
      paymentUrl: null,
      sessionExpiresAt: null,
    });
    expect(json.feeNote).toBe("repriced");
    expect(json.fee.status).toBe("WAIVED");
  });

  it("closes the fee as WAIVED when the kept discount is 100%", async () => {
    withFee(feeRow({ discountPercent: 100, amount: 0 }));
    const json = await (await patch({ programId: "p-tk" })).json();
    expect(feeData()).toMatchObject({ baseAmount: 800_000, amount: 0, status: "WAIVED" });
    expect(json.fee.status).toBe("WAIVED");
  });

  it("leaves a PAID fee untouched and says so", async () => {
    withFee(feeRow({ status: "PAID", method: "CASH", paidAt: new Date() }));
    const json = await (await patch({ programId: "p-tk", dcareAddon: true })).json();
    expect(feeUpdate).not.toHaveBeenCalled();
    expect(json.feeNote).toBe("unchanged_paid");
    expect(json.fee).toMatchObject({ status: "PAID", amount: 450_000 });
    expect(written()).toMatchObject({ programId: "p-tk", dcareAddon: true }); // the choice itself is still saved
  });

  it("leaves a WAIVED fee untouched and says so", async () => {
    withFee(feeRow({ status: "WAIVED", method: "WAIVED", amount: 0 }));
    const json = await (await patch({ programId: "p-tk" })).json();
    expect(feeUpdate).not.toHaveBeenCalled();
    expect(json.feeNote).toBe("unchanged_waived");
  });

  it("reports 'none' when the application has no fee row, and creates none", async () => {
    withFee(null);
    const json = await (await patch({ programId: "p-tk" })).json();
    expect(json.feeNote).toBe("none");
    expect(json.fee).toBeNull();
    expect(feeUpdate).not.toHaveBeenCalled();
  });

  it("does not reprice when the program and Day Care are sent but unchanged (a re-save must not move a snapshot)", async () => {
    withFee(feeRow());
    const json = await (await patch({ programId: "p-kb", dcareAddon: false, ayahData: { phone: "081200000000" } })).json();
    expect(feeUpdate).not.toHaveBeenCalled();
    expect(feeFindFirst).not.toHaveBeenCalled();
    expect(json).not.toHaveProperty("feeNote");
  });

  it("re-sending an unchanged RETIRED program does not 400, so a typo elsewhere can still be fixed", async () => {
    appFindUnique.mockResolvedValue(appRow({ programId: "p-retired" }));
    const res = await patch({ programId: "p-retired", ayahData: { phone: "081200000000" } });
    expect(res.status).toBe(200);
    expect(written().ayahData).toMatchObject({ phone: "081200000000" });
  });

  it("a retired program never waives a fee: the fee is left alone and the note says why", async () => {
    // programId is moved off the stored one onto a program that is active for the
    // application check but retired for pricing is impossible, so drive reprice
    // through a dcare change on an application that holds a retired program.
    appFindUnique.mockResolvedValue(appRow({ programId: "p-retired" }));
    withFee(feeRow());
    const json = await (await patch({ dcareAddon: true })).json();
    expect(feeUpdate).not.toHaveBeenCalled();
    expect(json.feeNote).toBe("unchanged_inactive_program");
    expect(json.fee).toMatchObject({ status: "UNPAID", amount: 450_000 });
    expect(written()).toMatchObject({ dcareAddon: true });
  });

  it("reopens a fee that was auto-waived for a free program when the new price is above 0", async () => {
    appFindUnique.mockResolvedValue(appRow({ programId: "p-free" }));
    withFee(feeRow({ status: "WAIVED", method: "WAIVED", baseAmount: 0, amount: 0, discountPercent: 0, discountReason: null, note: AUTO_WAIVE_NOTE, paymentUrl: null, sessionExpiresAt: null }));
    const json = await (await patch({ programId: "p-tk" })).json();
    expect(feeData()).toMatchObject({
      status: "UNPAID", method: null, markedBy: null, paidAt: null, note: null,
      baseAmount: 800_000, amount: 800_000, paymentUrl: null, sessionExpiresAt: null,
    });
    expect(json.feeNote).toBe("repriced");
    expect(json.fee).toMatchObject({ status: "UNPAID", amount: 800_000 });
    const fee = auditCreate.mock.calls.map((c) => c[0].data).find((r) => r.entity === "EnrollmentFee");
    expect(fee.after).toMatchObject({ reopened: true, status: "UNPAID" });
  });

  it("an auto-waived fee stays waived when the new program is free too", async () => {
    appFindUnique.mockResolvedValue(appRow({ programId: "p-tk" }));
    withFee(feeRow({ status: "WAIVED", method: "WAIVED", baseAmount: 0, amount: 0, note: AUTO_WAIVE_NOTE }));
    const json = await (await patch({ programId: "p-free" })).json();
    expect(feeUpdate).not.toHaveBeenCalled();
    expect(json.feeNote).toBe("unchanged_waived");
  });

  it("never reopens a deliberate staff waive (no auto-waive note)", async () => {
    withFee(feeRow({ status: "WAIVED", method: "WAIVED", amount: 0, note: "Anak guru" }));
    const json = await (await patch({ programId: "p-tk" })).json();
    expect(feeUpdate).not.toHaveBeenCalled();
    expect(json.feeNote).toBe("unchanged_waived");
  });

  it("a PAID fee carrying the auto-waive note text is still never reopened", async () => {
    withFee(feeRow({ status: "PAID", method: "CASH", note: AUTO_WAIVE_NOTE }));
    expect((await (await patch({ programId: "p-tk" })).json()).feeNote).toBe("unchanged_paid");
    expect(feeUpdate).not.toHaveBeenCalled();
  });

  describe("fees.edit", () => {
    const EDITOR = { id: "u-2", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view", "admissions.edit"] };
    beforeEach(() => getSession.mockResolvedValue(EDITOR));

    it.each([{ programId: "p-tk" }, { dcareAddon: true }])("403 for %j on an UNPAID fee without fees.edit; nothing is written", async (body) => {
      appFindUnique.mockResolvedValue(appRow({ fee: { status: "UNPAID" } }));
      const res = await patch({ ...body, ayahData: { phone: "081200000000" } });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("Mengubah program mengubah biaya pendaftaran; butuh izin keuangan.");
      nothingWritten();
    });

    it.each(["PAID", "WAIVED"])("no extra permission when the fee is %s", async (status) => {
      appFindUnique.mockResolvedValue(appRow({ fee: { status } }));
      withFee(feeRow({ status }));
      expect((await patch({ programId: "p-tk" })).status).toBe(200);
    });

    it("no extra permission when there is no fee row", async () => {
      expect((await patch({ programId: "p-tk" })).status).toBe(200);
    });

    it("no extra permission when program and Day Care are unchanged", async () => {
      appFindUnique.mockResolvedValue(appRow({ fee: { status: "UNPAID" } }));
      expect((await patch({ programId: "p-kb", dcareAddon: false, ayahData: { phone: "081200000000" } })).status).toBe(200);
    });

    it("re-checks under the lock when the pre-read was stale: 403 and the write rolls back", async () => {
      appFindUnique.mockResolvedValue(appRow()); // pre-read saw no fee …
      feeFindFirst.mockResolvedValue({ id: "fee-1" }); // … but an UNPAID one exists by the time the lock is held
      const res = await patch({ programId: "p-tk" });
      expect(res.status).toBe(403);
      expect(appUpdate).not.toHaveBeenCalled();
    });
  });

  it("400 with a programId field error for a program that is not an active program of the tenant; nothing is written", async () => {
    withFee(feeRow());
    const res = await patch({ programId: "p-other-tenant", ayahData: { phone: "081200000000" } });
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual([{ field: "programId", message: expect.any(String) }]);
    expect(appUpdate).not.toHaveBeenCalled();
    expect(feeUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("the active-program lookup is scoped to the session tenant", async () => {
    await patch({ programId: "p-tk" });
    expect(programFindMany.mock.calls[0][0].where).toEqual({ tenantId: "t-1", status: "ACTIVE" });
  });
});
