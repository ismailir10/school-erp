import { PrismaClient } from "../lib/generated/prisma/client";
import { JournalStatus } from "../lib/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";
import { reconcileSessions } from "@/lib/sessions/reconcile";
import { employees } from "./data/employees";
import { salaryComponents } from "./data/salary-components";
import { salaryValues } from "./data/salary-values";
import { allHolidays } from "./data/holidays";
import { students } from "./data/students";
import {
  academicYearFor,
  academicYearStartingIn,
  activeSemesterOf,
  addDays,
  createRng,
  firstOfMonthShifted,
  isSchoolDay,
  jakartaInstant,
  latestSchoolDay,
  monthLabelId,
  schoolDaysEndingAt,
  seedToday,
  termsOfSemester,
  weeksOfSemester,
} from "./data/calendar";
import {
  ACTIVITY_BY_CENTER,
  BUCKETED_SECTIONS,
  CLOSING_SECTIONS,
  CLOSING_TEXT,
  CURRICULUM_ELEMENTS,
  DEMO_LEVELS,
  OBJECTIVES,
  THEMES_SEMESTER_1,
  THEMES_SEMESTER_2,
  narrativeFor,
} from "./data/curriculum";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not configured");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// ── The seed's calendar, anchored on ONE date ───────────────────────────────
// Everything time-dependent below derives from TODAY (Asia/Jakarta; override
// with SEED_TODAY=YYYY-MM-DD to rehearse another day). The academic year, the
// semesters, the curriculum weeks, the sessions, the invoices and the payroll
// periods all move with it, so a fresh seed on ANY day is a live, current
// school. Anything a spec needs "today" for anchors on LATEST_SCHOOL_DAY (the
// most recent non-weekend, non-holiday day) so nothing depends on the weekday.
const TODAY = seedToday();
const HOLIDAY_DATES: ReadonlySet<string> = new Set(allHolidays.map((h) => h.date));
const CAL = academicYearFor(TODAY);
const PREV_CAL = academicYearStartingIn(Number(CAL.name.slice(0, 4)) - 1);
const ACTIVE_SEMESTER = activeSemesterOf(CAL, TODAY);
const LATEST_SCHOOL_DAY = (() => {
  const d = latestSchoolDay(TODAY, HOLIDAY_DATES);
  return d < CAL.start ? CAL.start : d;
})();
/** The last five school days (ascending, ending at LATEST_SCHOOL_DAY), inside this academic year. */
const RECENT_DAYS = schoolDaysEndingAt(LATEST_SCHOOL_DAY, 5, HOLIDAY_DATES, CAL.start);
const rand = createRng(Number(TODAY.replace(/-/g, "")));
const utcMidnight = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

async function main() {
  console.log(`🌱 Seeding database... (today = ${TODAY}, academic year ${CAL.name}, latest school day ${LATEST_SCHOOL_DAY})`);

  // Clear existing data — order matters: children before parents to respect FK constraints.
  // Raport + assessment + billing-run tables reference Week/Semester/Student/
  // FeeComponentDef with Restrict, so they go first.
  await prisma.assessmentEntry.deleteMany();
  await prisma.reportCardEntry.deleteMany();
  await prisma.studentMeasurement.deleteMany();
  await prisma.reportNarrativeTemplate.deleteMany();
  await prisma.reportClosingTemplate.deleteMany();
  await prisma.term.deleteMany();
  await prisma.billingRunLine.deleteMany();
  await prisma.billingRunRow.deleteMany();
  await prisma.billingRun.deleteMany();
  await prisma.studentFeeAdjustment.deleteMany();
  await prisma.enrollmentApplication.deleteMany();
  await prisma.studentJournalNoteRead.deleteMany();
  await prisma.studentJournalAudit.deleteMany();
  await prisma.studentJournalNote.deleteMany();
  await prisma.studentJournalEntry.deleteMany();
  await prisma.studentJournalIndicator.deleteMany();
  await prisma.studentJournalCategory.deleteMany();
  await prisma.studentJournalTemplate.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceLine.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.programFeeStructure.deleteMany();
  await prisma.feeComponentDef.deleteMany();
  await prisma.admission.deleteMany();
  // Curriculum (C1) — children before parents.
  await prisma.indicatorThemeLink.deleteMany();
  await prisma.achievementIndicator.deleteMany();
  await prisma.learningObjective.deleteMany();
  await prisma.week.deleteMany();
  await prisma.subTheme.deleteMany();
  await prisma.theme.deleteMany();
  // ClassSession references ClassSection + Semester + Employee, and
  // StudentAttendance references ClassSession via sessionId — so it must be
  // wiped before semester / studentAttendance / classSection / employee below.
  await prisma.studentAttendance.deleteMany();
  await prisma.classSession.deleteMany();
  await prisma.semester.deleteMany();
  await prisma.teachingAssignment.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.studentEnrollment.deleteMany();
  await prisma.studentGuardian.deleteMany();
  await prisma.parent.deleteMany();
  await prisma.student.deleteMany();
  await prisma.classSection.deleteMany();
  await prisma.classTrack.deleteMany();
  await prisma.program.deleteMany();
  await prisma.academicYear.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.payrollItemLine.deleteMany();
  await prisma.payrollItem.deleteMany();
  await prisma.payrollRun.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.employeeSalaryValue.deleteMany();
  await prisma.salaryComponentDef.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.employee.deleteMany();
  // Tenant-scoped tables that don't appear above — silently allowed when
  // running against a pristine CI DB (zero rows), but block tenant delete
  // when the local DB has been used by integration tests or production
  // staging data. Listed here so re-seeding from any state is idempotent.
  await prisma.invoiceNumberSequence.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.orgConfig.deleteMany();
  await prisma.campus.deleteMany();
  await prisma.tenant.deleteMany();

  // 1. Create tenant
  const tenant = await prisma.tenant.create({
    data: { name: "An Nisaa' Sekolahku", slug: "annisaa" },
  });
  console.log(`✅ Tenant: ${tenant.name}`);

  // 2. Create campuses
  const campusTamanAster = await prisma.campus.create({
    data: {
      tenantId: tenant.id,
      name: "Taman Aster",
      address: "Taman Aster, Bekasi, Jawa Barat",
      lat: -6.2234,
      lng: 106.8432,
    },
  });
  const campusMetland = await prisma.campus.create({
    data: {
      tenantId: tenant.id,
      name: "Metland Cibitung",
      address: "Metland, Cibitung, Jawa Barat",
      lat: -6.2345,
      lng: 107.1234,
    },
  });
  console.log(`✅ Campuses: 2`);

  const campusMap: Record<string, string> = {
    "taman-aster": campusTamanAster.id,
    "metland-cibitung": campusMetland.id,
  };

  // 3. Org config
  await prisma.orgConfig.create({
    data: {
      tenantId: tenant.id,
      workingDays: JSON.stringify(["MON", "TUE", "WED", "THU", "FRI"]),
      workStartTime: "07:00",
      workEndTime: "16:00",
      gracePeriodMinutes: 15,
      timezone: "Asia/Jakarta",
      payrollPeriodStartDay: 21,
      payrollPeriodEndDay: 20,
    },
  });
  console.log(`✅ Org config`);

  // 4. Holidays
  for (const h of allHolidays) {
    await prisma.holiday.create({
      data: { tenantId: tenant.id, date: h.date, name: h.name, type: h.type },
    });
  }
  console.log(`✅ Holidays: ${allHolidays.length}`);

  // 5. Salary components
  const componentMap: Record<string, string> = {};
  for (const comp of salaryComponents) {
    const created = await prisma.salaryComponentDef.create({
      data: {
        tenantId: tenant.id,
        code: comp.code,
        label: comp.label,
        category: comp.category,
        calcType: comp.calcType,
        isProRated: comp.isProRated,
        sortOrder: comp.sortOrder,
      },
    });
    componentMap[comp.code] = created.id;
  }
  console.log(`✅ Salary components: ${salaryComponents.length}`);

  // 6. Create admin users
  // Primary owner — SUPER_ADMIN (full access including payroll/salary)
  const adminUser = await prisma.user.create({
    data: {
      id: "u_super_admin",
      tenantId: tenant.id,
      email: "admin@annisaa.sch.id",
      role: "SUPER_ADMIN",
      name: "Admin Annisaa",
    },
  });
  console.log(`✅ Super admin user: ${adminUser.email}`);

  // Restricted admin — SCHOOL_ADMIN (no salary/payroll access — demo fixture)
  await prisma.user.create({
    data: {
      id: "u_school_admin",
      tenantId: tenant.id,
      email: "schooladmin@annisaa.sch.id",
      role: "SCHOOL_ADMIN",
      name: "Admin Sekolah",
    },
  });
  console.log(`✅ School admin user: schooladmin@annisaa.sch.id`);

  // Owner — SUPER_ADMIN (real owner email, always seeded)
  await prisma.user.create({
    data: {
      id: "u_owner",
      tenantId: tenant.id,
      email: "ismailir10@gmail.com",
      role: "SUPER_ADMIN",
      name: "Ismail Rabbani",
    },
  });
  console.log(`✅ Owner user: ismailir10@gmail.com`);

  // Additional SCHOOL_ADMIN tester (opaque cuid — not referenced by e2e)
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: "commandprompt.adhan@gmail.com",
      role: "SCHOOL_ADMIN",
      name: "Adhan (Tester)",
    },
  });
  console.log(`✅ School admin tester: commandprompt.adhan@gmail.com`);

  // Demo-mode users for Playwright + manual demo coverage of the
  // permission-based HR fence. Idempotent upsert by email so re-seeding
  // a populated DB stays safe.
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "superadmin@demo.local" } },
    update: { role: "SUPER_ADMIN", name: "Super Admin (Demo)" },
    create: {
      id: "u_demo_super_admin",
      tenantId: tenant.id,
      email: "superadmin@demo.local",
      role: "SUPER_ADMIN",
      name: "Super Admin (Demo)",
    },
  });
  console.log(`✅ Demo super admin: superadmin@demo.local`);

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "admin@demo.local" } },
    update: { role: "SCHOOL_ADMIN", name: "School Admin (Demo)" },
    create: {
      id: "u_demo_school_admin",
      tenantId: tenant.id,
      email: "admin@demo.local",
      role: "SCHOOL_ADMIN",
      name: "School Admin (Demo)",
    },
  });
  console.log(`✅ Demo school admin: admin@demo.local`);

  // 7. Employees + Teacher users + Salary values
  const employeeIds: Record<string, string> = {};
  let empCount = 0;
  for (const emp of employees) {
    const status = "status" in emp && emp.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    const created = await prisma.employee.create({
      data: {
        tenantId: tenant.id,
        kode: emp.kode,
        nama: emp.nama,
        formalName: emp.formalName ?? null,
        email: emp.email,
        noHp: emp.noHp ?? null,
        jabatan: emp.jabatan,
        campusId: campusMap[emp.campus],
        hireDate: "2020-01-15",
        status,
        bankAccountNo: emp.bankAccountNo,
        bankName: emp.bankName,
        bpjsEnrolled: emp.bpjsEnrolled,
      },
    });
    employeeIds[emp.kode] = created.id;

    // First teacher (E003, Guru Tiga) gets explicit ID for E2E demo auth
    const teacherUserId = emp.kode === "E003" ? "u_teacher" : undefined;
    await prisma.user.create({
      data: {
        ...(teacherUserId ? { id: teacherUserId } : {}),
        tenantId: tenant.id,
        email: emp.email,
        role: "TEACHER",
        name: emp.nama,
        employeeId: created.id,
      },
    });

    const values = salaryValues[emp.kode];
    if (values) {
      for (const [code, value] of Object.entries(values)) {
        if (componentMap[code]) {
          await prisma.employeeSalaryValue.create({
            data: {
              employeeId: created.id,
              componentDefId: componentMap[code],
              value,
            },
          });
        }
      }
    }
    empCount++;
  }
  console.log(`✅ Employees: ${empCount}`);
  console.log(`✅ Salary values: ${empCount * salaryComponents.length}`);

  // ── 7b. ACADEMIC YEAR, PROGRAMS, CLASS SECTIONS, STUDENTS ──

  // 7b-1. Academic years. The year containing TODAY is the ACTIVE one; the
  // year before it is ARCHIVED (its semesters INACTIVE, no classes). Year and
  // semester boundaries are contiguous Mondays (see prisma/data/calendar.ts),
  // so exactly one semester contains TODAY whatever day the seed runs.
  const previousYear = await prisma.academicYear.create({
    data: {
      tenantId: tenant.id,
      name: PREV_CAL.name,
      startDate: PREV_CAL.start,
      endDate: PREV_CAL.end,
      status: "ARCHIVED",
    },
  });
  for (const sem of PREV_CAL.semesters) {
    await prisma.semester.create({
      data: {
        tenantId: tenant.id,
        academicYearId: previousYear.id,
        number: sem.number,
        startDate: utcMidnight(sem.start),
        endDate: utcMidnight(sem.end),
        status: "INACTIVE",
      },
    });
  }
  const academicYear = await prisma.academicYear.create({
    data: {
      tenantId: tenant.id,
      name: CAL.name,
      startDate: CAL.start,
      endDate: CAL.end,
      status: "ACTIVE",
    },
  });
  console.log(`✅ Academic years: ${CAL.name} (ACTIVE), ${PREV_CAL.name} (ARCHIVED)`);

  // 7b-1b. Curriculum for BOTH semesters of the active year — themes, sub-themes,
  // Mon–Fri Weeks covering every week of the semester, learning objectives (TP)
  // with achievement indicators (IKTP) for TK A and TK B, and the
  // IndicatorThemeLink rows that make weekly (walas) and sentra assessment
  // usable for whichever week "today" falls in. Only the semester containing
  // TODAY is ACTIVE (one ACTIVE semester per year — demoteOtherActiveSemesters),
  // but the other still carries a curriculum so admin curriculum screens and the
  // objectives/theme-link specs have data whichever semester the API lists first.
  // Storage contract: Semester/Week dates are UTC-midnight of the Jakarta day.
  type SeededWeek = { id: string; number: number; start: string; end: string; themeId: string };
  const semesterIds: Record<number, string> = {};
  const weeksBySemester: Record<number, SeededWeek[]> = {};
  const indicatorsByThemeAge: Record<string, string[]> = {}; // `${themeId}|${ageGroup}` → indicator ids
  let themeCount = 0;
  let subThemeCount = 0;
  let weekCount = 0;
  let objectiveCount = 0;
  let indicatorCount = 0;
  for (const semSpan of CAL.semesters) {
    const semester = await prisma.semester.create({
      data: {
        tenantId: tenant.id,
        academicYearId: academicYear.id,
        number: semSpan.number,
        startDate: utcMidnight(semSpan.start),
        endDate: utcMidnight(semSpan.end),
        status: semSpan.number === ACTIVE_SEMESTER.number ? "ACTIVE" : "INACTIVE",
      },
    });
    semesterIds[semSpan.number] = semester.id;

    // Themes → sub-themes (12 per semester).
    const themePlans = semSpan.number === 1 ? THEMES_SEMESTER_1 : THEMES_SEMESTER_2;
    const subThemes: { id: string; themeId: string }[] = [];
    const themeIds: string[] = [];
    for (const [ti, tp] of themePlans.entries()) {
      const theme = await prisma.theme.create({
        data: { tenantId: tenant.id, semesterId: semester.id, name: tp.name, order: ti },
      });
      themeIds.push(theme.id);
      themeCount++;
      for (const [si, stName] of tp.subThemes.entries()) {
        const st = await prisma.subTheme.create({
          data: { tenantId: tenant.id, themeId: theme.id, name: stName, order: si },
        });
        subThemes.push({ id: st.id, themeId: theme.id });
        subThemeCount++;
      }
    }

    // Weeks: spread the semester's Mon–Fri weeks evenly over the sub-themes.
    const weekSpans = weeksOfSemester(semSpan);
    const seededWeeks: SeededWeek[] = [];
    for (const [wi, w] of weekSpans.entries()) {
      const sub = subThemes[Math.floor((wi * subThemes.length) / weekSpans.length)];
      const week = await prisma.week.create({
        data: {
          tenantId: tenant.id,
          subThemeId: sub.id,
          number: w.number,
          startDate: utcMidnight(w.start),
          endDate: utcMidnight(w.end),
          status: "ACTIVE",
        },
      });
      seededWeeks.push({ id: week.id, number: w.number, start: w.start, end: w.end, themeId: sub.themeId });
      weekCount++;
    }
    weeksBySemester[semSpan.number] = seededWeeks;

    // Objectives + indicators per age group, then link each indicator to two
    // themes so every theme (hence every week) has IKTP to assess.
    for (const ageGroup of ["A", "B"] as const) {
      const indicatorIds: string[] = [];
      for (const element of CURRICULUM_ELEMENTS) {
        for (const [oi, obj] of OBJECTIVES[element].entries()) {
          const created = await prisma.learningObjective.create({
            data: {
              tenantId: tenant.id,
              semesterId: semester.id,
              ageGroup,
              element,
              number: oi + 1,
              competencyText: obj.competencyText,
              content: obj.content,
              indicators: {
                create: obj.indicators.map((content, ii) => ({
                  tenantId: tenant.id,
                  content,
                  order: ii + 1,
                })),
              },
            },
            include: { indicators: { orderBy: { order: "asc" } } },
          });
          objectiveCount++;
          for (const ind of created.indicators) {
            indicatorIds.push(ind.id);
            indicatorCount++;
          }
        }
      }
      const links: { indicatorId: string; themeId: string }[] = [];
      indicatorIds.forEach((indicatorId, idx) => {
        for (const themeIdx of new Set([idx % themeIds.length, (idx + 3) % themeIds.length])) {
          links.push({ indicatorId, themeId: themeIds[themeIdx] });
          (indicatorsByThemeAge[`${themeIds[themeIdx]}|${ageGroup}`] ??= []).push(indicatorId);
        }
      });
      await prisma.indicatorThemeLink.createMany({ data: links });
    }
  }
  console.log(
    `✅ Curriculum: 2 semesters (Semester ${ACTIVE_SEMESTER.number} ACTIVE), ${themeCount} themes, ${subThemeCount} subthemes, ${weekCount} weeks, ${objectiveCount} objectives, ${indicatorCount} indicators`,
  );

  // 7b-2. Programs
  const programDefs = [
    { code: "DCARE", name: "Day Care", type: "YEAR_ROUND", ageMin: 24, ageMax: 36 },
    { code: "KB", name: "Kelompok Bermain", type: "SEMESTER", ageMin: 36, ageMax: 60 },
    { code: "TKIT", name: "TK Islam Terpadu", type: "SEMESTER", ageMin: 48, ageMax: 84 },
    { code: "POPUP", name: "Pop Up Class", type: "SESSION", ageMin: 36, ageMax: 72 },
  ];
  const programMap: Record<string, string> = {};
  for (const p of programDefs) {
    const created = await prisma.program.create({
      data: {
        tenantId: tenant.id,
        code: p.code,
        name: p.name,
        type: p.type,
        ageMin: p.ageMin,
        ageMax: p.ageMax,
      },
    });
    programMap[p.code] = created.id;
  }
  console.log(`✅ Programs: ${programDefs.length}`);

  // 7b-3. Class Sections
  const classSectionDefs = [
    // Every class keeps a few open seats (base roster + rightjetParent's third
    // child Fatimah in TKIT B fit with room to spare) so the enrollment
    // add/remove specs and the admin "Tambah Siswa" flow have somewhere to go.
    { name: "TKIT A", programCode: "TKIT", campusSlug: "taman-aster", capacity: 24, ageGroup: "A" as const },
    { name: "TKIT B", programCode: "TKIT", campusSlug: "taman-aster", capacity: 25, ageGroup: "B" as const },
    // Non-TK programs (KB / D'Care / POPUP) all map to ageGroup A as the
    // curriculum default — the 4-5 yo cohort that overlaps with TK A.
    // A real PAUD tenant typically uploads one PROMES set for the whole
    // program; assigning every KB+DCARE+POPUP class to A keeps the
    // indicator picker populated. Admin can change per-class via the
    // Kelompok Usia select once the cycle lands.
    // Campus-free names: the ClassSection unique key is now scoped by
    // campusId too (2026-07-29 class-picker-year-scoping), so "KB" at both
    // campuses below is a legitimate, non-colliding pair — the campusSlug
    // still differentiates each row, it just no longer rides in the name.
    { name: "KB", programCode: "KB", campusSlug: "taman-aster", capacity: 18, ageGroup: "A" as const },
    { name: "KB", programCode: "KB", campusSlug: "metland-cibitung", capacity: 18, ageGroup: "A" as const },
    { name: "D'Care", programCode: "DCARE", campusSlug: "taman-aster", capacity: 13, ageGroup: "A" as const },
    { name: "POPUP Weekend", programCode: "POPUP", campusSlug: "taman-aster", capacity: 25, ageGroup: "A" as const },
  ];
  const classSectionMap: Record<string, string> = {};
  const classSectionKeys = ["TKIT_A", "TKIT_B", "KB_ASTER", "KB_METLAND", "DCARE", "POPUP"];
  for (let i = 0; i < classSectionDefs.length; i++) {
    const cs = classSectionDefs[i];
    // Each section belongs to a stable multi-year ClassTrack
    // (cycle 2026-05-15 academic-hierarchy-refactor).
    const classTrack = await prisma.classTrack.create({
      data: {
        tenantId: tenant.id,
        campusId: campusMap[cs.campusSlug],
        programId: programMap[cs.programCode],
        name: cs.name,
      },
    });
    const created = await prisma.classSection.create({
      data: {
        tenantId: tenant.id,
        classTrackId: classTrack.id,
        programId: programMap[cs.programCode],
        academicYearId: academicYear.id,
        name: cs.name,
        ageGroup: cs.ageGroup,
        capacity: cs.capacity,
        campusId: campusMap[cs.campusSlug],
      },
    });
    classSectionMap[classSectionKeys[i]] = created.id;
  }
  console.log(`✅ Class sections: ${classSectionDefs.length}`);

  // 7b-4. Students with Guardians and Enrollments
  // NIS (Nomor Induk Siswa): school-assigned, "<YY of the intake year><4-digit running number>".
  let nisSequence = 0;
  const nextNis = () => `${CAL.start.slice(2, 4)}${String(++nisSequence).padStart(4, "0")}`;
  let studentCount = 0;
  for (const s of students) {
    const student = await prisma.student.create({
      data: {
        tenantId: tenant.id,
        name: s.name,
        nickname: s.nickname,
        dateOfBirth: s.dateOfBirth,
        gender: s.gender,
        address: s.address,
        status: "ACTIVE",
        nis: nextNis(),
        enrollments: {
          create: {
            classSectionId: classSectionMap[s.classCode],
            enrollDate: CAL.start,
            status: "ACTIVE",
          },
        },
      },
    });
    for (const g of s.guardians) {
      const parent = await prisma.parent.create({
        data: {
          tenantId: tenant.id,
          name: g.name,
          phone: g.phone,
          whatsapp: g.whatsapp,
        },
      });
      await prisma.studentGuardian.create({
        data: {
          studentId: student.id,
          parentId: parent.id,
          relationship: g.relationship,
          isPrimary: g.isPrimary,
        },
      });
    }
    studentCount++;
  }
  console.log(`✅ Students: ${studentCount} (with guardians & enrollments)`);

  // ── 7b-5. STUDENT JOURNAL (Buku Penghubung) — idempotent defaults ──
  const tmpl = await prisma.studentJournalTemplate.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id, status: JournalStatus.ACTIVE },
  });

  const journalDefaults: Array<{ scope: "SCHOOL" | "HOME"; name: string; indicators: string[] }> = [
    { scope: "SCHOOL", name: "Ibadah", indicators: [
      "Tahfizul Qur'an", "Qiro'atul Qur'an", "Membawa Infaq", "Praktek Sholat Subuh Berjama'ah",
    ]},
    { scope: "SCHOOL", name: "Perilaku", indicators: [
      "Datang di Sekolah tepat waktu",
      "Berpakaian lengkap dan rapih",
      "Patuh dan santun pada guru",
      "Salam dan jabat tangan dengan guru",
      "Membuang sampah pada tempatnya",
      "Bersikap baik kepada teman",
      "Berkata baik dan jujur",
      "Tertib pada saat belajar",
      "Membawa Buku Penghubung",
    ]},
    { scope: "SCHOOL", name: "Akademis", indicators: [
      "Semangat mengikuti pelajaran", "Menyelesaikan tugas", "Merapihkan alat tulis",
    ]},
    { scope: "HOME", name: "Ibadah Rumah", indicators: [
      "Sholat 5 waktu", "Mengaji / tilawah", "Doa harian",
    ]},
    { scope: "HOME", name: "Akhlak Rumah", indicators: [
      "Membantu orang tua", "Berkata baik", "Merapihkan kamar", "Tidur tepat waktu",
    ]},
  ];

  let journalCatCount = 0;
  let journalIndCount = 0;
  for (const [ci, cat] of journalDefaults.entries()) {
    const existing = await prisma.studentJournalCategory.findFirst({
      where: { templateId: tmpl.id, scope: cat.scope, name: cat.name },
    });
    const category = existing ?? await prisma.studentJournalCategory.create({
      data: { templateId: tmpl.id, scope: cat.scope, name: cat.name, order: ci },
    });
    if (!existing) journalCatCount++;
    for (const [ii, label] of cat.indicators.entries()) {
      const existingInd = await prisma.studentJournalIndicator.findFirst({
        where: { categoryId: category.id, label },
      });
      if (!existingInd) {
        await prisma.studentJournalIndicator.create({
          data: { categoryId: category.id, label, order: ii },
        });
        journalIndCount++;
      }
    }
  }
  console.log(`✅ Student journal template: ${journalCatCount} categories + ${journalIndCount} indicators upserted`);

  // ── 7b-6. Parent user for E2E demo auth (first student's primary guardian)
  const firstParent = await prisma.parent.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "asc" },
  });
  if (firstParent) {
    const existingParentUser = await prisma.user.findFirst({
      where: { parentId: firstParent.id },
    });
    if (!existingParentUser) {
      await prisma.user.create({
        data: {
          id: "u_rightjet",
          tenantId: tenant.id,
          email: "rightjet.hq@gmail.com",
          role: "GUARDIAN",
          name: firstParent.name,
          parentId: firstParent.id,
        },
      });
      console.log(`✅ Parent user: rightjet.hq@gmail.com (linked to ${firstParent.name})`);
    }
  }

  // ── 7c. TEACHING ASSIGNMENTS (link teachers to classes) ────
  // Map teachers by jabatan to classes (using synthetic employee codes)
  const teacherClassMap: { empKode: string; classKey: string; role: string }[] = [
    { empKode: "E003", classKey: "TKIT_A", role: "HOMEROOM" },
    { empKode: "E004", classKey: "TKIT_B", role: "HOMEROOM" },
    { empKode: "E005", classKey: "KB_ASTER", role: "HOMEROOM" },
    { empKode: "E006", classKey: "KB_METLAND", role: "HOMEROOM" },
    { empKode: "E001", classKey: "DCARE", role: "HOMEROOM" },
    { empKode: "E002", classKey: "POPUP", role: "HOMEROOM" },
  ];

  let assignmentCount = 0;
  for (const ta of teacherClassMap) {
    if (employeeIds[ta.empKode] && classSectionMap[ta.classKey]) {
      await prisma.teachingAssignment.create({
        data: {
          employeeId: employeeIds[ta.empKode],
          classSectionId: classSectionMap[ta.classKey],
          role: ta.role,
        },
      });
      assignmentCount++;
    }
  }
  console.log(`✅ Teaching assignments: ${assignmentCount}`);

  // ── 7c-2. CLASS SESSIONS (reactive generation) ─────────────
  // Generate daily ClassSession rows for every seeded ClassSection across both
  // Semesters of the (date-relative, ACTIVE) academic year. reconcileSessions is
  // idempotent and the single source of truth for session lifecycle — same call
  // the API routes use. Run AFTER teaching assignments so it resolves each
  // section's HOMEROOM teacher onto teacherId/defaultTeacherId (session teacher
  // = homeroom). It skips weekends and every seeded Holiday, so the generated
  // set spans TODAY on any school day and the teacher home has a session for it.
  let classSessionCount = 0;
  const reconcileErrors: string[] = [];
  for (const sectionId of Object.values(classSectionMap)) {
    try {
      const result = await reconcileSessions(sectionId);
      classSessionCount += result?.added ?? 0;
    } catch (error) {
      console.error(`reconcileSessions failed for section ${sectionId}:`, error);
      reconcileErrors.push(sectionId);
    }
  }
  const sectionTotal = Object.keys(classSectionMap).length;
  const successCount = sectionTotal - reconcileErrors.length;
  const failureSuffix = reconcileErrors.length
    ? `, ${reconcileErrors.length} sections failed: ${reconcileErrors.join(", ")}`
    : "";
  console.log(`✅ Class sessions: ${classSessionCount} generated across ${successCount} sections${failureSuffix}`);

  // ── 7d. STUDENT ATTENDANCE (last 5 school days, session-linked) ─────
  // One row per enrolled student per recent school day, tied to the class's
  // ClassSession (sessionId) so class health, KPIs and the teacher roster all
  // see it. The MOST RECENT school day (today on a weekday, the last Friday on
  // a weekend) is deliberately partial — ~60% of each class is marked and the
  // rest is still waiting for a tap-in — so the teacher roster always has fresh
  // rows to work and the admin "today" views show a class mid-morning.
  const allStudents = await prisma.student.findMany({
    where: { tenantId: tenant.id, status: "ACTIVE" },
    orderBy: { name: "asc" },
    include: { enrollments: { where: { status: "ACTIVE" }, select: { classSectionId: true } } },
  });
  const homeroomByClassId = new Map<string, string>(); // classSectionId → employeeId
  for (const ta of teacherClassMap) {
    if (employeeIds[ta.empKode] && classSectionMap[ta.classKey]) {
      homeroomByClassId.set(classSectionMap[ta.classKey], employeeIds[ta.empKode]);
    }
  }
  const recentSessions = await prisma.classSession.findMany({
    where: { classSectionId: { in: Object.values(classSectionMap) }, date: { in: RECENT_DAYS } },
    select: { id: true, classSectionId: true, date: true },
  });
  const sessionIdByKey = new Map(recentSessions.map((x) => [`${x.classSectionId}|${x.date}`, x.id]));
  const studentsByClass = new Map<string, typeof allStudents>();
  for (const st of allStudents) {
    const classSectionId = st.enrollments[0]?.classSectionId;
    if (!classSectionId) continue;
    if (!studentsByClass.has(classSectionId)) studentsByClass.set(classSectionId, []);
    studentsByClass.get(classSectionId)!.push(st);
  }

  const attendanceRows: {
    studentId: string;
    classSectionId: string;
    sessionId: string;
    date: string;
    status: string;
    checkInTime: Date | null;
    checkOutTime: Date | null;
    checkedInBy: string | null;
    pickedUpByRelation: string | null;
    pickedUpByName: string | null;
  }[] = [];
  for (const day of RECENT_DAYS) {
    for (const [classSectionId, roster] of studentsByClass) {
      const sessionId = sessionIdByKey.get(`${classSectionId}|${day}`);
      if (!sessionId) continue; // holiday / not generated — nothing to mark against
      const isLatest = day === LATEST_SCHOOL_DAY;
      // Latest day: mark the first ~60% of the roster, leave the rest unmarked.
      const marked = isLatest ? roster.slice(0, Math.ceil(roster.length * 0.6)) : roster;
      for (const student of marked) {
        const r = rand();
        // 88% PRESENT, 4% ABSENT, 5% SICK, 3% PERMISSION
        const status = r < 0.88 ? "PRESENT" : r < 0.92 ? "ABSENT" : r < 0.97 ? "SICK" : "PERMISSION";
        const present = status === "PRESENT";
        const inMinute = 5 + Math.floor(rand() * 55); // 07:05–07:59 WIB
        attendanceRows.push({
          studentId: student.id,
          classSectionId,
          sessionId,
          date: day,
          status,
          checkInTime: present ? jakartaInstant(day, `07:${String(inMinute).padStart(2, "0")}`) : null,
          // Still in class on the latest day; earlier days were picked up by a parent.
          checkOutTime: present && !isLatest ? jakartaInstant(day, `11:${String(30 + Math.floor(rand() * 25))}`) : null,
          checkedInBy: homeroomByClassId.get(classSectionId) ?? null,
          pickedUpByRelation: present && !isLatest ? "PARENT" : null,
          pickedUpByName: null,
        });
      }
    }
  }
  await prisma.studentAttendance.createMany({ data: attendanceRows });
  console.log(`✅ Student attendance: ${attendanceRows.length} records over ${RECENT_DAYS.length} school days (latest ${LATEST_SCHOOL_DAY} partial)`);

  // ── 8. SEED ATTENDANCE RECORDS (last 30 days) ──────────────
  const activeEmployeeIds = employees
    .filter((e) => !("status" in e && e.status === "INACTIVE"))
    .map((e) => employeeIds[e.kode]);

  const attendanceRecords: {
    employeeId: string;
    date: string;
    status: string;
    checkInTime: Date | null;
    checkOutTime: Date | null;
    checkInLat: number | null;
    checkInLng: number | null;
  }[] = [];
  for (let dayOffset = 30; dayOffset >= 0; dayOffset--) {
    const dateStr = addDays(TODAY, -dayOffset);
    if (!isSchoolDay(dateStr, HOLIDAY_DATES)) continue; // weekends + holidays

    for (const empId of activeEmployeeIds) {
      // Randomize: 80% present on time, 10% late, 5% absent, 5% leave
      const r = rand();
      let status: string;
      let checkInTime: Date | null = null;
      let checkOutTime: Date | null = null;
      const pad2 = (n: number) => String(n).padStart(2, "0");

      if (r < 0.80) {
        status = "PRESENT";
        checkInTime = jakartaInstant(dateStr, `07:${pad2(Math.floor(rand() * 14))}`); // 0-13 min after 07:00
        checkOutTime = dayOffset === 0 ? null : jakartaInstant(dateStr, `16:${pad2(Math.floor(rand() * 30))}`); // still at work today
      } else if (r < 0.90) {
        status = "LATE";
        checkInTime = jakartaInstant(dateStr, `07:${pad2(15 + Math.floor(rand() * 30))}`); // 15-44 min late
        checkOutTime = dayOffset === 0 ? null : jakartaInstant(dateStr, `16:${pad2(Math.floor(rand() * 30))}`);
      } else if (r < 0.95) {
        status = "ABSENT";
      } else {
        status = "LEAVE";
      }

      const located = status !== "ABSENT" && status !== "LEAVE";
      attendanceRecords.push({
        employeeId: empId,
        date: dateStr,
        status,
        checkInTime,
        checkOutTime,
        checkInLat: located ? -6.2234 + (rand() - 0.5) * 0.001 : null,
        checkInLng: located ? 106.8432 + (rand() - 0.5) * 0.001 : null,
      });
    }
  }
  await prisma.attendanceRecord.createMany({ data: attendanceRecords });
  console.log(`✅ Attendance records: ${attendanceRecords.length}`);

  // ── 9. SEED PAYROLL RUN (previous period, SLIPS_SENT) ──────
  // Payroll periods run from the 21st to the 20th of the next month. The
  // CURRENT period is the one containing TODAY; the SLIPS_SENT run is the
  // period before it and the DRAFT run (section 10) is the current one.
  const currentStartMonth = firstOfMonthShifted(TODAY, Number(TODAY.slice(8, 10)) >= 21 ? 0 : -1);
  const at21 = (firstOfMonth: string) => `${firstOfMonth.slice(0, 8)}21`;
  const at20 = (firstOfMonth: string) => `${firstOfMonth.slice(0, 8)}20`;
  const previousStartMonth = firstOfMonthShifted(currentStartMonth, -1);
  const periodStart = at21(previousStartMonth);
  const periodEnd = at20(currentStartMonth);
  const slipsDate = [addDays(periodEnd, 4), TODAY].sort()[0]; // slips go out a few days after the period closes
  const slipsSentInstant = jakartaInstant(slipsDate, "10:00");

  // Count working days in period (approx 22)
  const actualWorkDays = 22;

  const payrollRun = await prisma.payrollRun.create({
    data: {
      tenantId: tenant.id,
      periodStart,
      periodEnd,
      actualWorkDays,
      status: "SLIPS_SENT",
      createdBy: adminUser.id,
      approvedBy: adminUser.id,
      approvedAt: slipsSentInstant,
      exportedAt: slipsSentInstant,
      slipsSentAt: slipsSentInstant,
    },
  });

  // Create payroll items for each active employee
  let payrollItemCount = 0;
  for (const emp of employees) {
    if ("status" in emp && emp.status === "INACTIVE") continue;
    const empId = employeeIds[emp.kode];
    const sv = salaryValues[emp.kode];
    if (!sv) continue;

    // Simulate: most employees present all 22 days, a few with 20
    const daysPresent = rand() < 0.8 ? 22 : 20;
    const overtimeHours = rand() < 0.3 ? Math.floor(rand() * 15) : 0;
    const outdoorDays = rand() < 0.3 ? Math.floor(rand() * 5) : 0;
    const holidayWorkedDays = rand() < 0.15 ? Math.floor(rand() * 3) : 0;
    const dcDays = rand() < 0.2 ? Math.floor(rand() * 5) : 0;

    // Calculate component lines
    const lines: { componentDefId: string; labelSnapshot: string; categorySnapshot: string; calculatedAmount: number; finalAmount: number }[] = [];
    let gajiPokokAmount = 0;

    for (const comp of salaryComponents) {
      const baseValue = sv[comp.code as keyof typeof sv] ?? 0;
      let amount = 0;

      switch (comp.calcType) {
        case "FIXED":
          if (comp.isProRated && actualWorkDays > 0) {
            amount = baseValue * (daysPresent / actualWorkDays);
          } else {
            amount = baseValue;
          }
          break;
        case "PCT_OF_BASE":
          amount = gajiPokokAmount * (baseValue / 100);
          break;
        case "ATTENDANCE_BASED":
          if (comp.code === "tunjangan_transport") amount = baseValue * daysPresent;
          else if (comp.code === "tunjangan_msk") amount = baseValue * holidayWorkedDays;
          else if (comp.code === "insentif_outdoor") amount = baseValue * outdoorDays;
          else if (comp.code === "insentif_libur") amount = baseValue * holidayWorkedDays;
          else if (comp.code === "insentif_dc") amount = baseValue * dcDays;
          else amount = baseValue * daysPresent;
          break;
      }

      if (comp.code === "gaji_pokok") gajiPokokAmount = amount;
      amount = Math.round(amount);

      lines.push({
        componentDefId: componentMap[comp.code],
        labelSnapshot: comp.label,
        categorySnapshot: comp.category,
        calculatedAmount: amount,
        finalAmount: amount,
      });
    }

    const grossAmount = lines.filter((l) => l.categorySnapshot === "INCOME").reduce((s, l) => s + l.finalAmount, 0);
    const deductions = lines.filter((l) => l.categorySnapshot === "DEDUCTION").reduce((s, l) => s + l.finalAmount, 0);
    const netAmount = grossAmount - deductions;

    await prisma.payrollItem.create({
      data: {
        payrollRunId: payrollRun.id,
        employeeId: empId,
        grossAmount,
        deductions,
        netAmount,
        overtimeHours,
        outdoorDays,
        holidayWorkedDays,
        dcDays,
        lines: { create: lines },
      },
    });

    // Create email log for salary slip
    await prisma.emailLog.create({
      data: {
        tenantId: tenant.id,
        to: emp.email,
        subject: `Slip Gaji ${periodStart} - ${periodEnd}`,
        template: "salary_slip",
        status: "SENT",
      },
    });

    payrollItemCount++;
  }
  console.log(`✅ Payroll run: ${periodStart} → ${periodEnd} (${payrollItemCount} items, SLIPS_SENT)`);

  // ── 10. SEED A DRAFT PAYROLL (current period) ─────────────
  const currentPeriodStart = at21(currentStartMonth);
  const currentPeriodEnd = at20(firstOfMonthShifted(currentStartMonth, 1));

  // The current period always contains TODAY, so the DRAFT run always exists.
  {
    const draftRun = await prisma.payrollRun.create({
      data: {
        tenantId: tenant.id,
        periodStart: currentPeriodStart,
        periodEnd: currentPeriodEnd,
        actualWorkDays: 22,
        status: "DRAFT",
        createdBy: adminUser.id,
      },
    });

    let draftCount = 0;
    for (const emp of employees) {
      if ("status" in emp && emp.status === "INACTIVE") continue;
      const empId = employeeIds[emp.kode];
      const sv = salaryValues[emp.kode];
      if (!sv) continue;

      const daysPresent = 15 + Math.floor(rand() * 7); // partial month
      const lines: { componentDefId: string; labelSnapshot: string; categorySnapshot: string; calculatedAmount: number; finalAmount: number }[] = [];
      let gajiPokokAmount = 0;

      for (const comp of salaryComponents) {
        const baseValue = sv[comp.code as keyof typeof sv] ?? 0;
        let amount = 0;

        switch (comp.calcType) {
          case "FIXED":
            if (comp.isProRated && 22 > 0) amount = baseValue * (daysPresent / 22);
            else amount = baseValue;
            break;
          case "PCT_OF_BASE":
            amount = gajiPokokAmount * (baseValue / 100);
            break;
          case "ATTENDANCE_BASED":
            if (comp.code === "tunjangan_transport") amount = baseValue * daysPresent;
            else amount = 0;
            break;
        }

        if (comp.code === "gaji_pokok") gajiPokokAmount = amount;
        amount = Math.round(amount);
        lines.push({ componentDefId: componentMap[comp.code], labelSnapshot: comp.label, categorySnapshot: comp.category, calculatedAmount: amount, finalAmount: amount });
      }

      const grossAmount = lines.filter((l) => l.categorySnapshot === "INCOME").reduce((s, l) => s + l.finalAmount, 0);
      const deductions = lines.filter((l) => l.categorySnapshot === "DEDUCTION").reduce((s, l) => s + l.finalAmount, 0);

      await prisma.payrollItem.create({
        data: {
          payrollRunId: draftRun.id,
          employeeId: empId,
          grossAmount,
          deductions,
          netAmount: grossAmount - deductions,
          lines: { create: lines },
        },
      });
      draftCount++;
    }
    console.log(`✅ Draft payroll: ${currentPeriodStart} → ${currentPeriodEnd} (${draftCount} items, DRAFT)`);
  }

  // ══════════════════════════════════════════════════════════════
  // 11. SCENARIO FIXTURES — module coverage for dev + demos
  // ══════════════════════════════════════════════════════════════

  // Re-fetch canonical references (some created in earlier blocks, some needed here).
  const rightjetParent = await prisma.parent.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "asc" },
  });
  const studentsAll = await prisma.student.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "asc" },
    include: { guardians: true, enrollments: { where: { status: "ACTIVE" } } },
  });
  const rightjetPrimaryChild = studentsAll.find((s) =>
    s.guardians.some((g) => g.parentId === rightjetParent?.id)
  );

  // 11a. Multi-child: link rightjet parent to a second student (first non-linked student),
  // then create a brand-new third child wholly owned by rightjetParent for full household coverage.
  let secondChildId: string | null = null;
  let thirdChildId: string | null = null;
  if (rightjetParent && rightjetPrimaryChild) {
    const secondChild = studentsAll.find(
      (s) => s.id !== rightjetPrimaryChild.id && !s.guardians.some((g) => g.parentId === rightjetParent.id)
    );
    if (secondChild) {
      await prisma.studentGuardian.create({
        data: {
          studentId: secondChild.id,
          parentId: rightjetParent.id,
          relationship: "AYAH",
          isPrimary: false,
          childOrder: 2,
        },
      });
      secondChildId = secondChild.id;
      console.log(`✅ Multi-child link: ${rightjetParent.name} → ${secondChild.name}`);
    }

    // Third child — new Student + Enrollment + StudentGuardian for rightjetParent.
    const thirdChild = await prisma.student.create({
      data: {
        tenantId: tenant.id,
        name: "Fatimah Az-Zahra Hidayat",
        nickname: "Fatimah",
        dateOfBirth: "2020-08-17",
        gender: "P",
        address: "Perum Taman Aster Blok B2/8, Bekasi",
        status: "ACTIVE",
        nis: nextNis(),
        enrollments: {
          create: {
            classSectionId: classSectionMap["TKIT_B"],
            enrollDate: CAL.start,
            status: "ACTIVE",
          },
        },
      },
    });
    await prisma.studentGuardian.create({
      data: {
        studentId: thirdChild.id,
        parentId: rightjetParent.id,
        relationship: "AYAH",
        isPrimary: false,
        childOrder: 3,
      },
    });
    thirdChildId = thirdChild.id;
    console.log(`✅ Multi-child link: ${rightjetParent.name} → ${thirdChild.name}`);

    const rightjetChildCount = await prisma.studentGuardian.count({
      where: { parentId: rightjetParent.id },
    });
    console.log(`✅ Multi-child: rightjetParent has ${rightjetChildCount} kids`);
  }

  // 11a-2. New applicants who are ACTIVE students but not yet placed in a class
  // (so "Daftarkan ke Kelas" / "Tambah Siswa" and the enrollment add/remove
  // spec have someone to enroll). Two constraints shape them:
  //  - names sort early alphabetically: the enrollment spec probes the first 20
  //    students of the name-sorted list;
  //  - enrollment is age-gated per program (Day Care 24–36 months, KB 36–60,
  //    TK 48–84, measured at the start of the academic year), so one applicant
  //    fits each age band and there is a fit for whichever class is listed first.
  const bornMonthsBeforeYearStart = (months: number) =>
    `${firstOfMonthShifted(CAL.start, -months).slice(0, 8)}01`;
  const unplacedApplicants = [
    { name: "Aaliyah Nur Azzahra", nickname: "Aaliyah", dob: bornMonthsBeforeYearStart(30), gender: "P", parent: "Nuraini Azzahra", phone: "081290000101" }, // Day Care age
    { name: "Abdullah Faiz Ramadhan", nickname: "Faiz", dob: bornMonthsBeforeYearStart(48), gender: "L", parent: "Hendra Ramadhan", phone: "081290000102" }, // KB age
    { name: "Adzkia Naura Putri", nickname: "Naura", dob: bornMonthsBeforeYearStart(60), gender: "P", parent: "Ratna Dewi Putri", phone: "081290000103" }, // TK age
  ];
  for (const a of unplacedApplicants) {
    const applicant = await prisma.student.create({
      data: {
        tenantId: tenant.id,
        name: a.name,
        nickname: a.nickname,
        dateOfBirth: a.dob,
        gender: a.gender,
        address: "Bekasi, Jawa Barat",
        status: "ACTIVE",
        nis: nextNis(),
      },
    });
    const applicantParent = await prisma.parent.create({
      data: { tenantId: tenant.id, name: a.parent, phone: a.phone, whatsapp: a.phone },
    });
    await prisma.studentGuardian.create({
      data: {
        studentId: applicant.id,
        parentId: applicantParent.id,
        relationship: a.gender === "P" ? "IBU" : "AYAH",
        isPrimary: true,
      },
    });
  }
  console.log(`✅ Unplaced applicants (ACTIVE, no class yet): ${unplacedApplicants.length}`);

  // 11b. Mark one non-rightjet student as WITHDRAWN (lifecycle coverage).
  const withdrawTarget = studentsAll.find(
    (s) =>
      s.id !== rightjetPrimaryChild?.id &&
      s.id !== secondChildId &&
      s.id !== thirdChildId &&
      !s.guardians.some((g) => g.parentId === rightjetParent?.id)
  );
  if (withdrawTarget) {
    await prisma.student.update({
      where: { id: withdrawTarget.id },
      data: {
        status: "WITHDRAWN",
        withdrawalDate: TODAY,
        withdrawalReason: "Pindah domisili (demo fixture)",
      },
    });
    // Mirror app/api/students/[id]/withdraw: the active enrollment ends with the student.
    await prisma.studentEnrollment.updateMany({
      where: { studentId: withdrawTarget.id, status: "ACTIVE" },
      data: { status: "WITHDRAWN" },
    });
    console.log(`✅ Student WITHDRAWN: ${withdrawTarget.name}`);
  }

  // 11c. FEES — 3 components + ProgramFeeStructure per program.
  const feeDefs = [
    { code: "spp", label: "SPP Bulanan", category: "TUITION", isRecurring: true, sortOrder: 1 },
    { code: "daftar_ulang", label: "Daftar Ulang", category: "REGISTRATION", isRecurring: false, sortOrder: 2 },
    { code: "seragam", label: "Seragam", category: "MATERIAL", isRecurring: false, sortOrder: 3 },
  ];
  const feeMap: Record<string, string> = {};
  for (const f of feeDefs) {
    const created = await prisma.feeComponentDef.create({
      data: {
        tenantId: tenant.id,
        code: f.code,
        label: f.label,
        category: f.category,
        isRecurring: f.isRecurring,
        sortOrder: f.sortOrder,
      },
    });
    feeMap[f.code] = created.id;
  }

  const feeAmounts: Record<string, Record<string, number>> = {
    TKIT: { spp: 850_000, daftar_ulang: 2_500_000, seragam: 650_000 },
    KB:   { spp: 750_000, daftar_ulang: 2_000_000, seragam: 550_000 },
    DCARE:{ spp: 1_500_000, daftar_ulang: 3_000_000, seragam: 450_000 },
    POPUP:{ spp: 300_000, daftar_ulang: 500_000,   seragam: 300_000 },
  };
  let feeStructureCount = 0;
  for (const [pCode, amounts] of Object.entries(feeAmounts)) {
    if (!programMap[pCode]) continue;
    for (const [fCode, amount] of Object.entries(amounts)) {
      await prisma.programFeeStructure.create({
        data: {
          tenantId: tenant.id,
          programId: programMap[pCode],
          academicYearId: academicYear.id,
          feeComponentId: feeMap[fCode],
          amount,
        },
      });
      feeStructureCount++;
    }
  }
  console.log(`✅ Fees: ${feeDefs.length} components + ${feeStructureCount} program fee structures`);

  // 11d. INVOICES + PAYMENTS — relative to TODAY.
  //  (1) five scenarios on the rightjet primary child (PAID / PARTIALLY_PAID /
  //      OVERDUE / SENT / SENT with a Xendit link) — the long-standing fixtures
  //      the parent-portal specs and demos lean on, now labelled with the last
  //      five months so the newest is the CURRENT month;
  //  (2) one paid + one unpaid invoice per rightjet sibling;
  //  (3) SPP invoices for every other active, enrolled student for the current
  //      month and the two before it, with a mix of statuses (incl. DRAFT so the
  //      void spec has something to void) and payments spread through each month
  //      — including a few dated TODAY so Penerimaan / the dashboard are never
  //      empty on the first day.
  let invoiceCount = 0;
  let paymentCount = 0;
  if (rightjetPrimaryChild && rightjetParent) {
    const sppId = feeMap["spp"];
    const sppAmount = 850_000;
    const invoiceYear = TODAY.slice(0, 4);
    const monthStart = (monthsBack: number) => firstOfMonthShifted(TODAY, -monthsBack);
    const at = (offsetDays: number) => jakartaInstant(addDays(TODAY, offsetDays), "09:00");
    const sppLine = [{
      feeComponentId: sppId,
      labelSnapshot: "SPP Bulanan",
      amount: sppAmount,
      finalAmount: sppAmount,
    }];

    const invoiceScenarios: Array<{
      number: string;
      periodLabel: string;
      dueDate: string;
      status: string;
      sentAt: Date | null;
      paidAt: Date | null;
      totalPaid: number;
      xenditUrl?: string | null;
      payments: Array<{ amount: number; method: string; reference?: string; paidAt: Date }>;
    }> = [
      {
        number: `INV-${invoiceYear}-0001`,
        periodLabel: monthLabelId(monthStart(4)),
        dueDate: addDays(TODAY, -75),
        status: "PAID",
        sentAt: at(-85),
        paidAt: at(-70),
        totalPaid: sppAmount,
        payments: [{ amount: sppAmount, method: "CASH", reference: "TT-Bulan-1", paidAt: at(-70) }],
      },
      {
        number: `INV-${invoiceYear}-0002`,
        periodLabel: monthLabelId(monthStart(3)),
        dueDate: addDays(TODAY, -45),
        status: "PARTIALLY_PAID",
        sentAt: at(-55),
        paidAt: null,
        totalPaid: 400_000,
        payments: [{ amount: 400_000, method: "CASH", reference: "Cicilan-1", paidAt: at(-40) }],
      },
      {
        number: `INV-${invoiceYear}-0003`,
        periodLabel: monthLabelId(monthStart(2)),
        dueDate: addDays(TODAY, -10),
        status: "OVERDUE",
        sentAt: at(-25),
        paidAt: null,
        totalPaid: 0,
        payments: [],
      },
      {
        number: `INV-${invoiceYear}-0004`,
        periodLabel: monthLabelId(monthStart(1)),
        dueDate: addDays(TODAY, 10),
        status: "SENT",
        sentAt: at(-3),
        paidAt: null,
        totalPaid: 0,
        payments: [],
      },
      {
        number: `INV-${invoiceYear}-0005`,
        periodLabel: monthLabelId(monthStart(0)),
        dueDate: addDays(TODAY, 25),
        status: "SENT",
        sentAt: at(-1),
        paidAt: null,
        totalPaid: 0,
        xenditUrl: "https://checkout.xendit.co/v2/demo-session-annisaa-inv-0005",
        payments: [],
      },
    ];

    for (const sc of invoiceScenarios) {
      const invoice = await prisma.invoice.create({
        data: {
          tenantId: tenant.id,
          studentId: rightjetPrimaryChild.id,
          invoiceNumber: sc.number,
          periodLabel: sc.periodLabel,
          dueDate: sc.dueDate,
          totalDue: sppAmount,
          totalPaid: sc.totalPaid,
          status: sc.status,
          createdBy: adminUser.id,
          createdAt: sc.sentAt ?? undefined,
          sentAt: sc.sentAt,
          paidAt: sc.paidAt,
          parentId: rightjetParent.id,
          xenditPaymentUrl: sc.xenditUrl ?? null,
          xenditSessionId: sc.xenditUrl ? `xendit-demo-${sc.number}` : null,
          lines: { create: sppLine },
        },
      });
      for (const p of sc.payments) {
        await prisma.payment.create({
          data: {
            invoiceId: invoice.id,
            amount: p.amount,
            method: p.method,
            reference: p.reference ?? null,
            status: "APPROVED",
            createdBy: adminUser.id,
            paidAt: p.paidAt,
          },
        });
        paymentCount++;
      }
      invoiceCount++;
    }

    // Every rightjet sibling (second + third child) gets 1 paid + 1 unpaid invoice.
    // The first sibling's payment is a XENDIT one — the parent portal's
    // "Xendit method" example (a real amount, never an Rp 0 reconciliation row).
    const siblingInvoices: Array<{ studentId: string; prefix: string; method: string }> = [];
    if (secondChildId) siblingInvoices.push({ studentId: secondChildId, prefix: `INV-${invoiceYear}-1`, method: "XENDIT" });
    if (thirdChildId) siblingInvoices.push({ studentId: thirdChildId, prefix: `INV-${invoiceYear}-2`, method: "CASH" });
    for (const sib of siblingInvoices) {
      const paidSib = await prisma.invoice.create({
        data: {
          tenantId: tenant.id,
          studentId: sib.studentId,
          invoiceNumber: `${sib.prefix}001`,
          periodLabel: monthLabelId(monthStart(3)),
          dueDate: addDays(TODAY, -45),
          totalDue: sppAmount,
          totalPaid: sppAmount,
          status: "PAID",
          createdBy: adminUser.id,
          createdAt: at(-55),
          sentAt: at(-55),
          paidAt: at(-40),
          parentId: rightjetParent.id,
          lines: { create: sppLine },
        },
      });
      await prisma.payment.create({
        data: {
          invoiceId: paidSib.id,
          amount: sppAmount,
          method: sib.method,
          reference: sib.method === "XENDIT" ? "XENDIT-DEMO-SIBLING" : `TT-${sib.prefix}`,
          status: "APPROVED",
          createdBy: adminUser.id,
          xenditPaymentId: sib.method === "XENDIT" ? "xendit-demo-pay-0001" : null,
          paidAt: at(-40),
        },
      });
      invoiceCount++;
      paymentCount++;

      await prisma.invoice.create({
        data: {
          tenantId: tenant.id,
          studentId: sib.studentId,
          invoiceNumber: `${sib.prefix}002`,
          periodLabel: monthLabelId(monthStart(1)),
          dueDate: addDays(TODAY, 10),
          totalDue: sppAmount,
          totalPaid: 0,
          status: "SENT",
          createdBy: adminUser.id,
          createdAt: at(-3),
          sentAt: at(-3),
          paidAt: null,
          parentId: rightjetParent.id,
          lines: { create: sppLine },
        },
      });
      invoiceCount++;
    }

    // (3) Bulk SPP history for everyone else who is active and enrolled.
    const classKeyById = new Map(Object.entries(classSectionMap).map(([key, id]) => [id, key]));
    const programCodeByClassKey: Record<string, string> = {
      TKIT_A: "TKIT", TKIT_B: "TKIT", KB_ASTER: "KB", KB_METLAND: "KB", DCARE: "DCARE", POPUP: "POPUP",
    };
    const rightjetKids = new Set([rightjetPrimaryChild.id, secondChildId, thirdChildId]);
    const billable = await prisma.student.findMany({
      where: { tenantId: tenant.id, status: "ACTIVE", enrollments: { some: { status: "ACTIVE" } } },
      orderBy: { name: "asc" },
      include: {
        guardians: { orderBy: { isPrimary: "desc" }, take: 1, select: { parentId: true } },
        enrollments: { where: { status: "ACTIVE" }, select: { classSectionId: true }, take: 1 },
      },
    });

    // Invoice numbers run per calendar year off a counter starting at 0100 so
    // they never collide with the fixtures above; the sequence table is synced
    // to the per-year maximum at the end of the seed.
    const nextNumberByYear = new Map<string, number>();
    const numberFor = (createdYmd: string) => {
      const year = createdYmd.slice(0, 4);
      const n = nextNumberByYear.get(year) ?? 100;
      nextNumberByYear.set(year, n + 1);
      return `INV-${year}-${String(n).padStart(4, "0")}`;
    };
    const dayOfMonthToday = Number(TODAY.slice(8, 10));
    const methodFor = (r: number) => (r < 0.3 ? "CASH" : r < 0.7 ? "BANK_TRANSFER" : r < 0.9 ? "XENDIT" : "DOKU");

    type BulkInvoice = {
      id: string; tenantId: string; studentId: string; invoiceNumber: string; periodLabel: string;
      dueDate: string; totalDue: number; totalPaid: number; status: string; createdBy: string;
      createdAt: Date; sentAt: Date | null; paidAt: Date | null; parentId: string | null;
    };
    type BulkPayment = {
      id: string; invoiceId: string; amount: number; method: string; reference: string;
      status: string; createdBy: string; xenditPaymentId: string | null; paidAt: Date; createdAt: Date;
    };
    const bulkInvoices: BulkInvoice[] = [];
    const bulkPayments: BulkPayment[] = [];
    const bulkLines: { id: string; invoiceId: string; feeComponentId: string; labelSnapshot: string; amount: number; finalAmount: number }[] = [];
    let paymentSeq = 0;
    let todaysPayments = 0;

    // Older month first so invoice numbers ascend with time.
    for (const monthsBack of [2, 1, 0]) {
      const first = monthStart(monthsBack);
      const isCurrent = monthsBack === 0;
      const billedOn = addDays(first, 1);
      // Due the 10th of a past month; the current month is due the 25th (or a
      // week out if that has already gone by) so a SENT invoice is never past due.
      const dueDate = isCurrent
        ? (TODAY <= `${first.slice(0, 8)}25` ? `${first.slice(0, 8)}25` : addDays(TODAY, 7))
        : `${first.slice(0, 8)}10`;
      let idx = 0;
      for (const student of billable) {
        if (rightjetKids.has(student.id)) continue;
        idx++;
        const classKey = classKeyById.get(student.enrollments[0].classSectionId) ?? "TKIT_A";
        const fee = feeAmounts[programCodeByClassKey[classKey]]?.spp ?? sppAmount;

        // Status mix: history mostly settled; the current month is a live billing cycle.
        const r = rand();
        let status: string;
        if (monthsBack === 2) status = r < 0.94 ? "PAID" : r < 0.98 ? "PARTIALLY_PAID" : "OVERDUE";
        else if (monthsBack === 1) status = r < 0.80 ? "PAID" : r < 0.90 ? "PARTIALLY_PAID" : "OVERDUE";
        else status = idx % 10 <= 3 ? "PAID" : idx % 10 === 4 ? "PARTIALLY_PAID" : idx % 10 <= 8 ? "SENT" : "DRAFT";

        const createdAt = jakartaInstant(billedOn <= TODAY ? billedOn : TODAY, "08:00");
        const invoiceId = crypto.randomUUID();
        const paidFraction = status === "PAID" ? 1 : status === "PARTIALLY_PAID" ? 0.5 : 0;
        const totalPaid = Math.round(fee * paidFraction);
        // Payment date: current month → between the 1st and TODAY (the first few
        // paid invoices land TODAY); past months → somewhere in the first 3 weeks.
        const payDay = isCurrent
          ? (todaysPayments < 4 && status === "PAID" ? TODAY : addDays(first, Math.floor(rand() * dayOfMonthToday)))
          : addDays(first, 2 + Math.floor(rand() * 18));
        const paidOn = payDay > TODAY ? TODAY : payDay;
        if (status === "PAID" && paidOn === TODAY) todaysPayments++;

        bulkInvoices.push({
          id: invoiceId,
          tenantId: tenant.id,
          studentId: student.id,
          invoiceNumber: numberFor(billedOn <= TODAY ? billedOn : TODAY),
          periodLabel: monthLabelId(first),
          dueDate,
          totalDue: fee,
          totalPaid,
          status,
          createdBy: adminUser.id,
          createdAt,
          sentAt: status === "DRAFT" ? null : jakartaInstant(billedOn <= TODAY ? billedOn : TODAY, "09:00"),
          paidAt: status === "PAID" ? jakartaInstant(paidOn, "10:30") : null,
          parentId: student.guardians[0]?.parentId ?? null,
        });
        bulkLines.push({
          id: crypto.randomUUID(),
          invoiceId,
          feeComponentId: sppId,
          labelSnapshot: "SPP Bulanan",
          amount: fee,
          finalAmount: fee,
        });
        if (totalPaid > 0) {
          paymentSeq++;
          const method = methodFor(rand());
          const hh = 8 + Math.floor(rand() * 4); // 08:00–11:59 WIB
          const paidInstant = jakartaInstant(paidOn, `${String(hh).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}`);
          bulkPayments.push({
            id: crypto.randomUUID(),
            invoiceId,
            amount: totalPaid,
            method,
            reference: method === "CASH" ? `KW-${paymentSeq}` : method === "BANK_TRANSFER" ? `TRF-${paymentSeq}` : `${method}-${paymentSeq}`,
            status: "APPROVED",
            createdBy: adminUser.id,
            xenditPaymentId: method === "XENDIT" ? `xendit-seed-pay-${paymentSeq}` : null,
            paidAt: paidInstant,
            createdAt: paidInstant,
          });
        }
      }
    }
    await prisma.invoice.createMany({ data: bulkInvoices });
    await prisma.invoiceLine.createMany({ data: bulkLines });
    await prisma.payment.createMany({ data: bulkPayments });
    invoiceCount += bulkInvoices.length;
    paymentCount += bulkPayments.length;
  }
  console.log(`✅ Invoices: ${invoiceCount} (paid/partial/overdue/sent/draft) + ${paymentCount} payments`);

  // 11e. ADMISSIONS — INQUIRY + ADMITTED linked to converted student (studentId
  // is the "converted" signal; status stays ADMITTED post-conversion per cycle
  // 2026-05-12 — REGISTERED state dropped).
  const convertedStudent = studentsAll.find((s) => s.status === "ACTIVE");
  await prisma.admission.create({
    data: {
      tenantId: tenant.id,
      childName: "Ananda Demo Inquiry",
      childAge: "4 tahun",
      childGender: "L",
      dateOfBirth: "2022-03-11",
      parentName: "Bapak Calon Wali",
      parentPhone: "081200000001",
      parentEmail: "calon.wali@example.test",
      programId: programMap["TKIT"],
      source: "WHATSAPP",
      status: "INQUIRY",
      notes: "Menanyakan jadwal open house.",
    },
  });
  if (convertedStudent) {
    await prisma.admission.create({
      data: {
        tenantId: tenant.id,
        childName: convertedStudent.name,
        childAge: "5 tahun",
        childGender: convertedStudent.gender ?? "P",
        dateOfBirth: convertedStudent.dateOfBirth ?? "2021-05-20",
        parentName: "Ibu Demo Converted",
        parentPhone: "081200000002",
        programId: programMap["TKIT"],
        source: "WALK_IN",
        status: "ADMITTED",
        studentId: convertedStudent.id,
      },
    });
  }
  console.log(`✅ Admissions: 1 INQUIRY + 1 ADMITTED (converted)`);

  // 11f. LEAVE REQUESTS — 3 statuses across 3 employees.
  const empForLeave = Object.values(employeeIds).slice(0, 3);
  if (empForLeave.length >= 3) {
    const future = (n: number) => addDays(TODAY, n);
    const past = (n: number) => addDays(TODAY, -n);
    const pastInstant = (n: number) => jakartaInstant(past(n), "10:00");

    await prisma.leaveRequest.create({
      data: {
        employeeId: empForLeave[0],
        leaveType: "ANNUAL",
        startDate: future(5),
        endDate: future(6),
        days: 2,
        reason: "Urusan keluarga.",
        status: "PENDING",
      },
    });
    await prisma.leaveRequest.create({
      data: {
        employeeId: empForLeave[1],
        leaveType: "SICK",
        startDate: past(10),
        endDate: past(9),
        days: 2,
        reason: "Demam tinggi, surat dokter terlampir.",
        status: "APPROVED",
        reviewedBy: adminUser.id,
        reviewedAt: pastInstant(8),
        reviewNote: "Disetujui.",
      },
    });
    await prisma.leaveRequest.create({
      data: {
        employeeId: empForLeave[2],
        leaveType: "PERMISSION",
        startDate: past(20),
        endDate: past(20),
        days: 1,
        reason: "Izin tanpa alasan rinci.",
        status: "REJECTED",
        reviewedBy: adminUser.id,
        reviewedAt: pastInstant(19),
        reviewNote: "Tidak memenuhi syarat.",
      },
    });
    console.log(`✅ Leave requests: 3 (PENDING/APPROVED/REJECTED)`);
  }

  // 11h. STUDENT JOURNAL ENTRIES + NOTES — every recently-marked-present student
  // over the last five school days (SCHOOL scope), the rightjet household and
  // the KB-Aster D4 child also get HOME entries filled by their parent.
  const teacherUser = await prisma.user.findUnique({ where: { id: "u_teacher" } });
  const journalCategories = await prisma.studentJournalCategory.findMany({
    where: { templateId: tmpl.id },
    include: { indicators: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });
  const schoolInd = journalCategories.filter((c) => c.scope === "SCHOOL").flatMap((c) => c.indicators);
  const homeInd = journalCategories.filter((c) => c.scope === "HOME").flatMap((c) => c.indicators);
  let journalEntryCount = 0;
  if (teacherUser && schoolInd.length && homeInd.length) {
    // Teacher user per class — the homeroom's own login when it has one.
    const teacherUserByClassId = new Map<string, string>();
    for (const [classSectionId, employeeId] of homeroomByClassId) {
      const u = await prisma.user.findFirst({ where: { employeeId }, select: { id: true } });
      teacherUserByClassId.set(classSectionId, u?.id ?? teacherUser.id);
    }
    const journalRows: {
      tenantId: string; studentId: string; classSectionId: string | null; indicatorId: string;
      date: string; scope: string; checked: boolean; recordedByUserId: string;
    }[] = [];
    // SCHOOL scope — first 4 indicators for each student marked PRESENT that day.
    for (const row of attendanceRows) {
      if (row.status !== "PRESENT") continue;
      const recorder = teacherUserByClassId.get(row.classSectionId) ?? teacherUser.id;
      for (const ind of schoolInd.slice(0, 4)) {
        journalRows.push({
          tenantId: tenant.id,
          studentId: row.studentId,
          classSectionId: row.classSectionId,
          indicatorId: ind.id,
          date: row.date,
          scope: "SCHOOL",
          checked: rand() > 0.2,
          recordedByUserId: recorder,
        });
      }
    }
    // HOME scope — filled by the parent, for the days BEFORE the latest one
    // (the household reports on yesterday morning's routine).
    const bilalStudent = studentsAll.find((s) => s.name === "Bilal Hafidzh Rahman");
    const rightjetKidIds = [rightjetPrimaryChild?.id, secondChildId, thirdChildId].filter((id): id is string => !!id);
    const homeFamily = await prisma.student.findMany({
      where: { id: { in: [...rightjetKidIds, ...(bilalStudent ? [bilalStudent.id] : [])] }, status: "ACTIVE" },
      include: { enrollments: { where: { status: "ACTIVE" }, select: { classSectionId: true }, take: 1 } },
    });
    for (const day of RECENT_DAYS.filter((d) => d < LATEST_SCHOOL_DAY)) {
      for (const student of homeFamily) {
        const recorder = rightjetKidIds.includes(student.id) ? "u_rightjet" : "u_kbaster_parent_d4";
        for (const ind of homeInd.slice(0, 3)) {
          journalRows.push({
            tenantId: tenant.id,
            studentId: student.id,
            classSectionId: student.enrollments[0]?.classSectionId ?? null,
            indicatorId: ind.id,
            date: day,
            scope: "HOME",
            checked: rand() > 0.3,
            recordedByUserId: recorder,
          });
        }
      }
    }
    await prisma.studentJournalEntry.createMany({ data: journalRows });
    journalEntryCount = journalRows.length;

    // Notes — one teacher note (previous school day) + one parent note (latest
    // school day) on the rightjet primary child.
    const previousSchoolDay = RECENT_DAYS[RECENT_DAYS.length - 2] ?? LATEST_SCHOOL_DAY;
    if (rightjetPrimaryChild) {
      await prisma.studentJournalNote.create({
        data: {
          tenantId: tenant.id,
          studentId: rightjetPrimaryChild.id,
          date: previousSchoolDay,
          authorUserId: teacherUser.id,
          authorRole: "TEACHER",
          body: "Hari ini sangat aktif di kelas, menyelesaikan tugas dengan baik.",
        },
      });
      await prisma.studentJournalNote.create({
        data: {
          tenantId: tenant.id,
          studentId: rightjetPrimaryChild.id,
          date: LATEST_SCHOOL_DAY,
          authorUserId: "u_rightjet",
          authorRole: "GUARDIAN",
          body: "Terima kasih Ustadzah, di rumah sudah sholat subuh berjama'ah.",
        },
      });
    }
    // D4 UAT precondition — parent note authored by the actual guardian of a
    // KB-Aster student so JTBD-TEACHER-JOURNAL-03 has real data. We resolve
    // the student's first guardian → Parent row, then upsert a User with
    // role GUARDIAN linked to that Parent to use as authorUserId. authorRole
    // "GUARDIAN" drives the "Orang Tua" badge in NoteThread. Date = the
    // previous school day so it lands in the current visible week.
    const kbAsterStudent = studentsAll.find(
      (s) => s.status === "ACTIVE" && s.enrollments[0]?.classSectionId === classSectionMap["KB_ASTER"]
    );
    if (kbAsterStudent) {
      const kbAsterGuardian = kbAsterStudent.guardians[0];
      if (kbAsterGuardian) {
        const kbAsterParent = await prisma.parent.findUnique({
          where: { id: kbAsterGuardian.parentId },
        });
        if (kbAsterParent) {
          const kbAsterParentUser = await prisma.user.upsert({
            where: { id: "u_kbaster_parent_d4" },
            update: {},
            create: {
              id: "u_kbaster_parent_d4",
              tenantId: tenant.id,
              email: `parent-${kbAsterParent.id.slice(-6)}@demo.talib.id`,
              role: "GUARDIAN",
              name: kbAsterParent.name,
              parentId: kbAsterParent.id,
            },
          });
          await prisma.studentJournalNote.create({
            data: {
              tenantId: tenant.id,
              studentId: kbAsterStudent.id,
              date: previousSchoolDay,
              authorUserId: kbAsterParentUser.id,
              authorRole: "GUARDIAN",
              body: `${kbAsterStudent.name.split(" ")[0]} tadi pagi tidak sarapan banyak, mohon dipantau ketika makan siang ya Ustadzah. Jazakillah khayran.`,
            },
          });
        }
      }
    }
    console.log(`✅ Journal: ${journalEntryCount} entries + 2 notes + 1 KB-Aster parent note (D4)`);
  }

  // 11i. ASSESSMENT ENTRIES — weekly (walas) entries for the current curriculum
  // week and the two before it, plus a couple of sentra sessions last week, for
  // the TK A / TK B / KB-Aster homerooms. Entries stop the school day BEFORE
  // the latest one, so "today" still has assessing to do; the indicators are
  // exactly those linked to each week's theme for the class's age group.
  const ageGroupByClassKey = Object.fromEntries(classSectionKeys.map((k, i) => [k, classSectionDefs[i].ageGroup]));
  const allWeeks = [...(weeksBySemester[1] ?? []), ...(weeksBySemester[2] ?? [])];
  const currentWeekIdx = allWeeks.findIndex((w) => LATEST_SCHOOL_DAY >= w.start && LATEST_SCHOOL_DAY <= w.end);
  const assessmentRows: {
    tenantId: string; studentId: string; indicatorId: string; date: Date; weekId: string;
    source: "HOMEROOM" | "CENTER"; center: "WORSHIP" | "ART" | null; activity: string | null;
    level: "CONSISTENT" | "EMERGING" | "NEEDS_REINFORCEMENT"; note: string | null; recordedById: string;
  }[] = [];
  const levelFor = (): "CONSISTENT" | "EMERGING" | "NEEDS_REINFORCEMENT" => {
    const r = rand();
    return r < 0.55 ? "CONSISTENT" : r < 0.87 ? "EMERGING" : "NEEDS_REINFORCEMENT";
  };
  if (currentWeekIdx >= 0) {
    for (const classKey of ["TKIT_A", "TKIT_B", "KB_ASTER"]) {
      const classSectionId = classSectionMap[classKey];
      const roster = studentsByClass.get(classSectionId) ?? [];
      const recordedById = homeroomByClassId.get(classSectionId);
      if (!recordedById) continue;
      for (let wi = Math.max(0, currentWeekIdx - 2); wi <= currentWeekIdx; wi++) {
        const week = allWeeks[wi];
        const isCurrent = wi === currentWeekIdx;
        const cutoff = isCurrent ? addDays(LATEST_SCHOOL_DAY, -1) : week.end;
        const days = [0, 1, 2, 3, 4]
          .map((d) => addDays(week.start, d))
          .filter((d) => d <= cutoff && isSchoolDay(d, HOLIDAY_DATES));
        if (days.length === 0) continue;
        const indicators = indicatorsByThemeAge[`${week.themeId}|${ageGroupByClassKey[classKey]}`] ?? [];
        indicators.forEach((indicatorId, j) => {
          const date = utcMidnight(days[j % days.length]);
          for (const student of roster) {
            const level = levelFor();
            assessmentRows.push({
              tenantId: tenant.id,
              studentId: student.id,
              indicatorId,
              date,
              weekId: week.id,
              source: "HOMEROOM",
              center: null,
              activity: null,
              level,
              note: level === "NEEDS_REINFORCEMENT" && rand() < 0.5 ? "Perlu diulang dengan pendampingan." : null,
              recordedById,
            });
          }
        });
        // Sentra (CENTER) — last week only: Worship on the 2nd day, Art on the 4th.
        if (wi === currentWeekIdx - 1) {
          for (const [dayIdx, center] of [[1, "WORSHIP"], [3, "ART"]] as const) {
            if (!days[dayIdx]) continue;
            for (const indicatorId of indicators.slice(0, 3)) {
              for (const student of roster) {
                assessmentRows.push({
                  tenantId: tenant.id,
                  studentId: student.id,
                  indicatorId,
                  date: utcMidnight(days[dayIdx]),
                  weekId: week.id,
                  source: "CENTER",
                  center,
                  activity: ACTIVITY_BY_CENTER[center],
                  level: levelFor(),
                  note: null,
                  recordedById,
                });
              }
            }
          }
        }
      }
    }
    await prisma.assessmentEntry.createMany({ data: assessmentRows });
  }
  console.log(`✅ Assessment entries: ${assessmentRows.length} (weekly + sentra, current week and the two before)`);

  // 11j. TERMS (triwulan) + RAPORT — two Terms for the ACTIVE semester, the
  // narrative bank (kisi-kisi) for both age groups, and report cards for the
  // rightjet household: one PUBLISHED (first child, Term 1) and one DRAFT
  // (second child, the term containing TODAY).
  const termSpans = termsOfSemester(ACTIVE_SEMESTER);
  const termRows = [];
  for (const t of termSpans) {
    termRows.push(
      await prisma.term.create({
        data: {
          tenantId: tenant.id,
          semesterId: semesterIds[ACTIVE_SEMESTER.number],
          number: t.number,
          startDate: utcMidnight(t.start),
          endDate: utcMidnight(t.end),
        },
      }),
    );
  }
  const levels = ["CONSISTENT", "EMERGING", "NEEDS_REINFORCEMENT"] as const;
  for (const term of termRows) {
    await prisma.reportNarrativeTemplate.createMany({
      data: (["A", "B"] as const).flatMap((ageGroup) =>
        BUCKETED_SECTIONS.flatMap((section) =>
          levels.map((level) => ({
            tenantId: term.tenantId,
            termId: term.id,
            ageGroup,
            section,
            level,
            content: narrativeFor(section, level),
          })),
        ),
      ),
    });
    await prisma.reportClosingTemplate.createMany({
      data: (["A", "B"] as const).flatMap((ageGroup) =>
        CLOSING_SECTIONS.map((section) => ({
          tenantId: term.tenantId,
          termId: term.id,
          ageGroup,
          section,
          content: CLOSING_TEXT[section],
        })),
      ),
    });
  }
  const currentTermIdx = Math.max(0, termSpans.findIndex((t) => TODAY >= t.start && TODAY <= t.end));
  const raportTargets: { studentId: string | null; term: (typeof termRows)[number]; span: (typeof termSpans)[number]; state: "published" | "draft" }[] = [
    { studentId: rightjetPrimaryChild?.id ?? null, term: termRows[0], span: termSpans[0], state: "published" },
    { studentId: secondChildId, term: termRows[currentTermIdx], span: termSpans[currentTermIdx], state: "draft" },
  ];
  let reportCardCount = 0;
  for (const target of raportTargets) {
    if (!target.studentId) continue;
    const enrollment = await prisma.studentEnrollment.findFirst({
      where: { studentId: target.studentId, status: "ACTIVE" },
      select: { classSectionId: true },
    });
    const windowEnd = target.span.end < LATEST_SCHOOL_DAY ? target.span.end : LATEST_SCHOOL_DAY;
    let totalSchoolDays = 0;
    for (let d = target.span.start; d <= windowEnd; d = addDays(d, 1)) if (isSchoolDay(d, HOLIDAY_DATES)) totalSchoolDays++;
    const published = target.state === "published";
    const demo = DEMO_LEVELS[target.state];
    await prisma.reportCardEntry.create({
      data: {
        tenantId: tenant.id,
        studentId: target.studentId,
        termId: target.term.id,
        homeroomTeacherId: enrollment ? homeroomByClassId.get(enrollment.classSectionId) ?? null : null,
        sectionLevels: demo,
        sectionNarratives: {
          ...Object.fromEntries(
            BUCKETED_SECTIONS.map((section) => [
              section,
              narrativeFor(section, section === "INTRODUCTION" ? "CONSISTENT" : demo[section]),
            ]),
          ),
          ...CLOSING_TEXT,
        },
        sickDays: published ? 2 : 1,
        permittedAbsenceDays: published ? 1 : 0,
        unexcusedAbsenceDays: 0,
        totalSchoolDays,
        memorizationNotes: published ? "Hafal Surah An-Nas, Al-Falaq, dan Al-Ikhlas." : null,
        status: published ? "PUBLISHED" : "DRAFT",
        publishedAt: published ? jakartaInstant(LATEST_SCHOOL_DAY, "10:00") : null,
      },
    });
    await prisma.studentMeasurement.create({
      data: {
        tenantId: tenant.id,
        studentId: target.studentId,
        termId: target.term.id,
        heightCm: published ? 104.5 : 101.0,
        weightKg: published ? 16.2 : 15.1,
      },
    });
    reportCardCount++;
  }
  console.log(`✅ Terms: ${termRows.length} (Semester ${ACTIVE_SEMESTER.number}), raport narrative bank + ${reportCardCount} report cards (1 PUBLISHED, 1 DRAFT)`);

  // 11k. CUSTOM ROLE — a non-system RBAC role (Kepala Keuangan) so /admin roles
  // and the user-role picker have a custom row next to the built-ins.
  await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "Admin Keuangan",
      code: "FINANCE_ADMIN",
      description: "Mengelola tagihan, pembayaran, dan struktur biaya.",
      isSystem: false,
      permissions: JSON.stringify([
        "students.view",
        "invoices.view",
        "invoices.create",
        "invoices.void",
        "fees.view",
        "fees.edit",
        "payments.record",
      ]),
    },
  });
  console.log(`✅ Custom role: FINANCE_ADMIN`);

  // Sync InvoiceNumberSequence to the highest seeded invoice number per
  // (tenant, year). Without this, the atomic allocator in
  // lib/finance/invoice-numbers.ts would start a fresh tenant at lastNumber=1
  // and collide with the seeded INV-YYYY-0001 row, producing P2002 unique
  // constraint failures on the first POST /api/invoices in CI. The seed
  // creates Invoice rows directly with explicit invoiceNumber values, so the
  // sequence table never gets bumped through the normal allocator path.
  for (const t of await prisma.tenant.findMany({ select: { id: true } })) {
    const invoices = await prisma.invoice.findMany({
      where: { tenantId: t.id },
      select: { invoiceNumber: true },
    });
    const maxByYear = new Map<number, number>();
    for (const { invoiceNumber } of invoices) {
      const m = invoiceNumber.match(/^INV-(\d{4})-(\d+)$/);
      if (!m) continue;
      const year = Number(m[1]);
      const n = Number(m[2]);
      const prev = maxByYear.get(year) ?? 0;
      if (n > prev) maxByYear.set(year, n);
    }
    for (const [year, lastNumber] of maxByYear) {
      await prisma.invoiceNumberSequence.upsert({
        where: { tenantId_year: { tenantId: t.id, year } },
        update: { lastNumber },
        create: { tenantId: t.id, year, lastNumber },
      });
    }
  }

  // Invariant: no class section may exceed its capacity. Fails the seed loudly
  // if a future edit silently introduces another over-enrollment (F-4 from the
  // 2026-05-13 staging sweep — Fatimah Az-Zahra's third-child insert into TKIT_B
  // had bypassed the API capacity guard).
  const sections = await prisma.classSection.findMany({
    select: {
      id: true,
      name: true,
      capacity: true,
      _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
    },
  });
  const overCapacity = sections.filter((s) => s._count.enrollments > s.capacity);
  if (overCapacity.length > 0) {
    const detail = overCapacity
      .map((s) => `${s.name}: ${s._count.enrollments}/${s.capacity}`)
      .join(", ");
    throw new Error(`Seed invariant failed — class section(s) over capacity: ${detail}`);
  }

  // Invariant: the calendar must be LIVE for the day the seed ran. A fresh seed
  // on any date has exactly one ACTIVE year + semester containing today, a
  // curriculum week for the latest school day with IKTP for both age groups,
  // and a homeroom-taught session for every class on that school day.
  const invariantErrors: string[] = [];
  const activeYears = await prisma.academicYear.findMany({ where: { status: "ACTIVE" }, select: { name: true, startDate: true, endDate: true } });
  if (activeYears.length !== 1 || TODAY < activeYears[0].startDate || TODAY > activeYears[0].endDate) {
    invariantErrors.push(`expected exactly one ACTIVE academic year containing ${TODAY}, got ${JSON.stringify(activeYears)}`);
  }
  const activeSemesters = await prisma.semester.count({
    where: { status: "ACTIVE", startDate: { lte: utcMidnight(TODAY) }, endDate: { gte: utcMidnight(TODAY) } },
  });
  if (activeSemesters !== 1) invariantErrors.push(`expected exactly one ACTIVE semester containing ${TODAY}, got ${activeSemesters}`);
  const latestWeek = await prisma.week.findFirst({
    where: { startDate: { lte: utcMidnight(LATEST_SCHOOL_DAY) }, endDate: { gte: utcMidnight(LATEST_SCHOOL_DAY) } },
    select: { subTheme: { select: { theme: { select: { links: { select: { indicator: { select: { objective: { select: { ageGroup: true } } } } } } } } } } },
  });
  const linkedAgeGroups = new Set(latestWeek?.subTheme.theme.links.map((l) => l.indicator.objective.ageGroup) ?? []);
  if (!latestWeek || !linkedAgeGroups.has("A") || !linkedAgeGroups.has("B")) {
    invariantErrors.push(`no curriculum week with IKTP for both age groups on ${LATEST_SCHOOL_DAY}`);
  }
  const sessionsOnLatest = await prisma.classSession.count({ where: { date: LATEST_SCHOOL_DAY, teacherId: { not: null } } });
  if (sessionsOnLatest < Object.keys(classSectionMap).length) {
    invariantErrors.push(`expected a homeroom-taught session per class on ${LATEST_SCHOOL_DAY}, got ${sessionsOnLatest}`);
  }
  if ((await prisma.invoice.count({ where: { status: "DRAFT" } })) < 1) invariantErrors.push("no DRAFT invoice seeded");
  if ((await prisma.student.count({ where: { nis: null } })) > 0) invariantErrors.push("some students have no NIS");
  const unplaced = await prisma.student.count({ where: { status: "ACTIVE", enrollments: { none: {} } } });
  if (unplaced < 1) invariantErrors.push("no ACTIVE unenrolled student seeded");
  if (invariantErrors.length > 0) {
    throw new Error(`Seed invariant failed — ${invariantErrors.join("; ")}`);
  }

  console.log("\n🎉 Seed complete!");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
