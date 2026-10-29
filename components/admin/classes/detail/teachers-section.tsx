"use client";

import { useMemo, useState } from "react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DossierSection } from "@/components/admin/dossier-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { formatDateShort } from "@/lib/format";

import { AddTeacherDialog } from "./add-teacher-dialog";
import type { TeacherOptionsStatus } from "./teacher-option-items";
import { ROLE_LABEL, SECTION_TEACHERS, type ClassDetail, type Employee } from "./types";

type Assignment = ClassDetail["teachingAssignments"][number];

/**
 * "Guru Pengajar" dossier section: the teacher table, its "Tambah Guru
 * Pengajar" dialog, and the "Hapus" confirm — split out of
 * `app/admin/classes/[id]/client.tsx` (T2, 2026-09-27 admin-finish-standard
 * cycle). No behaviour change from the pre-split page.
 */
export function TeachersSection({
  classId,
  classDisplayName,
  teachingAssignments,
  employeeOptions,
  employeesTruncated,
  employeesStatus,
  onRetryEmployees,
  writeAllowed,
  open,
  onOpenChange,
  onChanged,
}: {
  classId: string;
  classDisplayName: string;
  teachingAssignments: Assignment[];
  employeeOptions: Employee[];
  employeesTruncated: boolean;
  employeesStatus: TeacherOptionsStatus;
  onRetryEmployees: () => void;
  writeAllowed: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [addTeacherOpen, setAddTeacherOpen] = useState(false);
  const [removeTeacherTarget, setRemoveTeacherTarget] = useState<Assignment | null>(null);

  const teacherColumns: ColumnDef<Assignment>[] = useMemo(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.employee.nama,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Nama" />
        ),
        cell: ({ row }) => (
          <span className="text-sm font-medium">
            {row.original.employee.nama}
          </span>
        ),
      },
      {
        id: "role",
        accessorFn: (r) => r.role,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Peran" />
        ),
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs">
            {ROLE_LABEL[row.original.role]}
          </Badge>
        ),
      },
      {
        id: "createdAt",
        accessorFn: (r) => r.createdAt,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tgl Ditugaskan" />
        ),
        meta: { priority: "low" },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDateShort(row.original.createdAt)}
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
                onClick={() => setRemoveTeacherTarget(row.original)}
              >
                <Trash2 size={14} className="mr-1" />
                <span className="text-xs">Hapus</span>
              </Button>
            )}
          </div>
        ),
      },
    ],
    [writeAllowed],
  );

  async function removeTeacher() {
    if (!removeTeacherTarget) return;
    const employeeId = removeTeacherTarget.employee.id;
    const res = await fetch(
      `/api/admin/classes/${classId}/teaching-assignments?employeeId=${employeeId}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      toast.success("Guru dihapus dari kelas");
      setRemoveTeacherTarget(null);
      onChanged();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Gagal menghapus guru");
    }
  }

  return (
    <>
      <DossierSection
        id={SECTION_TEACHERS}
        label="Guru Pengajar"
        badge={
          <Badge variant="neutral">
            {teachingAssignments.length} guru
          </Badge>
        }
        open={open}
        onOpenChange={onOpenChange}
        actions={
          writeAllowed ? (
            <Button size="sm" variant="ghost" onClick={() => setAddTeacherOpen(true)}>
              <Plus size={12} className="mr-1" aria-hidden="true" /> Tambah Guru Pengajar
            </Button>
          ) : undefined
        }
      >
        <p className="mb-3 text-small text-muted-foreground">
          Wali kelas + asisten.
        </p>
        <DataTable
          columns={teacherColumns}
          data={teachingAssignments}
          emptyTitle="Belum ada guru ditugaskan."
          emptyDescription="Guru yang ditugaskan mengajar kelas ini akan tampil di sini."
        />
      </DossierSection>

      <AddTeacherDialog
        open={addTeacherOpen}
        onOpenChange={setAddTeacherOpen}
        classId={classId}
        employeeOptions={employeeOptions}
        employeesTruncated={employeesTruncated}
        employeesStatus={employeesStatus}
        onRetryEmployees={onRetryEmployees}
        onAdded={onChanged}
      />

      <ConfirmDialog
        open={!!removeTeacherTarget}
        onOpenChange={(v) => !v && setRemoveTeacherTarget(null)}
        title="Hapus guru dari kelas?"
        description={
          removeTeacherTarget
            ? `${removeTeacherTarget.employee.nama} (${ROLE_LABEL[removeTeacherTarget.role]}) akan dihapus dari ${classDisplayName}.`
            : ""
        }
        confirmLabel="Hapus"
        destructive
        onConfirm={removeTeacher}
      />
    </>
  );
}
