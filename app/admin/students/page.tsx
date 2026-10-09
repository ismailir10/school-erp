"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useWatch, type Control } from "react-hook-form";
import type * as z4 from "zod/v4/core";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "sonner";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { STUDENT_STATUS_OPTIONS } from "@/lib/constants/filter-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { SectionHeading } from "@/components/ui/section-heading";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Plus, Users, GraduationCap, UserCheck, Download } from "lucide-react";
import { StudentExportDialog } from "@/components/admin/student-export-dialog";
import { DISPLAY_TIME_ZONE, formatDateShort } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { LIVING_WITH_OPTIONS, LIVING_WITH_LABELS } from "@/lib/constants/parent-options";
import { pickPrimaryEnrollment } from "@/lib/enrollment/active";
import { studentFormSchema } from "@/lib/validations/student";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyStudentErrors, sendStudentJson, StudentRequestError } from "@/components/admin/students/student-request";
import { STUDENT_LIST_QUERY_KEY } from "@/components/admin/students/list-query";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type Student = {
  id: string;
  name: string;
  nickname: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  status: string;
  nis: string | null;
  nisn: string | null;
  notes: string | null;
  photoUrl: string | null;
  createdAt: string;
  guardians: { parent: { id: string; name: string; phone: string | null } }[];
  enrollments: {
    id: string;
    enrollDate: string;
    classSection: { name: string; program: { name: string; type: string } };
  }[];
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type StudentFormValues = z4.input<typeof studentFormSchema>;
type StudentFormOutput = z4.output<typeof studentFormSchema>;

const EMPTY_CREATE_FORM: StudentFormValues = {
  name: "",
  nickname: "",
  gender: "",
  dateOfBirth: "",
  address: "",
  nis: "",
  nisn: "",
  birthPlace: "",
  nik: "",
  kkNumber: "",
  livingWith: "",
  notes: "",
  // Admin-created rows default ACTIVE; the Status section lets backfill set
  // GRADUATED / WITHDRAWN / INACTIVE without a follow-up PUT.
  status: "ACTIVE",
};

// ------------------------------------------------------------------
// Shared form body — reused by Dialog (desktop) + Sheet (mobile)
// for both Create and Edit
// ------------------------------------------------------------------

function StudentFormBody({
  control,
  mode,
}: {
  control: Control<StudentFormValues, unknown, StudentFormOutput>;
  /**
   * Create mode keeps all four statuses (historical-import intent — see
   * EMPTY_CREATE_FORM comment above). Edit mode never lets GRADUATED/WITHDRAWN
   * be set or changed here: those lifecycle transitions run through the
   * dedicated Luluskan/Keluarkan actions on the detail page (graduationDate +
   * enrollment cascade), which a plain status PUT bypasses — the API now
   * rejects GRADUATED on PUT.
   */
  mode: "create" | "edit";
}) {
  const status = useWatch({ control, name: "status" });
  const lockedLifecycle = mode === "edit" && (status === "GRADUATED" || status === "WITHDRAWN");
  return (
    <div className="space-y-field">
      <SectionHeading label="Data Anak" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-field">
        <FormField
          control={control}
          name="name"
          label="Nama Lengkap"
          required
          id="student-name"
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} placeholder="Aisyah Putri" autoFocus />
          )}
        />
        <FormField
          control={control}
          name="nickname"
          label="Nama Panggilan"
          id="student-nickname"
          render={({ field, controlProps }) => (
            <Input
              {...field}
              {...controlProps}
              value={(field.value as string | undefined) ?? ""}
              placeholder="Aisyah"
            />
          )}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-field">
        <FormField
          control={control}
          name="gender"
          label="Jenis Kelamin"
          id="student-gender"
          render={({ field, controlProps }) => (
            <Select
              value={(field.value as string | undefined) ?? ""}
              onValueChange={(v) => v != null && field.onChange(v)}
            >
              <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="L">Laki-laki</SelectItem>
                <SelectItem value="P">Perempuan</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        <FormField
          control={control}
          name="dateOfBirth"
          label="Tanggal Lahir"
          id="student-dob"
          render={({ field, controlProps }) => (
            <DatePicker
              {...controlProps}
              value={(field.value as string | undefined) ?? ""}
              onChange={field.onChange}
              max={getTodayInTimezone(DISPLAY_TIME_ZONE)}
            />
          )}
        />
      </div>

      <FormField
        control={control}
        name="address"
        label="Alamat"
        id="student-address"
        render={({ field, controlProps }) => (
          <Textarea
            {...field}
            {...controlProps}
            value={(field.value as string | undefined) ?? ""}
            placeholder="Alamat tempat tinggal"
            rows={2}
          />
        )}
      />

      <FormField
        control={control}
        name="notes"
        label="Catatan"
        id="student-notes"
        render={({ field, controlProps }) => (
          <Textarea
            {...field}
            {...controlProps}
            value={(field.value as string | undefined) ?? ""}
            placeholder="Alergi, kebutuhan khusus, dll."
            rows={2}
          />
        )}
      />

      <div className="pt-2"><SectionHeading label="Identitas Resmi" /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-field">
        <FormField
          control={control}
          name="nis"
          label="NIS"
          id="student-nis"
          render={({ field, controlProps }) => (
            <Input
              {...field}
              {...controlProps}
              value={(field.value as string | undefined) ?? ""}
              placeholder="Nomor Induk Siswa"
            />
          )}
        />
        <FormField
          control={control}
          name="nisn"
          label="NISN"
          id="student-nisn"
          render={({ field, controlProps }) => (
            <Input
              {...field}
              {...controlProps}
              value={(field.value as string | undefined) ?? ""}
              placeholder="Nomor Induk Siswa Nasional"
            />
          )}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-field">
        <FormField
          control={control}
          name="birthPlace"
          label="Tempat Lahir"
          id="student-birth-place"
          render={({ field, controlProps }) => (
            <Input
              {...field}
              {...controlProps}
              value={(field.value as string | undefined) ?? ""}
              placeholder="Kota kelahiran"
            />
          )}
        />
        <FormField
          control={control}
          name="nik"
          label="NIK"
          id="student-nik"
          render={({ field, controlProps }) => (
            <Input
              {...field}
              {...controlProps}
              value={(field.value as string | undefined) ?? ""}
              placeholder="Nomor Induk Kependudukan"
            />
          )}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-field">
        <FormField
          control={control}
          name="kkNumber"
          label="No. KK"
          id="student-kk-number"
          render={({ field, controlProps }) => (
            <Input
              {...field}
              {...controlProps}
              value={(field.value as string | undefined) ?? ""}
              placeholder="Nomor Kartu Keluarga"
            />
          )}
        />
        <FormField
          control={control}
          name="livingWith"
          label="Tinggal Dengan"
          id="student-living-with"
          render={({ field, controlProps }) => (
            <Select
              value={(field.value as string | undefined) || undefined}
              onValueChange={(v) => v != null && field.onChange(v)}
              items={LIVING_WITH_LABELS}
            >
              <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih" /></SelectTrigger>
              <SelectContent>
                {LIVING_WITH_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="pt-2"><SectionHeading label="Status" /></div>
      <FormField
        control={control}
        name="status"
        label="Status"
        id="student-status"
        render={({ field, controlProps }) => (
          <>
            <Select
              value={field.value as string}
              onValueChange={(v) => v != null && field.onChange(v)}
              disabled={lockedLifecycle}
            >
              <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue /></SelectTrigger>
              <SelectContent>
                {lockedLifecycle ? (
                  <SelectItem value={field.value as string}>
                    {field.value === "GRADUATED" ? "Lulus" : "Keluar"}
                  </SelectItem>
                ) : (
                  <>
                    <SelectItem value="ACTIVE">Aktif</SelectItem>
                    <SelectItem value="INACTIVE">Nonaktif</SelectItem>
                    {mode === "create" && (
                      <>
                        <SelectItem value="GRADUATED">Lulus</SelectItem>
                        <SelectItem value="WITHDRAWN">Keluar</SelectItem>
                      </>
                    )}
                  </>
                )}
              </SelectContent>
            </Select>
            {lockedLifecycle && (
              <p className="text-xs text-muted-foreground mt-1.5">
                Status lulus/keluar diubah melalui aksi Luluskan atau Keluarkan di halaman detail siswa.
              </p>
            )}
          </>
        )}
      />
    </div>
  );
}

// ------------------------------------------------------------------
// Columns definition
// ------------------------------------------------------------------

const columns: ColumnDef<Student>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Nama" />
    ),
    cell: ({ row }) => {
      const s = row.original;
      return (
        <DataTableLinkCell
          href={`/admin/students/${s.id}`}
          className="gap-3"
          description={
            <DataTableMobileMeta>
              <span>
                {s.enrollments.length === 0
                  ? "Belum terdaftar"
                  : s.enrollments.map((e) => `${e.classSection.program.name} · ${e.classSection.name}`).join(" + ")}
              </span>
              <StatusBadge status={s.status} />
            </DataTableMobileMeta>
          }
        >
          <span className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
              {s.photoUrl ? (
                // Auth-proxied — never a public filesystem path. Lazy-load to
                // keep large lists snappy on mid-range Android.
                // eslint-disable-next-line @next/next/no-img-element -- same-origin, cookie-authenticated URL; next/image's server-side optimizer cannot send the session cookie
                <img
                  src={`/api/students/${s.id}/photo`}
                  alt={`Foto ${s.name}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="text-primary text-xs font-bold">
                  {s.name[0]}
                </span>
              )}
            </span>
            <span className="whitespace-normal">
              {s.name}
              {s.nickname && (
                <span className="text-xs text-muted-foreground ml-1.5">
                  ({s.nickname})
                </span>
              )}
            </span>
          </span>
        </DataTableLinkCell>
      );
    },
  },
  {
    id: "program",
    header: "Program / Kelas",
    meta: { priority: "low" },
    cell: ({ row }) => {
      const enrollments = row.original.enrollments;
      if (enrollments.length === 0) {
        return (
          <span className="text-xs text-muted-foreground italic">
            Belum terdaftar
          </span>
        );
      }
      // Primary (sekolah/SEMESTER) enrollment first, then any other ACTIVE
      // enrollment (e.g. daycare) — a dual-enrolled student shows both
      // classes instead of an arbitrary one.
      const primary =
        enrollments.length <= 1 ? enrollments[0] : pickPrimaryEnrollment(enrollments);
      const ordered = primary
        ? [primary, ...enrollments.filter((e) => e.id !== primary.id)]
        : enrollments;
      // One placement per line rather than a " + "-joined run: TableCell is
      // whitespace-nowrap, so joining them inline forced this column wide
      // enough to push the page past the viewport. Stacking also reads
      // better than mixing "·" (program/class) with "+" (placements) in one
      // string. A single-enrollment row renders exactly as it did before.
      return (
        <div className="flex flex-col gap-0.5 whitespace-normal text-sm">
          {ordered.map((e) => (
            <span key={e.id}>
              {e.classSection.program.name}{" "}
              <span className="text-muted-foreground">· {e.classSection.name}</span>
            </span>
          ))}
        </div>
      );
    },
  },
  {
    id: "guardian",
    header: "Wali",
    meta: { priority: "low" },
    cell: ({ row }) => {
      // The API returns the primary guardian, or the first active one when no
      // primary is flagged. There is no row-level click handler on this table
      // (navigation goes through the Lihat action), so the link needs no
      // stopPropagation.
      const g = row.original.guardians[0];
      if (!g) return <span className="text-xs text-muted-foreground">—</span>;
      return (
        <Link
          href={`/admin/guardians/${g.parent.id}`}
          className="block rounded-md px-2 -mx-2 py-1 -my-1 text-sm hover:bg-accent/50 transition-colors"
        >
          <span>{g.parent.name}</span>
          {g.parent.phone && (
            <span className="text-xs text-muted-foreground ml-1.5">
              {g.parent.phone}
            </span>
          )}
        </Link>
      );
    },
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Terdaftar" />
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
    // Status sits under the name below `md` (DataTableMobileMeta above).
    meta: { priority: "low" },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
];

// ------------------------------------------------------------------
// Page component
// ------------------------------------------------------------------

export default function StudentsPage() {
  const router = useRouter();
  // Search, status filter and page live in the URL (?q=&status=&page=) so a
  // Back from a student's detail page lands on the same slice of the list.
  // Read once for the initial state; the effect below writes changes back.
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status") ?? "all";
  const initialPage = Number.parseInt(searchParams.get("page") ?? "", 10);
  const [initialSearch] = useState(() => searchParams.get("q") ?? "");
  const [data, setData] = useState<Student[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: Number.isFinite(initialPage) && initialPage > 1 ? initialPage : 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const searchRef = useRef(initialSearch);
  const [status, setStatus] = useState(
    STUDENT_STATUS_OPTIONS.some((o) => o.value === initialStatus) ? initialStatus : "all",
  );
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [stats, setStats] = useState({ total: 0, active: 0, graduated: 0 });

  // Create dialog state
  const [exportOpen, setExportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const createFormId = useId();
  const createForm = useZodForm(studentFormSchema, { defaultValues: EMPTY_CREATE_FORM });

  // Deactivate dialog state
  const [deactivateTarget, setDeactivateTarget] = useState<Student | null>(null);

  // Edit dialog state
  const [editTarget, setEditTarget] = useState<Student | null>(null);
  const editFormId = useId();
  const editForm = useZodForm(studentFormSchema, { defaultValues: EMPTY_CREATE_FORM });

  // Single groupBy endpoint, not three pageSize=1 list calls. Re-run after
  // any mutation (create/edit/status toggle) so the cards don't go stale.
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/students/stats");
      if (!res.ok) return;
      const data = (await res.json()) as {
        total: number;
        active: number;
        graduated: number;
      };
      setStats(data);
    } catch (err) {
      console.error("[students] stats fetch failed", err);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
        sortBy,
        sortOrder,
      });
      if (search) params.set("search", search);
      if (status !== "all") params.set("status", status);

      const res = await fetch(`/api/students?${params}`);
      const json = await res.json();
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      toast.error("Gagal memuat data siswa");
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, status, sortBy, sortOrder]);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  // Mirror the list state into the URL. `replace`, not `push`: typing a
  // search must not stack a history entry per keystroke.
  const currentQuery = searchParams.toString();
  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (status !== "all") next.set("status", status);
    if (pagination.page > 1) next.set("page", String(pagination.page));
    const qs = next.toString();
    try {
      sessionStorage.setItem(STUDENT_LIST_QUERY_KEY, qs);
    } catch {
      // Storage can be blocked; the detail page's back link then falls back to the bare list.
    }
    if (qs === currentQuery) return;
    router.replace(qs ? `/admin/students?${qs}` : "/admin/students", { scroll: false });
  }, [search, status, pagination.page, currentQuery, router]);

  // The toolbar debounces its search box (300 ms) and also reports the
  // initial value once on mount; only a real change may reset the page.
  const handleSearchChange = useCallback((value: string) => {
    if (value === searchRef.current) return;
    searchRef.current = value;
    setSearch(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const handleStatusChange = useCallback((value: string) => {
    setStatus(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setPagination((p) => ({ ...p, page }));
  }, []);

  const handlePageSizeChange = useCallback((pageSize: number) => {
    setPagination((p) => ({ ...p, page: 1, pageSize }));
  }, []);

  // DataTable reports its default sort once on mount; that echo must not
  // knock a restored ?page= back to 1, so only a real change resets it.
  const sortRef = useRef({ field: "createdAt", order: "desc" as "asc" | "desc" });
  const handleSortChange = useCallback((field: string, order: "asc" | "desc") => {
    if (sortRef.current.field === field && sortRef.current.order === order) return;
    sortRef.current = { field, order };
    setSortBy(field);
    setSortOrder(order);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  async function handleStatusToggle() {
    if (!deactivateTarget) return;
    const newStatus = deactivateTarget.status === "INACTIVE" ? "ACTIVE" : "INACTIVE";
    const res = await fetch(`/api/students/${deactivateTarget.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Gagal mengubah status siswa");
      return;
    }
    toast.success(newStatus === "ACTIVE" ? "Siswa diaktifkan kembali" : "Siswa dinonaktifkan");
    setDeactivateTarget(null);
    fetchStudents();
    fetchStats();
  }

  async function openEdit(student: Student) {
    // The list-row Student type omits the demographic fields the edit dialog
    // now exposes (address, birthPlace, nik, kkNumber, livingWith). Seeding
    // those from the row would set them to empty strings; saving would then
    // clobber the real DB values to null. Fetch the full record first.
    setEditTarget(student);
    try {
      const res = await fetch(`/api/students/${student.id}`);
      if (!res.ok) { toast.error("Gagal memuat data siswa"); return; }
      const full = (await res.json()) as {
        name: string; nickname: string | null; gender: string | null;
        dateOfBirth: string | null; address: string | null; notes: string | null;
        nis: string | null; nisn: string | null; birthPlace: string | null;
        nik: string | null; kkNumber: string | null; livingWith: string | null;
        status: string;
      };
      editForm.reset({
        name: full.name,
        nickname: full.nickname ?? "",
        gender: full.gender ?? "",
        dateOfBirth: full.dateOfBirth ?? "",
        address: full.address ?? "",
        nis: full.nis ?? "",
        nisn: full.nisn ?? "",
        birthPlace: full.birthPlace ?? "",
        nik: full.nik ?? "",
        kkNumber: full.kkNumber ?? "",
        livingWith: full.livingWith ?? "",
        notes: full.notes ?? "",
        status: full.status as StudentFormValues["status"],
      });
    } catch {
      toast.error("Terjadi kesalahan jaringan");
    }
  }

  const handleEditSave = editForm.handleSubmit(async (values) => {
    if (!editTarget) return;
    try {
      await sendStudentJson(
        `/api/students/${editTarget.id}`,
        { method: "PUT", body: values },
        "Gagal memperbarui data siswa",
      );
      toast.success("Data siswa diperbarui");
      setEditTarget(null);
      fetchStudents();
      fetchStats();
    } catch (err) {
      applyStudentErrors(editForm, err, "Gagal memperbarui data siswa");
    }
  });

  // A 409 DUPLICATE_STUDENT (same name + date of birth) is advisory: the admin
  // may know these are two children (twins, a sibling with a repeated name).
  // The values ride along so "Tetap simpan" can re-POST them verbatim.
  const [duplicate, setDuplicate] = useState<{
    message: string;
    existingId: string | null;
    values: StudentFormOutput;
  } | null>(null);

  async function submitCreate(values: StudentFormOutput, confirmDuplicate: boolean): Promise<boolean> {
    try {
      const student = await sendStudentJson<{ id: string }>(
        "/api/students",
        { method: "POST", body: confirmDuplicate ? { ...values, confirmDuplicate: true } : values },
        "Gagal menambahkan siswa",
      );
      toast.success("Siswa ditambahkan");
      setCreateOpen(false);
      createForm.reset(EMPTY_CREATE_FORM);
      fetchStats();
      router.push(`/admin/students/${student.id}`);
      return true;
    } catch (err) {
      if (!confirmDuplicate && err instanceof StudentRequestError && err.code === "DUPLICATE_STUDENT") {
        setDuplicate({ message: err.message, existingId: err.existingId ?? null, values });
        return false;
      }
      applyStudentErrors(createForm, err, "Gagal menambahkan siswa");
      return false;
    }
  }

  const handleCreateSave = createForm.handleSubmit((values) => submitCreate(values, false).then(() => undefined));

  const columnsWithActions = useMemo<ColumnDef<Student>[]>(
    () => [
      ...columns,
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const s = row.original;
          // GRADUATED/WITHDRAWN are terminal lifecycle states reached via the
          // dedicated Luluskan/Keluarkan actions on the detail page (with
          // graduationDate + enrollment cascade). Nonaktifkan/Aktifkan here
          // only toggle the binary ACTIVE<->INACTIVE soft-delete state — never
          // offer them for GRADUATED/WITHDRAWN rows.
          const isActive = s.status === "ACTIVE";
          const isInactive = s.status === "INACTIVE";
          return (
            <DataTableRowActions
              rowLabel={s.name}
              onEdit={() => openEdit(s)}
              onDeactivate={isActive ? () => setDeactivateTarget(s) : undefined}
              onActivate={isInactive ? () => setDeactivateTarget(s) : undefined}
              isActive={isActive}
            />
          );
        },
      },
    ],
    // Intentionally []: the columns must keep one identity or every row cell
    // remounts and closes its open action menu. openEdit only calls state setters,
    // `editForm.reset` and `toast`, all stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <>
      <PageHeader
        title="Siswa"
        description={search.trim() !== "" || status !== "all" ? `${pagination.total} siswa cocok` : `${pagination.total} siswa terdaftar`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setExportOpen(true)}>
              <Download size={14} className="mr-1.5" /> Unduh Data
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} className="mr-1.5" /> Tambah Siswa
            </Button>
          </div>
        }
      />

      <StudentExportDialog open={exportOpen} onOpenChange={setExportOpen} />

      <StatsCardsRow cols={3}>
        <StatCard label="Total Siswa" value={stats.total} icon={Users} color="primary" index={0} />
        <StatCard label="Aktif" value={stats.active} icon={UserCheck} color="success" index={1} />
        <StatCard label="Lulus" value={stats.graduated} icon={GraduationCap} color="warning" index={2} />
      </StatsCardsRow>

      <DataTableToolbar
        searchPlaceholder="Cari nama siswa..."
        defaultValue={initialSearch}
        onSearchChange={handleSearchChange}
        filters={[
          {
            key: "status",
            label: "Status",
            value: status,
            onChange: handleStatusChange,
            options: STUDENT_STATUS_OPTIONS,
          },
        ]}
      />

      <DataTable
        columns={columnsWithActions}
        data={data}
        pagination={pagination}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onSortChange={handleSortChange}
        defaultSort={{ field: "createdAt", order: "desc" }}
        loading={loading}
        emptyTitle="Belum ada siswa terdaftar"
        emptyDescription="Mulai dengan menambahkan siswa baru."
        isFiltered={search.trim() !== "" || status !== "all"}
      />

      {/* Deactivate / Activate ConfirmDialog */}
      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(o) => !o && setDeactivateTarget(null)}
        title={deactivateTarget?.status === "INACTIVE" ? `Aktifkan ${deactivateTarget?.name}?` : `Nonaktifkan ${deactivateTarget?.name}?`}
        description={deactivateTarget?.status === "INACTIVE" ? "Siswa akan dikembalikan ke status aktif." : "Siswa akan dinonaktifkan. Pendaftaran kelas aktif dicabut dan tagihan yang belum dibayar dibatalkan. Siswa bisa diaktifkan kembali kapan saja."}
        confirmLabel={deactivateTarget?.status === "INACTIVE" ? "Aktifkan" : "Nonaktifkan"}
        onConfirm={handleStatusToggle}
        destructive={deactivateTarget?.status !== "INACTIVE"}
      />

      {/* Edit Student */}
      <ResponsiveFormDialog
        open={!!editTarget}
        onOpenChange={(open) => { if (!editForm.formState.isSubmitting && !open) setEditTarget(null); }}
        title="Edit Siswa"
        size="lg"
        footer={
          <FormDialogFooter
            formId={editFormId}
            pending={editForm.formState.isSubmitting}
            onCancel={() => setEditTarget(null)}
            submitLabel="Simpan Perubahan"
          />
        }
      >
        <form id={editFormId} onSubmit={handleEditSave} noValidate className="space-y-field">
          <FormRootError formState={editForm.formState} />
          <StudentFormBody control={editForm.control} mode="edit" />
        </form>
      </ResponsiveFormDialog>

      {/* Same name + date of birth already exists — confirm before saving a second one */}
      <ConfirmDialog
        open={duplicate !== null}
        onOpenChange={(o) => !o && setDuplicate(null)}
        title="Siswa ini mungkin sudah terdaftar"
        description={duplicate?.message}
        confirmLabel="Tetap simpan"
        onConfirm={async () => {
          if (!duplicate) return;
          await submitCreate(duplicate.values, true);
        }}
      >
        {duplicate?.existingId && (
          <Link
            href={`/admin/students/${duplicate.existingId}`}
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            Lihat siswa
          </Link>
        )}
      </ConfirmDialog>

      {/* Create Student */}
      <ResponsiveFormDialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!createForm.formState.isSubmitting) {
            setCreateOpen(open);
            if (!open) createForm.reset(EMPTY_CREATE_FORM);
          }
        }}
        title="Tambah Siswa"
        size="lg"
        footer={
          <FormDialogFooter
            formId={createFormId}
            pending={createForm.formState.isSubmitting}
            onCancel={() => { setCreateOpen(false); createForm.reset(EMPTY_CREATE_FORM); }}
            submitLabel="Tambah Siswa"
          />
        }
      >
        <form id={createFormId} onSubmit={handleCreateSave} noValidate className="space-y-field">
          <FormRootError formState={createForm.formState} />
          <StudentFormBody control={createForm.control} mode="create" />
        </form>
      </ResponsiveFormDialog>
    </>
  );
}
