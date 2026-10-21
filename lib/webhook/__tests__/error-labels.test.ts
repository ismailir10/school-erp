import { describe, it, expect } from "vitest";
import { mapErrorLabel } from "../error-labels";

describe("mapErrorLabel — catalog", () => {
  it("INVOICE_NOT_FOUND with refId/sessionId suffix → humanized", () => {
    expect(mapErrorLabel("INVOICE_NOT_FOUND:ref=abc;session=ps-xyz")).toBe(
      "Tagihan tidak ditemukan untuk pembayaran ini. Hubungi tim teknis.",
    );
  });

  it("bare INVOICE_NOT_FOUND → humanized", () => {
    expect(mapErrorLabel("INVOICE_NOT_FOUND")).toBe(
      "Tagihan tidak ditemukan untuk pembayaran ini. Hubungi tim teknis.",
    );
  });

  it("MISSING_AMOUNT → humanized", () => {
    expect(mapErrorLabel("MISSING_AMOUNT")).toBe(
      "Jumlah pembayaran tidak tercatat di webhook. Verifikasi manual.",
    );
  });

  it("MISSING_PAYMENT_ID → humanized", () => {
    expect(mapErrorLabel("MISSING_PAYMENT_ID")).toBe(
      "ID pembayaran dari gerbang pembayaran tidak tercatat. Verifikasi manual.",
    );
  });

  it("OVERPAYMENT_FLAGGED → humanized", () => {
    expect(mapErrorLabel("OVERPAYMENT_FLAGGED")).toBe(
      "Pembayaran melebihi tagihan — sudah dikreditkan, verifikasi manual.",
    );
  });

  it("DUPLICATE_PAYMENT_AFTER_PAID → humanized", () => {
    expect(mapErrorLabel("DUPLICATE_PAYMENT_AFTER_PAID")).toBe(
      "Pembayaran kedua untuk tagihan yang sudah lunas — tidak dicatat. Periksa di dashboard gateway dan kembalikan dana bila perlu.",
    );
  });

  it("PAID_ON_CANCELLED_INVOICE → humanized", () => {
    expect(mapErrorLabel("PAID_ON_CANCELLED_INVOICE")).toBe(
      "Pembayaran untuk tagihan yang sudah dibatalkan — tidak dicatat. Periksa di dashboard gateway dan kembalikan dana.",
    );
  });

  it("legacy IGNORED reasons 'invoice cancelled' / '(in-tx)' → humanized", () => {
    expect(mapErrorLabel("invoice cancelled")).toBe("Tagihan dibatalkan — event diabaikan.");
    expect(mapErrorLabel("invoice cancelled (in-tx)")).toBe("Tagihan dibatalkan — event diabaikan.");
  });

  it("already_paid suffix → humanized", () => {
    expect(mapErrorLabel("IGNORED:already_paid")).toBe(
      "Tagihan sudah lunas — event diabaikan.",
    );
    expect(mapErrorLabel("already_paid")).toBe(
      "Tagihan sudah lunas — event diabaikan.",
    );
  });

  it("already_cancelled suffix → humanized", () => {
    expect(mapErrorLabel("IGNORED:already_cancelled")).toBe(
      "Tagihan dibatalkan — event diabaikan.",
    );
  });

  it("status_not_completed suffix → humanized", () => {
    expect(mapErrorLabel("IGNORED:status_not_completed")).toBe(
      "Status pembayaran belum selesai (masih pending di gerbang pembayaran).",
    );
  });

  it("status_not_handled suffix → humanized", () => {
    expect(mapErrorLabel("IGNORED:status_not_handled")).toBe(
      "Tipe event tidak didukung.",
    );
  });

  it("status_not_revertible suffix → humanized", () => {
    expect(mapErrorLabel("IGNORED:status_not_revertible")).toBe(
      "Status tagihan tidak bisa dikembalikan.",
    );
  });
});

describe("mapErrorLabel — null fallback", () => {
  it("returns null for null input", () => {
    expect(mapErrorLabel(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(mapErrorLabel(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(mapErrorLabel("")).toBeNull();
  });

  it("returns null for unmatched prefix", () => {
    expect(mapErrorLabel("SOMETHING_ELSE")).toBeNull();
    expect(mapErrorLabel("FOO:bar")).toBeNull();
  });
});
