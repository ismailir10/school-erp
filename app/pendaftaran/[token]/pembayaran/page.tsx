import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { schoolContactPhone } from "@/lib/contact";
import { getPublicFeeView } from "@/lib/enrollment/fee-view";
import { getPaymentGateView, type PaymentGateView } from "@/lib/enrollment/payment-gate";
import { resolveEnrollmentToken } from "@/lib/enrollment/resolve-token";
import { isFeeClosed } from "@/lib/enrollment/fee-closed";
import { isTokenShape } from "@/lib/enrollment/token";
import { prisma } from "@/lib/db";
import { reconcileEnrollmentFee } from "@/lib/payments/reconcile";
import { SchoolHero } from "@/components/brand/school-photos";
import { MessageCard } from "../message-card";
import { PayFirstScreen } from "../pay-first-screen";
import { PaymentPanel, type PaymentPanelMode } from "../payment-panel";
import { Shell } from "../shell";

export const metadata: Metadata = {
  title: "Pembayaran Biaya Pendaftaran", // root layout template appends " · Talib"
  description: "Status pembayaran biaya pendaftaran murid baru An Nisaa' Sekolahku.",
  robots: { index: false, follow: false }, // tokenized — keep out of search
};

/** Longest a stranger-triggerable page load may go without asking the gateway again. */
const POLL_INTERVAL_MS = 15_000;

/**
 * Where the gateway sends the parent back to (and where the form link lands for
 * someone checking on a payment). The redirect carries a `?status=` hint, but
 * the hint is only used to pick the words — whether the fee is paid is decided
 * by the stored state, after asking the gateway (throttled), because nothing on
 * a return URL proves anything and notifications are not reliable.
 *
 * Pay-first: this page is also THE "Bayar dulu" screen. While a formulir that was
 * not yet filled still owes its fee the form link lands here (`PAYMENT_REQUIRED`);
 * once the fee is settled this page hands the parent back to the form. It only
 * ever redirects to the form when the form is open, and the form only redirects
 * here while it is closed, so the two cannot bounce.
 */
export default async function PembayaranPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { token } = await params;
  const { status: hint } = await searchParams;
  const contactPhone = schoolContactPhone();

  if (!isTokenShape(token)) return <NotFound phone={contactPhone} />;
  const { access, application, tenantId } = await resolveEnrollmentToken(token, new Date());

  if (access === "NOT_FOUND" || !application) return <NotFound phone={contactPhone} />;
  // The form was never sent, so there is nothing to pay: back to the form.
  if (access === "OK") redirect(`/pendaftaran/${encodeURIComponent(token)}`);
  if (access === "EXPIRED") {
    return (
      <Shell>
        <MessageCard
          title="Tautan sudah kedaluwarsa"
          body="Tautan formulir ini sudah melewati masa berlaku. Mohon hubungi tim penerimaan untuk mendapatkan tautan baru."
          phone={contactPhone}
        />
      </Shell>
    );
  }

  if (access === "PAYMENT_REQUIRED") {
    if (!tenantId) return <NotFound phone={contactPhone} />;
    return payFirst({ token, hint, applicationId: application.id, tenantId, phone: contactPhone });
  }

  let fee = await getPublicFeeView(application.id);
  if (!fee) {
    return (
      <Shell>
        <MessageCard
          title="Tidak ada biaya yang perlu dibayar"
          body="Pendaftaran ananda tidak dikenai biaya pendaftaran. Tim penerimaan akan menghubungi Bapak/Ibu untuk proses selanjutnya."
        />
      </Shell>
    );
  }

  // Ask the gateway before rendering, so a parent who just paid sees "Lunas"
  // even if no notification ever arrived. Throttled per fee (a shared DB stamp),
  // and a failed poll just leaves the page showing what is stored.
  if (fee.status === "UNPAID" && fee.started) {
    try {
      const feeId = await feeIdFor(application.id);
      if (feeId) await reconcileEnrollmentFee(feeId, { minIntervalMs: POLL_INTERVAL_MS });
      fee = (await getPublicFeeView(application.id)) ?? fee;
    } catch (err) {
      console.error("[pendaftaran/pembayaran] reconcile failed", err);
    }
  }

  const mode: PaymentPanelMode = hint === "cancel" ? "cancelled" : fee.started ? "pending" : "start";

  return (
    <Shell>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold text-foreground text-balance">Pembayaran biaya pendaftaran</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
          {fee.status === "PAID"
            ? "Terima kasih, Bapak/Ibu. Berikut ringkasan pembayarannya."
            : fee.status === "WAIVED"
              ? "Berikut keterangan biaya pendaftaran ananda."
              : "Berikut status pembayaran biaya pendaftaran ananda."}
        </p>
        <div className="mt-5">
          <PaymentPanel
            token={token}
            childName={application.childName}
            fee={fee}
            mode={mode}
            closed={isFeeClosed(application)}
          />
        </div>
        <p className="mt-5 text-sm text-muted-foreground">
          <a
            href={`/pendaftaran/${encodeURIComponent(token)}`}
            className="inline-flex min-h-11 items-center font-medium text-primary-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            Kembali ke formulir pendaftaran
          </a>
        </p>
      </div>
    </Shell>
  );
}

/** Opens the form's way once the fee is settled; otherwise the pay-first screen, or a dead end when staff closed it. */
async function payFirst({
  token,
  hint,
  applicationId,
  tenantId,
  phone,
}: {
  token: string;
  hint: string | undefined;
  applicationId: string;
  tenantId: string;
  phone: string | null;
}) {
  const unavailable = (
    <Shell>
      <MessageCard
        title="Halaman pembayaran belum bisa dibuka"
        body="Mohon coba muat ulang beberapa saat lagi. Jika masih sama, hubungi tim penerimaan An Nisaa' Sekolahku."
        phone={phone}
      />
    </Shell>
  );

  let gate: PaymentGateView | null;
  try {
    gate = await getPaymentGateView(applicationId, tenantId);
    // Ask the gateway before rendering (same rules as below), so a parent who has
    // just paid goes straight to the form even if no notification arrived. A closed
    // registration is not collected any more, so it is not polled.
    if (gate && !gate.closed && gate.fee.status === "UNPAID" && gate.fee.started) {
      try {
        const feeId = await feeIdFor(applicationId);
        if (feeId) await reconcileEnrollmentFee(feeId, { minIntervalMs: POLL_INTERVAL_MS });
        gate = (await getPaymentGateView(applicationId, tenantId)) ?? gate;
      } catch (err) {
        console.error("[pendaftaran/pembayaran] reconcile failed", err);
      }
    }
  } catch (err) {
    console.error("[pendaftaran/pembayaran] gate lookup failed", err);
    return unavailable;
  }
  // No fee row after all: show a notice, never redirect — the form link would send
  // the parent straight back here if the fee reappeared in between.
  if (!gate) return unavailable;

  // Settled: the form is open now.
  if (!gate.closed && gate.fee.status !== "UNPAID") redirect(`/pendaftaran/${encodeURIComponent(token)}`);

  if (gate.closed) {
    return (
      <Shell>
        <MessageCard
          title="Mohon maaf, Bapak/Ibu"
          body="Maaf, Bapak/Ibu, pembayaran untuk formulir ini sudah ditutup. Silakan hubungi tim penerimaan."
          phone={phone}
        />
      </Shell>
    );
  }

  const mode: PaymentPanelMode = hint === "cancel" ? "cancelled" : gate.fee.started ? "pending" : "start";
  return (
    <Shell>
      <SchoolHero variant="slim" />
      <PayFirstScreen token={token} gate={gate} mode={mode} phone={phone} />
    </Shell>
  );
}

function NotFound({ phone }: { phone: string | null }) {
  return (
    <Shell>
      <MessageCard
        title="Tautan tidak ditemukan"
        body="Tautan ini tidak valid. Mohon hubungi tim penerimaan An Nisaa' Sekolahku untuk mendapatkan tautan baru."
        phone={phone}
      />
    </Shell>
  );
}

async function feeIdFor(applicationId: string): Promise<string | null> {
  const row = await prisma.enrollmentFee.findUnique({ where: { applicationId }, select: { id: true } });
  return row?.id ?? null;
}
