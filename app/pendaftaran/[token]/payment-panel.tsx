"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRupiah, formatTime } from "@/lib/format";
import type { PublicFeeView } from "@/lib/enrollment/fee-view";

/**
 * The pendaftaran fee, as the parent sees it. One component for every place the
 * fee appears — the card right after submit, the form link reopened later, and
 * the page DOKU sends the parent back to — so the amount, the discount and the
 * next step read the same everywhere.
 *
 * Presentation only: the amount and status come from the server, the button
 * asks `POST /api/enrollments/token/[token]/pay` for a link and sends the
 * browser there. Nothing here decides what is owed.
 *
 * The server state is the source of truth and is read straight from props, so a
 * `router.refresh()` ("Periksa lagi") that finds the fee paid flips this panel
 * with it. The only local state is the transient UI around a click.
 *
 *   start     right after submit — "Langkah terakhir"
 *   pending   back from DOKU, payment not seen yet — "Menunggu pembayaran"
 *   cancelled back from DOKU after cancelling
 *
 * `gate` is the pay-first variant ("Bayar dulu"): the formulir has not been filled
 * yet, so the panel names the program (and Day Care) the fee was priced for rather
 * than the child, drops the "Langkah terakhir" cue and says the fee is not
 * refundable instead of "pay later".
 */
export type PaymentPanelMode = "start" | "pending" | "cancelled";

const COPY = {
  closed: "Pendaftaran ini tidak dilanjutkan. Silakan hubungi tim penerimaan untuk informasi lebih lanjut.",
  generic: "Pembayaran belum bisa dimulai. Silakan hubungi tim penerimaan.",
  offline: "Koneksi terputus. Coba lagi sebentar ya.",
  rateLimited: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
  linkFailed: "Tautan pembayaran belum bisa dibuat. Coba lagi sebentar.",
  expired: "Tautan sudah kedaluwarsa. Hubungi tim penerimaan untuk tautan baru.",
} as const;

/** Only a real HTTPS gateway page is ever navigated to; anything else (javascript:, data:, http:) is refused. */
function isSafeGatewayUrl(url: string): boolean {
  try {
    return new URL(url, window.location.origin).protocol === "https:";
  } catch {
    return false;
  }
}

type PayResponse = { paymentUrl?: unknown; status?: unknown; error?: unknown; message?: unknown };

/** Parent-facing text for a non-OK answer. Never the server's raw body. */
function messageFor(status: number, body: PayResponse): { text: string; closed?: boolean } {
  if (status === 409 && body.error === "APPLICATION_CLOSED") return { text: COPY.closed, closed: true };
  if (status === 410) return { text: COPY.expired };
  if (status === 429) return { text: COPY.rateLimited };
  if (status === 502) return { text: COPY.linkFailed };
  return { text: COPY.generic };
}

export function PaymentPanel({
  token,
  childName,
  fee,
  mode = "start",
  closed = false,
  headingLevel = 2,
  gate,
  navigate = (url) => window.location.assign(url),
}: {
  token: string;
  childName: string;
  fee: PublicFeeView;
  mode?: PaymentPanelMode;
  /** Staff rejected the application: show the fee, offer no payment. */
  closed?: boolean;
  /** Level of the panel's heading: 2 under a page `h1`, 3 inside a card that already has an `h2`. */
  headingLevel?: 2 | 3;
  /** Pay-first: what the fee was priced for. Set on the "Bayar dulu" screen only. */
  gate?: { programName: string | null; dcareAddon: boolean };
  /** Where the browser goes for the gateway page; a seam for tests. */
  navigate?: (url: string) => void;
}) {
  const router = useRouter();
  // Transient UI around a click — NOT a copy of server state.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when `/pay` itself says the fee is settled (paid from another tab). It
  // shows the receipt at once; the refresh it triggers brings the real time.
  const [settledNow, setSettledNow] = useState<"PAID" | "WAIVED" | null>(null);
  // Set when `/pay` says the application was rejected since this page loaded.
  const [closedNow, setClosedNow] = useState(false);
  const [checking, startChecking] = useTransition();
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  // Leaving for DOKU leaves the button busy; Back restores this page from the
  // browser's cache with that state intact, so release it when the page returns.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const status = fee.status === "UNPAID" && settledNow ? settledNow : fee.status;
  const isClosed = closed || closedNow;
  const Heading = headingLevel === 2 ? "h2" : "h3";

  async function pay() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/enrollments/token/${encodeURIComponent(token)}/pay`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as PayResponse;
      if (res.ok && typeof body.paymentUrl === "string") {
        if (!isSafeGatewayUrl(body.paymentUrl)) {
          setError(COPY.linkFailed);
          setBusy(false);
          return;
        }
        // Leave the button busy: the page is about to be replaced.
        navigate(body.paymentUrl);
        return;
      }
      if (res.ok && (body.status === "PAID" || body.status === "WAIVED")) {
        // Settled while this page was open (paid from another tab or device).
        setSettledNow(body.status);
        router.refresh();
        setBusy(false);
        return;
      }
      const failure = messageFor(res.status, body);
      if (failure.closed) setClosedNow(true);
      setError(failure.text);
    } catch {
      setError(COPY.offline);
    }
    setBusy(false);
  }

  function checkAgain() {
    setCheckedAt(new Date().toISOString());
    startChecking(() => router.refresh());
  }

  if (status === "PAID") return <PaidPanel childName={childName} fee={fee} Heading={Heading} />;
  if (status === "WAIVED") return <WaivedPanel childName={childName} Heading={Heading} />;

  // A rejected application is not asked to pay, so it must not be told to.
  const heading = isClosed
    ? "Biaya pendaftaran"
    : mode === "pending"
      ? "Menunggu pembayaran"
      : mode === "cancelled"
        ? "Pembayaran belum selesai"
        : gate
          ? "Biaya formulir"
          : "Bayar biaya pendaftaran";
  const payLabel = mode === "start" && !fee.started ? "Bayar sekarang" : "Lanjutkan pembayaran";

  return (
    <section
      aria-labelledby="fee-heading"
      className="rounded-xl border border-primary-text/20 bg-primary/5 p-5 text-left sm:p-6"
    >
      {mode === "start" && !isClosed && !gate && <p className="text-xs font-medium text-primary-text">Langkah terakhir</p>}
      <Heading id="fee-heading" className="mt-1 text-lg font-semibold text-foreground text-balance">
        {heading}
      </Heading>

      <FeeAmount childName={childName} fee={fee} gate={gate} />

      {mode === "pending" && !isClosed && (
        <p role="status" className="mt-4 text-sm leading-relaxed text-muted-foreground text-pretty">
          Kami belum menerima pembayaran untuk biaya ini. Pembayaran lewat Virtual Account bisa
          memerlukan beberapa menit sampai terdeteksi. Jika Bapak/Ibu sudah membayar, ketuk
          &ldquo;Periksa lagi&rdquo;.
          {checkedAt && !checking && <span className="mt-1 block">Terakhir diperiksa pukul {formatTime(checkedAt)}.</span>}
        </p>
      )}
      {mode === "cancelled" && !isClosed && (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground text-pretty">
          Belum ada pembayaran yang masuk. Bapak/Ibu bisa mencobanya lagi kapan saja.
        </p>
      )}

      {/* The closed message below says it for a rejected application; Alert is already role="alert". */}
      {error && !isClosed && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Said before the button, so the parent reads it before paying. */}
      {!isClosed && gate && (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground text-pretty">
          Biaya formulir tidak dapat dikembalikan. Bapak/Ibu akan diarahkan ke halaman pembayaran DOKU.
        </p>
      )}

      {isClosed ? (
        <p role="status" className="mt-4 text-sm leading-relaxed text-muted-foreground text-pretty">{COPY.closed}</p>
      ) : (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            className="h-12 w-full text-base sm:w-auto sm:px-8"
            onClick={() => void pay()}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                Menyiapkan pembayaran...
              </>
            ) : (
              payLabel
            )}
          </Button>
          {mode === "pending" && (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full text-base sm:w-auto sm:px-6"
              onClick={checkAgain}
              disabled={busy || checking}
              aria-busy={checking}
            >
              {checking ? (
                <>
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                  Memeriksa...
                </>
              ) : (
                "Periksa lagi"
              )}
            </Button>
          )}
        </div>
      )}

      {!isClosed && !gate && mode === "start" && (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground text-pretty">
          Bapak/Ibu akan diarahkan ke halaman pembayaran DOKU. Belum sempat sekarang? Biaya ini
          bisa dibayar nanti lewat tautan formulir yang sama.
        </p>
      )}
    </section>
  );
}

/** Amount, with the discount shown when there is one. Spacing groups it; only the total gets a rule. */
function FeeAmount({
  childName,
  fee,
  gate,
}: {
  childName: string;
  fee: PublicFeeView;
  gate?: { programName: string | null; dcareAddon: boolean };
}) {
  const discount = Math.max(0, fee.baseAmount - fee.amount);
  return (
    <div className="mt-3 text-sm">
      {gate ? (
        <p className="text-muted-foreground">Biaya formulir pendaftaran</p>
      ) : (
        <p className="text-muted-foreground">
          Biaya pendaftaran ananda <span className="font-medium text-foreground">{childName}</span>
        </p>
      )}
      <dl>
        {/* Pay-first: the fee was priced before the form was filled, so say for what. */}
        {gate && (gate.programName || gate.dcareAddon) && (
          <div className="mt-3 space-y-1">
            {gate.programName && (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Program</dt>
                <dd className="text-right font-medium text-foreground">{gate.programName}</dd>
              </div>
            )}
            {gate.dcareAddon && (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Tambahan Day Care</dt>
                <dd className="text-right font-medium text-foreground">Ya</dd>
              </div>
            )}
          </div>
        )}
        {discount > 0 && (
          <div className="mt-3 space-y-1">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Biaya normal</dt>
              <dd className="text-muted-foreground tabular-nums line-through">{formatRupiah(fee.baseAmount)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-status-present-text">Diskon {fee.discountPercent}%</dt>
              <dd className="font-medium text-status-present-text tabular-nums">
                <span aria-hidden>−</span>
                <span className="sr-only">minus </span>
                {formatRupiah(discount)}
              </dd>
            </div>
          </div>
        )}
        <div
          className={`flex items-baseline justify-between gap-4 ${discount > 0 ? "mt-3 border-t border-border pt-3" : "mt-2"}`}
        >
          <dt className="font-medium text-foreground">Total</dt>
          <dd className="text-3xl font-semibold leading-tight text-foreground tabular-nums">{formatRupiah(fee.amount)}</dd>
        </div>
      </dl>
    </div>
  );
}

type HeadingTag = "h2" | "h3";

function PaidPanel({ childName, fee, Heading }: { childName: string; fee: PublicFeeView; Heading: HeadingTag }) {
  return (
    <section
      aria-labelledby="fee-paid-heading"
      className="rounded-xl border border-status-present/30 bg-status-present-subtle p-5 text-left sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-status-present text-white"
        >
          <Check className="size-4" strokeWidth={2.5} />
        </span>
        <div className="min-w-0">
          <Heading id="fee-paid-heading" className="text-lg font-semibold text-foreground text-balance">
            Pembayaran diterima
          </Heading>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">
            {childName ? (
              <>
                Alhamdulillah, biaya pendaftaran ananda <span className="font-medium text-foreground">{childName}</span>{" "}
                sudah lunas.
              </>
            ) : (
              "Alhamdulillah, biaya pendaftaran sudah lunas."
            )}{" "}
            Terima kasih, Bapak/Ibu.
          </p>
        </div>
      </div>
      <dl className="mt-4 space-y-1 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Jumlah</dt>
          <dd className="font-semibold text-foreground tabular-nums">{formatRupiah(fee.amount)}</dd>
        </div>
        {/* The server's time, once it has one; never this device's clock. */}
        {fee.paidAt && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Dibayar</dt>
            <dd className="text-right text-foreground">{formatDateTime(fee.paidAt)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function WaivedPanel({ childName, Heading }: { childName: string; Heading: HeadingTag }) {
  return (
    <section aria-labelledby="fee-waived-heading" className="rounded-xl border border-border bg-muted p-5 text-left sm:p-6">
      <Heading id="fee-waived-heading" className="text-lg font-semibold text-foreground text-balance">
        Biaya pendaftaran dibebaskan
      </Heading>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">
        {childName ? (
          <>
            Tidak ada biaya pendaftaran yang perlu dibayar untuk ananda{" "}
            <span className="font-medium text-foreground">{childName}</span>.
          </>
        ) : (
          "Biaya pendaftaran sudah dibebaskan."
        )}
      </p>
    </section>
  );
}
