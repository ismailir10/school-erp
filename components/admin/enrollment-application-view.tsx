"use client";

import { useId } from "react";
import {
  AGAMA_OPTIONS,
  KEWARGANEGARAAN_OPTIONS,
  LIVING_WITH_OPTIONS,
  BIRTH_DELIVERY_OPTIONS,
  BIRTH_TERM_OPTIONS,
  BLOOD_TYPE_OPTIONS,
  EDUCATION_OPTIONS,
  OCCUPATION_OPTIONS,
  INCOME_OPTIONS,
  type Option,
} from "@/lib/enrollment/constants";
import { formatDateShort } from "@/lib/format";

/**
 * Read-only rendering of a submitted pendaftaran form.
 *
 * Extracted from `/admin/enrollments/[id]` so the student dossier can show the
 * same form on the student record without a second copy of the option-label
 * lookups drifting from the first. The page keeps its header, status
 * transitions and convert action; only the form body lives here.
 *
 * Entity-agnostic in the same sense as `DossierSection` — it takes the four
 * JSON blobs and an application id, and knows nothing about students.
 *
 * The blobs are `Json` columns validated on submit (`lib/enrollment`), so every
 * field is read defensively: an older submission simply lacks keys a newer one
 * has, and a missing key renders as an em dash rather than throwing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type EnrollmentApplicationBlobs = {
  id: string;
  studentData: any;
  ayahData: any;
  ibuData: any;
  consentData: any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export function labelOf(options: Option[], value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  return options.find((o) => o.value === value)?.label ?? value;
}

export function v(x: unknown): string {
  return typeof x === "string" && x ? x : typeof x === "number" ? String(x) : "—";
}

/**
 * Birth dates are stored as `YYYY-MM-DD` strings. Show them as "15 Mar 2022";
 * anything that is not that shape (an older free-text submission) passes
 * through untouched rather than rendering "Invalid Date".
 */
function dateV(x: unknown): string {
  const raw = v(x);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? formatDateShort(raw) : raw;
}

/** Joins only the parts that are actually present, so no "—, —" strings. */
function join(parts: string[]): string {
  const kept = parts.filter((s) => s !== "—");
  return kept.length > 0 ? kept.join(", ") : "—";
}

export function ApplicationRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/50 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function ApplicationSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    // Named region: Anak / Ayah / Ibu can be told apart by a screen reader (and by a test).
    <section aria-labelledby={headingId} className="rounded-xl border bg-card p-4">
      <h3 id={headingId} className="mb-2 text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ParentSection({ title, p }: { title: string; p: any }) {
  const d = p ?? {};
  const a = d.address ?? {};
  return (
    <ApplicationSection title={title}>
      <ApplicationRow label="Nama" value={v(d.name)} />
      <ApplicationRow label="Tempat, tanggal lahir" value={join([v(d.birthPlace), dateV(d.dateOfBirth)])} />
      <ApplicationRow label="Agama" value={labelOf(AGAMA_OPTIONS, d.agama)} />
      <ApplicationRow label="No. HP" value={v(d.phone)} />
      <ApplicationRow label="Email" value={v(d.email)} />
      <ApplicationRow label="Pendidikan" value={labelOf(EDUCATION_OPTIONS, d.education)} />
      <ApplicationRow label="Pekerjaan" value={labelOf(OCCUPATION_OPTIONS, d.occupation)} />
      <ApplicationRow label="Penghasilan" value={labelOf(INCOME_OPTIONS, d.income)} />
      <ApplicationRow label="Nama kantor" value={v(d.employerName)} />
      <ApplicationRow label="Alamat" value={join([v(a.perumahan), v(a.kecamatan)])} />
    </ApplicationSection>
  );
}

export function EnrollmentApplicationView({
  application,
  columns = 2,
}: {
  application: EnrollmentApplicationBlobs;
  /**
   * The enrollment page renders two columns at `lg`. Inside a dossier section
   * the main column is already narrower than the page, so the caller can ask
   * for a single column and let the four blocks stack.
   */
  columns?: 1 | 2;
}) {
  const s = application.studentData ?? {};
  const addr = s.address ?? {};
  const consent = application.consentData ?? {};

  return (
    <div className={columns === 2 ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}>
      <ApplicationSection title="Data Anak">
        <ApplicationRow label="Nama lengkap" value={v(s.childName)} />
        <ApplicationRow label="Nama panggilan" value={v(s.nickname)} />
        <ApplicationRow
          label="Jenis kelamin"
          value={s.childGender === "L" ? "Laki-laki" : s.childGender === "P" ? "Perempuan" : "—"}
        />
        <ApplicationRow label="Tempat, tanggal lahir" value={join([v(s.birthPlace), dateV(s.dateOfBirth)])} />
        <ApplicationRow label="Agama" value={labelOf(AGAMA_OPTIONS, s.agama)} />
        <ApplicationRow label="Kewarganegaraan" value={labelOf(KEWARGANEGARAAN_OPTIONS, s.kewarganegaraan)} />
        <ApplicationRow label="Tinggal bersama" value={labelOf(LIVING_WITH_OPTIONS, s.livingWith)} />
        <ApplicationRow label="Bahasa di rumah" value={v(s.homeLanguage)} />
        <ApplicationRow
          label="Alamat"
          value={join([v(addr.perumahan), v(addr.blokCluster), v(addr.kecamatan), v(addr.kodePos)])}
        />
      </ApplicationSection>

      <ApplicationSection title="Kelahiran & Kesehatan">
        <ApplicationRow label="Jalan lahir" value={labelOf(BIRTH_DELIVERY_OPTIONS, s.birthDelivery)} />
        <ApplicationRow label="Bulan lahir" value={labelOf(BIRTH_TERM_OPTIONS, s.birthTerm)} />
        <ApplicationRow label="Berat badan" value={s.weightKg ? `${v(s.weightKg)} kg` : "—"} />
        <ApplicationRow label="Tinggi badan" value={s.heightCm ? `${v(s.heightCm)} cm` : "—"} />
        <ApplicationRow
          label="Lingkar kepala"
          value={s.headCircumferenceCm ? `${v(s.headCircumferenceCm)} cm` : "—"}
        />
        <ApplicationRow label="Golongan darah" value={labelOf(BLOOD_TYPE_OPTIONS, s.bloodType)} />
        <ApplicationRow label="Alergi makanan" value={v(s.foodAllergy)} />
        <ApplicationRow label="Penyakit berat" value={v(s.seriousIllness)} />
        <ApplicationRow label="Anak ke-" value={v(s.childOrder)} />
      </ApplicationSection>

      <ParentSection title="Data Ayah" p={application.ayahData} />
      <ParentSection title="Data Ibu" p={application.ibuData} />

      <ApplicationSection title="Surat Persetujuan">
        <ApplicationRow label="Disetujui" value={consent.agreed ? "Ya" : "Belum"} />
        <ApplicationRow label="Versi" value={v(consent.version)} />
        <ApplicationRow label="Ditandatangani Ayah" value={v(consent.ayah?.name)} />
        <ApplicationRow label="Ditandatangani Ibu" value={v(consent.ibu?.name)} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          {(["ayah", "ibu"] as const).map((which) =>
            consent[which]?.hasSignature ? (
              <figure key={which} className="rounded-lg border p-2">
                <figcaption className="mb-1 text-xs capitalize text-muted-foreground">{which}</figcaption>
                {/* Auth-proxied: the src is the admin-gated stream route, never
                    the storage token. Same pattern as the KK preview. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/enrollments/${application.id}/signature?which=${which}`}
                  alt={`Tanda tangan ${which}`}
                  className="h-24 w-full rounded bg-white object-contain"
                />
              </figure>
            ) : null,
          )}
        </div>
      </ApplicationSection>
    </div>
  );
}
