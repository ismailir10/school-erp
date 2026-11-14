import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
const programFindFirst = vi.hoisted(() => vi.fn(async () => ({ id: "p" }) as { id: string } | null));
const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, missing: false }));
const update = vi.hoisted(() => vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(state.row, data); return state.row; }));
vi.mock("@/lib/db", () => {
  const db = { enrollmentApplication: { findUnique: vi.fn(async () => state.missing ? null : state.row), update }, $queryRaw: vi.fn(async () => [{ id: "a" }]), program: { findFirst: programFindFirst } };
  return { prisma: { ...db, $transaction: (fn: (tx: typeof db) => unknown) => fn(db) } };
});
import { PATCH } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";
const ctx = { params: Promise.resolve({ token: "tok" }) };
const save = (body: unknown) => PATCH(new NextRequest("http://localhost/api/enrollments/token/tok", { method: "PATCH", body: JSON.stringify(body) }), ctx);
beforeEach(() => {
  vi.clearAllMocks(); __resetRateLimitForTest();
  state.missing = false;
  programFindFirst.mockResolvedValue({ id: "p" });
  state.row = { id: "a", tenantId: "t", programId: null, dcareAddon: false, status: "INVITED", tokenExpiresAt: new Date(Date.now() + 86400000), studentData: { nickname: "" }, ayahData: { phone: "" }, ibuData: { phone: "" }, consentData: { ayah: { signatureToken: "original", signedAt: "yesterday" }, ibu: {} } };
});
describe("draft saves", () => {
  it("returns404 for an unknown token without writing", async () => {
    state.missing = true;
    expect((await save({ studentData: { childName: "X" } })).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
  it("returns400 for malformed JSON without writing", async () => {
    const request = new NextRequest("http://localhost/api/enrollments/token/tok", { method: "PATCH", body: "{broken" });
    expect((await PATCH(request, ctx)).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
  it("keeps empty and stripped-document requests as no-op writes", async () => {
    expect((await save({})).status).toBe(200);
    expect((await save({ documents: { photo: "spoof" } })).status).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });
  it("persists a valid prefixed program after checking tenant ownership", async () => {
    expect((await save({ programId: "program_ab57fd0432e25d5b3013" })).status).toBe(200);
    expect(programFindFirst).toHaveBeenCalledWith({ where: { id: "program_ab57fd0432e25d5b3013", tenantId: "t" }, select: { id: true } });
    expect(state.row.programId).toBe("program_ab57fd0432e25d5b3013");
  });
  it("permits initial scalar choices without a baseline but protects an existing program", async () => {
    expect((await save({ programId: "program_first", dcareAddon: true })).status).toBe(200);
    expect(state.row).toMatchObject({ programId: "program_first", dcareAddon: true });
    expect((await save({ programId: "program_other" })).status).toBe(409);
    expect(state.row.programId).toBe("program_first");
  });
  it("persists an explicit single-parent flag while preserving signatures", async () => {
    expect((await save({ consentData: { onlyParent: "ibu" } })).status).toBe(200);
    expect(state.row.consentData).toMatchObject({ onlyParent: "ibu", ayah: { signatureToken: "original", signedAt: "yesterday" } });
  });

  it("refuses expired and already submitted tokens before writing", async () => {
    state.row.tokenExpiresAt = new Date(0);
    expect((await save({ studentData: {} })).status).toBe(410);
    state.row.status = "SUBMITTED";
    expect((await save({ studentData: {} })).status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });
  it("requires a resolved tenant before any write", async () => {
    state.row.tenantId = null;
    expect((await save({ studentData: {} })).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
  it("does not write a cross-tenant program reference", async () => {
    programFindFirst.mockResolvedValue(null);
    expect((await save({ programId: "program_foreign" })).status).toBe(200);
    expect(state.row.programId).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
  it("normalizes an explicit empty program to null", async () => {
    expect((await save({ programId: "" })).status).toBe(200);
    expect(state.row.programId).toBeNull();
  });
  it("retries a cleared program after the first success response is lost", async () => {
    state.row.programId = "program_original";
    const payload = { programId: "", baseData: { programId: "program_original" } };
    expect((await save(payload)).status).toBe(200);
    expect(state.row.programId).toBeNull();
    expect((await save(payload)).status).toBe(200);
    expect(state.row.programId).toBeNull();
  });

  it("rate limits repeated draft writes", async () => {
    for (let i = 0; i < 30; i++) expect((await save({})).status).toBe(200);
    expect((await save({})).status).toBe(429);
  });

  it("merges independent parents and rejects a stale conflicting leaf", async () => {
    const baseData = JSON.parse(JSON.stringify(state.row));
    expect((await save({ baseData, ayahData: { phone: "081111111" } })).status).toBe(200);
    expect((await save({ baseData, ibuData: { phone: "082222222" }, ayahData: { phone: "" } })).status).toBe(200);
    expect(state.row.ayahData).toEqual({ phone: "081111111" });
    expect(state.row.ibuData).toEqual({ phone: "082222222" });
    expect((await save({ baseData, ayahData: { phone: "old request" } })).status).toBe(409);
    expect(state.row.ayahData).toEqual({ phone: "081111111" });
  });
  it("accepts retry after a lost success response", async () => {
    const payload = { baseData: { studentData: { nickname: "" } }, studentData: { nickname: "new" } };
    expect((await save(payload)).status).toBe(200);
    expect((await save(payload)).status).toBe(200);
  });
  it("keeps signatures and cannot forge staff evidence through either blob", async () => {
    const response = await save({ baseData: { consentData: { ayah: { signatureToken: "spoof" }, staffRecorded: true } }, consentData: { staffRecorded: true, note: "spoof", ayah: { signatureToken: "spoof", signedAt: "tomorrow", name: "Ayah" } } });
    expect(response.status).toBe(200);
    expect(state.row.consentData).toEqual({ ayah: { signatureToken: "original", signedAt: "yesterday", name: "Ayah" }, ibu: {} });
  });
  it("does not allow legacy snapshots to overwrite a previously stored leaf", async () => {
    state.row.ayahData = { phone: "saved" };
    expect((await save({ ayahData: { phone: "stale" } })).status).toBe(409);
  });
  it("rejects cancelled invitations", async () => {
    state.row.admission = { status: "CANCELLED" };
    expect((await save({ studentData: { nickname: "new" } })).status).toBe(410);
    expect(update).not.toHaveBeenCalled();
  });
  it("mirrors the child name and strips documents", async () => {
    expect((await save({ studentData: { childName: " Aisyah " }, documents: { photo: "spoof" } })).status).toBe(200);
    expect(state.row.childName).toBe("Aisyah");
    expect(state.row.ayahData).toEqual({ phone: "" });
    expect(state.row.ibuData).toEqual({ phone: "" });
    expect(state.row).not.toHaveProperty("documents");
  });
});
