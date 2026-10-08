import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { UserPlus, ArrowRight, Send, Users2 } from "lucide-react";
import { formatDateShort } from "@/lib/format";
import { formatAgeFromDob } from "@/lib/admission/age";
import { canConvertAdmissionToStudent } from "@/app/admin/admissions/conversion";
import { SOURCE_LABELS, NEXT_STATUS, TERMINAL_STATUSES } from "./constants";
import type { Admission } from "./types";

// ------------------------------------------------------------------
// Columns — module-level factory (lesson 6: rebuilt columns remount row
// cells and close open row-action menus). The page memoises its call with
// `useMemo` + stable `useCallback` handlers so `columns` itself only
// changes identity when a handler or `canEdit` actually changes.
//
// Split out of `app/admin/admissions/page.tsx` (T5, cycle
// 2026-09-27-admin-finish-standard). No behaviour change — moved verbatim.
// ------------------------------------------------------------------

export type AdmissionColumnHandlers = {
  canEdit: boolean;
  onEdit: (a: Admission) => void;
  onCancelRequest: (a: Admission) => void;
  onAdvanceStatus: (a: Admission) => void;
  onConvertToStudent: (a: Admission) => void;
  onSendEnrollmentForm: (a: Admission) => void;
};

/**
 * One chip for the list and the mobile name cell. An ADMITTED row keeps the
 * "Diterima" label whether or not it has been converted — the stat card counts
 * it as "Diterima", and R2-ADMIN-14 found the row saying "Terdaftar" for the
 * same record. Conversion is already shown in the actions cell ("Sudah jadi
 * siswa").
 */
function AdmissionStatusChip({ admission }: { admission: Admission }) {
  return <StatusBadge status={admission.status} />;
}

export function createAdmissionColumns({
  canEdit,
  onEdit,
  onCancelRequest,
  onAdvanceStatus,
  onConvertToStudent,
  onSendEnrollmentForm,
}: AdmissionColumnHandlers): ColumnDef<Admission>[] {
  return [
    {
      accessorKey: "childName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Anak" />
      ),
      cell: ({ row }) => {
        const a = row.original;
        return (
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{a.childName}</span>
              {(() => {
                // Prefer derived age from dateOfBirth (new rows); fall back to
                // the legacy childAge free-text column for rows created before
                // the DOB-only switch (cycle 2026-05-11).
                const derived = formatAgeFromDob(a.dateOfBirth);
                const display = derived ?? a.childAge;
                return display ? (
                  <span className="text-xs text-muted-foreground">{display}</span>
                ) : null;
              })()}
            </div>
            <p className="text-xs text-muted-foreground">
              {a.parentName}
              {/* R2-ADMIN-14: a WhatsApp-only inquiry still shows a way to reach the family. */}
              {a.parentPhone
                ? ` · ${a.parentPhone}`
                : a.parentWhatsapp
                  ? ` · WA ${a.parentWhatsapp}`
                  : ""}
            </p>
            {/* R2-ADMIN-16: the Status column is hidden below md, so a phone list of
                inquiries would be indistinguishable — show the chip under the name. */}
            <div className="mt-1 md:hidden">
              <AdmissionStatusChip admission={a} />
            </div>
          </div>
        );
      },
    },
    {
      id: "program",
      header: "Program",
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.program?.name ?? (
            <span className="text-muted-foreground italic">Belum dipilih</span>
          )}
        </span>
      ),
    },
    {
      id: "source",
      header: "Sumber",
      meta: { priority: "low" },
      cell: ({ row }) => (
        <div className="text-xs">
          <span>{SOURCE_LABELS[row.original.source] ?? row.original.source}</span>
          <p className="text-muted-foreground">
            {formatDateShort(row.original.createdAt)}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Tanggal" />
      ),
      meta: { priority: "low" },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDateShort(row.original.createdAt)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      meta: { priority: "low" },
      cell: ({ row }) => <AdmissionStatusChip admission={row.original} />,
    },
    {
      id: "sibling",
      header: "Saudara",
      meta: { priority: "low" },
      cell: ({ row }) => {
        const dp = row.original.detectedParent;
        if (!dp) return <span className="text-xs text-muted-foreground">—</span>;
        const studentNames = dp.guardians
          .map((g) => g.student.name)
          .filter((n): n is string => Boolean(n));
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
                <p className="mt-1 text-muted-foreground italic">
                  Tidak ada siswa tertaut
                </p>
              )}
            </HoverCardContent>
          </HoverCard>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const a = row.original;
        if (!canEdit) {
          return <span className="text-xs text-muted-foreground">Hanya lihat</span>;
        }
        if (a.studentId) {
          return <span className="text-xs text-muted-foreground">Sudah jadi siswa</span>;
        }
        const next = NEXT_STATUS[a.status];
        const extras: { label: string; icon?: React.ReactNode; onClick: () => void }[] = [];
        if (next) {
          extras.push({
            label: next.label,
            icon: <ArrowRight size={14} />,
            onClick: () => onAdvanceStatus(a),
          });
        }
        if (canConvertAdmissionToStudent(a.status)) {
          extras.push({
            label: "Konversi ke Siswa",
            icon: <UserPlus size={14} />,
            onClick: () => onConvertToStudent(a),
          });
        }
        extras.push({
          label: "Kirim Formulir",
          icon: <Send size={14} />,
          onClick: () => onSendEnrollmentForm(a),
        });
        return (
          <DataTableRowActions
            onEdit={() => onEdit(a)}
            onCancel={!TERMINAL_STATUSES.has(a.status) ? () => onCancelRequest(a) : undefined}
            extraActions={extras.length ? extras : undefined}
          />
        );
      },
    },
  ];
}
