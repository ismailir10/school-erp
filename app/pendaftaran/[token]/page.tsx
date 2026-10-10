import type { Metadata } from "next";
import Image from "next/image";
import { getProgramFees } from "@/lib/enrollment/fee-config";
import { resolveEnrollmentToken } from "@/lib/enrollment/resolve-token";
import { missingRequiredDocuments, toPublicDocuments, type DocumentKey } from "@/lib/enrollment/documents";
import { getRequiredDocuments } from "@/lib/enrollment/required-documents";
import { schoolContactPhone } from "@/lib/contact";
import { TalibWordmark } from "@/components/brand/talib-wordmark";
import { SchoolHero } from "@/components/brand/school-photos";
import PendaftaranClient from "./client";
import { MessageCard } from "./message-card";
import { BringList, withoutWaivedParentDocs } from "./bring-list";

export const metadata: Metadata = {
  title: "Formulir Pendaftaran Murid Baru", // root layout template appends " · Talib"
  description: "Lengkapi formulir penerimaan murid baru An Nisaa' Sekolahku.",
  robots: { index: false, follow: false }, // tokenized — keep out of search
};

/**
 * ACTIVE programs of THIS application's tenant, with their pendaftaran fee for
 * the Tinjau breakdown. Tenant-scoped (the lookup used to list every tenant's
 * programs); the server re-prices on submit, so a stale number here is only a
 * display matter.
 */
async function getActivePrograms(tenantId: string | undefined) {
  if (!tenantId) return [];
  try {
    return await getProgramFees(tenantId);
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
  // `onlyParent` (R2-P-10): the one parent / wali filling alone, "" when both do.
  const onlyParent = c.onlyParent === "ayah" || c.onlyParent === "ibu" ? c.onlyParent : "";
  // `version` lets the form tell a draft ticked on an older letter from one ticked on this one.
  const version = typeof c.version === "string" ? c.version : "";
  return { agreed: c.agreed === true, version, onlyParent, ayah: side(c.ayah), ibu: side(c.ibu) };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-4">
          <Image
            src="/logo.png"
            alt=""
            width={44}
            height={44}
            priority
            className="rounded-[13px] outline -outline-offset-1 outline-black/10"
          />
          <TalibWordmark size="md" showSublabel />
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-5 py-8 sm:py-12">{children}</div>
    </main>
  );
}

async function getRequired(tenantId: string | undefined): Promise<DocumentKey[]> {
  if (!tenantId) return [];
  try {
    return await getRequiredDocuments(tenantId);
  } catch (err) {
    // Never block the parent's form on a config read; the server still enforces on submit.
    console.error("[pendaftaran/page] required documents lookup failed", err);
    return [];
  }
}

export default async function PendaftaranTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { access, application, tenantId } = await resolveEnrollmentToken(token, new Date());

  // Env-configured; null (no links) when the school has not set one.
  const contactPhone = schoolContactPhone();

  if (access === "NOT_FOUND") {
    return (
      <Shell>
        <MessageCard
          title="Tautan tidak ditemukan"
          body="Tautan formulir ini tidak valid. Mohon hubungi tim penerimaan An Nisaa' Sekolahku untuk mendapatkan tautan baru."
          phone={contactPhone}
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
          phone={contactPhone}
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
        >
          {/* Same checklist as the just-submitted card; it shrinks as staff mark documents received. */}
          <BringList
            keys={
              application
                ? withoutWaivedParentDocs(
                    missingRequiredDocuments(application.documents),
                    toPublicConsent(application.consentData).onlyParent,
                  )
                : []
            }
          />
        </MessageCard>
      </Shell>
    );
  }

  const [programs, requiredDocuments] = await Promise.all([
    getActivePrograms(tenantId),
    getRequired(tenantId),
  ]);

  return (
    <Shell>
      <SchoolHero variant="slim" />
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
          Formulir Pendaftaran Murid Baru
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Assalamu&apos;alaikum, Bapak/Ibu. Mohon lengkapi data ananda, data orang tua, dan surat
          persetujuan di bawah ini. Data tersimpan otomatis — Bapak/Ibu dapat melanjutkan nanti
          melalui tautan yang sama.
        </p>
      </div>
      <PendaftaranClient
        token={token}
        programs={programs}
        requiredDocuments={requiredDocuments}
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
