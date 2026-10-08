import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  CalendarOff,
  Banknote,
  CalendarDays,
  GraduationCap,
  UserPlus,
  Coins,
  Receipt,
  Wallet,
  Building2,
  Clock,
  Shield,
  Heart,
  BookOpen,
  ClipboardList,
  ClipboardCheck,
  FileText,
  NotebookPen,
  Palette,
  School,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { PermissionCode } from "@/lib/permissions";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  matchExact?: boolean;
  permission?: PermissionCode;
  /**
   * Additional path prefixes that also count as "this item" for active-state
   * and breadcrumb resolution, without rendering as separate sidebar rows.
   * e.g. Pendaftaran (/admin/admissions) also owns the public enrollment
   * form surface at /admin/enrollments.
   */
  alsoMatch?: string[];
};

export type NavGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
  permission?: PermissionCode;
};

export type SettingsItem = NavItem & {
  /** One-line Indonesian description of what this destination configures. */
  description: string;
};

export type SettingsSection = {
  id: string;
  label: string;
  items: SettingsItem[];
};

export type NavConfig = {
  standalone: NavItem[];
  groups: NavGroup[];
  settingsHub: SettingsSection[];
};

/** Route for the settings hub page — also the active-state target for every hub item. */
export const SETTINGS_HUB_HREF = "/admin/settings";

/** Bottom-of-sidebar link to the settings hub. Rendered only when `hasVisibleSettings`. */
export const settingsNavLink: NavItem = {
  label: "Pengaturan",
  href: SETTINGS_HUB_HREF,
  icon: Settings,
};

export const adminNav: NavConfig = {
  standalone: [
    {
      label: "Dasbor",
      href: "/admin",
      icon: LayoutDashboard,
      matchExact: true,
    },
  ],

  groups: [
    {
      id: "students",
      label: "Kesiswaan",
      icon: GraduationCap,
      items: [
        {
          label: "Pendaftaran",
          href: "/admin/admissions",
          icon: UserPlus,
          permission: "admissions.view",
          alsoMatch: ["/admin/enrollments"],
        },
        { label: "Siswa", href: "/admin/students", icon: GraduationCap, permission: "students.view" },
        { label: "Wali Murid", href: "/admin/guardians", icon: Heart, permission: "students.view" },
        { label: "Kelas", href: "/admin/classes", icon: School, permission: "academic.view" },
      ],
    },
    {
      id: "daily",
      label: "Harian",
      icon: NotebookPen,
      items: [
        { label: "Kehadiran Siswa", href: "/admin/student-attendance", icon: CalendarCheck, permission: "students.view" },
        { label: "Buku Penghubung", href: "/admin/student-journal/monitoring", icon: BookOpen, permission: "students.view" },
      ],
    },
    {
      id: "assessment",
      label: "Penilaian",
      icon: ClipboardList,
      items: [
        { label: "Pemantauan", href: "/admin/assessments", icon: ClipboardCheck, permission: "assessments.read" },
        { label: "Rapor", href: "/admin/report-cards", icon: FileText, permission: "reportCard.read" },
      ],
    },
    {
      id: "finance",
      label: "Keuangan",
      icon: Coins,
      items: [
        { label: "Tagihan", href: "/admin/invoices", icon: Receipt, permission: "invoices.view" },
        { label: "Penerimaan", href: "/admin/payments", icon: Wallet, permission: "invoices.view" },
      ],
    },
    {
      id: "hr",
      label: "SDM",
      icon: Users,
      permission: "hr.view",
      items: [
        { label: "Karyawan", href: "/admin/employees", icon: Users, permission: "hr.view" },
        { label: "Kehadiran", href: "/admin/employee-attendance", icon: CalendarCheck, permission: "attendance.view" },
        { label: "Pengajuan Cuti", href: "/admin/leave-requests", icon: CalendarOff, permission: "leave.view" },
        { label: "Penggajian", href: "/admin/payroll", icon: Banknote, permission: "payroll.view" },
      ],
    },
  ],

  settingsHub: [
    {
      id: "school",
      label: "Sekolah",
      items: [
        {
          label: "Kampus",
          href: "/admin/settings/campuses",
          icon: Building2,
          permission: "settings.view",
          description: "Kelola daftar kampus dan lokasinya.",
        },
        {
          label: "Tahun Ajaran",
          href: "/admin/academic-years",
          icon: CalendarDays,
          permission: "academic.view",
          description: "Atur tahun ajaran aktif dan riwayatnya.",
        },
        {
          label: "Semester",
          href: "/admin/semesters",
          icon: CalendarDays,
          permission: "curriculum.read",
          description: "Kelola semester, tema, dan pekan kurikulum.",
        },
        {
          label: "Hari Libur",
          href: "/admin/settings/holidays",
          icon: CalendarDays,
          permission: "settings.view",
          description: "Tetapkan hari libur sekolah dan nasional.",
        },
        {
          label: "Jam Kerja",
          href: "/admin/settings/work-hours",
          icon: Clock,
          permission: "settings.view",
          description: "Atur jam masuk dan pulang karyawan.",
        },
        {
          label: "Berkas Wajib Pendaftaran",
          href: "/admin/settings/pendaftaran",
          icon: FileText,
          permission: "admissions.view",
          description: "Pilih berkas yang wajib diunggah orang tua saat mendaftar.",
        },
      ],
    },
    {
      id: "academic",
      label: "Akademik",
      items: [
        {
          label: "Bank Narasi",
          href: "/admin/report-cards/templates",
          icon: NotebookPen,
          permission: "reportCard.template",
          description: "Kelola bank narasi untuk penyusunan rapor.",
        },
        {
          label: "Templat Buku Penghubung",
          href: "/admin/student-journal",
          icon: BookOpen,
          permission: "students.view",
          description: "Atur kategori dan indikator Buku Penghubung.",
        },
      ],
    },
    {
      id: "finance",
      label: "Keuangan & Gaji",
      items: [
        {
          label: "Biaya",
          href: "/admin/fees",
          icon: Coins,
          permission: "fees.view",
          description: "Komponen biaya, tarif per program, dan keringanan siswa.",
        },
        {
          label: "Komponen Gaji",
          href: "/admin/salary-components",
          icon: Coins,
          permission: "payroll.view",
          description: "Atur komponen dan struktur gaji karyawan.",
        },
      ],
    },
    {
      id: "access",
      label: "Akses",
      items: [
        {
          label: "Pengguna",
          href: "/admin/settings/users",
          icon: Users,
          permission: "users.view",
          description: "Kelola akun pengguna admin dan staf.",
        },
        {
          label: "Peran & Izin",
          href: "/admin/settings/roles",
          icon: Shield,
          permission: "users.view",
          description: "Atur peran dan hak akses pengguna.",
        },
      ],
    },
    // Design System is an internal dev/reference page — hide in production so
    // school admins don't see it. The build inlines NODE_ENV so this branch
    // is dead-code-eliminated from the production bundle.
    ...(process.env.NODE_ENV !== "production"
      ? [
          {
            id: "dev",
            label: "Pengembang",
            items: [
              {
                label: "Design System",
                href: "/admin/design-system",
                icon: Palette,
                permission: "settings.view",
                description: "Referensi komponen dan token desain.",
              } satisfies SettingsItem,
            ],
          } satisfies SettingsSection,
        ]
      : []),
  ],
};

/** Keep groups/sections only when their own gate and at least one destination are usable. */
export function getVisibleAdminNav(permissions: readonly string[]): NavConfig {
  const canSee = (item: { permission?: PermissionCode }) =>
    !item.permission || permissions.includes(item.permission);
  return {
    standalone: adminNav.standalone.filter(canSee),
    groups: adminNav.groups
      .filter(canSee)
      .map((group) => ({ ...group, items: group.items.filter(canSee) }))
      .filter((group) => group.items.length > 0),
    settingsHub: adminNav.settingsHub
      .map((section) => ({ ...section, items: section.items.filter(canSee) }))
      .filter((section) => section.items.length > 0),
  };
}

/** True when at least one settings-hub section has at least one visible item. */
export function hasVisibleSettings(nav: Pick<NavConfig, "settingsHub">): boolean {
  return nav.settingsHub.some((section) => section.items.length > 0);
}

export function isItemActive(pathname: string, item: NavItem): boolean {
  if (item.matchExact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

/**
 * Returns the single best-matching item from `items` for `pathname`.
 * When multiple items match (e.g. parent /admin/assessments + child
 * /admin/assessments/templates), the longer href wins. Prevents both
 * siblings from rendering as active when one is a prefix of the other.
 */
export function getActiveItem(
  pathname: string,
  items: NavItem[]
): NavItem | null {
  let best: NavItem | null = null;
  for (const item of items) {
    if (!isItemActive(pathname, item)) continue;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Unified active-state resolution
//
// A single longest-prefix match across every sidebar item (including their
// `alsoMatch` aliases) AND every settings-hub item. Whichever candidate has
// the longest matching href wins — this is what lets a hub item like
// "Bank Narasi" (/admin/report-cards/templates) outrank the sidebar's
// shorter "Rapor" (/admin/report-cards) entry, while still letting a
// genuinely unrelated sub-path of Rapor (e.g. /admin/report-cards/xyz)
// resolve back to Rapor.
// ---------------------------------------------------------------------------

function matchLen(pathname: string, href: string, matchExact?: boolean): number {
  if (matchExact) return pathname === href ? href.length : -1;
  if (pathname === href) return href.length;
  if (pathname.startsWith(href + "/")) return href.length;
  return -1;
}

type MatchCandidate =
  | { kind: "standalone"; item: NavItem; length: number }
  | {
      kind: "group";
      group: NavGroup;
      item: NavItem;
      length: number;
      matchedHref: string;
      viaAlsoMatch: boolean;
    }
  | { kind: "hub"; section: SettingsSection; item: SettingsItem; length: number };

function collectCandidates(
  pathname: string,
  nav: Pick<NavConfig, "standalone" | "groups" | "settingsHub">
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];

  for (const item of nav.standalone) {
    const length = matchLen(pathname, item.href, item.matchExact);
    if (length >= 0) candidates.push({ kind: "standalone", item, length });
  }

  for (const group of nav.groups) {
    for (const item of group.items) {
      const length = matchLen(pathname, item.href, item.matchExact);
      if (length >= 0) {
        candidates.push({ kind: "group", group, item, length, matchedHref: item.href, viaAlsoMatch: false });
      }
      for (const aliasHref of item.alsoMatch ?? []) {
        const aliasLength = matchLen(pathname, aliasHref, false);
        if (aliasLength >= 0) {
          candidates.push({ kind: "group", group, item, length: aliasLength, matchedHref: aliasHref, viaAlsoMatch: true });
        }
      }
    }
  }

  for (const section of nav.settingsHub) {
    for (const item of section.items) {
      const length = matchLen(pathname, item.href, item.matchExact);
      if (length >= 0) candidates.push({ kind: "hub", section, item, length });
    }
  }

  return candidates;
}

function pickBest(candidates: MatchCandidate[]): MatchCandidate | null {
  let best: MatchCandidate | null = null;
  for (const candidate of candidates) {
    if (!best || candidate.length > best.length) best = candidate;
  }
  return best;
}

export type ActiveResolution =
  | { kind: "standalone"; item: NavItem }
  | { kind: "group"; group: NavGroup; item: NavItem; matchedHref: string; viaAlsoMatch: boolean }
  | { kind: "hub"; section: SettingsSection; item: SettingsItem }
  | { kind: "settings-root" };

/**
 * Resolves which single nav entity "owns" `pathname` — a standalone item, a
 * group item, a settings-hub item, or the settings hub root itself
 * (/admin/settings exactly, which is nobody's href). Longest-prefix wins
 * across sidebar items (+ alsoMatch aliases) and hub items together.
 */
export function resolveActive(
  pathname: string,
  nav: Pick<NavConfig, "standalone" | "groups" | "settingsHub">
): ActiveResolution | null {
  if (pathname === SETTINGS_HUB_HREF) return { kind: "settings-root" };

  const best = pickBest(collectCandidates(pathname, nav));
  if (!best) return null;
  if (best.kind === "standalone") return { kind: "standalone", item: best.item };
  if (best.kind === "hub") return { kind: "hub", section: best.section, item: best.item };
  return { kind: "group", group: best.group, item: best.item, matchedHref: best.matchedHref, viaAlsoMatch: best.viaAlsoMatch };
}

/**
 * The href of the SIDEBAR entry that should render active for `pathname`.
 * A hub match (or the bare settings-root path) collapses to the Pengaturan
 * link's href, since hub items don't get their own sidebar row.
 */
export function getActiveHref(
  pathname: string,
  nav: Pick<NavConfig, "standalone" | "groups" | "settingsHub">
): string | null {
  const resolution = resolveActive(pathname, nav);
  if (!resolution) return null;
  if (resolution.kind === "hub" || resolution.kind === "settings-root") return SETTINGS_HUB_HREF;
  return resolution.item.href;
}

/** Group id to auto-expand for `pathname`, using the same resolver as `getActiveHref`. */
export function getActiveGroup(
  pathname: string,
  nav: Pick<NavConfig, "standalone" | "groups" | "settingsHub">
): string | null {
  const resolution = resolveActive(pathname, nav);
  return resolution?.kind === "group" ? resolution.group.id : null;
}

/**
 * Fixed labels for well-known sub-path segments. Any segment not in this
 * map is assumed to be a dynamic id and renders as "Detail".
 */
const SEGMENT_LABELS: Record<string, string> = {
  new: "Tambah",
  edit: "Ubah",
  monthly: "Bulanan",
  templates: "Template",
  guardians: "Wali Murid",
  score: "Nilai",
  scores: "Nilai",
  // Student Journal (Buku Penghubung) sub-routes: /admin/student-journal/classes/[id]
  // and /admin/student-journal/students/[id] used to render "Detail › Detail"
  // because neither "classes" nor "students" had a label of its own.
  classes: "Kelas",
  students: "Siswa",
  // Semester detail sub-routes: /admin/semesters/[id]/{themes,objectives,import}.
  themes: "Tema",
  objectives: "Tujuan Pembelajaran",
  import: "Impor PROMES",
};

function segmentLabel(segment: string): string {
  return SEGMENT_LABELS[segment] ?? "Detail";
}

function subTrail(pathname: string, baseHref: string): { label: string }[] {
  const crumbs = pathname
    .slice(baseHref.length + 1)
    .split("/")
    .filter(Boolean)
    .map((segment) => ({ label: segmentLabel(segment) }));

  // Safety net: even with every known segment labelled, a still-unmapped
  // dynamic id sitting right after another unmapped segment would render
  // "Detail" twice in a row. Collapse consecutive repeats down to one rather
  // than let a future nested route reintroduce the bug this fixes.
  return crumbs.filter(
    (crumb, i) => i === 0 || crumb.label !== "Detail" || crumbs[i - 1].label !== "Detail"
  );
}

/** Build breadcrumb trail from pathname. */
export function getBreadcrumbs(
  pathname: string
): { label: string; href?: string }[] {
  // /admin/work-queue is owned by the dashboard module (no nav-config entry
  // of its own — it's reached from the "Perlu ditangani" dashboard, not the
  // sidebar) but still needs a sensible trail back to Dasbor.
  if (pathname === "/admin/work-queue") {
    return [{ label: "Dasbor", href: "/admin" }, { label: "Antrean pekerjaan" }];
  }

  if (pathname === SETTINGS_HUB_HREF) {
    return [{ label: "Pengaturan" }];
  }

  const resolution = resolveActive(pathname, adminNav);
  if (!resolution || resolution.kind === "settings-root") return [];

  if (resolution.kind === "standalone") {
    return [{ label: resolution.item.label }];
  }

  if (resolution.kind === "hub") {
    const { item } = resolution;
    if (pathname === item.href) {
      return [{ label: "Pengaturan", href: SETTINGS_HUB_HREF }, { label: item.label }];
    }
    return [
      { label: "Pengaturan", href: SETTINGS_HUB_HREF },
      { label: item.label, href: item.href },
      ...subTrail(pathname, item.href),
    ];
  }

  // resolution.kind === "group"
  const { group, item, matchedHref, viaAlsoMatch } = resolution;

  if (viaAlsoMatch) {
    // The alsoMatch root (e.g. /admin/enrollments, the public enrollment
    // form) is a distinct sub-surface of Pendaftaran, not the Pendaftaran
    // list page itself — give it its own trailing crumb.
    const suffix = pathname
      .slice(matchedHref.length)
      .split("/")
      .filter(Boolean)
      .map((segment) => ({ label: segmentLabel(segment) }));
    return [
      { label: group.label },
      { label: item.label, href: item.href },
      { label: "Formulir", href: suffix.length ? matchedHref : undefined },
      ...suffix,
    ];
  }

  if (pathname === item.href) {
    return [{ label: group.label }, { label: item.label }];
  }
  return [
    { label: group.label },
    { label: item.label, href: item.href },
    ...subTrail(pathname, item.href),
  ];
}
