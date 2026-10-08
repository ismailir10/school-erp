import { test, expect } from "@playwright/test";
import { PNG_1X1, tinyPdf } from "./helpers/enrollment";

/**
 * Cycle A — enrollment application end-to-end smoke.
 *
 * Walks the full funnel against the deployed build:
 *   admission inquiry → admin "Kirim Formulir" (invite + token) →
 *   tokenized public submit → admin accept → convert → student exists.
 *
 * The parent side is driven through the real public API rather than the
 * wizard (the canvas wizard is exercised by enrollment-signature-handover and
 * enrollment-documents specs). Signatures and a document are uploaded for real
 * (the demo disk storage backend), and submit must read the signatures from the
 * row, not from the request. This spec's job is the cross-module contract — proxy public
 * allow-list, token gating, admin auth, the convert transaction, and a real
 * Student surfacing in the admin UI — which unit tests (mocked prisma) cannot
 * exercise.
 *
 * Admin auth: demo cookie school-erp-session=u_super_admin (same as
 * e2e/admin.spec.ts). Public POSTs carry a unique X-Forwarded-For so their
 * per-IP rate-limit buckets don't contend with other suites.
 */

const ADMIN_USER_ID = "u_super_admin";
const STAMP = Date.now();
const CHILD = `E2E Enrol ${STAMP}`;
const PARENT_EMAIL = `e2e-enrol-${STAMP}@example.com`;
const IP = "10.77.0.1";
const TINY_PDF = tinyPdf("kk");

test.describe.configure({ mode: "serial", timeout: 90_000 });

test.describe("Cycle A — Enrollment application funnel", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      { name: "school-erp-session", value: ADMIN_USER_ID, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
  });

  test("invalid token → friendly non-leaking page", async ({ page }) => {
    await page.goto("/pendaftaran/not-a-real-token");
    await expect(page.getByText("Tautan tidak ditemukan")).toBeVisible();
  });

  test("invite → tokenized submit → accept → convert → student exists", async ({ page }) => {
    // 1. Create an admission inquiry (public) with an email so it can be invited.
    const adm = await page.request.post("/api/admission/submit", {
      headers: { "X-Forwarded-For": IP },
      data: {
        childName: CHILD,
        dateOfBirth: "2021-03-15",
        childGender: "P",
        parentName: "E2E Ibu",
        parentPhone: "081200000001",
        parentEmail: PARENT_EMAIL,
      },
    });
    expect(adm.ok()).toBeTruthy();
    const admissionId = (await adm.json()).id as string;

    // 2. Admin invite → returns the tokenized form URL.
    const inv = await page.request.post("/api/enrollments/invite", { data: { admissionId } });
    expect(inv.ok()).toBeTruthy();
    const formUrl = (await inv.json()).formUrl as string;
    expect(formUrl).toContain("/pendaftaran/");
    const token = formUrl.split("/pendaftaran/")[1];
    expect(token.length).toBeGreaterThan(20);

    // 3. The public form page renders for a valid token.
    await page.goto(`/pendaftaran/${token}`);
    await expect(page.getByRole("heading", { name: "Formulir Pendaftaran Murid Baru" })).toBeVisible();

    // 4. Pick a real ACTIVE program for the tenant.
    const progRes = await page.request.get("/api/programs");
    const progJson = await progRes.json();
    const programs = Array.isArray(progJson) ? progJson : (progJson.data ?? []);
    expect(programs.length).toBeGreaterThan(0);
    const programId = programs[0].id as string;

    // 5. Submit the full form via the public token API. Signatures live on the
    //    row (the signature route persists them the moment they are drawn) and
    //    submit reads them from there, ignoring any client-sent token.
    const submitUrl = `/api/enrollments/token/${token}/submit`;
    const submitBody = {
      programId,
      dcareAddon: false,
      studentData: {
        childName: CHILD, childGender: "P", birthPlace: "Bekasi", dateOfBirth: "2021-03-15",
        agama: "ISLAM", kewarganegaraan: "WNI",
      },
      ayahData: { name: "E2E Ayah" },
      ibuData: { name: "E2E Ibu" },
      consentData: { agreed: true, version: "annisaa-2026-v1", ayah: { name: "E2E Ayah" }, ibu: { name: "E2E Ibu" } },
    };

    // 5a. Nothing stored yet: even client-sent "tokens" can't satisfy submit.
    const fakeTokens = await page.request.post(submitUrl, {
      headers: { "X-Forwarded-For": IP },
      data: {
        ...submitBody,
        consentData: {
          ...submitBody.consentData,
          ayah: { name: "E2E Ayah", signatureToken: "supabase:v1:enrollment/x/ayah-signature-deadbeef.png" },
          ibu: { name: "E2E Ibu", signatureToken: "supabase:v1:enrollment/x/ibu-signature-deadbeef.png" },
        },
      },
    });
    expect(fakeTokens.status()).toBe(422);

    // 5b. Nothing is saved yet → status endpoint says so.
    const sigBefore = await page.request.get(`/api/enrollments/token/${token}/signature`, {
      headers: { "X-Forwarded-For": IP },
    });
    expect(sigBefore.status()).toBe(200);
    expect(await sigBefore.json()).toMatchObject({ ayah: false, ibu: false });

    // 5c. Save both signatures server-side, one POST each.
    for (const which of ["ayah", "ibu"] as const) {
      const sig = await page.request.post(`/api/enrollments/token/${token}/signature?which=${which}`, {
        headers: { "X-Forwarded-For": IP },
        multipart: { file: { name: "sig.png", mimeType: "image/png", buffer: PNG_1X1 } },
      });
      expect(sig.status()).toBe(200);
      expect(await sig.json()).toEqual({ saved: true });
    }
    const sigAfter = await page.request.get(`/api/enrollments/token/${token}/signature`, {
      headers: { "X-Forwarded-For": IP },
    });
    expect(sigAfter.status()).toBe(200);
    const sigStatus = await sigAfter.json();
    expect(sigStatus).toMatchObject({ ayah: true, ibu: true });
    expect(JSON.stringify(sigStatus)).not.toContain("signatureToken");

    // 5d. Upload one document (Kartu Keluarga as a tiny PDF). The response
    //     carries the file name only — never a storage token.
    const doc = await page.request.post(`/api/enrollments/token/${token}/documents?key=kk`, {
      headers: { "X-Forwarded-For": IP },
      multipart: { file: { name: "kk-scan.pdf", mimeType: "application/pdf", buffer: TINY_PDF } },
    });
    expect(doc.status()).toBe(200);
    const docJson = await doc.json();
    expect(docJson.fileName).toBe("kk-scan.pdf");
    expect(docJson).not.toHaveProperty("fileToken");
    expect(JSON.stringify(docJson)).not.toContain("fileToken");

    // 5e. Submit WITHOUT any signature token in the body → 201.
    const submit = await page.request.post(submitUrl, { headers: { "X-Forwarded-For": IP }, data: submitBody });
    expect(submit.status()).toBe(201);

    // 6. Admin finds the SUBMITTED application.
    const list = await page.request.get(`/api/enrollments?status=SUBMITTED&search=${encodeURIComponent(CHILD)}&pageSize=20`);
    const row = (await list.json()).data.find((r: { childName: string }) => r.childName === CHILD);
    expect(row).toBeTruthy();
    const appId = row.id as string;

    // 7. Accept, then convert.
    const accept = await page.request.patch(`/api/enrollments/${appId}`, { data: { status: "ACCEPTED" } });
    expect(accept.ok()).toBeTruthy();
    const convert = await page.request.post(`/api/enrollments/${appId}/convert`);
    expect(convert.ok()).toBeTruthy();

    // 7b. Admin view of the documents: redacted (no storage token), streamable,
    //     and the physical-receipt tick still works on a converted application.
    const detail = await page.request.get(`/api/enrollments/${appId}`);
    expect(detail.status()).toBe(200);
    const detailJson = await detail.json();
    expect(JSON.stringify(detailJson)).not.toContain("fileToken");
    expect(detailJson.documents.kk.hasFile).toBe(true);
    expect(detailJson.documents.kk.fileName).toBe("kk-scan.pdf");

    const stream = await page.request.get(`/api/enrollments/${appId}/documents/kk`);
    expect(stream.status()).toBe(200);
    expect(stream.headers()["content-type"]).toContain("application/pdf");
    expect((await stream.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const tick = await page.request.patch(`/api/enrollments/${appId}`, { data: { documentsReceived: { akta: true } } });
    expect(tick.status()).toBe(200);
    const afterTick = await (await page.request.get(`/api/enrollments/${appId}`)).json();
    expect(afterTick.documents.akta.receivedPhysical).toBe(true);
    expect(afterTick.documents.akta.hasFile).toBe(false);
    expect(afterTick.documents.kk.hasFile).toBe(true);

    // Any other field stays frozen once converted.
    const frozen = await page.request.patch(`/api/enrollments/${appId}`, { data: { status: "REJECTED" } });
    expect(frozen.status()).toBe(409);

    // 8. The detail page now shows the converted state in the real UI.
    await page.goto(`/admin/enrollments/${appId}`);
    await expect(page.getByText("sudah dikonversi menjadi data siswa")).toBeVisible();

    // 9. A real Student exists for this child in the admin students list.
    const stu = await page.request.get(`/api/students?search=${encodeURIComponent(CHILD)}&pageSize=20`);
    const students = (await stu.json()).data ?? [];
    expect(students.some((s: { name: string }) => s.name === CHILD)).toBeTruthy();
  });
});
