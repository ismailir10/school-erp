"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { DetailPageHeader, type DetailPageHeaderAction } from "@/components/admin/detail-page-header";
import { DetailPageSkeleton } from "@/components/admin/detail-page-skeleton";
import { DossierNav, DossierSection, type DossierSectionDef } from "@/components/admin/dossier-section";
import { DetailRail, RailCard, RailKV, RailStatTiles } from "@/components/admin/detail-rail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { StatusBadge } from "@/components/ui/status-badge";
import { SalaryEditor, type SalaryComponentRow } from "@/components/admin/employees/salary-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { FormField, FormRootError } from "@/components/ui/form";
import { toast } from "sonner";
import { Save, Pencil, X, User, Mail, Phone, Briefcase, MapPin, Calendar, CreditCard, Shield } from "lucide-react";
import { DISPLAY_TIME_ZONE, formatDateShort, formatMonthLabel, formatTime } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { employeeEditFormSchema } from "@/lib/validations/employee";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { PeriodStepper } from "@/components/ui/period-stepper";

type Employee = {
  id: string; kode: string; nama: string; formalName: string | null; email: string;
  noHp: string | null; jabatan: string; campusId: string; hireDate: string;
  status: string; bankAccountNo?: string | null; bankName?: string | null; bpjsEnrolled?: boolean;
  leaveBalanceAnnual?: number; leaveBalanceSick?: number;
  leaveUsedAnnual?: number; leaveUsedSick?: number;
  campus: { name: string };
};
// Remaining leave = allowance minus APPROVED days used this year. Falls back
// to the bare allowance when the server sent no usage figure.
function leaveRemaining(total?: number, used?: number) {
  return total == null || used == null ? null : Math.max(0, total - used);
}
function leaveBalanceText(total?: number, used?: number) {
  if (total == null) return "—";
  const left = leaveRemaining(total, used);
  return left == null ? `${total} hari` : `Sisa ${left} dari ${total} hari`;
}
function leaveBalanceTile(total?: number, used?: number) {
  if (total == null) return { value: "—", hint: "hari" };
  const left = leaveRemaining(total, used);
  return left == null ? { value: total, hint: "hari" } : { value: left, hint: `sisa dari ${total} hari` };
}

type SalaryValue = {
  id: string; value: number; componentDefId: string;
  componentDef: { code: string; label: string; category: string; calcType: string; sortOrder: number };
};
type Campus = { id: string; name: string };

const INDONESIAN_BANKS = ["Bank BSI", "BRI", "BCA", "Bank Mandiri", "BNI", "CIMB Niaga", "BJB", "Bank Muamalat", "Bank Mega", "Bank Permata", "Lainnya"];

/**
 * Section ids double as DOM anchor targets for `DossierNav` (Recipe 2b,
 * patterns.md). English identifiers per the T6c migration — copy stays
 * Indonesian via each `DossierSection`'s `label`.
 */
const SECTION_PROFILE = "profile";
const SECTION_EMPLOYMENT = "employment";
const SECTION_LEAVE = "leave";
const SECTION_SALARY = "salary";
const SECTION_ATTENDANCE = "attendance";

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [salaryValues, setSalaryValues] = useState<SalaryValue[] | null>(null);
  const [salaryComponents, setSalaryComponents] = useState<SalaryComponentRow[] | null>(null);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSalary, setSavingSalary] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  // F-18: restore confirm dialog state. Symmetrical to deactivate.
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const editForm = useZodForm(employeeEditFormSchema, {
    defaultValues: {
      nama: "", formalName: "", email: "", noHp: "", jabatan: "", campusId: "", hireDate: "",
      bankName: "", bankAccountNo: "", bpjsEnrolled: false, leaveBalanceAnnual: "", leaveBalanceSick: "",
    },
  });

  // --- Section open/collapse state ---
  // Kehadiran starts closed: it is the one section that costs a second
  // request, and opening it is what triggers the fetch (same rule as the
  // student dossier's Kehadiran section).
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => ({
    [SECTION_PROFILE]: true,
    [SECTION_EMPLOYMENT]: true,
    [SECTION_LEAVE]: true,
    [SECTION_SALARY]: true,
    [SECTION_ATTENDANCE]: false,
  }));

  const setSectionOpen = useCallback((sectionId: string, open: boolean) => {
    setOpenSections((prev) => ({ ...prev, [sectionId]: open }));
  }, []);

  /** Nav click: expand first (a collapsed target is nothing to scroll to), then scroll. */
  const jumpToSection = useCallback(
    (sectionId: string) => {
      setSectionOpen(sectionId, true);
      requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [setSectionOpen],
  );

  /**
   * `#attendance`, `#salary` … — every section id is already a DOM anchor,
   * but the browser's own hash scroll fires before the section exists and
   * lands on nothing when the section is collapsed (Kehadiran starts
   * closed). Honouring the hash ourselves (same trick as the student and
   * guardian dossiers) is what makes a link straight into a specific
   * section actually work.
   */
  const hashHandled = useRef(false);
  useEffect(() => {
    if (loading || hashHandled.current) return;
    const target = window.location.hash.replace(/^#/, "");
    if (!target) { hashHandled.current = true; return; }
    if (!document.getElementById(target)) return;
    hashHandled.current = true;
    jumpToSection(target);
  }, [loading, jumpToSection]);

  const fetchEmployee = useCallback(async () => {
    try {
      const [emp, sal, comps, camps, pos] = await Promise.all([
        fetch(`/api/employees/${id}`).then(r => r.json()),
        fetch(`/api/employees/${id}/salary`).then(r => r.ok ? r.json() : null),
        // Every salary component, so components with no value row yet can be filled in (HR-3).
        fetch("/api/salary-components").then(r => r.ok ? r.json() : null).catch(() => null),
        fetch("/api/config/campuses").then(r => r.json()),
        fetch("/api/employees/positions").then(r => r.json()),
      ]);
      setEmployee(emp); setSalaryValues(sal); setSalaryComponents(Array.isArray(comps) ? comps : null); setCampuses(camps); setPositions(pos);
    } catch {
      toast.error("Gagal memuat data karyawan");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchEmployee(); }, [fetchEmployee]);

  function startEditing() {
    if (!employee) return;
    editForm.reset({ nama: employee.nama, formalName: employee.formalName ?? "", email: employee.email, noHp: employee.noHp ?? "", jabatan: employee.jabatan, campusId: employee.campusId, hireDate: employee.hireDate, bankName: employee.bankName ?? "", bankAccountNo: employee.bankAccountNo ?? "", bpjsEnrolled: employee.bpjsEnrolled ?? false, leaveBalanceAnnual: employee.leaveBalanceAnnual?.toString() ?? "", leaveBalanceSick: employee.leaveBalanceSick?.toString() ?? "" });
    setIsEditing(true);
  }

  const handleSave = editForm.handleSubmit(async (values) => {
    try {
      await sendJson(`/api/employees/${id}`, { method: "PUT", body: values }, "Gagal menyimpan");
      toast.success("Data karyawan disimpan");
      setIsEditing(false);
      const updated = await fetch(`/api/employees/${id}`).then(r => r.json());
      setEmployee(updated);
    } catch (err) {
      applyServerErrors(editForm, err, "Gagal menyimpan");
    }
  });

  async function handleSaveSalary(payload: { componentDefId: string; value: number | null }[]) {
    setSavingSalary(true);
    try {
      // The editor already coerces to numbers: Prisma serialises Decimal columns
      // as strings and the PUT schema requires `z.number()` (FIND-020-NEW).
      const res = await fetch(`/api/employees/${id}/salary`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success("Nilai gaji disimpan");
        // Refetch so newly created rows come back with their ids.
        const sal = await fetch(`/api/employees/${id}/salary`).then(r => r.ok ? r.json() : null).catch(() => null);
        if (sal) setSalaryValues(sal);
      } else {
        // Surface the Zod field error (validateBody returns `{ error, errors: [{ field, message }] }`)
        // so admins see *why* the save failed instead of a bare "Gagal menyimpan".
        let detail: string | undefined;
        try {
          const d = await res.json();
          detail = d?.errors?.[0]?.message ?? d?.error;
        } catch { /* non-JSON body — fall back to generic */ }
        toast.error(detail ?? "Gagal menyimpan");
      }
    } finally {
      setSavingSalary(false);
    }
  }

  async function handleDeactivate() {
    const res = await fetch(`/api/employees/${id}/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Gagal menonaktifkan karyawan");
      return;
    }
    toast.success("Karyawan dinonaktifkan");
    router.push("/admin/employees");
  }

  // F-18: restore handler — calls dedicated POST /restore endpoint, refetches
  // employee on success so the header flips back to ACTIVE state in-place
  // (no redirect — admin stays on the same detail page they came from).
  async function handleRestore() {
    const res = await fetch(`/api/employees/${id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Gagal mengaktifkan karyawan");
      return;
    }
    // Close the dialog FIRST so the network refetch doesn't keep it visible
    // on slow connections (mid-range Android + 4G is the deployment reality).
    setRestoreOpen(false);
    toast.success("Karyawan diaktifkan kembali");
    const updated = await fetch(`/api/employees/${id}`).then((r) => r.json());
    setEmployee(updated);
  }

  if (loading) return <DetailPageSkeleton />;
  if (!employee) return <EmptyState title="Karyawan tidak ditemukan" description="Silakan kembali ke daftar karyawan." />;

  const e = employee;
  const hasPayrollFields = "bankAccountNo" in e;

  const navSections: DossierSectionDef[] = [
    { id: SECTION_PROFILE, label: "Profil" },
    { id: SECTION_EMPLOYMENT, label: "Kepegawaian" },
    { id: SECTION_LEAVE, label: "Saldo Cuti" },
    // Listed only when the viewer holds payroll access — a nav entry that
    // scrolls to a section the server never sent is worse than no entry.
    ...(salaryValues !== null ? [{ id: SECTION_SALARY, label: "Gaji" }] : []),
    { id: SECTION_ATTENDANCE, label: "Kehadiran" },
  ];

  const editActions = isEditing ? (
    <>
      <Button size="sm" variant="outline" onClick={() => setIsEditing(false)} disabled={editForm.formState.isSubmitting}><X size={14} className="mr-1" /> Batal</Button>
      <Button size="sm" onClick={handleSave} disabled={editForm.formState.isSubmitting}><Save size={14} className="mr-1" /> {editForm.formState.isSubmitting ? "Menyimpan..." : "Simpan Profil"}</Button>
    </>
  ) : undefined;

  return (
    <>
      <DetailPageHeader
        backHref="/admin/employees"
        backLabel="Kembali ke Daftar Karyawan"
        title={e.nama}
        description={`${e.kode} · ${e.jabatan} · ${e.campus.name}`}
        badge={e.status !== "ACTIVE" ? <StatusBadge status="INACTIVE" /> : undefined}
        primaryActions={
          e.status === "ACTIVE"
            ? (!isEditing
                ? [{ label: "Ubah", icon: <Pencil size={14} aria-hidden="true" />, onClick: startEditing }]
                : []) as DetailPageHeaderAction[]
            : // F-18: when INACTIVE, surface an Aktifkan (restore) action so the
              // admin can re-activate without leaving the detail page. Uses the
              // dedicated POST /restore endpoint (idempotent + audited).
              [{ label: "Aktifkan", onClick: () => setRestoreOpen(true) }]
        }
        menuActions={
          e.status === "ACTIVE"
            ? [{ label: "Nonaktifkan", onClick: () => setDeactivateOpen(true), destructive: true }]
            : []
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <DossierNav sections={navSections} onJump={jumpToSection} />

          {/* ---------- Profil (Identitas + Kontak) ---------- */}
          <DossierSection
            id={SECTION_PROFILE}
            label="Profil"
            open={openSections[SECTION_PROFILE] ?? true}
            onOpenChange={(o) => setSectionOpen(SECTION_PROFILE, o)}
            actions={editActions}
          >
            {isEditing ? (
              /* ── EDIT MODE ─────────────────────────────────── */
              <div className="space-y-5">
                <FormRootError formState={editForm.formState} />
                <div>
                  <SectionHeading label="Identitas" />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field><FieldLabel htmlFor="employee-detail-code">Kode</FieldLabel><Input id="employee-detail-code" value={e.kode} disabled /></Field>
                    <FormField
                      control={editForm.control}
                      name="nama"
                      label="Nama"
                      required
                      id="employee-detail-nama"
                      render={({ field, controlProps }) => <Input {...field} {...controlProps} />}
                    />
                  </div>
                  <div className="mt-3">
                    <FormField
                      control={editForm.control}
                      name="formalName"
                      label="Nama Formal"
                      id="employee-detail-formal-name"
                      render={({ field, controlProps }) => <Input {...field} {...controlProps} value={field.value ?? ""} />}
                    />
                  </div>
                </div>

                <div>
                  <SectionHeading label="Kontak" />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      control={editForm.control}
                      name="email"
                      label="Email"
                      required
                      id="employee-detail-email"
                      render={({ field, controlProps }) => <Input {...field} {...controlProps} />}
                    />
                    <FormField
                      control={editForm.control}
                      name="noHp"
                      label="No. HP"
                      id="employee-detail-phone"
                      render={({ field, controlProps }) => <Input {...field} {...controlProps} value={field.value ?? ""} />}
                    />
                  </div>
                </div>
              </div>
            ) : (
              /* ── VIEW MODE ─────────────────────────────────── */
              <div className="space-y-section">
                {/* Identitas */}
                <div>
                  <SectionHeading label="Identitas" />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex items-center gap-3">
                      <User size={16} className="text-muted-foreground shrink-0" />
                      <div><p className="text-xs text-muted-foreground">Kode</p><p className="text-sm font-medium font-currency">{e.kode}</p></div>
                    </div>
                    <div className="flex items-center gap-3">
                      <User size={16} className="text-muted-foreground shrink-0" />
                      <div><p className="text-xs text-muted-foreground">Nama</p><p className="text-sm font-medium">{e.nama}</p></div>
                    </div>
                  </div>
                  {e.formalName && (
                    <div className="mt-2 ml-7"><p className="text-xs text-muted-foreground">Nama Formal</p><p className="text-sm">{e.formalName}</p></div>
                  )}
                </div>

                {/* Kontak */}
                <div>
                  <SectionHeading label="Kontak" />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex items-center gap-3">
                      <Mail size={16} className="text-muted-foreground shrink-0" />
                      <div className="min-w-0"><p className="text-xs text-muted-foreground">Email</p><p className="text-sm break-words">{e.email}</p></div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Phone size={16} className="text-muted-foreground shrink-0" />
                      <div className="min-w-0"><p className="text-xs text-muted-foreground">No. HP</p><p className="text-sm break-words">{e.noHp || "—"}</p></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </DossierSection>

          {/* ---------- Kepegawaian (Kepegawaian + Rekening & BPJS) ---------- */}
          <DossierSection
            id={SECTION_EMPLOYMENT}
            label="Kepegawaian"
            open={openSections[SECTION_EMPLOYMENT] ?? true}
            onOpenChange={(o) => setSectionOpen(SECTION_EMPLOYMENT, o)}
          >
            {isEditing ? (
              /* ── EDIT MODE ─────────────────────────────────── */
              <div className="space-y-5">
                <div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      control={editForm.control}
                      name="jabatan"
                      label="Jabatan"
                      required
                      id="employee-detail-position"
                      render={({ field, controlProps }) => (
                        <Select
                          value={field.value}
                          onValueChange={(v) => v && field.onChange(v)}
                          items={{
                            ...Object.fromEntries(positions.map((p) => [p, p])),
                            ...(!positions.includes(field.value) && field.value ? { [field.value]: field.value } : {}),
                          }}
                        >
                          <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih jabatan" /></SelectTrigger>
                          <SelectContent>
                            {positions.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                            {!positions.includes(field.value) && field.value && (
                              <SelectItem value={field.value}>{field.value}</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="campusId"
                      label="Kampus"
                      required
                      id="employee-detail-campus"
                      render={({ field, controlProps }) => (
                        <Select value={field.value} onValueChange={(v) => v && field.onChange(v)} items={campuses.map(c => ({ label: c.name, value: c.id }))}>
                          <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue /></SelectTrigger>
                          <SelectContent>{campuses.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                  <div className="mt-3">
                    <FormField
                      control={editForm.control}
                      name="hireDate"
                      label="Tanggal Masuk"
                      id="employee-detail-hire-date"
                      render={({ field, controlProps }) => (
                        <DatePicker {...controlProps} value={field.value} onChange={field.onChange} max={getTodayInTimezone(DISPLAY_TIME_ZONE)} />
                      )}
                    />
                  </div>
                </div>

                {hasPayrollFields && <div>
                  <SectionHeading label="Rekening & BPJS" />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      control={editForm.control}
                      name="bankName"
                      label="Bank"
                      id="employee-detail-bank"
                      render={({ field, controlProps }) => (
                        <Select value={field.value ?? ""} onValueChange={(v) => v && field.onChange(v)}>
                          <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih bank" /></SelectTrigger>
                          <SelectContent>
                            {INDONESIAN_BANKS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="bankAccountNo"
                      label="No. Rekening"
                      id="employee-detail-bank-account"
                      render={({ field, controlProps }) => <Input {...field} {...controlProps} value={field.value ?? ""} />}
                    />
                  </div>
                  <div className="mt-3">
                    <FormField
                      control={editForm.control}
                      name="bpjsEnrolled"
                      label="BPJS Terdaftar"
                      orientation="horizontal"
                      id="employee-detail-bpjs"
                      render={({ field, controlProps }) => (
                        <Checkbox {...controlProps} checked={!!field.value} onCheckedChange={(c) => field.onChange(!!c)} onBlur={field.onBlur} />
                      )}
                    />
                  </div>
                </div>}
              </div>
            ) : (
              /* ── VIEW MODE ─────────────────────────────────── */
              <div className="space-y-section">
                <div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex items-center gap-3">
                      <Briefcase size={16} className="text-muted-foreground shrink-0" />
                      <div><p className="text-xs text-muted-foreground">Jabatan</p><p className="text-sm font-medium">{e.jabatan}</p></div>
                    </div>
                    <div className="flex items-center gap-3">
                      <MapPin size={16} className="text-muted-foreground shrink-0" />
                      <div><p className="text-xs text-muted-foreground">Kampus</p><p className="text-sm">{e.campus.name}</p></div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <Calendar size={16} className="text-muted-foreground shrink-0" />
                    <div><p className="text-xs text-muted-foreground">Tanggal Masuk</p><p className="text-sm">{formatDateShort(e.hireDate)}</p></div>
                  </div>
                </div>

                {/* Rekening & BPJS — hidden when server stripped fields (SCHOOL_ADMIN) */}
                {hasPayrollFields && <div>
                  <SectionHeading label="Rekening & BPJS" />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex items-center gap-3">
                      <CreditCard size={16} className="text-muted-foreground shrink-0" />
                      <div><p className="text-xs text-muted-foreground">Bank</p><p className="text-sm">{e.bankName || "—"}</p></div>
                    </div>
                    <div className="flex items-center gap-3">
                      <CreditCard size={16} className="text-muted-foreground shrink-0" />
                      <div><p className="text-xs text-muted-foreground">No. Rekening</p><p className="text-sm font-currency">{e.bankAccountNo || "—"}</p></div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <Shield size={16} className="text-muted-foreground shrink-0" />
                    <div><p className="text-xs text-muted-foreground">BPJS</p><p className="text-sm">{e.bpjsEnrolled ? "Terdaftar" : "Tidak Terdaftar"}</p></div>
                  </div>
                </div>}
              </div>
            )}
          </DossierSection>

          {/* ---------- Saldo Cuti ---------- */}
          <DossierSection
            id={SECTION_LEAVE}
            label="Saldo Cuti"
            open={openSections[SECTION_LEAVE] ?? true}
            onOpenChange={(o) => setSectionOpen(SECTION_LEAVE, o)}
          >
            {isEditing ? (
              /* ── EDIT MODE ─────────────────────────────────── */
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={editForm.control}
                  name="leaveBalanceAnnual"
                  label="Cuti Tahunan"
                  id="employee-detail-annual-leave"
                  render={({ field, controlProps }) => (
                    <Input {...field} {...controlProps} value={String(field.value ?? "")} type="number" min={0} max={365} placeholder="12" />
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="leaveBalanceSick"
                  label="Cuti Sakit"
                  id="employee-detail-sick-leave"
                  render={({ field, controlProps }) => (
                    <Input {...field} {...controlProps} value={String(field.value ?? "")} type="number" min={0} max={365} placeholder="14" />
                  )}
                />
              </div>
            ) : (
              /* ── VIEW MODE ─────────────────────────────────── */
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex items-center gap-3">
                  <Calendar size={16} className="text-muted-foreground shrink-0" />
                  <div><p className="text-xs text-muted-foreground">Cuti Tahunan</p><p className="text-sm">{leaveBalanceText(e.leaveBalanceAnnual, e.leaveUsedAnnual)}</p></div>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar size={16} className="text-muted-foreground shrink-0" />
                  <div><p className="text-xs text-muted-foreground">Cuti Sakit</p><p className="text-sm">{leaveBalanceText(e.leaveBalanceSick, e.leaveUsedSick)}</p></div>
                </div>
              </div>
            )}
          </DossierSection>

          {/* ---------- Gaji — permission-gated: server omits salaryValues
              entirely for a viewer without payroll access, so a null (not an
              empty array) means "hidden", not "no components yet". ---------- */}
          {salaryValues !== null && (
            <DossierSection
              id={SECTION_SALARY}
              label="Gaji"
              open={openSections[SECTION_SALARY] ?? true}
              onOpenChange={(o) => setSectionOpen(SECTION_SALARY, o)}
            >
              <SalaryEditor
                components={salaryComponents}
                values={salaryValues}
                saving={savingSalary}
                onSave={handleSaveSalary}
              />
            </DossierSection>
          )}

          {/* ---------- Kehadiran ---------- */}
          <DossierSection
            id={SECTION_ATTENDANCE}
            label="Kehadiran"
            open={openSections[SECTION_ATTENDANCE] ?? false}
            onOpenChange={(o) => setSectionOpen(SECTION_ATTENDANCE, o)}
          >
            <EmployeeAttendanceContent employeeId={id} />
          </DossierSection>
        </div>

        {/* Desktop rail only, below `lg` (T1, cycle 2026-09-26,
            admin-ui-standard-c1). Unlike students/guardians/classes'[id],
            every card here (Kepegawaian, Kontak, Rekening & BPJS, the leave
            tiles) restates a fact the Profil/Kepegawaian/Saldo Cuti sections
            already show — there is no unique quick-action or KPI worth
            surfacing above the fold, so the mobile fallback is just to not
            repeat the same list twice. */}
        <DetailRail className="hidden lg:flex">
          <RailStatTiles
            tiles={[
              { label: "Cuti Tahunan", ...leaveBalanceTile(e.leaveBalanceAnnual, e.leaveUsedAnnual) },
              { label: "Cuti Sakit", ...leaveBalanceTile(e.leaveBalanceSick, e.leaveUsedSick) },
            ]}
          />
          <RailCard title="Kepegawaian">
            <RailKV
              items={[
                { label: "Kode", value: e.kode },
                { label: "Jabatan", value: e.jabatan },
                { label: "Kampus", value: e.campus.name },
                { label: "Tanggal Masuk", value: formatDateShort(e.hireDate) },
              ]}
            />
          </RailCard>
          <RailCard title="Kontak">
            <RailKV
              items={[
                { label: "Email", value: e.email },
                { label: "No. HP", value: e.noHp || "—" },
              ]}
            />
          </RailCard>
          {hasPayrollFields && (
            <RailCard title="Rekening & BPJS">
              <RailKV
                items={[
                  { label: "Bank", value: e.bankName || "—" },
                  { label: "No. Rekening", value: e.bankAccountNo || "—" },
                  { label: "BPJS", value: e.bpjsEnrolled ? "Terdaftar" : "Tidak Terdaftar" },
                ]}
              />
            </RailCard>
          )}
        </DetailRail>
      </div>

      <ConfirmDialog open={deactivateOpen} onOpenChange={setDeactivateOpen} title="Nonaktifkan Karyawan" description={`Nonaktifkan ${employee.nama}? Karyawan tidak bisa login dan tidak masuk penggajian berikutnya.`} onConfirm={handleDeactivate} confirmLabel="Nonaktifkan" destructive />

      {/* F-18: restore confirm — non-destructive, mirrors deactivate copy. */}
      <ConfirmDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title="Aktifkan Karyawan"
        description={`Aktifkan ${employee.nama}? Karyawan akan kembali masuk daftar aktif dan bisa login lagi.`}
        onConfirm={handleRestore}
        confirmLabel="Aktifkan"
      />
    </>
  );
}

function EmployeeAttendanceContent({ employeeId }: { employeeId: string }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<{ records: Array<{ date: string; status: string; checkInTime: string | null; checkOutTime: string | null }>; summary: { present: number; late: number; absent: number; leave: number } } | null>(null);
  const [attLoading, setAttLoading] = useState(false);

  const fetchAttendance = useCallback(async () => {
    setAttLoading(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}/attendance?month=${month}&year=${year}`);
      if (!res.ok) { toast.error("Gagal memuat kehadiran"); return; }
      setData(await res.json());
    } catch { toast.error("Terjadi kesalahan"); }
    finally { setAttLoading(false); }
  }, [employeeId, month, year]);

  useEffect(() => { fetchAttendance(); }, [fetchAttendance]);

  const monthLabel = formatMonthLabel(year, month);
  const STATUS_COLORS: Record<string, string> = { PRESENT: "bg-status-present", LATE: "bg-status-late", ABSENT: "bg-status-absent", LEAVE: "bg-status-leave", HOLIDAY: "bg-status-holiday", PRESENT_NO_CHECKOUT: "bg-status-no-checkout" };

  return (
    <>
      <PeriodStepper
        label={monthLabel}
        onPrev={() => { if (month === 1) { setMonth(12); setYear(year - 1); } else setMonth(month - 1); }}
        onNext={() => { if (month === 12) { setMonth(1); setYear(year + 1); } else setMonth(month + 1); }}
        prevLabel="Bulan sebelumnya"
        nextLabel="Bulan berikutnya"
        className="mb-4"
        labelClassName="capitalize"
      />
      {attLoading ? <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-40" /></div> : data ? (
        <>
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: "Hadir", value: data.summary.present, color: "text-status-present" },
              { label: "Terlambat", value: data.summary.late, color: "text-status-late" },
              { label: "Alpa", value: data.summary.absent, color: "text-status-absent" },
              { label: "Izin", value: data.summary.leave, color: "text-status-leave" },
            ].map(s => (
              <div key={s.label} className="text-center"><p className={`font-currency text-lg font-bold ${s.color}`}>{s.value}</p><p className="text-xs text-muted-foreground">{s.label}</p></div>
            ))}
          </div>
          <div className="space-y-1">
            {data.records.map(r => (
              <div key={r.date} className="flex items-center justify-between py-1.5 text-xs border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[r.status] ?? "bg-muted"}`} />
                  <span className="font-currency text-muted-foreground w-20">{formatDateShort(r.date)}</span>
                </div>
                <span className="font-currency">{r.checkInTime ? formatTime(r.checkInTime) : "--:--"} — {r.checkOutTime ? formatTime(r.checkOutTime) : "--:--"}</span>
                <div className="w-20 flex justify-end"><StatusBadge status={r.status} /></div>
              </div>
            ))}
            {data.records.length === 0 && <EmptyState title="Belum ada kehadiran" description="Belum ada rekap kehadiran untuk bulan ini." />}
          </div>
        </>
      ) : null}
    </>
  );
}
