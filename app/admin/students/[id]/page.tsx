"use client";

import { useEffect, useState, useCallback, useRef, useId } from "react";
import { useParams } from "next/navigation";
import { DetailPageHeader, type DetailPageHeaderAction } from "@/components/admin/detail-page-header";
import { DetailPageSkeleton } from "@/components/admin/detail-page-skeleton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useIsMobile } from "@/hooks/use-mobile";
import { Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { formatDateShort } from "@/lib/format";
import { studentDetailEditFormSchema } from "@/lib/validations/student";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { sendStudentJson, applyStudentErrors } from "@/components/admin/students/student-request";
import { STUDENT_LIST_QUERY_KEY } from "@/components/admin/students/list-query";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes-provider";
import { StudentEnrollDialog } from "@/components/admin/student-enroll-dialog";
import type { ClassSection } from "@/components/admin/class-section-picker";
import { pickPrimaryEnrollment } from "@/lib/enrollment/active";
import { DossierNav, DossierGroup, DossierSubsection } from "@/components/admin/dossier-section";
import { AttentionStrip } from "@/components/admin/attention-strip";
import { StudentFinanceBlock } from "@/components/admin/student-finance-block";
import { StudentKeringananBlock } from "@/components/admin/student-keringanan-block";
import { StudentJournalBlock } from "@/components/admin/student-journal-block";
import { StudentAcademicsBlock } from "@/components/admin/student-academics-block";
import { StudentEnrollmentApplicationBlock } from "@/components/admin/student-enrollment-application-block";
import type { StudentOverview } from "@/lib/student/overview";
import { summarizeStudentInvoices, EMPTY_INVOICE_SUMMARY } from "@/lib/finance/student-invoice-summary";
import type { StudentInvoiceRow } from "@/components/admin/student-finance-block";
import {
  parseStudentMetadata,
  splitStudentMetadata,
  buildStudentMetadata,
  healthFlags,
  type StudentSystemMetadata,
  type MetadataExtraRow,
} from "@/lib/student/metadata";
import { formatAgeShort } from "@/lib/student/age";
import { deriveSiblings } from "@/lib/parent/siblings";
import type * as z4 from "zod/v4/core";

import { DataAnakSection } from "@/components/admin/students/detail/data-anak-section";
import { KesehatanSection } from "@/components/admin/students/detail/kesehatan-section";
import { KeluargaSection } from "@/components/admin/students/detail/keluarga-section";
import { RiwayatKelasSection } from "@/components/admin/students/detail/riwayat-kelas-section";
import { KehadiranSection } from "@/components/admin/students/detail/kehadiran-section";
import { DokumenSection } from "@/components/admin/students/detail/dokumen-section";
import { RiwayatStatusSection } from "@/components/admin/students/detail/riwayat-status-section";
import { InformasiTambahanSection } from "@/components/admin/students/detail/informasi-tambahan-section";
import { StudentLifecycleDialogs } from "@/components/admin/students/detail/lifecycle-dialogs";
import { CutiSection } from "@/components/admin/students/detail/cuti-section";
import { StudentRail } from "@/components/admin/students/detail/rail-content";
import { buildRailTiles } from "@/components/admin/students/detail/rail-tiles";
import {
  buildStudentAttentionItems,
  DOC_TARGET_FOTO,
  DOC_TARGET_KK,
  DOC_TARGET_PENDAFTARAN,
  guardianDocumentsHref,
  type MissingDoc,
} from "@/components/admin/students/detail/attention-items";
import { FamilyContactStrip } from "@/components/admin/students/detail/family-strip";
import { KelasSaatIniSection } from "@/components/admin/students/detail/kelas-saat-ini";
import {
  catatanSummary,
  keluargaSummary,
  keuanganSummary,
  kelasSummary,
  profilSummary,
} from "@/components/admin/students/detail/group-summaries";
import {
  GROUPS,
  GROUP_CATATAN,
  GROUP_KELAS,
  GROUP_KELUARGA,
  GROUP_KEUANGAN,
  GROUP_PROFIL,
  LAZY_SECTIONS,
  SECTION_AKADEMIK,
  SECTION_CUTI,
  SECTION_JURNAL,
  SECTION_KEHADIRAN,
  SECTION_KELUARGA,
  SECTION_KERINGANAN,
  SECTION_KEUANGAN,
  SECTION_PENDAFTARAN,
  defaultOpenSections,
  groupOf,
  isKnownTarget,
} from "@/components/admin/students/detail/sections";
import type { Student } from "@/components/admin/students/detail/types";

const EMPTY_SYSTEM_METADATA: StudentSystemMetadata = {
  fromEnrollmentApplication: null,
  dcareAddon: false,
  priorFamilyAttendees: [],
};

const EMPTY_DATA_ANAK_FORM: z4.input<typeof studentDetailEditFormSchema> = {
  name: "",
  nickname: "",
  dateOfBirth: "",
  gender: "",
  address: "",
  notes: "",
  nis: "",
  nisn: "",
  birthPlace: "",
  nik: "",
  kkNumber: "",
  livingWith: "",
};

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isMobile = useIsMobile();
  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"failed" | "not-found" | "denied" | null>(null);

  // --- Data Anak edit toggle ---
  // Owned here, not by `DataAnakSection`: starting an edit has to check
  // Informasi Tambahan's dirty state — a sibling section — and the unsaved-
  // changes guard below hangs off the same form.
  const [isEditingDataAnak, setIsEditingDataAnak] = useState(false);
  const dataAnakFormId = useId();
  const dataAnakForm = useZodForm(studentDetailEditFormSchema, { defaultValues: EMPTY_DATA_ANAK_FORM });

  // --- Metadata, in three buckets (see lib/student/metadata.ts) ---
  const [metaKnown, setMetaKnown] = useState<Record<string, string>>({});
  const [metaSystem, setMetaSystem] = useState<StudentSystemMetadata>(EMPTY_SYSTEM_METADATA);
  const [metaExtra, setMetaExtra] = useState<MetadataExtraRow[]>([]);

  // Informasi Tambahan reports its live (possibly unsaved) rows + dirty state
  // up through this ref rather than state — every keystroke in that section
  // would otherwise re-render the whole dossier. Kesehatan's save reads
  // `.rows` (the pre-split page shared one `metadataRows` state between both
  // editors on purpose — see kesehatan-section.tsx's doc comment); the Data
  // Anak "Edit" guard reads `.dirty`.
  const tambahanRef = useRef<{ dirty: boolean; rows: MetadataExtraRow[] }>({ dirty: false, rows: [] });

  // Enroll dialog — state lives inside StudentEnrollDialog so typing an
  // override reason does not re-render the whole dossier. See that file.
  const [enrollDialog, setEnrollDialog] = useState(false);

  // Lifecycle actions (Naik Kelas / Luluskan / Keluarkan) — open state only;
  // everything else lives in `StudentLifecycleDialogs` (its menu triggers
  // live in the header, outside that component's own subtree). Promote also
  // keeps its pre-open class-list fetch here (same gate the pre-split page
  // had: a failed fetch toasts and never opens the dialog at all).
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);
  const [promoteSections, setPromoteSections] = useState<ClassSection[]>([]);
  const [graduateOpen, setGraduateOpen] = useState(false);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);

  // "Kembali ke Daftar Siswa" restores the list's search / status / page —
  // the list mirrors them into sessionStorage (see components/admin/students/list-query.ts).
  const [listHref, setListHref] = useState("/admin/students");
  useEffect(() => {
    try {
      const qs = sessionStorage.getItem(STUDENT_LIST_QUERY_KEY);
      if (qs) setListHref(`/admin/students?${qs}`);
    } catch {
      // Storage unavailable — the plain list link is fine.
    }
  }, []);

  async function openPromoteDialog() {
    try {
      // Same year scoping as Enroll — see StudentEnrollDialog.
      const res = await fetch("/api/class-sections?yearStatus=ACTIVE,PLANNING");
      if (!res.ok) { toast.error("Gagal memuat data kelas"); return; }
      setPromoteSections(await res.json());
      setPromoteDialogOpen(true);
    } catch { toast.error("Terjadi kesalahan"); }
  }

  // Kehadiran is lazy like Keringanan/Buku Penghubung: nothing is requested
  // until the section is opened.
  const [kehadiranActive, setKehadiranActive] = useState(false);

  // --- Keuangan (increment 2) ---
  // Eager, unlike Kehadiran: the rail's Tunggakan tile reads this summary, and
  // a tile that only fills once the admin opens a section below the fold is a
  // tile that always reads as zero.
  const [invoices, setInvoices] = useState<StudentInvoiceRow[] | null>(null);
  const [invoicesError, setInvoicesError] = useState<"denied" | "failed" | null>(null);

  // --- Lazy sections (increment 2) ---
  // One-way latches: opening the section pays for the fetch, closing it again
  // does not un-fetch, and re-opening does not re-request.
  const [keringananActive, setKeringananActive] = useState(false);
  const [keringananCount, setKeringananCount] = useState<number | null>(null);
  const [cutiActive, setCutiActive] = useState(false);
  const [cutiCount, setCutiCount] = useState<number | null>(null);
  const [jurnalActive, setJurnalActive] = useState(false);

  // --- Overview aggregate + lazy sections (increment 3) ---
  // The overview route is the only *eager* addition this increment makes, and
  // it is aggregates-only: the Kehadiran and Raport rail tiles read it, and a
  // tile that fills only after an admin opens a section below the fold is a
  // tile that always reads as zero. Fired alongside the student fetch, so it
  // adds no latency to the critical path.
  const [overview, setOverview] = useState<StudentOverview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [akademikActive, setAkademikActive] = useState(false);
  const [pendaftaranActive, setPendaftaranActive] = useState(false);

  // --- Group / lazy-row open state ---
  // Holds the five groups and the five lazy rows inside them; every other
  // sub-section is a flat block with nothing to open. The lazy rows start
  // closed on every viewport: opening one is what triggers its request.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => defaultOpenSections(false));
  // Once the admin has collapsed or expanded anything, stop rearranging the
  // page underneath them on a resize.
  const sectionsTouched = useRef(false);

  const setSectionOpen = useCallback((sectionId: string, open: boolean) => {
    sectionsTouched.current = true;
    setOpenSections((prev) => ({ ...prev, [sectionId]: open }));
  }, []);

  const fetchStudent = useCallback(async () => {
    try {
      const res = await fetch(`/api/students/${id}`);
      if (!res.ok) {
        toast.error("Gagal memuat data siswa");
        setLoadError(res.status === 404 ? "not-found" : res.status === 401 || res.status === 403 ? "denied" : "failed");
        return;
      }
      setLoadError(null);
      const data = (await res.json()) as Student;
      setStudent(data);

      // Split the blob once, here, so every consumer below reads typed state
      // instead of re-parsing JSON.
      const parsed = parseStudentMetadata(data.metadata);
      const split = splitStudentMetadata(parsed);
      setMetaKnown(split.known);
      setMetaSystem(split.system);
      setMetaExtra(split.extra);
      tambahanRef.current = { dirty: false, rows: split.extra };
    } catch { toast.error("Terjadi kesalahan jaringan"); setLoadError("failed"); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchStudent(); }, [fetchStudent]);

  /**
   * One page of invoices for this student. pageSize 100 because a child's
   * whole billing history is tens of rows at most, so one request is the
   * complete answer and the summary below it is not a partial sum.
   *
   * Failure is silent here — no toast. The student record still renders, and
   * the Keuangan section states the failure with its own retry. A toast for a
   * side-panel fetch on page load would fire on every offline hiccup.
   */
  const fetchInvoices = useCallback(async () => {
    setInvoicesError(null);
    try {
      const res = await fetch(`/api/invoices?studentId=${encodeURIComponent(id)}&pageSize=100`);
      if (!res.ok) { setInvoicesError(res.status === 403 ? "denied" : "failed"); return; }
      const json = await res.json();
      setInvoices(Array.isArray(json?.data) ? json.data : []);
    } catch {
      setInvoicesError("failed");
    }
  }, [id]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  /**
   * The dossier's number tiles, as aggregates. Silent on failure for the same
   * reason the invoice fetch is: the student record still renders, and a
   * side-panel fetch toasting on every offline hiccup is noise. Each tile shows
   * a dash instead — never a zero, which an admin would read as a real answer.
   */
  const fetchOverview = useCallback(async () => {
    setOverviewError(false);
    try {
      const res = await fetch(`/api/students/${id}/overview`);
      if (!res.ok) { setOverviewError(true); return; }
      setOverview((await res.json()) as StudentOverview);
    } catch {
      setOverviewError(true);
    }
  }, [id]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  // Mobile default: only Profil open, not three groups. Runs only while the
  // admin has not touched a disclosure themselves.
  useEffect(() => {
    if (!isMobile || sectionsTouched.current) return;
    setOpenSections(defaultOpenSections(true));
  }, [isMobile]);

  const handleSectionOpenChange = useCallback(
    (sectionId: string, open: boolean) => {
      setSectionOpen(sectionId, open);
      if (!open) return;
      // Opening a lazy row is what pays for its fetch (a one-way latch).
      if (sectionId === SECTION_KEHADIRAN) setKehadiranActive(true);
      if (sectionId === SECTION_KERINGANAN) setKeringananActive(true);
      if (sectionId === SECTION_CUTI) setCutiActive(true);
      if (sectionId === SECTION_JURNAL) setJurnalActive(true);
      if (sectionId === SECTION_AKADEMIK) setAkademikActive(true);
      if (sectionId === SECTION_PENDAFTARAN) setPendaftaranActive(true);
    },
    [setSectionOpen],
  );

  /**
   * Nav click, strip button or hash: open what contains the target (a closed
   * group is nothing to scroll to), open the target itself when it is a lazy
   * row (which fires its latch), then scroll. Works for a group id and for every
   * sub-section id the page has ever had.
   */
  const jumpToSection = useCallback(
    (sectionId: string) => {
      const group = groupOf(sectionId);
      if (!group) return;
      handleSectionOpenChange(group, true);
      if (LAZY_SECTIONS.has(sectionId)) handleSectionOpenChange(sectionId, true);
      requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [handleSectionOpenChange],
  );

  /**
   * `#pendaftaran`, `#akademik`, `#keuangan` … — every section id is already a
   * DOM anchor, but the browser's own hash scroll fires before the section
   * exists and lands on nothing when its group is collapsed. Honouring the
   * hash ourselves is what makes a link into the dossier actually work, which
   * is the whole point of "deep-linkable": the Pendaftaran section is a lazy
   * row inside a closed group three quarters down a long page.
   *
   * Runs once the student has loaded (before that there are no sections to
   * jump to) and only marks the intent as handled after it fires, so a hash
   * pointing at a section that renders conditionally still lands. A closed
   * group may not be in the DOM, so "does it exist" is answered from state.
   */
  const hashHandled = useRef(false);
  useEffect(() => {
    // No student yet (first fetch failed, "Coba Lagi" pending): nothing to jump
    // to, and the intent must survive until there is.
    if (loading || !student || hashHandled.current) return;
    const target = window.location.hash.replace(/^#/, "");
    if (!target) { hashHandled.current = true; return; }
    const known = isKnownTarget(target, {
      hasApplication: !!overview?.enrollmentApplication,
      lifecycleShown: student.status === "WITHDRAWN" || student.status === "GRADUATED",
    });
    if (!known) return;
    hashHandled.current = true;
    jumpToSection(target);
  }, [loading, student, jumpToSection, overview]);

  /**
   * `?aksi=daftarkan-kelas` opens "Daftarkan ke Kelas" — the pendaftaran convert toast links
   * here so staff can place the new student without hunting for the button. Read once after
   * the student loads, then dropped from the URL so a refresh does not reopen the dialog.
   */
  const enrollIntentHandled = useRef(false);
  useEffect(() => {
    if (loading || !student || enrollIntentHandled.current) return;
    enrollIntentHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("aksi") !== "daftarkan-kelas") return;
    params.delete("aksi");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    if (student.canEdit && student.status === "ACTIVE") setEnrollDialog(true);
  }, [loading, student]);

  // --- Data Anak edit toggle ---
  function startEditingDataAnak() {
    if (!student) return;
    // Switching to the edit form while Informasi Tambahan holds unsaved rows
    // risks losing typed work if that section's own save races this one —
    // warn instead of silently proceeding.
    if (tambahanRef.current.dirty) {
      toast.error("Simpan informasi tambahan dulu sebelum mengedit data siswa.");
      return;
    }
    dataAnakForm.reset({
      name: student.name, nickname: student.nickname ?? "",
      dateOfBirth: student.dateOfBirth ?? "", gender: student.gender ?? "",
      address: student.address ?? "", notes: student.notes ?? "",
      nis: student.nis ?? "", nisn: student.nisn ?? "", birthPlace: student.birthPlace ?? "",
      nik: student.nik ?? "", kkNumber: student.kkNumber ?? "", livingWith: student.livingWith ?? "",
    });
    setIsEditingDataAnak(true);
    setSectionOpen(GROUP_PROFIL, true);
  }

  // Unsaved Data Anak edits: sidebar / breadcrumb clicks ask before leaving
  // (same guard the Rapor editor uses). Must run before the early returns below.
  const dataAnakDirty = isEditingDataAnak && dataAnakForm.formState.isDirty;
  useUnsavedChangesGuard(
    dataAnakDirty,
    "Perubahan data siswa yang belum disimpan akan hilang.",
  );
  // R2-ADMIN-7: the guard above covers app-shell links (sidebar, breadcrumb,
  // and DetailPageHeader's "Kembali" link, which is a GuardedLink). Reload /
  // tab-close / hard navigation get the browser's own prompt. In-app browser
  // Back is a popstate the App Router handles itself — not interceptable
  // without a history shim, so it stays best-effort.
  useEffect(() => {
    if (!dataAnakDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dataAnakDirty]);

  // In-flight latch for save: a fast double click (or Enter + click) must not
  // send two PUTs. The button's `disabled` only lands after the next render.
  const savingDataAnak = useRef(false);
  const saveDataAnak = dataAnakForm.handleSubmit(async (values) => {
    if (savingDataAnak.current) return;
    savingDataAnak.current = true;
    try {
      await sendStudentJson(`/api/students/${id}`, { method: "PUT", body: values }, "Gagal menyimpan");
      toast.success("Data siswa diperbarui");
      setIsEditingDataAnak(false);
      fetchStudent();
    } catch (err) {
      applyStudentErrors(dataAnakForm, err, "Gagal menyimpan");
    } finally {
      savingDataAnak.current = false;
    }
  });

  // --- Metadata persistence ---
  /**
   * Single writer for `Student.metadata`. Both editors (the typed health block
   * in `KesehatanSection` and the free-form rows in `InformasiTambahanSection`)
   * funnel through here with the *whole* three-bucket state, so saving one can
   * never drop the other — or the machine-owned keys neither of them renders.
   */
  async function persistMetadata(next: {
    known: Record<string, string>;
    extra: MetadataExtraRow[];
  }): Promise<boolean> {
    const payload = buildStudentMetadata({
      known: next.known,
      extra: next.extra,
      system: metaSystem,
    });
    try {
      const res = await fetch(`/api/students/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: payload }),
      });
      if (res.ok) return true;
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Gagal menyimpan");
      return false;
    } catch {
      toast.error("Terjadi kesalahan jaringan");
      return false;
    }
  }

  if (loading) return <DetailPageSkeleton />;
  if (!student) {
    if (loadError === "not-found") return <EmptyState title="Siswa tidak ditemukan" description="Periksa kembali tautan siswa atau pilih siswa dari daftar." actionLabel="Kembali ke Daftar Siswa" actionHref={listHref} />;
    if (loadError === "denied") return <EmptyState title="Data siswa tidak bisa diakses" description="Sesi Anda berakhir atau akun Anda tidak memiliki akses." actionLabel="Kembali ke Daftar Siswa" actionHref={listHref} />;
    return <div role="alert"><EmptyState title="Data siswa belum bisa dimuat" description="Periksa koneksi Anda, lalu coba lagi." actionLabel="Coba Lagi" onAction={() => { setLoading(true); fetchStudent(); }} /></div>;
  }

  // A student can hold a school (SEMESTER) and a day-care (YEAR_ROUND)
  // enrollment at once, and many carry a stale ACTIVE row in an archived
  // year. The API returns enrollments newest-first, so `.find(ACTIVE)` used
  // to surface whichever was created last — after enrolling into day care
  // the header announced the day-care class as the child's placement.
  // Primary (school) first, then any other current placement, matching the
  // students list. The Riwayat Kelas section below still lists every row.
  const currentEnrollments = student.enrollments.filter(
    e => e.status === "ACTIVE" && e.classSection.academicYear.status !== "ARCHIVED",
  );
  const primaryEnrollment = pickPrimaryEnrollment(currentEnrollments);
  const orderedEnrollments = primaryEnrollment
    ? [primaryEnrollment, ...currentEnrollments.filter(e => e.id !== primaryEnrollment.id)]
    : [];
  const activeEnrollment = primaryEnrollment;
  const hasActiveEnrollment = student.enrollments.some((e) => e.status === "ACTIVE");

  const activeGuardians = student.guardians.filter((g) => g.status !== "INACTIVE");
  const siblings = deriveSiblings(student.guardians, student.id);
  const parsedMetadata = parseStudentMetadata(student.metadata);
  const flags = healthFlags(parsedMetadata);
  const age = formatAgeShort(student.dateOfBirth);
  const lifecycleShown = student.status === "WITHDRAWN" || student.status === "GRADUATED";

  // Earliest enrollment = when this child actually joined the school. Plain
  // string compare is safe: the column is YYYY-MM-DD.
  const joinedDate = student.enrollments.reduce<string | null>(
    (min, e) => (e.enrollDate && (!min || e.enrollDate < min) ? e.enrollDate : min),
    null,
  );

  // KK is a per-family document — resolve it through the primary wali, falling
  // back to the first active one.
  const kkGuardian = activeGuardians.find((g) => g.isPrimary) ?? activeGuardians[0] ?? null;
  const hasKk = kkGuardian?.parent.hasKk ?? false;
  const contactGuardian = kkGuardian;

  // Presence only — this is "is the file on record", not a required-documents
  // policy. The school has not defined one, so nothing here is called missing.
  const docItems: Array<MissingDoc & { present: boolean }> = [
    { label: "Foto siswa", present: !!student.photoUrl, ...DOC_TARGET_FOTO },
    { label: "KK keluarga", present: hasKk, ...DOC_TARGET_KK },
    // The guardian page owns KTP upload, so that row leaves this page.
    ...activeGuardians.map((g) => ({
      label: `KTP ${g.parent.name}`,
      present: g.parent.hasKtp,
      href: guardianDocumentsHref(g.parent.id),
    })),
    // Only for a student who came from the form. A hand-entered student never
    // had a consent letter to sign, so listing it as missing would invent a gap.
    ...(overview?.enrollmentApplication
      ? [{ label: "Surat persetujuan", present: overview.documents?.consent === true, ...DOC_TARGET_PENDAFTARAN }]
      : []),
    // Paper-form checklist (x / N). Only for a converted student, same reason.
    ...(overview?.documents?.enrollment
      ? [
          {
            label: `Berkas pendaftaran (${overview.documents.enrollment.done} / ${overview.documents.enrollment.required})`,
            present: overview.documents.enrollment.done >= overview.documents.enrollment.required,
            ...DOC_TARGET_PENDAFTARAN,
          },
        ]
      : []),
  ];
  const docsPresent = docItems.filter((d) => d.present).length;

  // Increment 3 additions, all read off the one aggregate fetch.
  // Optional-chained all the way down: a 200 with an unexpected body (a proxy
  // error page, a future field rename) must degrade to the same dash the
  // failure path shows, not throw the whole dossier away.
  const application = overview?.enrollmentApplication ?? null;
  const attendanceCounts = overview?.attendance?.counts ?? null;
  const raportTally = overview?.raport ?? null;
  // The class the raport deep link should preselect. Primary (school) placement
  // rather than a day-care row — raport is a school-programme artefact.
  const primaryClassSectionId = primaryEnrollment?.classSection.id ?? null;

  // Summary over whatever the invoice fetch returned. Until it lands, the
  // empty summary reads as zero everywhere — which is why the Tunggakan tile
  // below distinguishes "not loaded yet" from "nothing owed".
  const invoiceSummary = invoices ? summarizeStudentInvoices(invoices) : EMPTY_INVOICE_SUMMARY;
  const invoicesLoading = invoices === null && !invoicesError;

  // One line per group, shown only while the group is closed. The overview-
  // backed parts stay null until that request lands, so nothing reads as zero.
  const summaries = {
    [GROUP_PROFIL]: profilSummary({ nis: student.nis, gender: student.gender, allergy: flags.allergy }),
    [GROUP_KELUARGA]: keluargaSummary({
      guardianCount: activeGuardians.length,
      siblingCount: siblings.length,
      docsPresent,
      docsTotal: docItems.length,
    }),
    [GROUP_KELAS]: kelasSummary({
      className: primaryEnrollment?.classSection.name ?? null,
      attendance: attendanceCounts,
      raport: raportTally,
    }),
    [GROUP_KEUANGAN]: keuanganSummary({
      loading: invoicesLoading,
      error: invoicesError !== null,
      summary: invoiceSummary,
      keringananCount,
      cutiCount,
    }),
    [GROUP_CATATAN]: catatanSummary({
      application: overview ? application : undefined,
      fromFormulir: !!metaSystem.fromEnrollmentApplication,
    }),
  };

  // The header carries at most one visible action, chosen by the child's state
  // (a second filled button would compete with it, and "Edit" now lives in Data
  // Anak). Everything else is in the ⋯ menu, on every viewport.
  //   ACTIVE, no class        → "Daftarkan ke Kelas", filled: the one job left to do.
  //   WITHDRAWN or GRADUATED  → "Aktifkan kembali", the way back (R2-ADMIN-8: a
  //                             mistaken Luluskan used to be a dead end). Never
  //                             "Daftarkan ke Kelas": the API refuses anyone not
  //                             ACTIVE with STUDENT_NOT_ACTIVE.
  //   ACTIVE and placed       → no visible button.
  // "Placed" is what the page shows as placed (a current, non-archived class,
  // day care included) — the same test as the header subtitle, not the looser
  // "any ACTIVE row" that the Luluskan guard below mirrors from the server.
  const canManage = student.canEdit === true;
  const isActiveStudent = student.status === "ACTIVE";
  const isPlaced = !!activeEnrollment;
  const primaryHeaderActions: DetailPageHeaderAction[] = [
    ...(canManage && isActiveStudent && !isPlaced
      ? [{
          label: "Daftarkan ke Kelas",
          icon: <Plus size={14} aria-hidden="true" />,
          onClick: () => setEnrollDialog(true),
          variant: "default" as const,
        }]
      : []),
    ...(canManage && (student.status === "WITHDRAWN" || student.status === "GRADUATED")
      ? [{
          label: "Aktifkan kembali",
          icon: <RotateCcw size={14} aria-hidden="true" />,
          onClick: () => setReactivateOpen(true),
        }]
      : []),
  ];

  const menuHeaderActions: DetailPageHeaderAction[] = [
    // Already placed: this adds a second placement (day care next to school).
    ...(canManage && isActiveStudent && isPlaced
      ? [{ label: "Daftarkan ke Kelas", onClick: () => setEnrollDialog(true) }]
      : []),
    ...(canManage && isActiveStudent && activeEnrollment
      ? [{ label: "Naik Kelas", onClick: openPromoteDialog }]
      : []),
    // Graduating ends the active enrolments — with none there is nothing to
    // graduate from (the API answers 409 "kelas aktif"). Any ACTIVE row counts,
    // including a stale one in an archived year, matching the server's check.
    ...(canManage && isActiveStudent && hasActiveEnrollment
      ? [{ label: "Luluskan", onClick: () => setGraduateOpen(true) }]
      : []),
    ...(canManage && isActiveStudent
      ? [{ label: "Keluarkan", onClick: () => setWithdrawDialogOpen(true), destructive: true }]
      : []),
  ];

  const attentionItems = buildStudentAttentionItems({
    studentName: student.name,
    canEdit: canManage,
    isActive: isActiveStudent,
    isPlaced,
    invoices: { loading: invoicesLoading, error: invoicesError !== null, summary: invoiceSummary },
    activeGuardianCount: activeGuardians.length,
    hasPrimaryGuardian: activeGuardians.some((g) => g.isPrimary),
    missingDocs: docItems.filter((d) => !d.present).map(({ label, section, href }) => ({ label, section, href })),
    raportDraft: raportTally?.draft ?? null,
    onJump: jumpToSection,
    onEnroll: () => setEnrollDialog(true),
  });
  const railTiles = buildRailTiles({
    invoices: { loading: invoicesLoading, error: invoicesError !== null, summary: invoiceSummary },
    overviewError,
    attendanceCounts,
    raportTally,
  });

  return (
    <>
      <DetailPageHeader
        backHref={listHref}
        backLabel="Kembali ke Daftar Siswa"
        title={student.name}
        description={
          [
            student.nickname,
            age,
            orderedEnrollments.length > 0
              ? orderedEnrollments.map(e => `${e.classSection.program.name} · ${e.classSection.name}`).join(" + ")
              : "Belum terdaftar di kelas",
          ]
            .filter(Boolean)
            .join(" · ")
        }
        badge={
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={student.status} />
            {/* Allergy and illness ride in the header, not three sections down:
                they are the one fact a teacher or admin must not have to hunt for. */}
            {flags.allergy && (
              <Badge variant="info">
                Alergi: {flags.allergy}
              </Badge>
            )}
            {flags.illness && (
              <Badge variant="info">
                Riwayat: {flags.illness}
              </Badge>
            )}
          </div>
        }
        primaryActions={primaryHeaderActions}
        menuActions={menuHeaderActions}
      />

      <AttentionStrip items={attentionItems} className="mb-4" />

      <FamilyContactStrip
        guardian={contactGuardian}
        guardianCount={activeGuardians.length}
        onSeeAll={() => jumpToSection(SECTION_KELUARGA)}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <DossierNav sections={GROUPS} onJump={jumpToSection} />

          {/* ---------- Profil ---------- */}
          <DossierGroup
            id={GROUP_PROFIL}
            label="Profil"
            keepMounted
            summary={summaries[GROUP_PROFIL]}
            open={openSections[GROUP_PROFIL] ?? true}
            onOpenChange={(o) => handleSectionOpenChange(GROUP_PROFIL, o)}
          >
            <DataAnakSection
              student={student}
              age={age}
              canEdit={student.canEdit === true}
              editing={isEditingDataAnak}
              form={dataAnakForm}
              formId={dataAnakFormId}
              onEdit={startEditingDataAnak}
              onSave={saveDataAnak}
              onCancel={() => setIsEditingDataAnak(false)}
              onSaved={fetchStudent}
            />

            <KesehatanSection
              canEdit={student.canEdit === true}
              known={metaKnown}
              system={metaSystem}
              hasAllergy={!!flags.allergy}
              persistMetadata={persistMetadata}
              getExtraRows={() => tambahanRef.current.rows}
              onSaved={fetchStudent}
            />

            <InformasiTambahanSection
              canEdit={student.canEdit === true}
              extra={metaExtra}
              known={metaKnown}
              persistMetadata={persistMetadata}
              onSaved={fetchStudent}
              onStateChange={(state) => { tambahanRef.current = state; }}
            />
          </DossierGroup>

          {/* ---------- Keluarga & Berkas ---------- */}
          <DossierGroup
            id={GROUP_KELUARGA}
            label="Keluarga & Berkas"
            summary={summaries[GROUP_KELUARGA]}
            open={openSections[GROUP_KELUARGA] ?? true}
            onOpenChange={(o) => handleSectionOpenChange(GROUP_KELUARGA, o)}
          >
            <KeluargaSection
              student={student}
              studentId={id}
              onSaved={fetchStudent}
            />

            <DokumenSection
              canEdit={student.canEdit === true}
              kkGuardian={kkGuardian}
              hasKk={hasKk}
            />
          </DossierGroup>

          {/* ---------- Kelas & Akademik ----------
              Holds the lazy Kehadiran and Akademik rows, so the group keeps its
              children mounted while closed: what they fetched survives a collapse. */}
          <DossierGroup
            id={GROUP_KELAS}
            label="Kelas & Akademik"
            summary={summaries[GROUP_KELAS]}
            open={openSections[GROUP_KELAS] ?? false}
            onOpenChange={(o) => handleSectionOpenChange(GROUP_KELAS, o)}
            keepMounted
          >
            <KelasSaatIniSection enrollments={orderedEnrollments} joinedDate={joinedDate} />

            <RiwayatKelasSection canEdit={student.canEdit === true} enrollments={student.enrollments} />

            <KehadiranSection
              studentId={id}
              active={kehadiranActive}
              open={openSections[SECTION_KEHADIRAN] ?? false}
              onOpenChange={(o) => handleSectionOpenChange(SECTION_KEHADIRAN, o)}
            />

            {/* Akademik (lazy): raport state per triwulan + that term's penilaian
                coverage, over GET /api/students/[id]/academics. Read-only: every
                row deep-links to /admin/report-cards, which owns the authoring
                and the publish. */}
            <DossierSubsection
              id={SECTION_AKADEMIK}
              label="Akademik"
              badge={
                raportTally && raportTally.total > 0 ? (
                  <Badge variant="neutral">
                    {raportTally.published}/{raportTally.total} terbit
                  </Badge>
                ) : undefined
              }
              open={openSections[SECTION_AKADEMIK] ?? false}
              onOpenChange={(o) => handleSectionOpenChange(SECTION_AKADEMIK, o)}
              keepMounted
            >
              <StudentAcademicsBlock
                studentId={id}
                classSectionId={primaryClassSectionId}
                active={akademikActive}
              />
            </DossierSubsection>

            {lifecycleShown && <RiwayatStatusSection student={student} onSaved={fetchStudent} />}
          </DossierGroup>

          {/* ---------- Keuangan ----------
              Read-only over GET /api/invoices?studentId=. Every write still
              belongs to the Tagihan module, so each row deep-links there. */}
          <DossierGroup
            id={GROUP_KEUANGAN}
            label="Keuangan"
            summary={summaries[GROUP_KEUANGAN]}
            open={openSections[GROUP_KEUANGAN] ?? true}
            onOpenChange={(o) => handleSectionOpenChange(GROUP_KEUANGAN, o)}
            keepMounted
          >
            <DossierSubsection
              id={SECTION_KEUANGAN}
              label="Tagihan"
              badge={
                invoiceSummary.unpaidCount > 0 ? (
                  <Badge variant="danger">
                    {invoiceSummary.unpaidCount} belum lunas
                  </Badge>
                ) : undefined
              }
            >
              <StudentFinanceBlock
                invoices={invoices ?? []}
                summary={invoiceSummary}
                statusGroups={overview?.finance?.byStatus ?? null}
                loading={invoicesLoading}
                error={invoicesError !== null}
                forbidden={invoicesError === "denied"}
                onRetry={fetchInvoices}
              />
            </DossierSubsection>

            {/* Keringanan (lazy) */}
            <DossierSubsection
              id={SECTION_KERINGANAN}
              label="Keringanan"
              badge={
                keringananCount != null && keringananCount > 0 ? (
                  <Badge variant="neutral">
                    {keringananCount}
                  </Badge>
                ) : undefined
              }
              open={openSections[SECTION_KERINGANAN] ?? false}
              onOpenChange={(o) => handleSectionOpenChange(SECTION_KERINGANAN, o)}
              keepMounted
            >
              <StudentKeringananBlock
                studentId={id}
                active={keringananActive}
                onCountChange={setKeringananCount}
              />
            </DossierSubsection>

            {/* Cuti (lazy): billing pauses per enrollment. Recording and
                cancelling are in-page dialogs (students.edit here, plus
                invoices.create on the API); the follow-up can cancel unpaid
                invoices through the existing void route. */}
            <DossierSubsection
              id={SECTION_CUTI}
              label="Cuti"
              badge={
                cutiCount != null && cutiCount > 0 ? (
                  <Badge variant="neutral">
                    {cutiCount}
                  </Badge>
                ) : undefined
              }
              open={openSections[SECTION_CUTI] ?? false}
              onOpenChange={(o) => handleSectionOpenChange(SECTION_CUTI, o)}
              keepMounted
            >
              <CutiSection
                studentId={id}
                active={cutiActive}
                canManage={canManage}
                onCountChange={setCutiCount}
                onInvoiceVoided={fetchInvoices}
              />
            </DossierSubsection>
          </DossierGroup>

          {/* ---------- Pendaftaran & Catatan ---------- */}
          <DossierGroup
            id={GROUP_CATATAN}
            label="Pendaftaran & Catatan"
            summary={summaries[GROUP_CATATAN]}
            open={openSections[GROUP_CATATAN] ?? false}
            onOpenChange={(o) => handleSectionOpenChange(GROUP_CATATAN, o)}
            keepMounted
          >
            {/* Formulir Pendaftaran (lazy): the original paper form, read-only.
                Rendered only for a student converted from one — `overview`
                answers that from the FK, so a hand-entered student never sees
                an empty row. */}
            {application && (
              <DossierSubsection
                id={SECTION_PENDAFTARAN}
                label="Formulir Pendaftaran"
                badge={
                  <Badge variant="neutral">
                    {application.submittedAt ? formatDateShort(application.submittedAt) : "Belum dikirim"}
                  </Badge>
                }
                open={openSections[SECTION_PENDAFTARAN] ?? false}
                onOpenChange={(o) => handleSectionOpenChange(SECTION_PENDAFTARAN, o)}
                keepMounted
              >
                <StudentEnrollmentApplicationBlock
                  studentId={id}
                  active={pendaftaranActive}
                  onDocumentsChange={fetchOverview}
                />
              </DossierSubsection>
            )}

            {/* Buku Penghubung (lazy) */}
            <DossierSubsection
              id={SECTION_JURNAL}
              label="Buku Penghubung"
              open={openSections[SECTION_JURNAL] ?? false}
              onOpenChange={(o) => handleSectionOpenChange(SECTION_JURNAL, o)}
              keepMounted
            >
              <StudentJournalBlock studentId={id} active={jurnalActive} />
            </DossierSubsection>
          </DossierGroup>
        </div>

        {/* Desktop only: below lg the rail is hidden and the strip, the family
            row and the closed groups' summaries carry the same facts. */}
        <StudentRail
          tiles={railTiles}
          createdAt={student.createdAt}
          fromEnrollmentApplication={metaSystem.fromEnrollmentApplication}
        />
      </div>

      <StudentEnrollDialog
        studentId={id}
        open={enrollDialog}
        onOpenChange={setEnrollDialog}
        onEnrolled={fetchStudent}
        isMobile={isMobile}
      />

      <StudentLifecycleDialogs
        studentId={id}
        studentName={student.name}
        promoteOpen={promoteDialogOpen}
        onPromoteOpenChange={setPromoteDialogOpen}
        promoteSections={promoteSections}
        graduateOpen={graduateOpen}
        onGraduateOpenChange={setGraduateOpen}
        withdrawOpen={withdrawDialogOpen}
        onWithdrawOpenChange={setWithdrawDialogOpen}
        studentStatus={student.status}
        reactivateOpen={reactivateOpen}
        onReactivateOpenChange={setReactivateOpen}
        onChanged={fetchStudent}
      />
    </>
  );
}
