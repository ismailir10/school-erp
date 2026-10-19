"use client";

import { useEffect, useState, useCallback, use, useId, useRef } from "react";
import type { Control } from "react-hook-form";
import type * as z4 from "zod/v4/core";
import { DetailPageHeader } from "@/components/admin/detail-page-header";
import { DetailPageSkeleton } from "@/components/admin/detail-page-skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormRootError } from "@/components/ui/form";
import { useIsMobile } from "@/hooks/use-mobile";
import { DossierNav, DossierSection, type DossierSectionDef } from "@/components/admin/dossier-section";
import { AttentionStrip, type AttentionItem } from "@/components/admin/attention-strip";
import { ContactActions } from "@/components/admin/contact-actions";
import { Pencil, Plus, X, Save } from "lucide-react";
import { toast } from "sonner";
import { formatRupiah } from "@/lib/format";
import { familyReminderWaUrl, guardianChatNumber } from "@/lib/finance/invoice-reminder";
import { GuardianFormBody, type GuardianFieldValues } from "@/components/admin/guardian-edit-dialog";
import { parentFormSchema } from "@/lib/validations/parent";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import {
  SECTION_CHILDREN,
  SECTION_DOCUMENTS,
  SECTION_INVOICES,
  SECTION_PROFILE,
  type ParentDetail,
} from "@/components/admin/guardians/detail/types";
import {
  childrenSummary,
  documentsSummary,
  invoicesSummary,
  missingDocumentsText,
  profileSummary,
} from "@/components/admin/guardians/detail/summaries";
import { GuardianProfileView } from "@/components/admin/guardians/detail/profile-view";
import { ChildrenList } from "@/components/admin/guardians/detail/children-list";
import { InvoicesList } from "@/components/admin/guardians/detail/invoices-list";
import { DocumentsPanel } from "@/components/admin/guardians/detail/documents-section";
import { GuardianRail } from "@/components/admin/guardians/detail/guardian-rail";
import { LinkStudentDialog } from "@/components/admin/guardians/link-student-dialog";

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

type LoadError = "failed" | "not-found" | "denied";

const LIST_HREF = "/admin/guardians";

// Default disclosure state. The answer-first sections (children, invoices) and
// the profile start open on desktop; Dokumen is sensitive and heavy, so it
// starts closed and its collapsed header says what is on file.
const DESKTOP_OPEN: Record<string, boolean> = {
  [SECTION_CHILDREN]: true,
  [SECTION_INVOICES]: true,
  [SECTION_PROFILE]: true,
  [SECTION_DOCUMENTS]: false,
};
// Phone: only the two sections that answer "who and what do they owe".
const MOBILE_OPEN: Record<string, boolean> = {
  [SECTION_CHILDREN]: true,
  [SECTION_INVOICES]: true,
  [SECTION_PROFILE]: false,
  [SECTION_DOCUMENTS]: false,
};

// ------------------------------------------------------------------
// Page — Recipe 2b Dossier: a thin orchestrator (state, disclosure, hash,
// fetch, edit toggle). Each section body lives in
// components/admin/guardians/detail/*. Order is answer-first: who the children
// are, what is owed, then the wali's own data and documents.
// ------------------------------------------------------------------

export default function GuardianDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isMobile = useIsMobile();
  const [parent, setParent] = useState<ParentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  // Guards a double click while the stamps are in flight (the chat is already open).
  const reminding = useRef(false);

  // Edit toggle
  const [isEditing, setIsEditing] = useState(false);
  const editFormId = useId();
  const editForm = useZodForm(parentFormSchema, { defaultValues: EMPTY_PARENT_FORM });

  // --- Section open/collapse state ---
  // Nothing on this page costs a second request to open, so there is no
  // lazy-fetch-on-open wiring to replicate from the student dossier.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => ({ ...DESKTOP_OPEN }));
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

  // Mobile default: children + invoices open, the rest closed. Runs only while
  // the admin has not touched a disclosure themselves.
  useEffect(() => {
    if (!isMobile || sectionsTouched.current) return;
    setOpenSections({ ...MOBILE_OPEN });
  }, [isMobile]);

  /**
   * `#documents`, `#invoices` … — every section id is already a DOM anchor,
   * but the browser's own hash scroll fires before the section exists and
   * lands on nothing when the section is collapsed. Honouring the hash
   * ourselves (same trick as the student dossier) is what makes a link
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
      if (!res.ok) {
        setLoadError(res.status === 404 ? "not-found" : res.status === 401 || res.status === 403 ? "denied" : "failed");
        toast.error("Gagal memuat data wali");
        return;
      }
      setParent(await res.json());
      setLoadError(null);
    } catch {
      setLoadError("failed");
      toast.error("Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
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
    // Data Wali can be collapsed (phone default): open it so the form is in view.
    jumpToSection(SECTION_PROFILE);
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
  if (!parent) {
    if (loadError === "not-found") {
      return (
        <EmptyState
          title="Wali tidak ditemukan"
          description="Periksa kembali tautan wali atau pilih wali dari daftar."
          actionLabel="Kembali ke Daftar Wali"
          actionHref={LIST_HREF}
        />
      );
    }
    if (loadError === "denied") {
      return (
        <EmptyState
          title="Data wali tidak bisa diakses"
          description="Sesi Anda berakhir atau akun Anda tidak memiliki akses."
          actionLabel="Kembali ke Daftar Wali"
          actionHref={LIST_HREF}
        />
      );
    }
    return (
      <div role="alert">
        <EmptyState
          title="Data wali belum bisa dimuat"
          description="Periksa koneksi Anda, lalu coba lagi."
          actionLabel="Coba Lagi"
          onAction={() => { setLoading(true); fetchParent(); }}
        />
      </div>
    );
  }

  const canEdit = parent.canEdit === true;

  /**
   * "Ingatkan via WhatsApp": one message to THIS wali listing every unpaid
   * invoice. The chat opens first and synchronously, inside the click, so a
   * popup blocker treats it as user-initiated. Only then is each invoice
   * stamped ("Terakhir diingatkan") through the existing per-invoice endpoint.
   * That endpoint builds its own wa.me URL for the *student's primary* wali;
   * the returned URL is ignored here and only the stamp is used. A stamp can
   * be refused (409 nothing to chase, 422 no number on the primary wali, 429)
   * without undoing the message, so the toast reports how many were recorded.
   */
  async function remindByWhatsApp() {
    if (!parent || reminding.current) return;
    const items = parent.unpaidInvoices;
    // `items` is capped at 25 by the API; the total is the whole debt, and the
    // rest are named as one trailing line instead of silently under-stating it.
    const url = familyReminderWaUrl({
      guardian: { name: parent.name, whatsapp: parent.whatsapp, phone: parent.phone },
      items,
      total: parent.invoiceSummary.outstanding,
      moreCount: Math.max(0, parent.invoiceSummary.unpaidCount - items.length),
      payUrl: `${window.location.origin}/parent/invoices`,
    });
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");

    reminding.current = true;
    try {
      const results = await Promise.allSettled(
        items.map((i) => fetch(`/api/invoices/${i.id}/reminder`, { method: "POST" })),
      );
      const recorded = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
      if (recorded > 0) {
        toast.success(`Pengingat dicatat untuk ${recorded} dari ${items.length} tagihan`);
      } else {
        toast.error("Pengingat belum tercatat, tetapi WhatsApp sudah dibuka.");
      }
    } finally {
      reminding.current = false;
    }
  }
  const canSendReminder =
    parent.canRemind === true &&
    parent.unpaidInvoices.length > 0 &&
    guardianChatNumber({ whatsapp: parent.whatsapp, phone: parent.phone }) !== null;

  const studentCount = parent.guardians.length;
  const summary = parent.invoiceSummary;

  const navSections: DossierSectionDef[] = [
    { id: SECTION_CHILDREN, label: "Anak Terdaftar" },
    { id: SECTION_INVOICES, label: "Tagihan" },
    { id: SECTION_PROFILE, label: "Data Wali" },
    { id: SECTION_DOCUMENTS, label: "Dokumen" },
  ];

  // "Perlu perhatian": only what applies, owed money first.
  const attentionItems: AttentionItem[] = [];
  if (summary.outstanding > 0) {
    attentionItems.push({
      id: "owed",
      message: (
        <>
          <strong className="font-currency font-semibold">{formatRupiah(summary.outstanding)}</strong> belum dibayar
          {" · "}
          {summary.unpaidCount} tagihan{summary.overdueCount > 0 ? `, ${summary.overdueCount} lewat tempo` : ""}
        </>
      ),
      action: { label: "Lihat tagihan", onClick: () => jumpToSection(SECTION_INVOICES), testId: "attention-owed" },
      secondaryAction: canSendReminder
        ? { label: "Ingatkan via WhatsApp", onClick: () => void remindByWhatsApp(), testId: "attention-remind" }
        : undefined,
    });
  }
  const missingDocs = missingDocumentsText(parent);
  if (missingDocs) {
    attentionItems.push({
      id: "documents",
      message: missingDocs,
      action: canEdit
        ? { label: "Unggah", onClick: () => jumpToSection(SECTION_DOCUMENTS), testId: "attention-documents" }
        : undefined,
    });
  }
  if (studentCount === 0) {
    attentionItems.push({
      id: "no-student",
      message: "Belum tertaut ke siswa",
      action: canEdit ? { label: "Tautkan anak", onClick: () => setLinkOpen(true), testId: "attention-link-child" } : undefined,
    });
  }

  return (
    <>
      <DetailPageHeader
        backHref={LIST_HREF}
        backLabel="Kembali ke Daftar Wali"
        title={parent.name}
        description={`${studentCount} siswa${parent.phone?.trim() ? ` · ${parent.phone.trim()}` : ""}`}
        badge={<StatusBadge status={parent.status} />}
        actions={
          <>
            <ContactActions phone={parent.phone} whatsapp={parent.whatsapp} className="w-full sm:w-auto" />
            {canEdit && !isEditing && (
              <Button size="sm" variant="outline" onClick={startEditing}>
                <Pencil size={14} className="mr-1" /> Edit
              </Button>
            )}
          </>
        }
      />

      <AttentionStrip items={attentionItems} className="mb-4" />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <DossierNav sections={navSections} onJump={jumpToSection} />

          {/* ---------- Anak Terdaftar ---------- */}
          <DossierSection
            id={SECTION_CHILDREN}
            label="Anak Terdaftar"
            badge={
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {studentCount} anak
              </span>
            }
            summary={childrenSummary(parent.guardians)}
            open={openSections[SECTION_CHILDREN] ?? true}
            onOpenChange={(o) => setSectionOpen(SECTION_CHILDREN, o)}
            actions={
              canEdit ? (
                <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
                  <Plus size={14} className="mr-1" /> Tautkan anak
                </Button>
              ) : undefined
            }
          >
            {studentCount === 0 ? (
              <EmptyState
                title="Belum ada anak terdaftar"
                description="Belum ada siswa yang ditautkan ke wali ini."
                actionLabel={canEdit ? "Tautkan anak" : undefined}
                onAction={canEdit ? () => setLinkOpen(true) : undefined}
              />
            ) : (
              <ChildrenList guardians={parent.guardians} />
            )}
          </DossierSection>

          {/* ---------- Tagihan ---------- */}
          <DossierSection
            id={SECTION_INVOICES}
            label="Tagihan"
            badge={
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {summary.invoiceCount} tagihan
              </span>
            }
            summary={invoicesSummary(summary)}
            open={openSections[SECTION_INVOICES] ?? true}
            onOpenChange={(o) => setSectionOpen(SECTION_INVOICES, o)}
          >
            <InvoicesList summary={summary} invoices={parent.invoices} guardians={parent.guardians} />
          </DossierSection>

          {/* ---------- Data Wali — View/Edit toggle ---------- */}
          <DossierSection
            id={SECTION_PROFILE}
            label="Data Wali"
            summary={profileSummary(parent)}
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
              <GuardianProfileView parent={parent} />
            )}
          </DossierSection>

          {/* ---------- Dokumen — admin-only auth-proxied uploads (UU PDP). Closed by default. ---------- */}
          <DossierSection
            id={SECTION_DOCUMENTS}
            label="Dokumen"
            summary={documentsSummary(parent)}
            open={openSections[SECTION_DOCUMENTS] ?? false}
            onOpenChange={(o) => setSectionOpen(SECTION_DOCUMENTS, o)}
          >
            <DocumentsPanel parent={parent} onMutated={fetchParent} />
          </DossierSection>
        </div>

        <GuardianRail parent={parent} />
      </div>

      {canEdit && (
        <LinkStudentDialog parentId={parent.id} open={linkOpen} onOpenChange={setLinkOpen} onLinked={fetchParent} />
      )}
    </>
  );
}
