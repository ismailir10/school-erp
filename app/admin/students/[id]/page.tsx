"use client";

import { useEffect, useState, useCallback, useRef, useId } from "react";
import { useParams } from "next/navigation";
import { DetailPageHeader, type DetailPageHeaderAction } from "@/components/admin/detail-page-header";
import { DetailPageSkeleton } from "@/components/admin/detail-page-skeleton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useIsMobile } from "@/hooks/use-mobile";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { formatDateShort, formatRupiah } from "@/lib/format";
import { studentDetailEditFormSchema } from "@/lib/validations/student";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { StudentEnrollDialog } from "@/components/admin/student-enroll-dialog";
import type { ClassSection } from "@/components/admin/class-section-picker";
import { pickPrimaryEnrollment } from "@/lib/enrollment/active";
import { DossierNav, DossierSection, type DossierSectionDef } from "@/components/admin/dossier-section";
import { DetailRail, RailCard, RailKV, RailStatTiles, RailChecklist, type RailItem } from "@/components/admin/detail-rail";
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
import { StudentRailContent } from "@/components/admin/students/detail/rail-content";
import type { Student } from "@/components/admin/students/detail/types";

const EMPTY_SYSTEM_METADATA: StudentSystemMetadata = {
  fromEnrollmentApplication: null,
  dcareAddon: false,
  priorFamilyAttendees: [],
};

/**
 * Section ids double as DOM anchor targets for `DossierNav`. Order here is the
 * render order and the nav order — one list, no second place to forget.
 */
const SECTION_DATA_ANAK = "data-anak";
const SECTION_KESEHATAN = "kesehatan";
const SECTION_KELUARGA = "keluarga";
const SECTION_RIWAYAT_KELAS = "riwayat-kelas";
const SECTION_KEHADIRAN = "kehadiran";
const SECTION_KEUANGAN = "keuangan";
const SECTION_KERINGANAN = "keringanan";
const SECTION_JURNAL = "buku-penghubung";
const SECTION_AKADEMIK = "akademik";
const SECTION_PENDAFTARAN = "pendaftaran";
const SECTION_DOKUMEN = "dokumen";
const SECTION_STATUS = "riwayat-status";
const SECTION_TAMBAHAN = "informasi-tambahan";

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

  // --- Data Anak edit toggle ---
  // Owned here, not by `DataAnakSection`: the trigger is the "Edit" button in
  // `DetailPageHeader`, outside that section's own subtree, and starting an
  // edit has to check Informasi Tambahan's dirty state — a sibling section.
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
  const [invoicesError, setInvoicesError] = useState(false);

  // --- Lazy sections (increment 2) ---
  // One-way latches: opening the section pays for the fetch, closing it again
  // does not un-fetch, and re-opening does not re-request.
  const [keringananActive, setKeringananActive] = useState(false);
  const [keringananCount, setKeringananCount] = useState<number | null>(null);
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

  // --- Section open/collapse state ---
  // Kehadiran starts closed on every viewport: it is the one section that costs
  // a second request, and opening it is what triggers the fetch.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => ({
    [SECTION_DATA_ANAK]: true,
    [SECTION_KESEHATAN]: true,
    [SECTION_KELUARGA]: true,
    [SECTION_RIWAYAT_KELAS]: true,
    [SECTION_KEHADIRAN]: false,
    [SECTION_KEUANGAN]: true,
    // Both cost a request, so both start closed — same rule as Kehadiran.
    [SECTION_KERINGANAN]: false,
    [SECTION_JURNAL]: false,
    // Increment 3's two sections follow the same rule: each costs a request.
    [SECTION_AKADEMIK]: false,
    [SECTION_PENDAFTARAN]: false,
    [SECTION_DOKUMEN]: true,
    [SECTION_STATUS]: true,
    [SECTION_TAMBAHAN]: true,
  }));
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
      if (!res.ok) { toast.error("Gagal memuat data siswa"); return; }
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
    } catch { toast.error("Terjadi kesalahan"); }
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
    setInvoicesError(false);
    try {
      const res = await fetch(`/api/invoices?studentId=${encodeURIComponent(id)}&pageSize=100`);
      if (!res.ok) { setInvoicesError(true); return; }
      const json = await res.json();
      setInvoices(Array.isArray(json?.data) ? json.data : []);
    } catch {
      setInvoicesError(true);
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

  // Mobile default: one open section, not eight. Runs only while the admin has
  // not touched a disclosure themselves.
  useEffect(() => {
    if (!isMobile || sectionsTouched.current) return;
    setOpenSections((prev) => {
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(prev)) next[key] = key === SECTION_DATA_ANAK;
      return next;
    });
  }, [isMobile]);

  const handleSectionOpenChange = useCallback(
    (sectionId: string, open: boolean) => {
      setSectionOpen(sectionId, open);
      if (open && sectionId === SECTION_KEHADIRAN) setKehadiranActive(true);
      if (open && sectionId === SECTION_KERINGANAN) setKeringananActive(true);
      if (open && sectionId === SECTION_JURNAL) setJurnalActive(true);
      if (open && sectionId === SECTION_AKADEMIK) setAkademikActive(true);
      if (open && sectionId === SECTION_PENDAFTARAN) setPendaftaranActive(true);
    },
    [setSectionOpen],
  );

  /** Nav click: expand first (a collapsed target is nothing to scroll to), then scroll. */
  const jumpToSection = useCallback(
    (sectionId: string) => {
      handleSectionOpenChange(sectionId, true);
      requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [handleSectionOpenChange],
  );

  /**
   * `#pendaftaran`, `#akademik`, `#keuangan` … — every section id is already a
   * DOM anchor, but the browser's own hash scroll fires before the section
   * exists and lands on nothing when the section is collapsed. Honouring the
   * hash ourselves is what makes a link into the dossier actually work, which
   * is the whole point of "deep-linkable": the Pendaftaran section is a lazy,
   * collapsed section three quarters down a long page.
   *
   * Runs once the student has loaded (before that there are no sections to
   * jump to) and only marks the intent as handled after it fires, so a hash
   * pointing at a section that renders conditionally still lands.
   */
  const hashHandled = useRef(false);
  useEffect(() => {
    if (loading || hashHandled.current) return;
    const target = window.location.hash.replace(/^#/, "");
    if (!target) { hashHandled.current = true; return; }
    if (!document.getElementById(target)) return;
    hashHandled.current = true;
    jumpToSection(target);
  }, [loading, jumpToSection, overview]);

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
    setSectionOpen(SECTION_DATA_ANAK, true);
  }

  const saveDataAnak = dataAnakForm.handleSubmit(async (values) => {
    try {
      await sendJson(`/api/students/${id}`, { method: "PUT", body: values }, "Gagal menyimpan");
      toast.success("Data siswa diperbarui");
      setIsEditingDataAnak(false);
      fetchStudent();
    } catch (err) {
      applyServerErrors(dataAnakForm, err, "Gagal menyimpan");
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
  if (!student) return <EmptyState title="Siswa tidak ditemukan" description="Data siswa tidak tersedia atau telah dihapus." />;

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
  const docItems = [
    { label: "Foto siswa", present: !!student.photoUrl },
    { label: "KK keluarga", present: hasKk },
    ...activeGuardians.map((g) => ({
      label: `KTP ${g.parent.name}`,
      present: g.parent.hasKtp,
    })),
    // Only for a student who came from the form. A hand-entered student never
    // had a consent letter to sign, so listing it as missing would invent a gap.
    ...(overview?.enrollmentApplication
      ? [{ label: "Surat persetujuan", present: overview.documents?.consent === true }]
      : []),
    // Paper-form checklist (x / N). Only for a converted student, same reason.
    ...(overview?.documents?.enrollment
      ? [
          {
            label: `Berkas pendaftaran (${overview.documents.enrollment.done} / ${overview.documents.enrollment.required})`,
            present: overview.documents.enrollment.done >= overview.documents.enrollment.required,
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

  const navSections: DossierSectionDef[] = [
    { id: SECTION_DATA_ANAK, label: "Data Anak" },
    { id: SECTION_KESEHATAN, label: "Kesehatan & Kelahiran" },
    { id: SECTION_KELUARGA, label: "Keluarga & Wali" },
    { id: SECTION_RIWAYAT_KELAS, label: "Riwayat Kelas" },
    { id: SECTION_KEHADIRAN, label: "Kehadiran" },
    { id: SECTION_KEUANGAN, label: "Keuangan" },
    { id: SECTION_KERINGANAN, label: "Keringanan" },
    { id: SECTION_JURNAL, label: "Buku Penghubung" },
    { id: SECTION_AKADEMIK, label: "Akademik" },
    // Listed only when the student actually came from a pendaftaran form —
    // a nav entry that scrolls to nothing is worse than no entry.
    ...(application ? [{ id: SECTION_PENDAFTARAN, label: "Pendaftaran" }] : []),
    { id: SECTION_DOKUMEN, label: "Dokumen" },
    ...(lifecycleShown ? [{ id: SECTION_STATUS, label: "Riwayat Status" }] : []),
    { id: SECTION_TAMBAHAN, label: "Informasi Tambahan" },
  ];

  const statTiles = [
    { label: "Usia", value: age ?? "—", hint: student.dateOfBirth ? formatDateShort(student.dateOfBirth) : undefined },
    { label: "Kelas Aktif", value: currentEnrollments.length, hint: currentEnrollments.length > 1 ? "sekolah + day care" : undefined },
    { label: "Wali Aktif", value: activeGuardians.length, hint: siblings.length > 0 ? `${siblings.length} saudara` : undefined },
    {
      label: "Berkas",
      value: `${docsPresent}/${docItems.length}`,
      tone: (docsPresent < docItems.length ? "warning" : "positive") as "warning" | "positive",
    },
    // Kehadiran and Raport are the two tiles increments 1 and 2 left out rather
    // than ship blank. They read the aggregate route, so neither costs a row
    // dump — and both distinguish "not loaded" from a real zero.
    {
      label: "Hadir Bln Ini",
      value: overviewError ? (
        <span className="text-muted-foreground">—</span>
      ) : !attendanceCounts ? (
        <span className="text-muted-foreground">Memuat…</span>
      ) : attendanceCounts.total === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        `${attendanceCounts.present}/${attendanceCounts.total}`
      ),
      tone: (attendanceCounts && attendanceCounts.total > 0 && attendanceCounts.absent > 0
        ? "warning"
        : "default") as "warning" | "default",
      hint:
        !attendanceCounts || overviewError
          ? undefined
          : attendanceCounts.total === 0
            ? "Belum ada absensi bulan ini"
            : [
                attendanceCounts.absent > 0 ? `${attendanceCounts.absent} alpa` : null,
                attendanceCounts.sick > 0 ? `${attendanceCounts.sick} sakit` : null,
                attendanceCounts.permission > 0 ? `${attendanceCounts.permission} izin` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Hadir penuh",
    },
    {
      label: "Raport",
      value: overviewError ? (
        <span className="text-muted-foreground">—</span>
      ) : !raportTally ? (
        <span className="text-muted-foreground">Memuat…</span>
      ) : raportTally.total === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        `${raportTally.published}/${raportTally.total}`
      ),
      tone: "default" as const,
      hint:
        !raportTally || overviewError
          ? undefined
          : raportTally.total === 0
            ? "Triwulan belum dibuat"
            : raportTally.draft > 0
              ? `${raportTally.draft} draf`
              : raportTally.published === 0
                ? // Found in smoke: with 0 published and 0 draft this said
                  // "terbit", which reads as though a raport had been issued.
                  "Belum ada raport"
                : "semua terbit",
    },
    // Real figure or an honest dash — never a zero that could mean either
    // "paid up" or "we could not load it".
    {
      label: "Tunggakan",
      wide: true,
      value: invoicesLoading ? (
        <span className="text-muted-foreground">Memuat…</span>
      ) : invoicesError ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="font-currency">{formatRupiah(invoiceSummary.outstanding)}</span>
      ),
      tone: (invoiceSummary.outstanding > 0 ? "critical" : "positive") as "critical" | "positive",
      hint: invoicesLoading || invoicesError
        ? undefined
        : invoiceSummary.unpaidCount > 0
          ? `${invoiceSummary.unpaidCount} tagihan belum lunas${
              invoiceSummary.nearestDue ? ` · ${formatDateShort(invoiceSummary.nearestDue)}` : ""
            }`
          : "Lunas semua",
    },
  ];

  const summaryItems: RailItem[] = [
    { label: "Status", value: <StatusBadge status={student.status} /> },
    ...(primaryEnrollment
      ? [{ label: "Kelas utama", value: `${primaryEnrollment.classSection.name}` }]
      : []),
    ...(orderedEnrollments.slice(1).map((e) => ({
      label: e.classSection.program.name,
      value: e.classSection.name,
    }))),
    ...(primaryEnrollment
      ? [{ label: "Tahun ajaran", value: primaryEnrollment.classSection.academicYear.name }]
      : []),
    ...(primaryEnrollment
      ? [{ label: "Kampus", value: primaryEnrollment.classSection.campus.name }]
      : []),
    ...(joinedDate ? [{ label: "Masuk sejak", value: formatDateShort(joinedDate) }] : []),
    ...(student.nis ? [{ label: "NIS", value: <span className="font-currency">{student.nis}</span> }] : []),
  ];

  // DetailPageHeader caps visible buttons at two — Edit and the most-used
  // action (Daftarkan ke Kelas) stay visible; the rest (including the
  // destructive Keluarkan) live in its `⋯` overflow menu, on every viewport,
  // so there is one action layout instead of a separate mobile one.
  const primaryHeaderActions: DetailPageHeaderAction[] = [
    ...(!isEditingDataAnak
      ? [{ label: "Edit", icon: <Pencil size={14} aria-hidden="true" />, onClick: startEditingDataAnak }]
      : []),
    {
      label: "Daftarkan ke Kelas",
      icon: <Plus size={14} aria-hidden="true" />,
      onClick: () => setEnrollDialog(true),
    },
  ];

  const menuHeaderActions: DetailPageHeaderAction[] = [
    ...(student.status === "ACTIVE" && activeEnrollment
      ? [{ label: "Naik Kelas", onClick: openPromoteDialog }]
      : []),
    ...(student.status === "ACTIVE"
      ? [{ label: "Luluskan", onClick: () => setGraduateOpen(true) }]
      : []),
    ...(student.status === "ACTIVE"
      ? [{ label: "Keluarkan", onClick: () => setWithdrawDialogOpen(true), destructive: true }]
      : []),
  ];

  const railContent = (
    <>
      <RailStatTiles tiles={statTiles} />
      <StudentRailContent
        summaryItems={summaryItems}
        contactGuardian={contactGuardian}
        docItems={docItems}
        createdAt={student.createdAt}
        fromEnrollmentApplication={metaSystem.fromEnrollmentApplication}
      />
    </>
  );

  return (
    <>
      <DetailPageHeader
        backHref="/admin/students"
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
              <Badge className="bg-status-leave-subtle text-status-leave-text text-xs">
                Alergi: {flags.allergy}
              </Badge>
            )}
            {flags.illness && (
              <Badge className="bg-status-leave-subtle text-status-leave-text text-xs">
                Riwayat: {flags.illness}
              </Badge>
            )}
          </div>
        }
        primaryActions={primaryHeaderActions}
        menuActions={menuHeaderActions}
      />

      {/* Mobile: the rail's numbers move above the sections so the first
          viewport still answers "who is this child". */}
      {isMobile && <div className="mb-4"><RailStatTiles tiles={statTiles} /></div>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <DossierNav sections={navSections} onJump={jumpToSection} />

          <DataAnakSection
            student={student}
            age={age}
            open={openSections[SECTION_DATA_ANAK] ?? true}
            onOpenChange={(o) => handleSectionOpenChange(SECTION_DATA_ANAK, o)}
            editing={isEditingDataAnak}
            form={dataAnakForm}
            formId={dataAnakFormId}
            onSave={saveDataAnak}
            onCancel={() => setIsEditingDataAnak(false)}
            onSaved={fetchStudent}
          />

          <KesehatanSection
            known={metaKnown}
            system={metaSystem}
            hasAllergy={!!flags.allergy}
            open={openSections[SECTION_KESEHATAN] ?? true}
            onOpenChange={(o) => handleSectionOpenChange(SECTION_KESEHATAN, o)}
            persistMetadata={persistMetadata}
            getExtraRows={() => tambahanRef.current.rows}
            onSaved={fetchStudent}
          />

          <KeluargaSection
            student={student}
            studentId={id}
            open={openSections[SECTION_KELUARGA] ?? true}
            onOpenChange={(o) => handleSectionOpenChange(SECTION_KELUARGA, o)}
            onSaved={fetchStudent}
          />

          <RiwayatKelasSection
            enrollments={student.enrollments}
            open={openSections[SECTION_RIWAYAT_KELAS] ?? true}
            onOpenChange={(o) => handleSectionOpenChange(SECTION_RIWAYAT_KELAS, o)}
          />

          <KehadiranSection
            studentId={id}
            active={kehadiranActive}
            open={openSections[SECTION_KEHADIRAN] ?? false}
            onOpenChange={(o) => handleSectionOpenChange(SECTION_KEHADIRAN, o)}
          />

          {/* ---------- Keuangan (increment 2) ----------
              Read-only over GET /api/invoices?studentId=. Every write still
              belongs to the Tagihan module, so each row deep-links there. */}
          <DossierSection
            id={SECTION_KEUANGAN}
            label="Keuangan"
            badge={
              invoiceSummary.unpaidCount > 0 ? (
                <Badge className="bg-status-absent-subtle text-status-absent-text text-xs">
                  {invoiceSummary.unpaidCount} belum lunas
                </Badge>
              ) : undefined
            }
            open={openSections[SECTION_KEUANGAN] ?? true}
            onOpenChange={(o) => handleSectionOpenChange(SECTION_KEUANGAN, o)}
          >
            <StudentFinanceBlock
              invoices={invoices ?? []}
              summary={invoiceSummary}
              statusGroups={overview?.finance?.byStatus ?? null}
              loading={invoicesLoading}
              error={invoicesError}
              onRetry={fetchInvoices}
            />
          </DossierSection>

          {/* ---------- Keringanan (increment 2, lazy) ---------- */}
          <DossierSection
            id={SECTION_KERINGANAN}
            label="Keringanan"
            badge={
              keringananCount != null && keringananCount > 0 ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {keringananCount}
                </span>
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
          </DossierSection>

          {/* ---------- Buku Penghubung (increment 2, lazy) ---------- */}
          <DossierSection
            id={SECTION_JURNAL}
            label="Buku Penghubung"
            open={openSections[SECTION_JURNAL] ?? false}
            onOpenChange={(o) => handleSectionOpenChange(SECTION_JURNAL, o)}
            keepMounted
          >
            <StudentJournalBlock studentId={id} active={jurnalActive} />
          </DossierSection>

          {/* ---------- Akademik (increment 3, lazy) ----------
              Raport state per triwulan + that term's penilaian coverage, over
              GET /api/students/[id]/academics. Read-only: every row deep-links
              to /admin/report-cards, which owns the authoring and the publish. */}
          <DossierSection
            id={SECTION_AKADEMIK}
            label="Akademik"
            badge={
              raportTally && raportTally.total > 0 ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {raportTally.published}/{raportTally.total} terbit
                </span>
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
          </DossierSection>

          {/* ---------- Pendaftaran (increment 3, lazy) ----------
              The original paper form, read-only. Rendered only for a student
              converted from one — `overview` answers that from the FK, so a
              hand-entered student never sees an empty section. */}
          {application && (
            <DossierSection
              id={SECTION_PENDAFTARAN}
              label="Formulir Pendaftaran"
              badge={
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {application.submittedAt
                    ? formatDateShort(application.submittedAt.slice(0, 10))
                    : "Belum dikirim"}
                </span>
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
            </DossierSection>
          )}

          <DokumenSection
            kkGuardian={kkGuardian}
            hasKk={hasKk}
            open={openSections[SECTION_DOKUMEN] ?? true}
            onOpenChange={(o) => handleSectionOpenChange(SECTION_DOKUMEN, o)}
          />

          {lifecycleShown && (
            <RiwayatStatusSection
              student={student}
              open={openSections[SECTION_STATUS] ?? true}
              onOpenChange={(o) => handleSectionOpenChange(SECTION_STATUS, o)}
              onSaved={fetchStudent}
            />
          )}

          <InformasiTambahanSection
            extra={metaExtra}
            known={metaKnown}
            open={openSections[SECTION_TAMBAHAN] ?? true}
            onOpenChange={(o) => handleSectionOpenChange(SECTION_TAMBAHAN, o)}
            persistMetadata={persistMetadata}
            onSaved={fetchStudent}
            onStateChange={(state) => { tambahanRef.current = state; }}
          />
        </div>

        {/* Desktop rail. On mobile the tiles already rendered above and the
            remaining cards fall to the end of the document, after the sections. */}
        {isMobile ? (
          <div className="mt-2 flex flex-col gap-4">
            <RailCard title="Ringkasan"><RailKV items={summaryItems} /></RailCard>
            <RailCard title="Kelengkapan Berkas"><RailChecklist items={docItems} /></RailCard>
          </div>
        ) : (
          <DetailRail>{railContent}</DetailRail>
        )}
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
        onChanged={fetchStudent}
      />
    </>
  );
}
