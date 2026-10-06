import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { resolveEnrollmentToken } from "@/lib/enrollment/resolve-token";
import { toPublicDocuments } from "@/lib/enrollment/documents";
import PendaftaranClient from "./client";

export const metadata: Metadata = {
  title: "Formulir Pendaftaran Murid Baru — Talib",
  description: "Lengkapi formulir penerimaan murid baru An Nisaa' Sekolahku.",
  robots: { index: false, follow: false }, // tokenized — keep out of search
};

async function getActivePrograms() {
  try {
    return await prisma.program.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  } catch (err) {
    console.error("[pendaftaran/page] program lookup failed", err);
    return [];
  }
}

/**
 * Consent blob for the browser: names + a `signed` flag per parent. The raw
 * storage tokens never leave the server (the signature routes persist them on
 * the row; submit reads them from there).
 */
function toPublicConsent(raw: unknown) {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const side = (v: unknown) => {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return {
      name: typeof o.name === "string" ? o.name : "",
      signed: typeof o.signatureToken === "string" && o.signatureToken.length > 0,
    };
  };
  return { agreed: c.agreed === true, ayah: side(c.ayah), ibu: side(c.ibu) };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f4f6f3]">
      <header className="border-b border-emerald-900/10 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-4">
          <div
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0C5C3F] text-base font-semibold text-white"
          >
            T
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-base font-semibold text-[#0C5C3F]">Talib</span>
            <span className="text-xs text-emerald-900/70">by An Nisaa&apos; Sekolahku</span>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-5 py-8 sm:py-12">{children}</div>
    </main>
  );
}

function MessageCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-emerald-900/10 bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-semibold text-emerald-950">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-emerald-900/70">{body}</p>
    </div>
  );
}

export default async function PendaftaranTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { access, application } = await resolveEnrollmentToken(token, new Date());

  if (access === "NOT_FOUND") {
    return (
      <Shell>
        <MessageCard
          title="Tautan tidak ditemukan"
          body="Tautan formulir ini tidak valid. Mohon hubungi tim penerimaan An Nisaa' Sekolahku untuk mendapatkan tautan baru."
        />
      </Shell>
    );
  }

  if (access === "EXPIRED") {
    return (
      <Shell>
        <MessageCard
          title="Tautan sudah kedaluwarsa"
          body="Tautan formulir ini sudah melewati masa berlaku (14 hari). Mohon hubungi tim penerimaan untuk mendapatkan tautan baru."
        />
      </Shell>
    );
  }

  if (access === "SUBMITTED" || !application) {
    return (
      <Shell>
        <MessageCard
          title="Formulir sudah diterima"
          body="Jazakumullah khairan. Formulir pendaftaran ananda sudah kami terima. Tim penerimaan akan menghubungi Bapak/Ibu untuk proses selanjutnya."
        />
      </Shell>
    );
  }

  const programs = await getActivePrograms();

  return (
    <Shell>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold text-emerald-950 sm:text-3xl">
          Formulir Pendaftaran Murid Baru
        </h1>
        <p className="mt-2 text-sm text-emerald-900/70 sm:text-base">
          Assalamu&apos;alaikum, Bapak/Ibu. Mohon lengkapi data ananda, data orang tua, dan surat
          persetujuan di bawah ini. Data tersimpan otomatis — Bapak/Ibu dapat melanjutkan nanti
          melalui tautan yang sama.
        </p>
      </div>
      <PendaftaranClient
        token={token}
        programs={programs}
        prefill={{
          programId: application.programId,
          dcareAddon: application.dcareAddon,
          studentData: application.studentData,
          ayahData: application.ayahData,
          ibuData: application.ibuData,
          consentData: toPublicConsent(application.consentData),
          documents: toPublicDocuments(application.documents),
        }}
      />
    </Shell>
  );
}
