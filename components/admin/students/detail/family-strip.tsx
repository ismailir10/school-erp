"use client";

import { ContactActions } from "@/components/admin/contact-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { REL_LABELS } from "@/lib/constants/parent-options";
import type { Guardian } from "./types";

/**
 * The family contact row under "Perlu perhatian": who to call about this child
 * (the wali utama, else the first active wali) with WhatsApp / Telepon, on every
 * viewport. "N wali · Lihat semua" jumps to Keluarga & Wali for the rest.
 *
 * Renders nothing without a wali: the attention strip already says "Belum ada
 * wali". WhatsApp / Telepon appear only for a usable number — no dead button.
 */
export function FamilyContactStrip({
  guardian,
  guardianCount,
  onSeeAll,
}: {
  guardian: Guardian | null;
  guardianCount: number;
  onSeeAll: () => void;
}) {
  if (!guardian) return null;
  const { parent } = guardian;
  const relationship = REL_LABELS[guardian.relationship] ?? guardian.relationship;
  const number = parent.phone?.trim() || parent.whatsapp?.trim() || null;

  return (
    <Card
      aria-label="Kontak keluarga"
      role="region"
      className="mb-4 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 sm:px-card"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 break-words text-sm font-semibold text-foreground">{parent.name}</p>
          <Badge variant="secondary" className="text-xs">
            {relationship}
            {guardian.isPrimary ? " · Wali utama" : ""}
          </Badge>
        </div>
        {number && <p className="font-currency mt-0.5 text-small text-muted-foreground">{number}</p>}
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <ContactActions phone={parent.phone} whatsapp={parent.whatsapp} className="w-full sm:w-auto" />
        <Button
          type="button"
          variant="link"
          size="sm"
          className="tap-target w-full sm:w-auto"
          onClick={onSeeAll}
        >
          {guardianCount} wali · Lihat semua
        </Button>
      </div>
    </Card>
  );
}
