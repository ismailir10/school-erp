import type { ReactNode } from "react";
import { MaskedValue } from "@/components/admin/masked-value";
import { SectionHeading } from "@/components/ui/section-heading";
import type { ParentDetail } from "./types";

/**
 * Data Wali, view mode: grouped Kontak / Identitas / Pekerjaan. An empty value
 * reads "Belum diisi" instead of disappearing, so "no email on file" and "not
 * shown" can never look the same.
 */

function Empty() {
  return <span className="italic text-muted-foreground">Belum diisi</span>;
}

function Row({
  label,
  value,
  wide,
  breakAll,
}: {
  label: string;
  value: ReactNode;
  wide?: boolean;
  breakAll?: boolean;
}) {
  return (
    <div className={wide ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-sm font-medium ${breakAll ? "break-all" : "break-words"}`}>{value}</dd>
    </div>
  );
}

const text = (v: string | null | undefined) => (v && v.trim() ? v : <Empty />);

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="[&:not(:first-child)]:mt-6">
      <SectionHeading label={label} />
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

export function GuardianProfileView({ parent }: { parent: ParentDetail }) {
  return (
    <>
      <Group label="Kontak">
        <Row label="Telepon" value={text(parent.phone)} />
        <Row label="WhatsApp" value={text(parent.whatsapp)} />
        <Row label="Email" value={text(parent.email)} breakAll />
        <Row label="Alamat" value={text(parent.address)} />
      </Group>

      <Group label="Identitas">
        <Row
          label="NIK"
          value={parent.nik?.trim() ? <MaskedValue value={parent.nik} label="NIK wali" /> : <Empty />}
        />
        <Row label="Jumlah Anak" value={parent.childrenTotal != null ? parent.childrenTotal : <Empty />} />
      </Group>

      <Group label="Pekerjaan">
        <Row label="Pendidikan" value={text(parent.education)} />
        <Row label="Pekerjaan" value={text(parent.occupation)} />
        <Row label="Tempat Kerja" value={text(parent.employer)} />
        <Row label="Penghasilan" value={text(parent.incomeRange)} />
        {parent.employerAddress?.trim() && <Row label="Alamat Kantor" value={parent.employerAddress} />}
        {parent.employerCity?.trim() && <Row label="Kota/Kab" value={parent.employerCity} />}
      </Group>
    </>
  );
}
