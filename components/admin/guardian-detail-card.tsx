"use client";

import { memo } from "react";
import Link from "next/link";
import { Pencil, Trash2, Star, Phone, Mail, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MaskedValue } from "@/components/admin/masked-value";
import { REL_LABELS } from "@/lib/constants/parent-options";

/**
 * Full wali profile card.
 *
 * Replaces the three bare badges the student detail page used to show
 * (education / occupation / income and nothing else) — every one of these
 * fields was already in the page payload and simply was not rendered, so an
 * admin had to open `/admin/guardians/[id]` to read data the browser had
 * already downloaded.
 *
 * Structural: takes only data + callbacks so the wali/household view can render
 * the same card. It knows nothing about students.
 */

export type GuardianCardParent = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  nik: string | null;
  education: string | null;
  occupation: string | null;
  employer: string | null;
  employerAddress: string | null;
  employerCity: string | null;
  incomeRange: string | null;
  childrenTotal: number | null;
  address: string | null;
  hasKtp: boolean;
  hasKk: boolean;
};

export type GuardianCardData = {
  id: string;
  relationship: string;
  isPrimary: boolean;
  childOrder: number | null;
  status: string;
  parent: GuardianCardParent;
};

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="truncate text-small font-medium">{value}</div>
    </div>
  );
}

/**
 * Memoised: the dossier page re-renders on every keystroke in any of its
 * overlays, and a family can carry several of these cards. Callers must pass
 * stable handlers (`useCallback`) for the memo to bite.
 */
export const GuardianDetailCard = memo(function GuardianDetailCard({
  guardian,
  onEdit,
  onToggleStatus,
  onSetPrimary,
}: {
  guardian: GuardianCardData;
  onEdit?: (g: GuardianCardData) => void;
  onToggleStatus?: (g: GuardianCardData) => void;
  onSetPrimary?: (g: GuardianCardData) => void;
}) {
  const p = guardian.parent;
  const workplace = [p.employer, p.employerCity].filter(Boolean).join(", ");

  return (
    <div className="rounded-lg border p-3.5">
      <div className="flex items-start justify-between gap-2">
        {/* Only the identity cluster links out — the row actions sit outside it
            so there is no interactive element nested inside an anchor. */}
        <Link
          href={`/admin/guardians/${p.id}`}
          className="-mx-1.5 -my-1 min-w-0 rounded-md px-1.5 py-1 transition-colors hover:bg-accent/50"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{p.name}</span>
            <Badge variant="outline" className="text-xs">
              {REL_LABELS[guardian.relationship] ?? guardian.relationship}
            </Badge>
            {guardian.isPrimary && (
              <Badge variant="success">
                Utama
              </Badge>
            )}
            {guardian.childOrder != null && (
              <Badge variant="outline" className="text-xs">
                Anak ke-{guardian.childOrder}
              </Badge>
            )}
          </div>
        </Link>
        <div className="flex shrink-0 gap-1">
          {onSetPrimary && !guardian.isPrimary && guardian.status !== "INACTIVE" && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              aria-label={`Jadikan ${p.name} wali utama`}
              title="Jadikan wali utama"
              onClick={() => onSetPrimary(guardian)}
            >
              <Star size={12} aria-hidden="true" />
            </Button>
          )}
          {onEdit && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              aria-label={`Edit wali ${p.name}`}
              onClick={() => onEdit(guardian)}
            >
              <Pencil size={12} aria-hidden="true" />
            </Button>
          )}
          {onToggleStatus && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:bg-destructive-subtle hover:text-destructive-text"
              aria-label={`Nonaktifkan wali ${p.name}`}
              title="Nonaktifkan wali"
              onClick={() => onToggleStatus(guardian)}
            >
              <Trash2 size={12} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {/* Contact — the reason most admins open this page at all, so it sits
          directly under the name rather than below the biography. */}
      <div className="mt-2 space-y-1">
        {p.phone && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Phone size={12} aria-hidden="true" /> {p.phone}
          </p>
        )}
        {p.whatsapp && p.whatsapp !== p.phone && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageCircle size={12} aria-hidden="true" /> {p.whatsapp}
          </p>
        )}
        {p.email ? (
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <Mail size={12} aria-hidden="true" /> {p.email}
          </p>
        ) : (
          // Billing needs an address on file — say so here rather than letting
          // the admin discover it when an invoice fails to send.
          <p className="flex items-center gap-1.5 text-xs text-status-leave-text">
            <Mail size={12} aria-hidden="true" /> Email belum diisi — tagihan tidak bisa dikirim
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t pt-3">
        {p.education && <Fact label="Pendidikan" value={p.education} />}
        {p.occupation && <Fact label="Pekerjaan" value={p.occupation} />}
        {workplace && <Fact label="Tempat Kerja" value={workplace} />}
        {p.employerAddress && <Fact label="Alamat Kantor" value={p.employerAddress} />}
        {p.incomeRange && <Fact label="Penghasilan" value={p.incomeRange} />}
        {p.childrenTotal != null && <Fact label="Jumlah Anak" value={p.childrenTotal} />}
        {p.nik && <Fact label="NIK" value={<MaskedValue value={p.nik} label={`NIK ${p.name}`} />} />}
        {p.address && (
          <div className="col-span-2">
            <Fact label="Alamat" value={<span className="whitespace-normal">{p.address}</span>} />
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5">
        <Badge variant="outline" className="text-xs">
          KTP {p.hasKtp ? "✓" : "belum"}
        </Badge>
        <Badge variant="outline" className="text-xs">
          KK {p.hasKk ? "✓" : "belum"}
        </Badge>
        <Link
          href={`/admin/guardians/${p.id}`}
          className="ml-auto text-xs font-semibold text-primary-text hover:underline"
        >
          Buka halaman wali →
        </Link>
      </div>
    </div>
  );
});
