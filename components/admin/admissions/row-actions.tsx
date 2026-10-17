"use client";

import Link from "next/link";
import { Loader2, MessageCircle, MoreHorizontal, Pencil, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { admissionChildLabel } from "@/lib/admission/child-label";
import type { Admission } from "./types";

/**
 * What a Pendaftaran row offers, decided by its stage (cycle
 * 2026-10-11-pendaftaran-simplify): one visible primary action that moves the family
 * forward, and an overflow menu for the rest.
 *
 *   BARU              Kirim Formulir            (one tap: posts the invite, opens the link card)
 *   FORMULIR_DIKIRIM  Kirim ulang tautan        (menu: Ingatkan bayar when it can be sent)
 *   FORMULIR_MASUK    Buka formulir             (the detail page holds Terima & Jadikan Siswa)
 *   DITERIMA, DITOLAK Buka formulir
 *   SISWA             Lihat siswa
 *   BATAL             nothing
 *
 * Menu, for every lead that is neither a student nor cancelled: Ubah data pertanyaan, Batalkan.
 * Viewers (no `admissions.edit`) only ever get the links.
 */

export type PrimaryAction =
  | { kind: "send"; label: string }
  | { kind: "link"; label: string; href: string };

export type RowActionPlan = {
  primary: PrimaryAction | null;
  /** The WhatsApp fee reminder endpoint (opens wa.me in a new tab), when it can be sent. */
  reminderHref: string | null;
  canEditLead: boolean;
};

/** The lead's own page of data is editable until it becomes a student or is cancelled. */
export function isLeadEditable(a: Pick<Admission, "stage">): boolean {
  return a.stage !== "SISWA" && a.stage !== "BATAL";
}

export function planRowActions(a: Admission, canEdit: boolean): RowActionPlan {
  const formulirHref = a.application ? `/admin/enrollments/${a.application.id}` : null;
  const studentId = a.studentId ?? a.application?.studentId ?? null;

  let primary: PrimaryAction | null = null;
  switch (a.stage) {
    case "BARU":
      if (canEdit) primary = { kind: "send", label: "Kirim Formulir" };
      break;
    case "FORMULIR_DIKIRIM":
      if (canEdit) primary = { kind: "send", label: "Kirim ulang tautan" };
      break;
    case "FORMULIR_MASUK":
    case "DITERIMA":
    case "DITOLAK":
      if (formulirHref) primary = { kind: "link", label: "Buka formulir", href: formulirHref };
      break;
    case "SISWA":
      if (studentId) primary = { kind: "link", label: "Lihat siswa", href: `/admin/students/${studentId}` };
      break;
    case "BATAL":
      break;
  }

  const remindable = a.stage === "FORMULIR_DIKIRIM" || a.stage === "FORMULIR_MASUK" || a.stage === "DITERIMA";
  const reminderHref =
    canEdit && remindable && a.application?.fee?.canRemind
      ? `/api/enrollments/${a.application.id}/fee/reminder`
      : null;

  return { primary, reminderHref, canEditLead: canEdit && isLeadEditable(a) };
}

/** A name for screen readers: the child, or the parent while the child is not named yet. */
export function rowLabel(a: Pick<Admission, "childName" | "parentName">): string {
  return a.childName.trim() ? admissionChildLabel(a.childName) : a.parentName;
}

export type AdmissionRowActionsProps = {
  admission: Admission;
  canEdit: boolean;
  /** Sends the formulir in one tap (first send, or a resend for FORMULIR_DIKIRIM). */
  onSend: (a: Admission) => void;
  /** This row's invite is in flight: the button shows a spinner (label unchanged; the page announces it) and ignores taps. */
  sending?: boolean;
  onEdit: (a: Admission) => void;
  onCancelRequest: (a: Admission) => void;
};

export function AdmissionRowActions({ admission: a, canEdit, onSend, sending = false, onEdit, onCancelRequest }: AdmissionRowActionsProps) {
  const plan = planRowActions(a, canEdit);
  const label = rowLabel(a);
  const hasMenu = plan.canEditLead || plan.reminderHref !== null;

  if (!plan.primary && !hasMenu) {
    return <span className="text-xs text-muted-foreground">{canEdit ? "—" : "Hanya lihat"}</span>;
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {plan.primary?.kind === "send" && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-2.5 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
          aria-label={`${plan.primary.label}: ${label}`}
          data-admission-primary={a.id}
          // aria-disabled, not disabled: the button keeps focus while the invite is sent.
          aria-disabled={sending || undefined}
          aria-busy={sending || undefined}
          onClick={() => {
            if (!sending) onSend(a);
          }}
        >
          {sending ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : null}
          {plan.primary.label}
        </Button>
      )}
      {plan.primary?.kind === "link" && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-2.5 text-xs [@media(pointer:coarse)]:min-h-11"
          aria-label={`${plan.primary.label}: ${label}`}
          data-admission-primary={a.id}
          render={<Link href={plan.primary.href} />}
        >
          {plan.primary.label}
        </Button>
      )}

      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Aksi untuk ${label}`}
                data-admission-menu={a.id}
              />
            }
          >
            <MoreHorizontal size={14} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-40">
            {plan.reminderHref && (
              <DropdownMenuItem render={<a href={plan.reminderHref} target="_blank" rel="noopener noreferrer" />}>
                <MessageCircle size={14} className="mr-2" aria-hidden="true" />
                Ingatkan bayar (WhatsApp)
              </DropdownMenuItem>
            )}
            {plan.canEditLead && (
              <DropdownMenuItem onClick={() => onEdit(a)}>
                <Pencil size={14} className="mr-2" aria-hidden="true" />
                Ubah data pertanyaan
              </DropdownMenuItem>
            )}
            {plan.canEditLead && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onCancelRequest(a)} className="text-destructive focus:text-destructive">
                  <XCircle size={14} className="mr-2" aria-hidden="true" />
                  Batalkan
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
