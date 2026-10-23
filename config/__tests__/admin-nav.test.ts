import { describe, expect, it } from "vitest";
import { ClipboardList, ClipboardCheck } from "lucide-react";
import {
  adminNav,
  getActiveGroup,
  getActiveHref,
  getActiveItem,
  getBreadcrumbs,
  getVisibleAdminNav,
  hasVisibleSettings,
  SETTINGS_HUB_HREF,
  type NavItem,
} from "../admin-nav";

const assessmentItems: NavItem[] = [
  { label: "Template Penilaian", href: "/admin/assessment-templates", icon: ClipboardList },
  { label: "Penilaian Siswa", href: "/admin/assessments", icon: ClipboardCheck },
];

describe("getActiveItem — longest-prefix wins", () => {
  it("picks flat template path", () => {
    const active = getActiveItem("/admin/assessment-templates", assessmentItems);
    expect(active?.href).toBe("/admin/assessment-templates");
  });

  it("picks parent on parent path", () => {
    const active = getActiveItem("/admin/assessments", assessmentItems);
    expect(active?.href).toBe("/admin/assessments");
  });

  it("picks parent on non-child sibling path (scores)", () => {
    const active = getActiveItem("/admin/assessments/scores", assessmentItems);
    expect(active?.href).toBe("/admin/assessments");
  });

  it("returns null on unrelated path", () => {
    const active = getActiveItem("/admin/students", assessmentItems);
    expect(active).toBeNull();
  });
});

describe("adminNav IA — ordering + grouping", () => {
  const groupIds = adminNav.groups.map((g) => g.id);

  it("orders groups: students → daily → assessment → finance → hr", () => {
    expect(groupIds).toEqual(["students", "daily", "assessment", "finance", "hr"]);
  });

  it("students group covers the admission → guardian funnel + Kelas, in that order", () => {
    const group = adminNav.groups.find((g) => g.id === "students")!;
    expect(group.label).toBe("Kesiswaan");
    expect(group.items.map((i) => i.label)).toEqual(["Pendaftaran", "Siswa", "Wali Murid", "Kelas"]);
    const pendaftaran = group.items.find((i) => i.label === "Pendaftaran")!;
    expect(pendaftaran.href).toBe("/admin/admissions");
    expect(pendaftaran.permission).toBe("admissions.view");
    expect(pendaftaran.alsoMatch).toEqual(["/admin/enrollments"]);
    const kelas = group.items.find((i) => i.label === "Kelas")!;
    expect(kelas.href).toBe("/admin/classes");
    expect(kelas.permission).toBe("academic.view");
  });

  it("no standalone Akademik group — Kelas absorbed into Kesiswaan, Tahun Ajaran/Semester moved to the settings hub", () => {
    expect(adminNav.groups.find((g) => g.id === "academic")).toBeUndefined();
  });

  it("daily group (Harian) holds attendance + the journal monitor, not the journal template", () => {
    const group = adminNav.groups.find((g) => g.id === "daily")!;
    expect(group.label).toBe("Harian");
    expect(group.items.map((i) => i.label)).toEqual(["Kehadiran Siswa", "Buku Penghubung"]);
    const jurnal = group.items.find((i) => i.label === "Buku Penghubung")!;
    expect(jurnal.href).toBe("/admin/student-journal/monitoring");
    expect(jurnal.permission).toBe("students.view");
  });

  it("assessment group holds only the penilaian monitor and rapor — Bank Narasi moved to the hub", () => {
    const group = adminNav.groups.find((g) => g.id === "assessment")!;
    expect(group.items.map((i) => i.label)).toEqual(["Pemantauan", "Rapor"]);
    expect(group.items[0].href).toBe("/admin/assessments");
    expect(group.items[0].permission).toBe("assessments.read");
    expect(group.items[1].href).toBe("/admin/report-cards");
    expect(group.items[1].permission).toBe("reportCard.read");
  });

  it("finance group holds Tagihan + Penerimaan — Biaya moved to the hub", () => {
    const group = adminNav.groups.find((g) => g.id === "finance")!;
    expect(group.items.map((i) => i.label)).toEqual(["Tagihan", "Penerimaan"]);
  });

  it("hr group keeps hr.view gate, no longer inlines Komponen Gaji", () => {
    const group = adminNav.groups.find((g) => g.id === "hr")!;
    expect(group.permission).toBe("hr.view");
    expect(group.items.map((i) => i.label)).toEqual(["Karyawan", "Kehadiran", "Pengajuan Cuti", "Penggajian"]);
  });

  it("sidebar entry count is 16 (incl. Pengaturan) with every permission granted", () => {
    const fullPermissions = [
      "admissions.view",
      "students.view",
      "academic.view",
      "assessments.read",
      "reportCard.read",
      "invoices.view",
      "hr.view",
      "attendance.view",
      "leave.view",
      "payroll.view",
    ];
    const nav = getVisibleAdminNav(fullPermissions);
    const sidebarCount =
      nav.standalone.length +
      nav.groups.reduce((sum, g) => sum + g.items.length, 0) +
      (hasVisibleSettings(nav) ? 1 : 0);
    expect(sidebarCount).toBe(16);
  });
});

describe("settingsHub — sections + moved items", () => {
  it("school section covers Kampus, Tahun Ajaran, Semester, Hari Libur, Jam Kerja, Pengaturan Pendaftaran with original permission codes", () => {
    const section = adminNav.settingsHub.find((s) => s.id === "school")!;
    expect(section.label).toBe("Sekolah");
    expect(section.items.map((i) => i.label)).toEqual([
      "Kampus",
      "Tahun Ajaran",
      "Semester",
      "Hari Libur",
      "Jam Kerja",
      "Pengaturan Pendaftaran",
    ]);
    expect(section.items.find((i) => i.label === "Pengaturan Pendaftaran")).toMatchObject({
      href: "/admin/settings/pendaftaran",
      permission: "admissions.view",
    });
    expect(section.items.find((i) => i.label === "Tahun Ajaran")).toMatchObject({
      href: "/admin/academic-years",
      permission: "academic.view",
    });
    expect(section.items.find((i) => i.label === "Semester")).toMatchObject({
      href: "/admin/semesters",
      permission: "curriculum.read",
    });
    expect(section.items.every((i) => typeof i.description === "string" && i.description.length > 0)).toBe(true);
  });

  it("academic section covers Bank Narasi + Templat Buku Penghubung", () => {
    const section = adminNav.settingsHub.find((s) => s.id === "academic")!;
    expect(section.label).toBe("Akademik");
    expect(section.items.map((i) => i.label)).toEqual(["Bank Narasi", "Templat Buku Penghubung"]);
    expect(section.items[0]).toMatchObject({ href: "/admin/report-cards/templates", permission: "reportCard.template" });
    expect(section.items[1]).toMatchObject({ href: "/admin/student-journal", permission: "students.view" });
  });

  it("finance section covers Biaya + Komponen Gaji + Templat Pengingat WhatsApp", () => {
    const section = adminNav.settingsHub.find((s) => s.id === "finance")!;
    expect(section.label).toBe("Keuangan & Gaji");
    expect(section.items.map((i) => i.label)).toEqual(["Biaya", "Komponen Gaji", "Templat Pengingat WhatsApp"]);
    expect(section.items[0]).toMatchObject({ href: "/admin/fees", permission: "fees.view" });
    expect(section.items[1]).toMatchObject({ href: "/admin/salary-components", permission: "payroll.view" });
    expect(section.items[2]).toMatchObject({ href: "/admin/settings/pengingat-whatsapp", permission: "payments.record" });
  });

  it("access section covers Pengguna + Peran & Izin", () => {
    const section = adminNav.settingsHub.find((s) => s.id === "access")!;
    expect(section.label).toBe("Akses");
    expect(section.items.map((i) => i.label)).toEqual(["Pengguna", "Peran & Izin"]);
    expect(section.items.every((i) => i.permission === "users.view")).toBe(true);
  });
});

describe("getVisibleAdminNav", () => {
  const sidebarHrefs = (permissions: string[]) => {
    const nav = getVisibleAdminNav(permissions);
    return nav.groups.flatMap((group) => group.items).map((item) => item.href);
  };
  const hubHrefs = (permissions: string[]) => {
    const nav = getVisibleAdminNav(permissions);
    return nav.settingsHub.flatMap((section) => section.items).map((item) => item.href);
  };

  it("hides admissions and enrollment destinations from finance and HR roles", () => {
    expect(sidebarHrefs(["invoices.view"])).toEqual(["/admin/invoices", "/admin/payments"]);
    expect(sidebarHrefs(["hr.view", "leave.view", "attendance.view"])).toEqual([
      "/admin/employees",
      "/admin/employee-attendance",
      "/admin/leave-requests",
    ]);
  });

  it("shows Pendaftaran without student or payroll links for admissions-only permission", () => {
    expect(sidebarHrefs(["admissions.view"])).toEqual(["/admin/admissions"]);
  });

  it("does not let broad group gates hide separately granted destinations", () => {
    expect(sidebarHrefs(["reportCard.read"])).toEqual(["/admin/report-cards"]);
  });

  it("requires both HR module access and payroll read access for payroll links", () => {
    expect(sidebarHrefs(["payroll.view"])).not.toContain("/admin/payroll");
    expect(sidebarHrefs(["hr.view", "payroll.view"])).toContain("/admin/payroll");
    expect(sidebarHrefs(["hr.view"])).not.toContain("/admin/payroll");
  });

  it("drops empty hub sections and keeps only granted hub items", () => {
    expect(hubHrefs(["users.view"])).toEqual(["/admin/settings/users", "/admin/settings/roles"]);
    expect(hubHrefs(["academic.view"])).toEqual(["/admin/academic-years"]);
  });

  it("hasVisibleSettings is false with zero settings-relevant permissions", () => {
    expect(hasVisibleSettings(getVisibleAdminNav(["invoices.view"]))).toBe(false);
  });

  it("hasVisibleSettings is true once any hub permission is granted", () => {
    expect(hasVisibleSettings(getVisibleAdminNav(["users.view"]))).toBe(true);
  });
});

describe("getActiveHref — longest-prefix match across sidebar + hub", () => {
  const nav = getVisibleAdminNav([
    "admissions.view",
    "students.view",
    "academic.view",
    "curriculum.read",
    "assessments.read",
    "reportCard.read",
    "reportCard.template",
    "invoices.view",
    "fees.view",
    "hr.view",
    "attendance.view",
    "leave.view",
    "payroll.view",
    "users.view",
    "settings.view",
  ]);

  it("/admin exact → Dasbor only", () => {
    expect(getActiveHref("/admin", nav)).toBe("/admin");
  });

  it("/admin/student-journal/monitoring → Buku Penghubung (sidebar, longer than the hub template root)", () => {
    expect(getActiveHref("/admin/student-journal/monitoring", nav)).toBe("/admin/student-journal/monitoring");
  });

  it("/admin/student-journal → Pengaturan (hub-owned Templat Buku Penghubung)", () => {
    expect(getActiveHref("/admin/student-journal", nav)).toBe(SETTINGS_HUB_HREF);
  });

  it("/admin/student-journal/classes/abc → Pengaturan (longest prefix is the hub template root)", () => {
    // Edge case, called out in the cycle doc: this sub-path belongs to a
    // journal-classes feature that isn't itself a nav destination, so the
    // hub's /admin/student-journal prefix is the longest match available.
    expect(getActiveHref("/admin/student-journal/classes/abc", nav)).toBe(SETTINGS_HUB_HREF);
  });

  it("/admin/report-cards/templates → Pengaturan (Bank Narasi outranks Rapor)", () => {
    expect(getActiveHref("/admin/report-cards/templates", nav)).toBe(SETTINGS_HUB_HREF);
  });

  it("/admin/report-cards and /admin/report-cards/xyz → Rapor", () => {
    expect(getActiveHref("/admin/report-cards", nav)).toBe("/admin/report-cards");
    expect(getActiveHref("/admin/report-cards/xyz", nav)).toBe("/admin/report-cards");
  });

  it("/admin/enrollments/123 → Pendaftaran via alsoMatch", () => {
    expect(getActiveHref("/admin/enrollments/123", nav)).toBe("/admin/admissions");
  });

  it("/admin/academic-years → Pengaturan", () => {
    expect(getActiveHref("/admin/academic-years", nav)).toBe(SETTINGS_HUB_HREF);
  });

  it("/admin/settings (bare hub root) → Pengaturan", () => {
    expect(getActiveHref("/admin/settings", nav)).toBe(SETTINGS_HUB_HREF);
  });

  it("getActiveGroup resolves via the same matcher — only ever one active entry", () => {
    expect(getActiveGroup("/admin/enrollments/123", nav)).toBe("students");
    expect(getActiveGroup("/admin/report-cards/templates", nav)).toBeNull();
    expect(getActiveGroup("/admin/report-cards/xyz", nav)).toBe("assessment");
  });
});

describe("getBreadcrumbs", () => {
  it("returns single crumb for dashboard", () => {
    expect(getBreadcrumbs("/admin")).toEqual([{ label: "Dasbor" }]);
  });

  it("returns 2-level trail for an exact nav item", () => {
    expect(getBreadcrumbs("/admin/employees")).toEqual([{ label: "SDM" }, { label: "Karyawan" }]);
  });

  it("renders [id] as Detail on depth-3 path", () => {
    expect(getBreadcrumbs("/admin/employees/abc123")).toEqual([
      { label: "SDM" },
      { label: "Karyawan", href: "/admin/employees" },
      { label: "Detail" },
    ]);
  });

  it("renders /edit as Ubah on depth-4 path", () => {
    expect(getBreadcrumbs("/admin/employees/abc123/edit")).toEqual([
      { label: "SDM" },
      { label: "Karyawan", href: "/admin/employees" },
      { label: "Detail" },
      { label: "Ubah" },
    ]);
  });

  it("renders /new as Tambah", () => {
    expect(getBreadcrumbs("/admin/students/new")).toEqual([
      { label: "Kesiswaan" },
      { label: "Siswa", href: "/admin/students" },
      { label: "Tambah" },
    ]);
  });

  it("renders payroll /monthly as Bulanan", () => {
    expect(getBreadcrumbs("/admin/payroll/monthly")).toEqual([
      { label: "SDM" },
      { label: "Penggajian", href: "/admin/payroll" },
      { label: "Bulanan" },
    ]);
  });

  it("returns 2-level trail for the consolidated penilaian monitor", () => {
    expect(getBreadcrumbs("/admin/assessments")).toEqual([{ label: "Penilaian" }, { label: "Pemantauan" }]);
  });

  it("returns no trail for the retired assessment-templates path (server-redirected)", () => {
    expect(getBreadcrumbs("/admin/assessment-templates")).toEqual([]);
  });

  it("returns a sub-page trail for a nested path under the assessments monitor", () => {
    expect(getBreadcrumbs("/admin/assessments/abc123")).toEqual([
      { label: "Penilaian" },
      { label: "Pemantauan", href: "/admin/assessments" },
      { label: "Detail" },
    ]);
  });

  it("hub item at its own root → Pengaturan + item label", () => {
    expect(getBreadcrumbs("/admin/academic-years")).toEqual([
      { label: "Pengaturan", href: "/admin/settings" },
      { label: "Tahun Ajaran" },
    ]);
  });

  it("renders settings hub sub-page trail", () => {
    expect(getBreadcrumbs("/admin/settings/campuses/c1/edit")).toEqual([
      { label: "Pengaturan", href: "/admin/settings" },
      { label: "Kampus", href: "/admin/settings/campuses" },
      { label: "Detail" },
      { label: "Ubah" },
    ]);
  });

  it("/admin/settings (bare) → single Pengaturan crumb", () => {
    expect(getBreadcrumbs("/admin/settings")).toEqual([{ label: "Pengaturan" }]);
  });

  it("/admin/enrollments → Kesiswaan / Pendaftaran / Formulir", () => {
    expect(getBreadcrumbs("/admin/enrollments")).toEqual([
      { label: "Kesiswaan" },
      { label: "Pendaftaran", href: "/admin/admissions" },
      { label: "Formulir" },
    ]);
  });

  it("/admin/work-queue → Dasbor / Antrean pekerjaan", () => {
    expect(getBreadcrumbs("/admin/work-queue")).toEqual([
      { label: "Dasbor", href: "/admin" },
      { label: "Antrean pekerjaan" },
    ]);
  });

  it("returns empty array for unknown path", () => {
    expect(getBreadcrumbs("/admin/does-not-exist")).toEqual([]);
  });

  // T1 (cycle 2026-09-26, admin-ui-standard-c1) — nested dynamic routes used
  // to render "Detail › Detail" because neither of their two trailing
  // segments had a label. Known leaf segments now name themselves, so the
  // dynamic id only ever renders "Detail" once.
  it("labels the student-journal class sub-route, no duplicate Detail", () => {
    expect(getBreadcrumbs("/admin/student-journal/classes/cls-1")).toEqual([
      { label: "Pengaturan", href: "/admin/settings" },
      { label: "Templat Buku Penghubung", href: "/admin/student-journal" },
      { label: "Kelas" },
      { label: "Detail" },
    ]);
  });

  it("labels the student-journal student sub-route, no duplicate Detail", () => {
    expect(getBreadcrumbs("/admin/student-journal/students/s-1")).toEqual([
      { label: "Pengaturan", href: "/admin/settings" },
      { label: "Templat Buku Penghubung", href: "/admin/student-journal" },
      { label: "Siswa" },
      { label: "Detail" },
    ]);
  });

  it("labels semester /import as Impor PROMES", () => {
    expect(getBreadcrumbs("/admin/semesters/sem-1/import")).toEqual([
      { label: "Pengaturan", href: "/admin/settings" },
      { label: "Semester", href: "/admin/semesters" },
      { label: "Detail" },
      { label: "Impor PROMES" },
    ]);
  });

  it("labels semester /themes as Tema and /objectives as Tujuan Pembelajaran", () => {
    expect(getBreadcrumbs("/admin/semesters/sem-1/themes")).toEqual([
      { label: "Pengaturan", href: "/admin/settings" },
      { label: "Semester", href: "/admin/semesters" },
      { label: "Detail" },
      { label: "Tema" },
    ]);
    expect(getBreadcrumbs("/admin/semesters/sem-1/objectives")).toEqual([
      { label: "Pengaturan", href: "/admin/settings" },
      { label: "Semester", href: "/admin/semesters" },
      { label: "Detail" },
      { label: "Tujuan Pembelajaran" },
    ]);
  });
});
