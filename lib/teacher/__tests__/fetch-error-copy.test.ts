import { afterEach, describe, expect, it, vi } from "vitest";
import { describeFetchFailure, failureFromError, fetchOrDescribe, FetchFailureError } from "../fetch-error-copy";

describe("describeFetchFailure", () => {
  it("401 is auth and cannot be retried", () => {
    expect(describeFetchFailure({ status: 401, action: "disimpan", serverMessage: "Unauthorized" })).toEqual({
      kind: "auth", canRetry: false, message: "Sesi Anda sudah berakhir. Masuk lagi, lalu simpan ulang.",
    });
  });
  it("403 is forbidden, never 'periksa koneksi', and cannot be retried", () => {
    const f = describeFetchFailure({ status: 403, action: "dimuat", serverMessage: "Forbidden" });
    expect(f).toEqual({ kind: "forbidden", canRetry: false, message: "Anda tidak punya akses ke kelas ini. Hubungi admin sekolah." });
  });
  it("a network failure is retryable and ignores any status/message", () => {
    const f = describeFetchFailure({ networkError: true, action: "disimpan", serverMessage: "Failed to fetch" });
    expect(f).toEqual({ kind: "network", canRetry: true, message: "Koneksi terputus. Periksa internet, lalu coba lagi." });
  });
  it.each([500, 502, 503])("%i is a retryable server problem", (status) => {
    expect(describeFetchFailure({ status, action: "disimpan", serverMessage: "Internal Server Error" })).toEqual({
      kind: "server", canRetry: true, message: "Server sedang bermasalah. Coba lagi sebentar lagi.",
    });
  });
  it("429 asks the teacher to wait", () => {
    expect(describeFetchFailure({ status: 429, action: "disimpan" })).toMatchObject({ kind: "server", canRetry: true, message: expect.stringContaining("Tunggu sebentar") });
  });
  it.each([400, 409, 422])("%i uses the server message when present", (status) => {
    expect(describeFetchFailure({ status, action: "disimpan", serverMessage: "Tidak bisa mencatat kehadiran untuk tanggal yang akan datang" })).toEqual({
      kind: "validation", canRetry: true, message: "Tidak bisa mencatat kehadiran untuk tanggal yang akan datang",
    });
  });
  it("validation falls back to generic copy when the message is missing, blank or oversized", () => {
    const generic = "Data belum bisa disimpan. Coba lagi.";
    expect(describeFetchFailure({ status: 400, action: "disimpan" }).message).toBe(generic);
    expect(describeFetchFailure({ status: 422, action: "disimpan", serverMessage: "   " }).message).toBe(generic);
    expect(describeFetchFailure({ status: 400, action: "disimpan", serverMessage: "x".repeat(500) }).message).toBe(generic);
  });
  it("never uses a server message for 404 and names the action", () => {
    expect(describeFetchFailure({ status: 404, action: "dimuat", serverMessage: "Not found" }).message).toBe("Data belum bisa dimuat. Coba lagi.");
  });
  it("an unknown shape falls back to the server copy", () => {
    expect(describeFetchFailure({ action: "disimpan" }).kind).toBe("server");
  });
});

describe("fetchOrDescribe", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("turns a thrown fetch into a network failure without the browser text", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const err = await fetchOrDescribe("/x", undefined, "disimpan").catch((e) => e);
    expect(err).toBeInstanceOf(FetchFailureError);
    expect(err.failure.kind).toBe("network");
    expect(err.message).not.toMatch(/Failed to fetch/);
  });
  it("describes a 401 body of 'Unauthorized' as auth", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) })));
    const err = await fetchOrDescribe("/x", undefined, "disimpan").catch((e) => e);
    expect(err.failure).toMatchObject({ kind: "auth", canRetry: false });
  });
  it("survives a non-JSON error body", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => { throw new Error("bad json"); } })));
    const err = await fetchOrDescribe("/x", undefined, "disimpan").catch((e) => e);
    expect(err.failure.kind).toBe("server");
  });
  it("returns the response when ok", async () => {
    const res = { ok: true, status: 200 };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(res)));
    await expect(fetchOrDescribe("/x", undefined, "disimpan")).resolves.toBe(res);
  });
});

describe("failureFromError", () => {
  it("never leaks an arbitrary Error message", () => {
    expect(failureFromError(new Error("ECONNRESET secret"), "disimpan").message).toBe("Server sedang bermasalah. Coba lagi sebentar lagi.");
  });
});

describe("describeFetchFailure — machine codes", () => {
  it("never shows a snake_case code as copy", () => {
    const f = describeFetchFailure({ status: 422, action: "disimpan", serverMessage: "student_not_enrolled" });
    expect(f.message).toBe("Data belum bisa disimpan. Coba lagi.");
  });
});
