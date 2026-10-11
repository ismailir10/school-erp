import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { StatusBadge } from "@/components/ui/status-badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Users2 } from "lucide-react";
import { formatDateShort, formatRupiah } from "@/lib/format";
import { formatAgeFromDob } from "@/lib/admission/age";
import { admissionChildLabel } from "@/lib/admission/child-label";
import { AdmissionRowActions, isLeadEditable } from "./row-actions";
import type { Admission } from "./types";

// ------------------------------------------------------------------
// Columns — module-level factory (lesson 6: rebuilt columns remount row
// cells and close open row-action menus). The page memoises its call with
// `useMemo` + stable `useCallback` handlers so `columns` itself only
// changes identity when a handler or `canEdit` actually changes.
// ------------------------------------------------------------------

export type AdmissionColumnHandlers = {
  canEdit: boolean;
  /** Opens the lead dialog pre-filled (row click without a formulir, and the "Ubah data pertanyaan" item). */
  onEdit: (a: Admission) => void;
  onCancelRequest: (a: Admission) => void;
  /** Opens "Kirim formulir" (first send, or a resend while the stage is FORMULIR_DIKIRIM). */
  onSend: (a: Admission) => void;
};

/** Pembayaran: the fee's status; "—" when there is no fee row. */
function PaymentCell({ admission: a }: { admission: Admission }) {
  if (a.payment === "NONE") {
    return (
      <>
        <span aria-hidden="true" className="text-muted-foreground">—</span>
        <span className="sr-only">Tanpa biaya</span>
      </>
    );
  }
  return (
    <div className="flex flex-col items-start gap-0.5">
      <StatusBadge status={a.payment} />
      {a.payment === "UNPAID" && a.application?.fee && (
        <span className="text-xs tabular-nums text-muted-foreground">{formatRupiah(a.application.fee.amount)}</span>
      )}
    </div>
  );
}

/**
 * The row's identity cell is also its way in ("name is the link"): the formulir's
 * detail page when there is one, otherwise the lead dialog. A converted or cancelled
 * lead without a formulir has nowhere to go, and a viewer cannot open the dialog.
 */
function IdentityCell({ admission: a, canEdit, onEdit }: { admission: Admission; canEdit: boolean; onEdit: (a: Admission) => void }) {
  const label = admissionChildLabel(a.childName);
  // Prefer derived age from dateOfBirth; fall back to the legacy childAge free text.
  const age = formatAgeFromDob(a.dateOfBirth) ?? a.childAge;
  const contact = a.parentPhone ? ` · ${a.parentPhone}` : a.parentWhatsapp ? ` · WA ${a.parentWhatsapp}` : "";

  let name: React.ReactNode;
  if (a.application) {
    name = <DataTableLinkCell href={`/admin/enrollments/${a.application.id}`}>{label}</DataTableLinkCell>;
  } else if (a.stage === "SISWA" && a.studentId) {
    name = <DataTableLinkCell href={`/admin/students/${a.studentId}`}>{label}</DataTableLinkCell>;
  } else if (canEdit && isLeadEditable(a)) {
    name = <DataTableLinkCell onClick={() => onEdit(a)}>{label}</DataTableLinkCell>;
  } else {
    name = <span className="text-sm font-medium">{label}</span>;
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2">
        {name}
        {age && <span className="text-xs text-muted-foreground">{age}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        {a.parentName}
        {/* A WhatsApp-only lead still shows a way to reach the family. */}
        {contact}
      </p>
      {/* Tahap and Pembayaran are hidden below md: repeat them under the name for a phone. */}
      <DataTableMobileMeta className="mt-1">
        <StatusBadge status={a.stage} />
        {a.payment !== "NONE" && <StatusBadge status={a.payment} />}
      </DataTableMobileMeta>
    </div>
  );
}

export function createAdmissionColumns({ canEdit, onEdit, onCancelRequest, onSend }: AdmissionColumnHandlers): ColumnDef<Admission>[] {
  return [
    {
      accessorKey: "childName",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Anak" />,
      cell: ({ row }) => <IdentityCell admission={row.original} canEdit={canEdit} onEdit={onEdit} />,
    },
    {
      id: "program",
      header: "Program",
      meta: { priority: "low" },
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.program?.name ?? <span className="text-muted-foreground italic">Belum dipilih</span>}
        </span>
      ),
    },
    {
      id: "stage",
      header: "Tahap",
      meta: { priority: "low" },
      cell: ({ row }) => <StatusBadge status={row.original.stage} />,
    },
    {
      id: "payment",
      header: "Pembayaran",
      meta: { priority: "low" },
      cell: ({ row }) => <PaymentCell admission={row.original} />,
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Dibuat" />,
      meta: { priority: "low" },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatDateShort(row.original.createdAt)}</span>
      ),
    },
    {
      id: "sibling",
      header: "Saudara",
      meta: { priority: "low" },
      cell: ({ row }) => {
        const dp = row.original.detectedParent;
        if (!dp) return <span className="text-xs text-muted-foreground">—</span>;
        const studentNames = dp.guardians.map((g) => g.student.name).filter((n): n is string => Boolean(n));
        return (
          <HoverCard>
            <HoverCardTrigger
              render={
                <button
                  type="button"
                  className="inline-flex cursor-help items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                  data-testid="admission-row-sibling-chip"
                >
                  <Users2 size={12} aria-hidden="true" />
                  Saudara terdeteksi
                </button>
              }
            />

            <HoverCardContent className="w-64 text-sm" side="left">
              <p className="font-semibold">{dp.name}</p>
              {studentNames.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {studentNames.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground italic">Tidak ada siswa tertaut</p>
              )}
            </HoverCardContent>
          </HoverCard>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <AdmissionRowActions
          admission={row.original}
          canEdit={canEdit}
          onSend={onSend}
          onEdit={onEdit}
          onCancelRequest={onCancelRequest}
        />
      ),
    },
  ];
}
