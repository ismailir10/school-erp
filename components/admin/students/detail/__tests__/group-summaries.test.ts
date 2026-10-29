import { describe, it, expect } from "vitest";
import {
  catatanSummary,
  keluargaSummary,
  keuanganSummary,
  kelasSummary,
  profilSummary,
} from "../group-summaries";

describe("profilSummary", () => {
  it("joins NIS, gender and the allergy flag", () => {
    expect(profilSummary({ nis: "2026-0142", gender: "L", allergy: "kacang" })).toBe(
      "NIS 2026-0142 · Laki-laki · Alergi kacang",
    );
  });
  it("says NIS belum diisi and drops absent parts", () => {
    expect(profilSummary({ nis: null, gender: null, allergy: null })).toBe("NIS belum diisi");
    expect(profilSummary({ nis: "  ", gender: "P", allergy: undefined })).toBe("NIS belum diisi · Perempuan");
  });
  it("ignores an unknown gender value", () => {
    expect(profilSummary({ nis: "1", gender: "X", allergy: null })).toBe("NIS 1");
  });
});

describe("keluargaSummary", () => {
  it("counts wali, saudara and berkas", () => {
    expect(keluargaSummary({ guardianCount: 2, siblingCount: 1, docsPresent: 3, docsTotal: 4 })).toBe(
      "2 wali · 1 saudara · Berkas 3/4",
    );
  });
  it("omits saudara when there are none and names a missing wali", () => {
    expect(keluargaSummary({ guardianCount: 0, siblingCount: 0, docsPresent: 1, docsTotal: 2 })).toBe(
      "Belum ada wali · Berkas 1/2",
    );
  });
});

describe("kelasSummary", () => {
  it("shows class, attendance and raport once the overview is in", () => {
    expect(
      kelasSummary({ className: "KB A", attendance: { present: 18, total: 20 }, raport: { published: 0, total: 2 } }),
    ).toBe("KB A · Hadir 18/20 · Rapor 0/2 terbit");
  });
  it("leaves out the overview parts while it loads or fails (null), never a 0", () => {
    expect(kelasSummary({ className: "KB A", attendance: null, raport: null })).toBe("KB A");
  });
  it("leaves out parts with nothing to count", () => {
    expect(
      kelasSummary({ className: "KB A", attendance: { present: 0, total: 0 }, raport: { published: 0, total: 0 } }),
    ).toBe("KB A");
  });
  it("names a child with no class", () => {
    expect(kelasSummary({ className: null, attendance: null, raport: null })).toBe("Belum terdaftar di kelas");
  });
});

describe("keuanganSummary", () => {
  const base = { loading: false, error: false, keringananCount: null };
  it("shows what is owed", () => {
    expect(keuanganSummary({ ...base, summary: { invoiceCount: 3, outstanding: 1250000 }, keringananCount: 2 })).toBe(
      "Rp 1.250.000 belum dibayar · 2 keringanan",
    );
  });
  it("says everything is paid, or that there is nothing billed", () => {
    expect(keuanganSummary({ ...base, summary: { invoiceCount: 3, outstanding: 0 } })).toBe("Semua tagihan lunas");
    expect(keuanganSummary({ ...base, summary: { invoiceCount: 0, outstanding: 0 } })).toBe("Belum ada tagihan");
  });
  it("is Memuat… while loading and a dash on error, with no keringanan part", () => {
    const summary = { invoiceCount: 0, outstanding: 0 };
    expect(keuanganSummary({ ...base, loading: true, summary, keringananCount: 2 })).toBe("Memuat…");
    expect(keuanganSummary({ ...base, error: true, summary, keringananCount: 2 })).toBe("Gagal memuat");
  });
  it("leaves the keringanan part out until it is known and above zero", () => {
    const summary = { invoiceCount: 1, outstanding: 0 };
    expect(keuanganSummary({ ...base, summary, keringananCount: null })).toBe("Semua tagihan lunas");
    expect(keuanganSummary({ ...base, summary, keringananCount: 0 })).toBe("Semua tagihan lunas");
  });
  it("names active cuti only once known and above zero", () => {
    const summary = { invoiceCount: 1, outstanding: 0 };
    expect(keuanganSummary({ ...base, summary, cutiCount: null })).toBe("Semua tagihan lunas");
    expect(keuanganSummary({ ...base, summary, cutiCount: 0 })).toBe("Semua tagihan lunas");
    expect(keuanganSummary({ ...base, summary, keringananCount: 1, cutiCount: 2 })).toBe(
      "Semua tagihan lunas · 1 keringanan · 2 cuti aktif",
    );
  });
});

describe("catatanSummary", () => {
  it("names the formulir date", () => {
    expect(catatanSummary({ application: { submittedAt: "2026-09-12T03:00:00.000Z" }, fromFormulir: true })).toBe(
      "Formulir 12 Sep 2026",
    );
  });
  it("says when the formulir was never sent", () => {
    expect(catatanSummary({ application: { submittedAt: null }, fromFormulir: true })).toBe("Formulir belum dikirim");
  });
  it("says Input manual for a hand-entered child", () => {
    expect(catatanSummary({ application: null, fromFormulir: false })).toBe("Input manual");
  });
  it("says nothing it cannot know while the overview is still pending", () => {
    expect(catatanSummary({ application: undefined, fromFormulir: false })).toBeUndefined();
    expect(catatanSummary({ application: undefined, fromFormulir: true })).toBe("Formulir");
  });
});
