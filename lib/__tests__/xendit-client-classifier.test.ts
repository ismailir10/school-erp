/**
 * Tests for `XenditApiError` classification in `lib/xendit/client.ts`.
 *
 * Covers each HTTP-status branch (5xx / 408 / 429 / 401 / 403 / 422 / other 4xx),
 * the network-error path (fetch throws), and `Retry-After` parsing edge cases
 * (numeric, capped, garbage, missing). Asserts on `error.code` + `error.retriable`
 * + `error.retryAfterMs` per Task 1 acceptance.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  XenditApiError,
  createXenditSession,
  parseRetryAfter,
  type CreateSessionParams,
} from "../xendit/client";

const baseParams: CreateSessionParams = {
  referenceId: "inv-test-1",
  amount: 100000,
  description: "Test invoice",
  customerName: "Test Customer",
  successReturnUrl: "https://example.test/success",
  cancelReturnUrl: "https://example.test/cancel",
};

/** Build a minimal `Response`-shaped mock for an error status. */
function mockErrorResponse(opts: {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}): Response {
  const headers = new Headers(opts.headers ?? {});
  return {
    ok: false,
    status: opts.status,
    headers,
    json: async () => opts.body ?? { message: `mock ${opts.status}` },
  } as unknown as Response;
}

describe("parseRetryAfter", () => {
  it("returns ms for a numeric header (seconds → ms)", () => {
    expect(parseRetryAfter("2")).toBe(2000);
  });

  it("caps the value at 3000ms (per spec)", () => {
    expect(parseRetryAfter("99")).toBe(3000);
    expect(parseRetryAfter("3")).toBe(3000);
  });

  it("returns undefined for a null (missing) header", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("returns undefined for non-numeric garbage", () => {
    expect(parseRetryAfter("garbage")).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
  });

  it("parses leading digits via parseInt (RFC-ish leniency)", () => {
    // parseInt("2.5", 10) === 2 — documents current behavior so future
    // refactors don't silently change parsing semantics.
    expect(parseRetryAfter("2.5")).toBe(2000);
  });
});

describe("createXenditSession — XenditApiError classification", () => {
  const originalKey = process.env.XENDIT_SECRET_KEY;

  beforeEach(() => {
    process.env.XENDIT_SECRET_KEY = "test-secret";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.XENDIT_SECRET_KEY;
    else process.env.XENDIT_SECRET_KEY = originalKey;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("classifies 500 as code=5xx, retriable=true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockErrorResponse({ status: 500 })),
    );
    await expect(createXenditSession(baseParams)).rejects.toMatchObject({
      name: "GatewayApiError",
      status: 500,
      code: "5xx",
      retriable: true,
    });
  });

  it("classifies 502 as code=5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockErrorResponse({ status: 502 })),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err).toBeInstanceOf(XenditApiError);
    expect(err.code).toBe("5xx");
    expect(err.retriable).toBe(true);
  });

  it("classifies 503 as code=5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockErrorResponse({ status: 503 })),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err).toBeInstanceOf(XenditApiError);
    expect(err.code).toBe("5xx");
    expect(err.retriable).toBe(true);
  });

  it("classifies 408 as code=408, retriable=true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockErrorResponse({ status: 408 })),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err).toBeInstanceOf(XenditApiError);
    expect(err.code).toBe("408");
    expect(err.retriable).toBe(true);
  });

  it("classifies 429 with Retry-After: 2 → retryAfterMs=2000, retriable=true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockErrorResponse({
          status: 429,
          headers: { "Retry-After": "2" },
        }),
      ),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err).toBeInstanceOf(XenditApiError);
    expect(err.code).toBe("429");
    expect(err.retriable).toBe(true);
    expect(err.retryAfterMs).toBe(2000);
  });

  it("classifies 429 with Retry-After: 99 → retryAfterMs capped at 3000", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockErrorResponse({
          status: 429,
          headers: { "Retry-After": "99" },
        }),
      ),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err.code).toBe("429");
    expect(err.retryAfterMs).toBe(3000);
  });

  it("classifies 429 with Retry-After: garbage → retryAfterMs=undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockErrorResponse({
          status: 429,
          headers: { "Retry-After": "garbage" },
        }),
      ),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err.code).toBe("429");
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.retriable).toBe(true);
  });

  it("classifies 429 with no Retry-After → retryAfterMs=undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockErrorResponse({ status: 429 })),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err.code).toBe("429");
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.retriable).toBe(true);
  });

  it("classifies 401 as code=401, retriable=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockErrorResponse({ status: 401 })),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err).toBeInstanceOf(XenditApiError);
    expect(err.code).toBe("401");
    expect(err.retriable).toBe(false);
  });

  it("classifies 403 as code=403, retriable=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockErrorResponse({ status: 403 })),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err.code).toBe("403");
    expect(err.retriable).toBe(false);
  });

  it("classifies 422 as code=422, retriable=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockErrorResponse({ status: 422 })),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err.code).toBe("422");
    expect(err.retriable).toBe(false);
  });

  it("classifies 400 as code=4xx, retriable=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockErrorResponse({ status: 400 })),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err.code).toBe("4xx");
    expect(err.retriable).toBe(false);
  });

  it("classifies 404 as code=4xx, retriable=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockErrorResponse({ status: 404 })),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err.code).toBe("4xx");
    expect(err.retriable).toBe(false);
  });

  it("classifies fetch-throw (network error) as code=network, retriable=true, status=null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err).toBeInstanceOf(XenditApiError);
    expect(err.code).toBe("network");
    expect(err.retriable).toBe(true);
    expect(err.status).toBeNull();
    expect(err.message).toContain("fetch failed");
  });

  it("preserves the body message when present (5xx)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockErrorResponse({
          status: 503,
          body: { message: "service temporarily unavailable" },
        }),
      ),
    );
    const err = await createXenditSession(baseParams).catch((e) => e);
    expect(err.message).toBe("service temporarily unavailable");
  });

  it("aborts a hanging create after 10 seconds as a retriable network error", async () => {
    vi.useFakeTimers();
    try {
      // Native AbortSignal.timeout uses internal timers; replace its clock with Vitest's.
      const controller = new AbortController();
      const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
        return controller.signal;
      });
      vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })));

      const outcome = createXenditSession(baseParams).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(controller.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(timeout).toHaveBeenCalledWith(10_000);
      expect(await outcome).toMatchObject({
        name: "GatewayApiError",
        code: "network",
        status: null,
        retriable: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
