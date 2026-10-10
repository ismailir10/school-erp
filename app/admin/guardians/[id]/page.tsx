"use client";

import { useEffect, useState, useCallback, use, useId, useRef } from "react";
import type { Control } from "react-hook-form";
import type * as z4 from "zod/v4/core";
import Link from "next/link";
import { DetailPageHeader } from "@/components/admin/detail-page-header";
import { DetailPageSkeleton } from "@/components/admin/detail-page-skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SectionHeading } from "@/components/ui/section-heading";
import { FormRootError } from "@/components/ui/form";
import { useIsMobile } from "@/hooks/use-mobile";
import { DossierNav, DossierSection, type DossierSectionDef } from "@/components/admin/dossier-section";
import { DetailRail, RailCard, RailStatTiles, RailChecklist } from "@/components/admin/detail-rail";
import { Mail, Phone, MapPin, Briefcase, User, Building, GraduationCap, Wallet, Baby, Pencil, X, Save } from "lucide-react";
import { toast } from "sonner";
import { REL_LABELS } from "@/lib/constants/parent-options";
import { formatRupiah } from "@/lib/format";
import { telHref, whatsappHref } from "@/lib/contact";
import { summarizeStudentInvoices, EMPTY_INVOICE_SUMMARY } from "@/lib/finance/student-invoice-summary";
import { GuardianFormBody, type GuardianFieldValues } from "@/components/admin/guardian-edit-dialog";
import { parentFormSchema } from "@/lib/validations/parent";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type ParentFormValues = z4.input<typeof parentFormSchema>;

const EMPTY_PARENT_FORM: ParentFormValues = {
  name: "",
  phone: "",
  email: "",
  whatsapp: "",
  address: "",
  parentNik: "",
  education: "",
  occupation: "",
  employer: "",
  employerAddress: "",
  employerCity: "",
  incomeRange: "",
  childrenTotal: "",
};

type ParentDetail = {
  canEdit: boolean;
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  nik: string | null;
  education: string | null;
  occupation: string | null;
  employer: string | null;
  employerAddress: string | null;
  employerCity: string | null;
  incomeRange: string | null;
  childrenTotal: number | null;
  hasKtp: boolean;
  hasKk: boolean;
  status: string;
  guardians: {
    id: string;
    relationship: string;
    isPrimary: boolean;
    status: string;
    student: { id: string; name: string; status: string; gender: string | null };
  }[];
  invoices: {
    id: string;
    invoiceNumber: string;
    periodLabel: string;
    totalDue: number;
    totalPaid: number;
    status: string;
  }[];
};

// ------------------------------------------------------------------
// Document upload control (T14 + T6) — KTP / KK admin-only auth-proxied
// ------------------------------------------------------------------

const DOC_MAX_BYTES = 5 * 1024 * 1024;
const DOC_ACCEPT = "image/jpeg,image/png,application/pdf";

function DocumentUploadCell({
  parentId,
  parentName,
  field,
  label,
  hasFile,
  onMutated,
  canEdit,
}: {
  parentId: string;
  parentName: string;
  field: "ktp" | "kk";
  label: string;
  hasFile: boolean;
  onMutated: () => void;
  canEdit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // Cache-bust the auth-proxied URL after upload/delete so <embed> reloads.
  const [version, setVersion] = useState(0);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > DOC_MAX_BYTES) {
      toast.error(`Ukuran ${label} maksimal 5 MB`);
      return;
    }
    const okMime = ["image/jpeg", "image/png", "application/pdf"].includes(file.type);
    if (!okMime) {
      toast.error(`Format ${label} harus JPG, PNG, atau PDF`);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch(`/api/parents/${parentId}/${field}`, { method: "POST", body: fd });
      if (res.ok) {
        toast.success(`${label} diperbarui`);
        setVersion((v) => v + 1);
        onMutated();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error === "UNSUPPORTED_MEDIA_TYPE"
          ? `Format ${label} tidak sesuai isi berkas. Pastikan file JPG, PNG, atau PDF asli — bukan hasil ubah ekstensi.`
          : d.error || `Gagal mengunggah ${label}`);
      }
    } catch {
      toast.error("Terjadi kesalahan jaringan");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/parents/${parentId}/${field}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(`${label} dihapus`);
        setVersion((v) => v + 1);
        onMutated();
      } else {
        toast.error(`Gagal menghapus ${label}`);
      }
    } catch {
      toast.error("Terjadi kesalahan jaringan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {hasFile ? (
        <>
          <embed
            key={version}
            src={`/api/parents/${parentId}/${field}?v=${version}`}
            className="w-full h-48 border rounded-lg bg-muted"
            aria-label={`Pratinjau ${label}`}
          />
          <a
            href={`/api/parents/${parentId}/${field}?v=${version}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary-text hover:underline inline-block"
          >
            Buka di tab baru →
          </a>
        </>
      ) : (
        <div className="w-full h-48 border border-dashed rounded-lg bg-muted/50 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">{label} belum diunggah</p>
        </div>
      )}
      {canEdit && <div className="flex gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={DOC_ACCEPT}
          className="hidden"
          onChange={handleFile}
        />
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? "Memproses..." : hasFile ? `Ganti ${label}` : `Unggah ${label}`}
        </Button>
        {hasFile && (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteOpen(true)} disabled={busy}>
            Hapus
          </Button>
        )}
      </div>}
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Hapus ${label}?`}
        description={`${label} ${parentName} akan dihapus. Unggah lagi jika masih diperlukan.`}
        confirmLabel="Ya, Hapus"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ------------------------------------------------------------------
// Page — Recipe 2b Dossier: single scroll, hash-addressable sections,
// mirrors app/admin/students/[id]/page.tsx's layout (DetailPageHeader +
// DossierNav + DossierSection[] + DetailRail). No fetch this page didn't
// already make — the rail derives entirely from the /api/parents/[id] payload.
// ------------------------------------------------------------------

const SECTION_PROFILE = "profile";
const SECTION_DOCUMENTS = "documents";
const SECTION_CHILDREN = "children";
const SECTION_INVOICES = "invoices";

export default function GuardianDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isMobile = useIsMobile();
  const [parent, setParent] = useState<ParentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit toggle
  const [isEditing, setIsEditing] = useState(false);
  const editFormId = useId();
  const editForm = useZodForm(parentFormSchema, { defaultValues: EMPTY_PARENT_FORM });

  // --- Section open/collapse state ---
  // Nothing on this page costs a second request to open, unlike the student
  // dossier's Kehadiran/Keringanan/etc — so every section starts open on
  // desktop and there is no lazy-fetch-on-open wiring to replicate.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => ({
    [SECTION_PROFILE]: true,
    [SECTION_DOCUMENTS]: true,
    [SECTION_CHILDREN]: true,
    [SECTION_INVOICES]: true,
  }));
  // Once the admin has collapsed or expanded anything, stop rearranging the
  // page underneath them on a resize.
  const sectionsTouched = useRef(false);

  const setSectionOpen = useCallback((sectionId: string, open: boolean) => {
    sectionsTouched.current = true;
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

  // Mobile default: one open section, not four. Runs only while the admin has
  // not touched a disclosure themselves.
  useEffect(() => {
    if (!isMobile || sectionsTouched.current) return;
    setOpenSections((prev) => {
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(prev)) next[key] = key === SECTION_PROFILE;
      return next;
    });
  }, [isMobile]);

  /**
   * `#documents`, `#invoices` … — every section id is already a DOM anchor,
   * but the browser's own hash scroll fires before the section exists and
   * lands on nothing when the section is collapsed on mobile. Honouring the
   * hash ourselves (same trick as the student dossier) is what makes a link
   * straight into "Tagihan" actually work.
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

  const fetchParent = useCallback(async () => {
    try {
      const res = await fetch(`/api/parents/${id}`);
      if (!res.ok) { toast.error("Gagal memuat data wali"); return; }
      setParent(await res.json());
    } catch { toast.error("Terjadi kesalahan"); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchParent(); }, [fetchParent]);

  // --- Edit toggle ---
  function startEditing() {
    if (!parent) return;
    editForm.reset({
      ...EMPTY_PARENT_FORM,
      name: parent.name,
      // No relationship/isPrimary seeding: the save below PUTs to
      // /api/parents/[id], which owns bio only and never touches a junction
      // row. Relationship belongs to the student↔parent link and is edited
      // from the student page.
      email: parent.email ?? "",
      phone: parent.phone ?? "",
      whatsapp: parent.whatsapp ?? "",
      address: parent.address ?? "",
      parentNik: parent.nik ?? "",
      education: parent.education ?? "",
      occupation: parent.occupation ?? "",
      employer: parent.employer ?? "",
      employerAddress: parent.employerAddress ?? "",
      employerCity: parent.employerCity ?? "",
      incomeRange: parent.incomeRange ?? "",
      childrenTotal: parent.childrenTotal != null ? String(parent.childrenTotal) : "",
    });
    setIsEditing(true);
  }

  // Bio lives on Parent, so save through the parent's own route. This page
  // used to PUT /api/guardians/[guardianId] against whichever junction row
  // happened to be first — which meant a wali with no linked student could
  // not be edited at all, and every save rewrote that one child's
  // relationship as a side effect. `values` carries every field — including
  // blanks — since a PUT that omits a key means "keep" server-side.
  const saveParent = editForm.handleSubmit(async (values) => {
    if (!parent) return;
    try {
      await sendJson(`/api/parents/${parent.id}`, { method: "PUT", body: values }, "Gagal menyimpan");
      toast.success("Data wali diperbarui");
      setIsEditing(false);
      fetchParent();
    } catch (err) {
      applyServerErrors(editForm, err, "Gagal menyimpan");
    }
  });

  if (loading) return <DetailPageSkeleton />;
  if (!parent) return <EmptyState title="Wali tidak ditemukan" description="Data wali tidak tersedia atau telah dihapus." />;

  const studentCount = parent.guardians.length;
  const invoiceSummary = parent.invoices.length > 0 ? summarizeStudentInvoices(parent.invoices) : EMPTY_INVOICE_SUMMARY;

  const navSections: DossierSectionDef[] = [
    { id: SECTION_PROFILE, label: "Data Wali" },
    { id: SECTION_DOCUMENTS, label: "Dokumen" },
    { id: SECTION_CHILDREN, label: "Anak Terdaftar" },
    { id: SECTION_INVOICES, label: "Tagihan" },
  ];

  const docItems = [
    { label: "KTP", present: parent.hasKtp },
    { label: "KK", present: parent.hasKk },
  ];

  const statTiles = [
    { label: "Anak Terdaftar", value: studentCount },
    {
      label: "Tagihan",
      value: parent.invoices.length,
      hint: invoiceSummary.unpaidCount > 0 ? `${invoiceSummary.unpaidCount} belum lunas` : undefined,
    },
    {
      label: "Piutang",
      value: formatRupiah(invoiceSummary.outstanding),
      tone: invoiceSummary.outstanding > 0 ? ("warning" as const) : ("default" as const),
      wide: true,
    },
  ];

  const waHref = whatsappHref(parent.whatsapp ?? parent.phone);
  const telephoneHref = telHref(parent.phone);
  const contactCard = (waHref || telephoneHref) && (
    <RailCard title="Kontak Cepat">
      <p className="text-small font-semibold">{parent.name}</p>
      {parent.phone && <p className="mt-0.5 text-xs text-muted-foreground">{parent.phone}</p>}
      <div className="mt-3 flex gap-2">
        {waHref && (
          <Button
            size="sm"
            className="flex-1"
            render={<a href={waHref} target="_blank" rel="noopener noreferrer" />}
          >
            WhatsApp
          </Button>
        )}
        {telephoneHref && (
          <Button size="sm" variant="outline" className="flex-1" render={<a href={telephoneHref} />}>
            Telepon
          </Button>
        )}
      </div>
    </RailCard>
  );

  const railContent = (
    <>
      <RailStatTiles tiles={statTiles} />
      {contactCard}
      <RailCard title="Kelengkapan Berkas">
        <RailChecklist items={docItems} />
      </RailCard>
    </>
  );

  return (
    <>
      <DetailPageHeader
        backHref="/admin/guardians"
        backLabel="Kembali ke Daftar Wali"
        title={parent.name}
        description={`${studentCount} siswa terdaftar`}
        badge={<StatusBadge status={parent.status} />}
        actions={
          parent.canEdit === true && !isEditing ? (
            <Button size="sm" variant="outline" onClick={startEditing}>
              <Pencil size={14} className="mr-1" /> Ubah
            </Button>
          ) : undefined
        }
      />

      {/* Mobile: the rail's numbers move above the sections so the first
          viewport still answers "who is this wali". */}
      {isMobile && <div className="mb-4"><RailStatTiles tiles={statTiles} /></div>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <DossierNav sections={navSections} onJump={jumpToSection} />

          {/* ---------- Data Wali — View/Edit toggle ---------- */}
          <DossierSection
            id={SECTION_PROFILE}
            label="Data Wali"
            open={openSections[SECTION_PROFILE] ?? true}
            onOpenChange={(o) => setSectionOpen(SECTION_PROFILE, o)}
            actions={
              isEditing ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setIsEditing(false)} disabled={editForm.formState.isSubmitting}>
                    <X size={14} className="mr-1" /> Batal
                  </Button>
                  <Button size="sm" form={editFormId} type="submit" disabled={editForm.formState.isSubmitting}>
                    <Save size={14} className="mr-1" /> {editForm.formState.isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
                  </Button>
                </div>
              ) : undefined
            }
          >
            {isEditing ? (
              <form id={editFormId} onSubmit={saveParent} noValidate className="space-y-field">
                <FormRootError formState={editForm.formState} />
                {/* Boundary cast — see the identical one in
                    app/admin/guardians/page.tsx. */}
                <GuardianFormBody
                  control={editForm.control as unknown as Control<GuardianFieldValues, unknown, GuardianFieldValues>}
                  showRelationship={false}
                />
              </form>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <User size={16} className="text-muted-foreground shrink-0" />
                    <div className="min-w-0"><p className="text-xs text-muted-foreground">Nama Lengkap</p><p className="text-sm font-medium break-words">{parent.name}</p></div>
                  </div>
                  {parent.email && (
                    <div className="flex min-w-0 items-center gap-3">
                      <Mail size={16} className="text-muted-foreground shrink-0" />
                      <div className="min-w-0"><p className="text-xs text-muted-foreground">Email</p><p className="text-sm font-medium break-all">{parent.email}</p></div>
                    </div>
                  )}
                  {parent.phone && (
                    <div className="flex items-center gap-3">
                      <Phone size={16} className="text-muted-foreground shrink-0" />
                      <div><p className="text-xs text-muted-foreground">Telepon</p><p className="text-sm font-medium">{parent.phone}</p></div>
                    </div>
                  )}
                  {parent.whatsapp && (
                    <div className="flex items-center gap-3">
                      <Phone size={16} className="text-muted-foreground shrink-0" />
                      <div><p className="text-xs text-muted-foreground">WhatsApp</p><p className="text-sm font-medium">{parent.whatsapp}</p></div>
                    </div>
                  )}
                  {parent.address && (
                    <div className="flex items-start gap-3 sm:col-span-2">
                      <MapPin size={16} className="text-muted-foreground shrink-0 mt-0.5" />
                      <div><p className="text-xs text-muted-foreground">Alamat</p><p className="text-sm">{parent.address}</p></div>
                    </div>
                  )}
                  {parent.nik && (
                    <div className="flex items-center gap-3">
                      <User size={16} className="text-muted-foreground shrink-0" />
                      <div><p className="text-xs text-muted-foreground">NIK</p><p className="text-sm font-medium font-currency">{parent.nik}</p></div>
                    </div>
                  )}
                  {parent.childrenTotal != null && (
                    <div className="flex items-center gap-3">
                      <Baby size={16} className="text-muted-foreground shrink-0" />
                      <div><p className="text-xs text-muted-foreground">Jumlah Anak</p><p className="text-sm font-medium">{parent.childrenTotal}</p></div>
                    </div>
                  )}
                </div>

                {(parent.education || parent.occupation || parent.employer || parent.incomeRange) && (
                  <>
                    <div className="mt-6"><SectionHeading label="Data Pekerjaan" /></div>
                    <div className="grid grid-cols-2 gap-4">
                      {parent.education && (
                        <div className="flex items-center gap-3">
                          <GraduationCap size={16} className="text-muted-foreground shrink-0" />
                          <div><p className="text-xs text-muted-foreground">Pendidikan</p><p className="text-sm font-medium">{parent.education}</p></div>
                        </div>
                      )}
                      {parent.occupation && (
                        <div className="flex items-center gap-3">
                          <Briefcase size={16} className="text-muted-foreground shrink-0" />
                          <div><p className="text-xs text-muted-foreground">Pekerjaan</p><p className="text-sm font-medium">{parent.occupation}</p></div>
                        </div>
                      )}
                      {parent.incomeRange && (
                        <div className="flex items-center gap-3">
                          <Wallet size={16} className="text-muted-foreground shrink-0" />
                          <div><p className="text-xs text-muted-foreground">Penghasilan</p><p className="text-sm font-medium">{parent.incomeRange}</p></div>
                        </div>
                      )}
                      {parent.employer && (
                        <div className="flex items-center gap-3">
                          <Building size={16} className="text-muted-foreground shrink-0" />
                          <div><p className="text-xs text-muted-foreground">Tempat Kerja</p><p className="text-sm font-medium">{parent.employer}</p></div>
                        </div>
                      )}
                      {parent.employerAddress && (
                        <div className="flex items-center gap-3">
                          <MapPin size={16} className="text-muted-foreground shrink-0" />
                          <div><p className="text-xs text-muted-foreground">Alamat Kantor</p><p className="text-sm font-medium">{parent.employerAddress}</p></div>
                        </div>
                      )}
                      {parent.employerCity && (
                        <div className="flex items-center gap-3">
                          <Building size={16} className="text-muted-foreground shrink-0" />
                          <div><p className="text-xs text-muted-foreground">Kota/Kab</p><p className="text-sm font-medium">{parent.employerCity}</p></div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </DossierSection>

          {/* ---------- Dokumen (T14 + T6) — admin-only auth-proxied uploads.
              Sensitive PII under UU PDP 27/2022 — files written under .data/
              (never public/), reads stream through requireAdmin-gated GET. ---------- */}
          <DossierSection
            id={SECTION_DOCUMENTS}
            label="Dokumen"
            open={openSections[SECTION_DOCUMENTS] ?? true}
            onOpenChange={(o) => setSectionOpen(SECTION_DOCUMENTS, o)}
          >
            <p className="mb-4 text-xs text-muted-foreground">
              KTP per orang tua + KK per keluarga · maks 5 MB · JPG / PNG / PDF
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <DocumentUploadCell
                parentId={parent.id}
                parentName={parent.name}
                field="ktp"
                label="KTP"
                canEdit={parent.canEdit === true}
                hasFile={parent.hasKtp}
                onMutated={fetchParent}
              />
              <DocumentUploadCell
                parentId={parent.id}
                parentName={parent.name}
                field="kk"
                label="KK"
                canEdit={parent.canEdit === true}
                hasFile={parent.hasKk}
                onMutated={fetchParent}
              />
            </div>
          </DossierSection>

          {/* ---------- Anak Terdaftar ---------- */}
          <DossierSection
            id={SECTION_CHILDREN}
            label="Anak Terdaftar"
            badge={
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {studentCount} anak
              </span>
            }
            open={openSections[SECTION_CHILDREN] ?? true}
            onOpenChange={(o) => setSectionOpen(SECTION_CHILDREN, o)}
          >
            {parent.guardians.length === 0 ? (
              <EmptyState title="Belum ada anak terdaftar" description="Belum ada siswa yang ditautkan ke wali ini." />
            ) : (
              <div className="space-y-2">
                {parent.guardians.map(g => (
                  <Link key={g.id} href={`/admin/students/${g.student.id}`} className="block">
                    <div className="flex flex-col gap-2 py-2.5 border-b border-border/50 last:border-0 hover:bg-accent/50 rounded-md px-2 -mx-2 transition-colors sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 break-words text-sm font-medium">{g.student.name}</span>
                          <Badge variant="outline" className="text-xs">{REL_LABELS[g.relationship] ?? g.relationship}</Badge>
                          {g.isPrimary && <Badge className="bg-primary/10 text-primary-text text-xs">Utama</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {g.student.gender === "L" ? "Laki-laki" : g.student.gender === "P" ? "Perempuan" : ""}
                        </p>
                      </div>
                      <StatusBadge status={g.student.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </DossierSection>

          {/* ---------- Tagihan ---------- */}
          <DossierSection
            id={SECTION_INVOICES}
            label="Tagihan"
            badge={
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {parent.invoices.length} tagihan
              </span>
            }
            open={openSections[SECTION_INVOICES] ?? true}
            onOpenChange={(o) => setSectionOpen(SECTION_INVOICES, o)}
          >
            {parent.invoices.length === 0 ? (
              <EmptyState title="Belum ada tagihan" description="Belum ada tagihan untuk wali ini." />
            ) : (
              <div className="space-y-0">
                {parent.invoices.map(inv => (
                  <Link key={inv.id} href={`/admin/invoices/${inv.id}`} className="block">
                    <div className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0 hover:bg-accent/50 rounded-md px-2 -mx-2 transition-colors">
                      <div>
                        <p className="text-sm font-medium">{inv.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {inv.periodLabel} &middot; {formatRupiah(inv.totalDue)}
                        </p>
                      </div>
                      <StatusBadge status={inv.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </DossierSection>
        </div>

        {/* Desktop rail. On mobile the stat tiles already rendered above and the
            remaining cards fall to the end of the document, after the sections. */}
        {isMobile ? (
          <div className="mt-2 flex flex-col gap-4">
            {contactCard}
            <RailCard title="Kelengkapan Berkas"><RailChecklist items={docItems} /></RailCard>
          </div>
        ) : (
          <DetailRail>{railContent}</DetailRail>
        )}
      </div>
    </>
  );
}
