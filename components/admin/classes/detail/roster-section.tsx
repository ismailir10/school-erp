"use client";

import { useMemo, useState } from "react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { Plus, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { DossierSection } from "@/components/admin/dossier-section";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { StatusBadge } from "@/components/ui/status-badge";

import { AddStudentDialog } from "./add-student-dialog";
import { formatDate, SECTION_ROSTER, type ClassDetail } from "./types";

type Enrollment = ClassDetail["enrollments"][number];

/**
 * "Daftar Siswa" dossier section: the roster table, its "Tambah Siswa"
 * dialog, and the "Keluarkan dari Kelas Ini" confirm — split out of
 * `app/admin/classes/[id]/client.tsx` (T2, 2026-09-27 admin-finish-standard
 * cycle). No behaviour change from the pre-split page: every id, label,
 * aria-label and confirm string is carried over verbatim.
 */
export function RosterSection({
  classId,
  classDisplayName,
  capacity,
  enrollments,
  writeAllowed,
  open,
  onOpenChange,
  onChanged,
}: {
  classId: string;
  classDisplayName: string;
  capacity: number;
  enrollments: Enrollment[];
  writeAllowed: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [removeStudentTarget, setRemoveStudentTarget] = useState<Enrollment | null>(null);

  const enrolledCount = enrollments.length;

  const rosterColumns: ColumnDef<Enrollment>[] = useMemo(
    () => [
      {
        id: "student",
        accessorFn: (r) => r.student.name,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Nama" />
        ),
        cell: ({ row }) => (
          <DataTableLinkCell
            href={`/admin/students/${row.original.student.id}`}
            className="whitespace-normal"
            description={
              <DataTableMobileMeta>
                <StatusBadge status={row.original.status} />
              </DataTableMobileMeta>
            }
          >
            {row.original.student.name}
          </DataTableLinkCell>
        ),
      },
      {
        id: "nis",
        accessorFn: (r) => r.student.nis ?? "",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="NIS" />
        ),
        meta: { priority: "low" },
        cell: ({ row }) =>
          row.original.student.nis ? (
            <span className="font-currency text-sm">
              {row.original.student.nis}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        // Status sits under the name below `md` (DataTableMobileMeta above).
        meta: { priority: "low" },
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "enrollDate",
        accessorFn: (r) => r.enrollDate,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tgl Masuk" />
        ),
        meta: { priority: "low" },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDate(row.original.enrollDate)}
          </span>
        ),
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            {writeAllowed && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-destructive hover:text-destructive"
                onClick={() => setRemoveStudentTarget(row.original)}
                aria-label={`Keluarkan ${row.original.student.name} dari Kelas Ini`}
              >
                <UserMinus size={14} className="md:mr-1" />
                {/* Icon-only below md so the roster fits 390px without scrolling sideways. */}
                <span className="sr-only text-xs md:not-sr-only">Keluarkan</span>
              </Button>
            )}
          </div>
        ),
      },
    ],
    [writeAllowed],
  );

  async function removeStudent() {
    if (!removeStudentTarget) return;
    const studentId = removeStudentTarget.student.id;
    const res = await fetch(
      `/api/admin/classes/${classId}/enrollments?studentId=${studentId}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      toast.success("Siswa dikeluarkan");
      setRemoveStudentTarget(null);
      onChanged();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Gagal mengeluarkan siswa");
    }
  }

  return (
    <>
      <DossierSection
        id={SECTION_ROSTER}
        label="Daftar Siswa"
        badge={
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {enrolledCount} siswa
          </span>
        }
        open={open}
        onOpenChange={onOpenChange}
        actions={
          writeAllowed ? (
            <Button size="sm" variant="ghost" onClick={() => setAddStudentOpen(true)}>
              <Plus size={12} className="mr-1" aria-hidden="true" /> Tambah Siswa
            </Button>
          ) : undefined
        }
      >
        <p className="mb-3 text-small text-muted-foreground">
          {enrolledCount} siswa aktif dari kapasitas {capacity}.
        </p>
        <DataTable
          columns={rosterColumns}
          data={enrollments}
          emptyTitle="Belum ada siswa terdaftar di kelas ini."
          emptyDescription="Siswa yang terdaftar di kelas ini akan tampil di sini."
        />
      </DossierSection>

      <AddStudentDialog
        open={addStudentOpen}
        onOpenChange={setAddStudentOpen}
        classId={classId}
        onAdded={onChanged}
      />

      <ConfirmDialog
        open={!!removeStudentTarget}
        onOpenChange={(v) => !v && setRemoveStudentTarget(null)}
        title="Keluarkan siswa dari kelas?"
        description={
          removeStudentTarget
            ? `${removeStudentTarget.student.name} akan dikeluarkan dari ${classDisplayName}. Pendaftaran akan ditandai Keluar.`
            : ""
        }
        confirmLabel="Keluarkan dari Kelas Ini"
        destructive
        onConfirm={removeStudent}
      />
    </>
  );
}
