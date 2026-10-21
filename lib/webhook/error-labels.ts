/**
 * Pure mapper from `WebhookEvent.errorMessage` (engineer-facing prefix codes
 * like `INVOICE_NOT_FOUND:ref=...`, `MISSING_AMOUNT`, `IGNORED:already_paid`)
 * to humanized Indonesian copy for the admin "Aktivitas Pembayaran" panel.
 *
 * Per voice.md admin rules: no raw engineer codes leak into the UI. Each
 * known prefix has a polite, action-oriented Indonesian label. Unmatched
 * prefixes return null — the panel falls back to muted "Lihat detail di
 * payload" copy and the raw `errorMessage` is only visible inside the
 * expanded payload JSON.
 *
 * Catalog cross-referenced with:
 *   - C6 (Aktivitas Pembayaran panel spec)
 *   - voice.md admin error rules
 */

import {
  DUPLICATE_PAYMENT_AFTER_PAID,
  OVERPAYMENT_FLAGGED,
  PAID_ON_CANCELLED_INVOICE,
} from "@/lib/payments/needs-review";

export function mapErrorLabel(errorMessage: string | null | undefined): string | null {
  if (!errorMessage) return null;

  // Prefix matches first (longest-match-wins for nested codes).
  if (errorMessage.startsWith("INVOICE_NOT_FOUND")) {
    return "Tagihan tidak ditemukan untuk pembayaran ini. Hubungi tim teknis.";
  }
  if (errorMessage === "MISSING_AMOUNT") {
    return "Jumlah pembayaran tidak tercatat di webhook. Verifikasi manual.";
  }
  if (errorMessage === "MISSING_PAYMENT_ID") {
    return "ID pembayaran dari gerbang pembayaran tidak tercatat. Verifikasi manual.";
  }
  if (errorMessage === OVERPAYMENT_FLAGGED) {
    return "Pembayaran melebihi tagihan — sudah dikreditkan, verifikasi manual.";
  }
  if (errorMessage === DUPLICATE_PAYMENT_AFTER_PAID) {
    return "Pembayaran kedua untuk tagihan yang sudah lunas — tidak dicatat. Periksa di dashboard gateway dan kembalikan dana bila perlu.";
  }
  if (errorMessage === PAID_ON_CANCELLED_INVOICE) {
    return "Pembayaran untuk tagihan yang sudah dibatalkan — tidak dicatat. Periksa di dashboard gateway dan kembalikan dana.";
  }
  if (errorMessage.startsWith("CURRENCY_MISMATCH")) {
    return "Mata uang pembayaran bukan IDR — tidak dikreditkan, verifikasi manual.";
  }

  // IGNORED:* suffix family.
  if (errorMessage.endsWith("already_paid")) {
    return "Tagihan sudah lunas — event diabaikan.";
  }
  // Legacy IGNORED reasons written before a payment on a cancelled invoice became an error.
  if (errorMessage === "invoice cancelled" || errorMessage === "invoice cancelled (in-tx)") {
    return "Tagihan dibatalkan — event diabaikan.";
  }
  if (errorMessage.endsWith("already_cancelled")) {
    return "Tagihan dibatalkan — event diabaikan.";
  }
  if (errorMessage.endsWith("status_not_completed")) {
    return "Status pembayaran belum selesai (masih pending di gerbang pembayaran).";
  }
  if (errorMessage.endsWith("status_not_handled")) {
    return "Tipe event tidak didukung.";
  }
  if (errorMessage.endsWith("status_not_revertible")) {
    return "Status tagihan tidak bisa dikembalikan.";
  }

  return null;
}
