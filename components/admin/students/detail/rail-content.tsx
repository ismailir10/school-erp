"use client";

import Link from "next/link";
import { RailCard, RailKV, RailChecklist, type RailItem } from "@/components/admin/detail-rail";
import { Button } from "@/components/ui/button";
import { telHref, whatsappHref } from "@/lib/contact";
import { formatDateShort } from "@/lib/format";
import { REL_LABELS } from "@/lib/constants/parent-options";
import type { Guardian } from "./types";

/**
 * The dossier's right rail body: Ringkasan, Kontak Cepat (primary/first
 * active wali), Kelengkapan Berkas, Jejak. Everything here is read-only and
 * derived from data the page already fetched — no local state, no fetch.
 *
 * Rendered both inside `DetailRail` (desktop, sticky) and, on mobile, inline
 * above the sections — the page decides the wrapper, this decides the content.
 */
export function StudentRailContent({
  summaryItems,
  contactGuardian,
  docItems,
  createdAt,
  fromEnrollmentApplication,
}: {
  summaryItems: RailItem[];
  contactGuardian: Guardian | null;
  docItems: { label: string; present: boolean }[];
  createdAt: string | null;
  fromEnrollmentApplication: string | null;
}) {
  return (
    <>
      <RailCard title="Ringkasan">
        <RailKV items={summaryItems} />
      </RailCard>
      {contactGuardian && (
        <RailCard title="Kontak Cepat">
          <p className="text-small font-semibold">{contactGuardian.parent.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {REL_LABELS[contactGuardian.relationship] ?? contactGuardian.relationship}
            {contactGuardian.parent.phone ? ` · ${contactGuardian.parent.phone}` : ""}
          </p>
          <div className="mt-3 flex gap-2">
            {whatsappHref(contactGuardian.parent.whatsapp ?? contactGuardian.parent.phone) && (
              <Button
                size="sm"
                className="flex-1"
                render={
                  <a
                    href={whatsappHref(contactGuardian.parent.whatsapp ?? contactGuardian.parent.phone)!}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                WhatsApp
              </Button>
            )}
            {telHref(contactGuardian.parent.phone) && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                render={<a href={telHref(contactGuardian.parent.phone)!} />}
              >
                Telepon
              </Button>
            )}
          </div>
        </RailCard>
      )}
      <RailCard title="Kelengkapan Berkas">
        <RailChecklist items={docItems} />
      </RailCard>
      <RailCard title="Jejak">
        <RailKV
          items={[
            ...(createdAt ? [{ label: "Dibuat", value: formatDateShort(createdAt) }] : []),
            {
              label: "Asal data",
              value: fromEnrollmentApplication ? (
                <Link
                  href={`/admin/enrollments/${fromEnrollmentApplication}`}
                  className="text-primary-text hover:underline"
                >
                  Formulir pendaftaran →
                </Link>
              ) : (
                <span className="text-muted-foreground">Input manual</span>
              ),
            },
          ]}
        />
      </RailCard>
    </>
  );
}
