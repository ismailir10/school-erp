import { beforeEach, describe, expect, it, vi } from "vitest";

const { error } = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error } }));

import { ApiError } from "@/lib/api/client-errors";
import { MESSAGES, RETRY_LABEL, toastCaughtError, toastError } from "@/lib/feedback";

beforeEach(() => {
  error.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("MESSAGES", () => {
  it("builds loadFailed around the noun", () => {
    expect(MESSAGES.loadFailed("Data siswa")).toBe("Data siswa belum bisa dimuat. Coba lagi sebentar ya.");
  });

  it("keeps status codes and English out of the generic copy", () => {
    const generic = [MESSAGES.network, MESSAGES.saveFailed, MESSAGES.deleteFailed, MESSAGES.generic, MESSAGES.required];
    for (const m of generic) expect(m).not.toMatch(/\d{3}|error|failed/i);
  });
});

describe("toastError", () => {
  it("uses Sonner defaults when no options are given", () => {
    toastError(MESSAGES.generic);
    expect(error).toHaveBeenCalledWith(MESSAGES.generic, { id: undefined, duration: undefined, action: undefined });
  });

  it("persists and offers a Coba lagi action when retry is given", () => {
    const retry = vi.fn();
    toastError(MESSAGES.saveFailed, { retry });
    const [message, opts] = error.mock.calls[0];
    expect(message).toBe(MESSAGES.saveFailed);
    expect(opts.duration).toBe(Infinity);
    expect(opts.action.label).toBe(RETRY_LABEL);
    expect(opts.action.label).toBe("Coba lagi");
    opts.action.onClick();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("persists without an action when only persistent is set", () => {
    toastError(MESSAGES.saveFailed, { persistent: true });
    const [, opts] = error.mock.calls[0];
    expect(opts.duration).toBe(Infinity);
    expect(opts.action).toBeUndefined();
  });

  it("passes the id through so repeated failures replace one toast", () => {
    toastError(MESSAGES.network, { id: "save-error" });
    expect(error.mock.calls[0][1].id).toBe("save-error");
    toastError(MESSAGES.network, { id: 7 });
    expect(error.mock.calls[1][1].id).toBe(7);
  });

  it("returns Sonner's toast id", () => {
    error.mockReturnValueOnce("toast-1");
    expect(toastError(MESSAGES.generic)).toBe("toast-1");
  });
});

describe("toastCaughtError", () => {
  it("shows the message of an ApiError", () => {
    toastCaughtError(new ApiError("Nama kelas sudah dipakai."), MESSAGES.saveFailed);
    expect(error.mock.calls[0][0]).toBe("Nama kelas sudah dipakai.");
  });

  it.each([
    ["a TypeError from res.json()", new TypeError("Unexpected end of JSON input")],
    ["a plain Error", new Error("boom")],
    ["a non-error value", "nope"],
  ])("shows the fallback for %s, never the raw text", (_label, err) => {
    toastCaughtError(err, MESSAGES.saveFailed);
    expect(error.mock.calls[0][0]).toBe(MESSAGES.saveFailed);
  });

  it("forwards retry and persistent options", () => {
    const retry = vi.fn();
    toastCaughtError(new Error("x"), MESSAGES.network, { retry, id: "n" });
    const [, opts] = error.mock.calls[0];
    expect(opts.duration).toBe(Infinity);
    expect(opts.action.label).toBe("Coba lagi");
    expect(opts.id).toBe("n");
  });
});
