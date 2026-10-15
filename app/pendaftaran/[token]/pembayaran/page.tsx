import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { schoolContactPhone } from "@/lib/contact";
import { getPublicFeeView } from "@/lib/enrollment/fee-view";
import { resolveEnrollmentToken } from "@/lib/enrollment/resolve-token";
import { isFeeClosed } from "@/lib/enrollment/fee-closed";
import { isTokenShape } from "@/lib/enrollment/token";
import { prisma } from "@/lib/db";
import { reconcileEnrollmentFee } from "@/lib/payments/reconcile";
import { MessageCard } from "../message-card";
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
 * The fee is paid after the form is sent, so this page is for a submitted
 * application; one whose form is still open is sent back to the form.
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
  const { access, application } = await resolveEnrollmentToken(token, new Date());

  if (access === "NOT_FOUND" || !application) return <NotFound phone={contactPhone} />;
  // The form is still open, so there is nothing to pay yet: back to the form.
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
