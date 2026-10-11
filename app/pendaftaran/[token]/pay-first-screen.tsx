"use client";

import { useEffect, useRef } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { telHref, whatsappHref } from "@/lib/contact";
import type { PaymentGateView } from "@/lib/enrollment/payment-gate";
import { PaymentPanel, type PaymentPanelMode } from "./payment-panel";

/**
 * The "Bayar dulu" screen (pay-first): what the parent sees at their formulir
 * link until the pendaftaran fee is PAID or WAIVED. It says what is owed and for
 * what, what waits behind the payment (the seven steps and the documents to
 * prepare), and offers one action. The only place it lives is
 * `/pendaftaran/[token]/pembayaran`; the form link sends the parent there while
 * the fee is owed, and the payment page sends them back to the form once it is
 * settled — so neither page ever redirects to a page that redirects back.
 *
 * Presentation only: the numbers and the closed state come from the server
 * (`getPaymentGateView`), and paying goes through PaymentPanel.
 */
export function PayFirstScreen({
  token,
  gate,
  mode,
  phone,
  navigate,
}: {
  token: string;
  gate: PaymentGateView;
  mode: PaymentPanelMode;
  /** `schoolContactPhone()`; null when the school has not set one. */
  phone: string | null;
  /** Test seam for the gateway redirect; defaults to a full navigation. */
  navigate?: (url: string) => void;
}) {
  // A screen reader lands on the headline, not on the page chrome. Not scrolled
  // into view (the banner above stays visible) and not a tab stop of its own.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const wa = whatsappHref(phone);
  const tel = telHref(phone);
  const linkClass =
    "inline-flex min-h-11 items-center gap-2 font-medium text-primary-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold text-foreground text-balance outline-none sm:text-3xl"
      >
        Bayar biaya formulir untuk mulai mengisi
      </h1>
      <p className="mt-2 mb-5 text-sm leading-relaxed text-muted-foreground text-pretty sm:text-base">
        Assalamu&apos;alaikum, Bapak/Ibu. Setelah biaya formulir terbayar, formulir pendaftaran
        ananda langsung terbuka dan datanya tersimpan otomatis.
      </p>

      <PaymentPanel
        token={token}
        childName=""
        fee={gate.fee}
        mode={mode}
        gate={{ programName: gate.programName, dcareAddon: gate.dcareAddon }}
        navigate={navigate}
      />

      <section aria-labelledby="after-pay-heading" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 id="after-pay-heading" className="text-base font-semibold text-foreground">
          Setelah bayar, Bapak/Ibu bisa mengisi:
        </h2>
        <ol className="mt-3 space-y-1.5 text-sm text-foreground">
          {gate.steps.map((label, i) => (
            <li key={label} className="flex gap-3">
              <span aria-hidden className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">
                {i + 1}.
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ol>

        <h3 className="mt-5 text-sm font-semibold text-foreground">Siapkan berkas ini</h3>
        {gate.requiredDocuments.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {gate.requiredDocuments.map((d) => (
              <li key={d.key}>{d.label}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
            Berkas pendukung diunggah di langkah Berkas; daftar lengkapnya akan terlihat di sana.
          </p>
        )}
      </section>

      <div className="mt-5 text-sm text-muted-foreground">
        <p>Butuh bantuan? Hubungi sekolah.</p>
        {(wa || tel) && (
          <div className="mt-1 flex flex-wrap gap-x-5">
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className={linkClass}>
                <MessageCircle size={18} aria-hidden />
                <span>
                  Chat WhatsApp <span className="sr-only">(tab baru)</span>
                </span>
              </a>
            )}
            {tel && (
              <a href={tel} className={linkClass}>
                <Phone size={18} aria-hidden /> Telepon sekolah
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
