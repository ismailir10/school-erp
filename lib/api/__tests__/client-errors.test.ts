import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiError, readApiError, userMessage } from "../client-errors";

describe("userMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the Indonesian copy for a real parse-failure exception, never leaking the exception text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Reproduce the real failure: an empty-body 500 response whose
    // `.json()` rejects, exactly like the bug this helper fixes. Browsers
    // reject with `TypeError: Failed to execute 'json' on 'Response':
    // Unexpected end of JSON input`; Node's fetch (undici) rejects with a
    // `SyntaxError` carrying similar text. Either way it is NOT an
    // `ApiError`, which is the property under test.
    let caught: unknown;
    try {
      await new Response("", { status: 500 }).json();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(ApiError);

    const message = userMessage(caught, "Gagal memuat bank narasi.");
    expect(message).toBe("Gagal memuat bank narasi.");
    expect(message).not.toMatch(/Unexpected end of JSON input/i);
  });

  it("passes an API-authored ApiError message through unchanged", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new ApiError("Triwulan tidak ditemukan.");
    expect(userMessage(err, "Gagal memuat bank narasi.")).toBe(
      "Triwulan tidak ditemukan.",
    );
  });

  it("always logs the raw error for debuggability", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");
    userMessage(err, "Gagal memuat data.");
    expect(spy).toHaveBeenCalledWith(err);
  });

  it("falls back for a plain Error that was not authored via ApiError", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("some internal detail");
    expect(userMessage(err, "Gagal memuat data.")).toBe("Gagal memuat data.");
  });
});

describe("readApiError", () => {
  it("builds an ApiError from the standard envelope, carrying message, fieldErrors and status", async () => {
    const res = new Response(
      JSON.stringify({
        error: "Validasi gagal",
        errors: [
          { field: "name", message: "Nama wajib diisi" },
          { field: "date", message: "Tanggal wajib diisi" },
        ],
      }),
      { status: 400 },
    );

    const err = await readApiError(res, "Gagal menyimpan");

    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Validasi gagal");
    expect(err.status).toBe(400);
    expect(err.fieldErrors).toEqual([
      { field: "name", message: "Nama wajib diisi" },
      { field: "date", message: "Tanggal wajib diisi" },
    ]);
  });

  it("falls back to the given message when the envelope has no `error` string", async () => {
    const res = new Response(JSON.stringify({ errors: [] }), { status: 500 });

    const err = await readApiError(res, "Gagal menyimpan");

    expect(err.message).toBe("Gagal menyimpan");
    expect(err.status).toBe(500);
    expect(err.fieldErrors).toEqual([]);
  });

  it("falls back to the given message and empty fieldErrors for a non-JSON body", async () => {
    const res = new Response("<html>502 Bad Gateway</html>", { status: 502 });

    const err = await readApiError(res, "Gagal menyimpan");

    expect(err.message).toBe("Gagal menyimpan");
    expect(err.status).toBe(502);
    expect(err.fieldErrors).toEqual([]);
  });

  it("filters out malformed entries in `errors`", async () => {
    const res = new Response(
      JSON.stringify({
        error: "Validasi gagal",
        errors: [
          { field: "name", message: "Nama wajib diisi" },
          { field: "onlyField" },
          { message: "onlyMessage" },
          "not-an-object",
          null,
          42,
        ],
      }),
      { status: 400 },
    );

    const err = await readApiError(res, "Gagal menyimpan");

    expect(err.fieldErrors).toEqual([{ field: "name", message: "Nama wajib diisi" }]);
  });

  describe("status-aware copy (STR-17)", () => {
    const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });

    it("maps a bare 403 'Forbidden' to Indonesian permission copy", async () => {
      const err = await readApiError(json({ error: "Forbidden" }, 403), "Gagal menyimpan");
      expect(err.message).toBe("Anda tidak memiliki izin untuk tindakan ini.");
      expect(err.status).toBe(403);
    });

    it("maps a 403 with no readable body to the same copy", async () => {
      const err = await readApiError(new Response("", { status: 403 }), "Gagal menyimpan");
      expect(err.message).toBe("Anda tidak memiliki izin untuk tindakan ini.");
    });

    it("keeps a 403 server sentence that is already Indonesian", async () => {
      const err = await readApiError(json({ error: "Hanya admin yang dapat mengubah wali." }, 403), "Gagal");
      expect(err.message).toBe("Hanya admin yang dapat mengubah wali.");
    });

    it("maps 401 'Unauthorized' to the session-expired copy", async () => {
      const err = await readApiError(json({ error: "Unauthorized" }, 401), "Gagal menyimpan");
      expect(err.message).toBe("Sesi Anda berakhir. Silakan masuk kembali.");
    });

    it("keeps a 401 server sentence that is already Indonesian", async () => {
      const err = await readApiError(json({ error: "Email atau kata sandi salah." }, 401), "Gagal");
      expect(err.message).toBe("Email atau kata sandi salah.");
    });

    it("replaces the stock English 500 text and machine words with server copy", async () => {
      for (const error of ["Internal Server Error", "INTERNAL_ERROR"]) {
        const err = await readApiError(json({ error }, 500), "Gagal menyimpan");
        expect(err.message).toBe("Terjadi kendala di server. Coba lagi sebentar lagi.");
      }
    });

    it("uses the server copy for an empty 5xx when the caller gave no fallback", async () => {
      const err = await readApiError(new Response("", { status: 500 }), "");
      expect(err.message).toBe("Terjadi kendala di server. Coba lagi sebentar lagi.");
    });

    it("keeps the caller's Indonesian fallback for an empty 5xx body", async () => {
      const err = await readApiError(new Response("", { status: 500 }), "Gagal menyimpan");
      expect(err.message).toBe("Gagal menyimpan");
    });

    it("keeps an Indonesian 5xx sentence from the server", async () => {
      const err = await readApiError(json({ error: "Penyedia pembayaran sedang gangguan." }, 502), "Gagal");
      expect(err.message).toBe("Penyedia pembayaran sedang gangguan.");
    });

    it("still returns fieldErrors alongside mapped copy", async () => {
      const err = await readApiError(
        json({ error: "Forbidden", errors: [{ field: "name", message: "Nama wajib diisi" }] }, 403),
        "Gagal",
      );
      expect(err.message).toBe("Anda tidak memiliki izin untuk tindakan ini.");
      expect(err.fieldErrors).toEqual([{ field: "name", message: "Nama wajib diisi" }]);
    });
  });
});
