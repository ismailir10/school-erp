import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invalidateAdminHeaderContext } from "@/lib/admin/header-context-tag";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { students } from "../../../../prisma/data/students";

/**
 * POST /api/admin/seed
 * Seeds academic + student data on staging. Idempotent — skips if already seeded.
 * SCHOOL_ADMIN only, rate-limited.
 */
export async function POST(req: NextRequest) {
  const { success } = rateLimit(`admin-seed:${getClientIp(req)}`, 1, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const session = await getSession();
  if (!session?.tenantId || !isSuperAdmin(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenantId = session.tenantId;

  // Check if already seeded — skip only academic year creation if it exists
  const existingYear = await prisma.academicYear.findFirst({
    where: { tenantId, name: "2025/2026" },
  });

  // Get campuses
  const campuses = await prisma.campus.findMany({ where: { tenantId } });
  const campusByName: Record<string, string> = {};
  for (const c of campuses) campusByName[c.name] = c.id;
  const defaultCampusId = campuses[0]?.id;
  if (!defaultCampusId) return NextResponse.json({ error: "No campuses found" }, { status: 400 });

  // 1. Academic Year (idempotent)
  let academicYear = existingYear;
  if (!academicYear) {
    academicYear = await prisma.academicYear.create({
      data: { tenantId, name: "2025/2026", startDate: "2025-07-14", endDate: "2026-06-20", status: "ACTIVE" },
    });
  }

  // 2. Programs (idempotent)
  const programDefs = [
    { code: "DCARE", name: "Day Care", type: "YEAR_ROUND", ageMin: 24, ageMax: 36 },
    { code: "KB", name: "Kelompok Bermain", type: "SEMESTER", ageMin: 36, ageMax: 60 },
    { code: "TKIT", name: "TK Islam Terpadu", type: "SEMESTER", ageMin: 48, ageMax: 84 },
    { code: "POPUP", name: "Pop Up Class", type: "SESSION", ageMin: 36, ageMax: 72 },
  ];
  const programMap: Record<string, string> = {};
  for (const p of programDefs) {
    const created = await prisma.program.upsert({
      where: { tenantId_code: { tenantId, code: p.code } },
      update: {},
      create: { tenantId, code: p.code, name: p.name, type: p.type, ageMin: p.ageMin, ageMax: p.ageMax },
    });
    programMap[p.code] = created.id;
  }

  // 3. Class Sections
  const asterCampusId = campusByName["Taman Aster"] ?? defaultCampusId;
  const metlandCampusId = campusByName["Metland Cibitung"] ?? defaultCampusId;

  const classDefs = [
    { name: "TKIT A", programCode: "TKIT", campusId: asterCampusId, capacity: 20, key: "TKIT_A", ageGroup: "A" as const },
    { name: "TKIT B", programCode: "TKIT", campusId: asterCampusId, capacity: 20, key: "TKIT_B", ageGroup: "B" as const },
    // Non-TK programs default to A — see prisma/seed.ts for the rationale.
    { name: "KB", programCode: "KB", campusId: asterCampusId, capacity: 15, key: "KB_ASTER", ageGroup: "A" as const },
    { name: "KB", programCode: "KB", campusId: metlandCampusId, capacity: 15, key: "KB_METLAND", ageGroup: "A" as const },
    { name: "D'Care", programCode: "DCARE", campusId: asterCampusId, capacity: 10, key: "DCARE", ageGroup: "A" as const },
    { name: "POPUP Weekend", programCode: "POPUP", campusId: asterCampusId, capacity: 25, key: "POPUP", ageGroup: "A" as const },
  ];
  const classMap: Record<string, string> = {};
  for (const cs of classDefs) {
    // campusId is part of the match because class names are campus-free as of
    // the 2026-07-29 class-picker-year-scoping cycle — "KB" now exists at both
    // Aster and Metland. Without it this lookup would find the first campus's
    // row and silently skip creating the second.
    let existing = await prisma.classSection.findFirst({
      where: {
        tenantId,
        name: cs.name,
        academicYearId: academicYear.id,
        campusId: cs.campusId,
      },
    });
    if (!existing) {
      // Resolve-or-create the stable ClassTrack for this section
      // (cycle 2026-05-15 academic-hierarchy-refactor).
      const classTrack = await prisma.classTrack.upsert({
        where: {
          tenantId_campusId_programId_name: {
            tenantId,
            campusId: cs.campusId,
            programId: programMap[cs.programCode],
            name: cs.name,
          },
        },
        update: {},
        create: { tenantId, campusId: cs.campusId, programId: programMap[cs.programCode], name: cs.name },
      });
      existing = await prisma.classSection.create({
        data: { tenantId, classTrackId: classTrack.id, programId: programMap[cs.programCode], academicYearId: academicYear.id, name: cs.name, ageGroup: cs.ageGroup, capacity: cs.capacity, campusId: cs.campusId },
      });
    }
    classMap[cs.key] = existing.id;
  }

  // 4. Students (import seed data inline — idempotent)
  let studentCount = 0;
  for (const s of students) {
    // Idempotent: skip if student with same name + DOB already exists
    const existingStudent = await prisma.student.findFirst({
      where: { tenantId, name: s.name, dateOfBirth: s.dateOfBirth },
    });
    if (existingStudent) { studentCount++; continue; }

    const student = await prisma.student.create({
      data: {
        tenantId,
        name: s.name, nickname: s.nickname, dateOfBirth: s.dateOfBirth,
        gender: s.gender, address: s.address, status: "ACTIVE",
        enrollments: {
          create: { classSectionId: classMap[s.classCode], enrollDate: "2025-07-14", status: "ACTIVE" },
        },
      },
    });
    for (const g of s.guardians as { name: string; relationship: string; phone: string; whatsapp: string; isPrimary: boolean }[]) {
      const parent = await prisma.parent.create({
        data: { tenantId, name: g.name, phone: g.phone, whatsapp: g.whatsapp },
      });
      await prisma.studentGuardian.create({
        data: { studentId: student.id, parentId: parent.id, relationship: g.relationship, isPrimary: g.isPrimary },
      });
    }
    studentCount++;
  }

  // 5. Teaching Assignments
  const teacherEmails: Record<string, string> = {
    TKIT_A: "guru06@example.test",
    TKIT_B: "guru07@example.test",
    KB_ASTER: "guru08@example.test",
    KB_METLAND: "guru09@example.test",
    DCARE: "guru10@example.test",
    POPUP: "guru11@example.test",
  };
  let assignmentCount = 0;
  for (const [classKey, email] of Object.entries(teacherEmails)) {
    const user = await prisma.user.findFirst({ where: { email, tenantId } });
    if (user?.employeeId && classMap[classKey]) {
      await prisma.teachingAssignment.upsert({
        where: { employeeId_classSectionId: { employeeId: user.employeeId, classSectionId: classMap[classKey] } },
        update: {},
        create: { employeeId: user.employeeId, classSectionId: classMap[classKey], role: "HOMEROOM" },
      });
      assignmentCount++;
    }
  }

  // 6. Student Attendance (last 5 school days)
  const allStudents = await prisma.student.findMany({
    where: { tenantId, status: "ACTIVE" },
    include: { enrollments: { where: { status: "ACTIVE" }, select: { classSectionId: true } } },
  });
  let attCount = 0;
  const now = new Date();
  for (let dayOffset = 5; dayOffset >= 1; dayOffset--) {
    const d = new Date(now);
    d.setDate(d.getDate() - dayOffset);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const dateStr = d.toISOString().split("T")[0];

    for (const st of allStudents) {
      if (!st.enrollments[0]) continue;
      const rand = Math.random();
      const status = rand < 0.75 ? "PRESENT" : rand < 0.85 ? "ABSENT" : rand < 0.95 ? "SICK" : "PERMISSION";
      // @@unique([studentId, date]) was dropped (cycle 2026-05-15
      // academic-hierarchy-refactor); uniqueness moved to
      // (studentId, sessionId). Seed rows are session-agnostic
      // (sessionId NULL) — find-then-create keeps idempotency.
      const existingAtt = await prisma.studentAttendance.findFirst({
        where: { studentId: st.id, date: dateStr, sessionId: null },
        select: { id: true },
      });
      if (!existingAtt) {
        await prisma.studentAttendance.create({
          data: { studentId: st.id, classSectionId: st.enrollments[0].classSectionId, date: dateStr, status },
        });
      }
      attCount++;
    }
  }

  // ── 7. Fee Components ──────────────────────────────────────
  const feeComponentDefs = [
    { code: "spp", label: "SPP Bulanan", category: "TUITION", isRecurring: true, sortOrder: 1 },
    { code: "uang_pangkal", label: "Uang Pangkal", category: "REGISTRATION", isRecurring: false, sortOrder: 2 },
    { code: "seragam", label: "Seragam", category: "MATERIAL", isRecurring: false, sortOrder: 3 },
    { code: "kegiatan", label: "Kegiatan & Ekskul", category: "ACTIVITY", isRecurring: true, sortOrder: 4 },
    { code: "buku_atk", label: "Buku & ATK", category: "MATERIAL", isRecurring: false, sortOrder: 5 },
  ];
  const feeComponentIdMap: Record<string, string> = {};
  for (const fc of feeComponentDefs) {
    const created = await prisma.feeComponentDef.upsert({
      where: { tenantId_code: { tenantId, code: fc.code } },
      update: {},
      create: { tenantId, code: fc.code, label: fc.label, category: fc.category, isRecurring: fc.isRecurring, sortOrder: fc.sortOrder },
    });
    feeComponentIdMap[fc.code] = created.id;
  }

  // ── 8. Fee Structures (amounts per program) ───────────────
  const feeAmounts: Record<string, Record<string, number>> = {
    TKIT: { spp: 500000, uang_pangkal: 3000000, seragam: 800000, kegiatan: 100000, buku_atk: 250000 },
    KB: { spp: 400000, uang_pangkal: 2000000, seragam: 600000, kegiatan: 75000, buku_atk: 200000 },
    DCARE: { spp: 1200000, uang_pangkal: 1500000, seragam: 500000, kegiatan: 0, buku_atk: 0 },
    POPUP: { spp: 200000, uang_pangkal: 0, seragam: 0, kegiatan: 50000, buku_atk: 0 },
  };
  let feeStructureCount = 0;
  for (const [programCode, fees] of Object.entries(feeAmounts)) {
    const pId = programMap[programCode];
    if (!pId) continue;
    for (const [feeCode, amount] of Object.entries(fees)) {
      if (amount === 0) continue;
      const fcId = feeComponentIdMap[feeCode];
      if (!fcId) continue;
      await prisma.programFeeStructure.upsert({
        where: { programId_academicYearId_feeComponentId: { programId: pId, academicYearId: academicYear.id, feeComponentId: fcId } },
        update: {},
        create: { tenantId, programId: pId, academicYearId: academicYear.id, feeComponentId: fcId, amount },
      });
      feeStructureCount++;
    }
  }

  // ── 9. Invoices + Payments ────────────────────────────────
  const adminUser = await prisma.user.findFirst({ where: { tenantId, role: { in: ["SUPER_ADMIN", "SCHOOL_ADMIN"] } } });
  const adminUserId = adminUser?.id ?? "system";

  const enrolledStudents = await prisma.studentEnrollment.findMany({
    where: { status: "ACTIVE", classSection: { tenantId } },
    include: { student: true, classSection: { include: { program: true } } },
  });

  let invoiceCount = 0;
  const recurringFees = feeComponentDefs.filter(f => f.isRecurring);
  for (const enrollment of enrolledStudents) {
    const programCode = enrollment.classSection.program.code;
    const fees = feeAmounts[programCode];
    if (!fees) continue;

    const lines = recurringFees.map(fc => ({
      feeComponentId: feeComponentIdMap[fc.code],
      labelSnapshot: fc.label,
      amount: fees[fc.code] ?? 0,
      adjustmentAmount: 0,
      finalAmount: fees[fc.code] ?? 0,
    })).filter(l => l.amount > 0);

    if (lines.length === 0) continue;

    const totalDue = lines.reduce((s, l) => s + l.finalAmount, 0);
    const invoiceNumber = `INV-2026-${String(invoiceCount + 1).padStart(4, "0")}`;

    // Check if this invoice already exists
    const existingInvoice = await prisma.invoice.findFirst({
      where: { tenantId, invoiceNumber },
      select: { id: true, status: true, xenditPaymentUrl: true },
    });
    if (existingInvoice) {
      // Backfill: patch null-URL payable invoices that were seeded before the URL fix shipped
      const backfillStatuses = ["SENT", "PARTIALLY_PAID", "OVERDUE"] as const;
      if (
        existingInvoice.xenditPaymentUrl === null &&
        (backfillStatuses as readonly string[]).includes(existingInvoice.status)
      ) {
        await prisma.invoice.update({
          where: { id: existingInvoice.id },
          data: {
            xenditPaymentUrl: `https://checkout-staging.xendit.co/web/demo-${invoiceNumber}`,
            paymentLinkExpiresAt: new Date(Date.now() + 5 * 86_400_000),
          },
        });
      }
      invoiceCount++;
      continue;
    }

    // Vary statuses across the batch
    const statuses = ["PAID", "PAID", "PAID", "PARTIALLY_PAID", "PARTIALLY_PAID", "SENT", "SENT", "SENT", "DRAFT", "DRAFT"] as const;
    const status = statuses[invoiceCount % statuses.length];
    const totalPaid = status === "PAID" ? totalDue : status === "PARTIALLY_PAID" ? Math.round(totalDue * 0.5) : 0;

    const needsPaymentLink = status === "SENT" || status === "PARTIALLY_PAID";
    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        studentId: enrollment.student.id,
        invoiceNumber,
        periodLabel: "April 2026",
        dueDate: "2026-04-15",
        totalDue,
        totalPaid,
        status,
        xenditPaymentUrl: needsPaymentLink ? `https://checkout-staging.xendit.co/web/demo-${invoiceNumber}` : null,
        // A seeded link is good for five days from seeding, so the demo shows a real date.
        paymentLinkExpiresAt: needsPaymentLink ? new Date(Date.now() + 5 * 86_400_000) : null,
        createdBy: adminUserId,
        lines: { create: lines },
      },
    });

    // Create payment for PAID / PARTIALLY_PAID invoices
    if (totalPaid > 0) {
      await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: totalPaid,
          method: invoiceCount % 3 === 0 ? "BANK_TRANSFER" : "CASH",
          reference: invoiceCount % 3 === 0 ? `TRF-${Date.now()}-${invoiceCount}` : null,
          status: "RECORDED",
        },
      });
    }
    invoiceCount++;
  }

  // ── 9b. Payment-link expiry fixtures ──────────────────────
  // Cycle 2026-10-20-payment-link-expiry-display. Dates hang off "now" so they stay
  // meaningful whenever this runs. Numbered INV-2026-0980..0989, clear of the
  // loop's sequential INV-2026-0001.. numbers. Idempotent by invoice number.
  //   0980 SENT, link, future date          0985 SENT, link expired early, link cleared
  //   0981 SENT, link, past date            0986 OVERDUE, link, past date
  //   0982 SENT, link, no recorded date     0987 OVERDUE, no link
  //   0983 PAID, link, past date            0988 PARTIALLY_PAID, link, future date
  //   0984 SENT, future date + expired      0989 PARTIALLY_PAID, no link
  //        event in the activity log
  const DAY = 86_400_000;
  const ymdOffset = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
  const linkExpiryFixtures: Array<{
    n: string; status: string; dueInDays: number; paid: number; link: boolean; expiresInDays: number | null;
  }> = [
    { n: "0980", status: "SENT", dueInDays: 10, paid: 0, link: true, expiresInDays: 5 },
    { n: "0981", status: "SENT", dueInDays: 6, paid: 0, link: true, expiresInDays: -2 },
    { n: "0982", status: "SENT", dueInDays: 8, paid: 0, link: true, expiresInDays: null },
    { n: "0983", status: "PAID", dueInDays: -35, paid: 0, link: true, expiresInDays: -30 },
    { n: "0984", status: "SENT", dueInDays: 12, paid: 0, link: true, expiresInDays: 4 },
    { n: "0985", status: "SENT", dueInDays: 6, paid: 0, link: false, expiresInDays: null },
    { n: "0986", status: "OVERDUE", dueInDays: -12, paid: 0, link: true, expiresInDays: -5 },
    { n: "0987", status: "OVERDUE", dueInDays: -20, paid: 0, link: false, expiresInDays: null },
    { n: "0988", status: "PARTIALLY_PAID", dueInDays: 3, paid: 400_000, link: true, expiresInDays: 3 },
    { n: "0989", status: "PARTIALLY_PAID", dueInDays: -3, paid: 300_000, link: false, expiresInDays: null },
  ];
  let linkFixtureCount = 0;
  const fixtureEnrollments = enrolledStudents.filter((e) => feeAmounts[e.classSection.program.code]);
  for (const [i, fx] of linkExpiryFixtures.entries()) {
    if (fixtureEnrollments.length === 0) break;
    const invoiceNumber = `INV-2026-${fx.n}`;
    if (await prisma.invoice.findFirst({ where: { tenantId, invoiceNumber }, select: { id: true } })) continue;
    const enrollment = fixtureEnrollments[(i * 3) % fixtureEnrollments.length];
    const sppAmount = feeAmounts[enrollment.classSection.program.code].spp;
    const totalPaid = fx.status === "PAID" ? sppAmount : fx.paid;
    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        studentId: enrollment.student.id,
        invoiceNumber,
        periodLabel: "Oktober 2026",
        dueDate: ymdOffset(fx.dueInDays),
        totalDue: sppAmount,
        totalPaid,
        status: fx.status,
        sentAt: new Date(Date.now() - 14 * DAY),
        paidAt: fx.status === "PAID" ? new Date(Date.now() - 32 * DAY) : null,
        xenditPaymentUrl: fx.link ? `https://checkout-staging.xendit.co/web/demo-${invoiceNumber}` : null,
        xenditSessionId: fx.link ? `xendit-demo-${invoiceNumber}` : null,
        paymentLinkExpiresAt: fx.link && fx.expiresInDays !== null ? new Date(Date.now() + fx.expiresInDays * DAY) : null,
        createdBy: adminUserId,
        lines: { create: [{ feeComponentId: feeComponentIdMap["spp"], labelSnapshot: "SPP Bulanan", amount: sppAmount, adjustmentAmount: 0, finalAmount: sppAmount }] },
      },
    });
    if (totalPaid > 0) {
      await prisma.payment.create({
        data: { invoiceId: invoice.id, amount: totalPaid, method: "CASH", reference: null, status: "RECORDED" },
      });
    }
    if (fx.n === "0984") {
      // The first link expired and was replaced; the current link carries the later date.
      await prisma.webhookEvent.upsert({
        where: { eventId: `seed-evt-expired-${invoice.id}` },
        update: {},
        create: {
          provider: "xendit",
          eventId: `seed-evt-expired-${invoice.id}`,
          eventType: "payment_session.expired",
          status: "PROCESSED",
          invoiceId: invoice.id,
          payload: {
            event: "payment_session.expired",
            created: new Date(Date.now() - 4 * DAY).toISOString(),
            data: { payment_session_id: `xendit-demo-old-${invoiceNumber}`, reference_id: invoice.id, status: "EXPIRED" },
          },
          createdAt: new Date(Date.now() - 4 * DAY),
          processedAt: new Date(Date.now() - 4 * DAY),
        },
      });
    }
    linkFixtureCount++;
  }
  invoiceCount += linkFixtureCount;

  // ── 10. Admissions ────────────────────────────────────────
  const admissionDefs = [
    { childName: "Aisha Putri Ramadhani", childAge: "4 tahun", childGender: "P", parentName: "Budi Ramadhani", parentPhone: "081234500001", source: "WHATSAPP", status: "INQUIRY", programCode: "KB" },
    { childName: "Rafa Putra Wijaya", childAge: "3 tahun", childGender: "L", parentName: "Dian Wijaya", parentPhone: "081234500002", source: "WALK_IN", status: "INQUIRY", programCode: "DCARE" },
    { childName: "Zahra Amelia", childAge: "5 tahun", childGender: "P", parentName: "Hendra Saputra", parentPhone: "081234500003", source: "WEBSITE", status: "INQUIRY", programCode: "TKIT" },
    { childName: "Kenzo Alvaro", childAge: "4 tahun", childGender: "L", parentName: "Rina Alvaro", parentPhone: "081234500004", source: "REFERRAL", status: "VISIT_SCHEDULED", programCode: "KB", followUpDate: "2026-04-20" },
    { childName: "Nayla Safira", childAge: "5 tahun", childGender: "P", parentName: "Ahmad Safira", parentPhone: "081234500005", source: "WHATSAPP", status: "VISIT_SCHEDULED", programCode: "TKIT", followUpDate: "2026-04-22" },
    { childName: "Arkan Zain", childAge: "4 tahun", childGender: "L", parentName: "Sari Zain", parentPhone: "081234500006", source: "WALK_IN", status: "VISITED", programCode: "KB" },
    { childName: "Lina Maharani", childAge: "5 tahun", childGender: "P", parentName: "Dewi Maharani", parentPhone: "081234500007", source: "REFERRAL", status: "VISITED", programCode: "TKIT" },
    { childName: "Farel Putra", childAge: "3 tahun", childGender: "L", parentName: "Andi Putra", parentPhone: "081234500008", source: "WALK_IN", status: "ADMITTED", programCode: "KB" },
    { childName: "Salsabila Aulia", childAge: "5 tahun", childGender: "P", parentName: "Yuni Aulia", parentPhone: "081234500009", source: "WHATSAPP", status: "ADMITTED", programCode: "TKIT" },
    { childName: "Gibran Alfarizi", childAge: "4 tahun", childGender: "L", parentName: "Tono Alfarizi", parentPhone: "081234500010", source: "WEBSITE", status: "ADMITTED", programCode: "KB" },
    { childName: "Maya Safitri", childAge: "3 tahun", childGender: "P", parentName: "Eko Safitri", parentPhone: "081234500011", source: "WALK_IN", status: "CANCELLED", programCode: "DCARE" },
  ] as const;

  let admissionCount = 0;
  for (const a of admissionDefs) {
    // Idempotent: skip if an admission with this child name + parent phone exists
    const existing = await prisma.admission.findFirst({
      where: { tenantId, childName: a.childName, parentPhone: a.parentPhone },
    });
    if (existing) continue;

    await prisma.admission.create({
      data: {
        tenantId,
        childName: a.childName,
        childAge: a.childAge,
        childGender: a.childGender,
        parentName: a.parentName,
        parentPhone: a.parentPhone,
        source: a.source,
        status: a.status,
        programId: programMap[a.programCode] ?? null,
        campusPreference: asterCampusId,
        followUpDate: "followUpDate" in a ? (a as { followUpDate: string }).followUpDate : null,
      },
    });
    admissionCount++;
  }

  // ── 11. Student Fee Adjustments (Keringanan) ──────────────
  // One sample sibling discount so demo mode + e2e have data.
  let feeAdjustmentCount = 0;
  const seedAdjustmentStudent = allStudents[0];
  const sppComponentId = feeComponentIdMap["spp"];
  if (seedAdjustmentStudent && sppComponentId) {
    const existingAdjustment = await prisma.studentFeeAdjustment.findFirst({
      where: {
        tenantId,
        studentId: seedAdjustmentStudent.id,
        academicYearId: academicYear.id,
        feeComponentId: sppComponentId,
        reason: "Diskon saudara kandung",
      },
    });
    if (!existingAdjustment) {
      await prisma.studentFeeAdjustment.create({
        data: {
          tenantId,
          studentId: seedAdjustmentStudent.id,
          academicYearId: academicYear.id,
          feeComponentId: sppComponentId,
          type: "DISCOUNT",
          mode: "PERCENT",
          value: 20,
          reason: "Diskon saudara kandung",
          createdBy: adminUserId,
        },
      });
    }
    feeAdjustmentCount = 1;
  }

  // ── 12. Leave Requests ────────────────────────────────────
  const leaveRequestDefs = [
    { empKode: "E002", leaveType: "ANNUAL", startDate: "2026-04-01", endDate: "2026-04-03", days: 3, reason: "Urusan keluarga", status: "APPROVED" },
    { empKode: "E003", leaveType: "SICK", startDate: "2026-04-07", endDate: "2026-04-08", days: 2, reason: "Sakit demam", status: "APPROVED" },
    { empKode: "E004", leaveType: "ANNUAL", startDate: "2026-04-15", endDate: "2026-04-16", days: 2, reason: "Acara pernikahan", status: "PENDING" },
    { empKode: "E007", leaveType: "PERMISSION", startDate: "2026-04-10", endDate: "2026-04-10", days: 1, reason: "Keperluan mendadak", status: "REJECTED", reviewNote: "Tidak bisa karena jadwal asesmen" },
    { empKode: "E008", leaveType: "ANNUAL", startDate: "2026-03-20", endDate: "2026-03-21", days: 2, reason: "Mudik", status: "CANCELLED" },
  ];

  let leaveCount = 0;
  for (const lr of leaveRequestDefs) {
    const employee = await prisma.employee.findFirst({
      where: { tenantId, kode: lr.empKode },
    });
    if (!employee) continue;

    // Idempotent: skip if leave request with same employee + dates exists
    const existing = await prisma.leaveRequest.findFirst({
      where: { employeeId: employee.id, startDate: lr.startDate, endDate: lr.endDate },
    });
    if (existing) continue;

    await prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveType: lr.leaveType,
        startDate: lr.startDate,
        endDate: lr.endDate,
        days: lr.days,
        reason: lr.reason,
        status: lr.status,
        reviewNote: "reviewNote" in lr ? lr.reviewNote : null,
        reviewedBy: lr.status === "APPROVED" || lr.status === "REJECTED" ? adminUserId : null,
        reviewedAt: lr.status === "APPROVED" || lr.status === "REJECTED" ? new Date() : null,
      },
    });
    leaveCount++;
  }

  invalidateAdminHeaderContext();
  return NextResponse.json({
    ok: true,
    seeded: {
      academicYear: 1,
      programs: programDefs.length,
      classes: classDefs.length,
      students: studentCount,
      assignments: assignmentCount,
      attendance: attCount,
      feeComponents: feeComponentDefs.length,
      feeStructures: feeStructureCount,
      invoices: invoiceCount,
      admissions: admissionCount,
      feeAdjustments: feeAdjustmentCount,
      leaveRequests: leaveCount,
    },
  });
}
