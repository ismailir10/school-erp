import { test, expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import {
  CONSENT_VERSION,
  PNG_1X1,
  createInvite,
  firstProgramId,
  newAdminContext,
  newIpBlock,
  postSignature,
  prefillDraft,
  tinyPdf,
} from "./helpers/enrollment";

/**
 * Enrollment documents follow-ups (cycle 2026-10-06-enrollment-docs-followups).
 *
 *  1. Required-before-submit: staff mark Kartu Keluarga as required in
 *     /api/config/enrollment; the submit API refuses (422) without it and the
 *     parent form blocks Lanjut on the Berkas step until it is uploaded.
 *  2. Settings UI: /admin/settings/pendaftaran lists the documents as checkboxes
 *     and saves through the same config API.
 *  3. Convert copy: KTP Ayah, KTP Ibu and KK uploaded by the parent are copied
 *     into the guardians' own records on convert, with no storage token leaking.
 *  4. Student page: the converted student's dossier shows the Kelengkapan Berkas
 *     card in the Pendaftaran section and the "Berkas pendaftaran (x / 9)" rail row.
 *
 * The required list is a per-tenant setting shared by every spec, so it is only
 * non-empty inside tests 1 and 2 and is reset to [] in `finally` and `afterAll`.
 * Parent-side calls carry a unique X-Forwarded-For so per-IP rate limits don't
 * contend with other specs.
 */

const STAMP = Date.now();
const KK_LABEL = "Kartu Keluarga (KK)";
const AKTA_LABEL = "Akta kelahiran anak";
const nextIp = newIpBlock(80);

// Test 1 (required-before-submit)
const CHILD_REQ = `E2E Wajib ${STAMP}`;
// Tests 3-4 (convert copy, student page)
const CHILD_COPY = `E2E Salin ${STAMP}`;
const AYAH_EMAIL = `e2e-salin-ayah-${STAMP}@example.com`;
const IBU_EMAIL = `e2e-salin-ibu-${STAMP}@example.com`;
const tail = String(STAMP).slice(-8);
const AYAH_PHONE = `0813${tail}`;
const IBU_PHONE = `0814${tail}`;

test.describe.configure({ mode: "serial", timeout: 90_000 });

async function setRequiredDocuments(admin: APIRequestContext, requiredDocuments: string[]) {
  const res = await admin.put("/api/config/enrollment", { data: { requiredDocuments } });
  expect(res.status()).toBe(200);
  expect((await res.json()).requiredDocuments).toEqual(requiredDocuments);
}

async function getRequiredDocuments(admin: APIRequestContext): Promise<string[]> {
  const res = await admin.get("/api/config/enrollment");
  expect(res.status()).toBe(200);
  return (await res.json()).requiredDocuments as string[];
}

function submitBody(opts: {
  programId: string;
  child: string;
  ayah?: Record<string, unknown>;
  ibu?: Record<string, unknown>;
}) {
  return {
    programId: opts.programId,
    dcareAddon: false,
    studentData: {
      childName: opts.child,
      childGender: "P",
      birthPlace: "Bekasi",
      dateOfBirth: "2021-03-15",
      agama: "ISLAM",
      kewarganegaraan: "WNI",
    },
    ayahData: { name: "E2E Ayah", ...opts.ayah },
    ibuData: { name: "E2E Ibu", ...opts.ibu },
    consentData: {
      agreed: true,
      version: CONSENT_VERSION,
      ayah: { name: "E2E Ayah" },
      ibu: { name: "E2E Ibu" },
    },
  };
}

test.describe("Enrollment documents follow-ups", () => {
  let admin: BrowserContext;
  let programId = "";
  let studentId = "";
  let ayahParentId = "";
  let ibuParentId = "";

  test.beforeAll(async ({ browser }) => {
    admin = await newAdminContext(browser);
    programId = await firstProgramId(admin.request);
    // Start from a known state even if an earlier aborted run left a list behind.
    await setRequiredDocuments(admin.request, []);
  });

  test.afterAll(async () => {
    try {
      await admin?.request.put("/api/config/enrollment", { data: { requiredDocuments: [] } });
    } finally {
      await admin?.close();
    }
  });

  test("required Kartu Keluarga: API refuses submit, form blocks Lanjut until uploaded, then submit works", async ({
    browser,
  }) => {
    await setRequiredDocuments(admin.request, ["kk"]);
    const parent = await browser.newContext({
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { "X-Forwarded-For": nextIp() },
    });
    try {
      const ip = nextIp();
      const { token } = await createInvite(admin.request, {
        ip,
        child: CHILD_REQ,
        email: `e2e-wajib-${STAMP}@example.com`,
      });
      await prefillDraft(admin.request, { token, ip, child: CHILD_REQ, programId });
      for (const which of ["ayah", "ibu"] as const) {
        const sig = await postSignature(admin.request, { token, ip, which });
        expect(sig.status()).toBe(200);
      }

      // Server side: no KK stored → 422, and the message names the gap.
      const refused = await admin.request.post(`/api/enrollments/token/${token}/submit`, {
        headers: { "X-Forwarded-For": ip },
        data: submitBody({ programId, child: CHILD_REQ }),
      });
      expect(refused.status()).toBe(422);
      expect(JSON.stringify(await refused.json())).toContain("Berkas wajib belum diunggah");

      // Browser: walk to the Berkas step.
      const page = await parent.newPage();
      await page.goto(`/pendaftaran/${token}`);
      // A prefilled draft resumes at its first incomplete step (PUBX-4); start
      // the walk from Data Anak through the stepper.
      await expect(page.getByRole("list", { name: "Langkah formulir" })).toBeVisible();
      const toDataAnak = page.getByRole("button", { name: "1. Data Anak" });
      if (await toDataAnak.isVisible()) await toDataAnak.click();
      await expect(page.getByRole("heading", { name: "Data Anak", exact: true })).toBeVisible();
      for (const heading of ["Data Ayah", "Data Ibu", "Pilihan Program", "Berkas pendukung"]) {
        await page.getByRole("button", { name: "Lanjut" }).click();
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      }

      const kkRow = page.getByRole("listitem").filter({ hasText: KK_LABEL });
      await expect(kkRow.getByText("Wajib diunggah", { exact: true })).toBeVisible();

      // Lanjut is blocked with a named error and the parent stays on Berkas.
      await page.getByRole("button", { name: "Lanjut" }).click();
      await expect(page.getByText(`${KK_LABEL} wajib diunggah.`)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Berkas pendukung", exact: true })).toBeVisible();

      // Upload the KK through the row's file input → Lanjut proceeds.
      await page.locator("#berkas-kk").setInputFiles({
        name: "kk-wajib.pdf",
        mimeType: "application/pdf",
        buffer: tinyPdf("kk-wajib"),
      });
      await expect(page.getByText("kk-wajib.pdf")).toBeVisible();
      await page.getByRole("button", { name: "Lanjut" }).click();
      await expect(
        page.getByRole("heading", { name: "Surat Persetujuan Orang Tua", exact: true }),
      ).toBeVisible();

      // Signatures are already saved on the row → Tinjau → Kirim Formulir.
      await page.getByRole("button", { name: "Lanjut" }).click();
      await expect(page.getByRole("heading", { name: /Tinjau/ })).toBeVisible();
      await page.getByRole("button", { name: "Kirim Formulir" }).click();
      await expect(page.getByText("Jazakumullah khairan")).toBeVisible();
    } finally {
      await parent.close();
      await setRequiredDocuments(admin.request, []);
    }
  });

  test("settings page: staff toggle Akta as required and the config API reflects it", async () => {
    await setRequiredDocuments(admin.request, ["kk"]);
    const page = await admin.newPage();
    try {
      await page.goto("/admin/settings/pendaftaran");
      await expect(page.getByRole("heading", { name: "Berkas wajib pendaftaran" })).toBeVisible();

      const kkBox = page.getByRole("checkbox", { name: KK_LABEL });
      const aktaBox = page.getByRole("checkbox", { name: AKTA_LABEL });
      await expect(kkBox).toBeChecked();
      await expect(aktaBox).not.toBeChecked();

      await aktaBox.check();
      await page.getByRole("button", { name: "Simpan Pengaturan" }).click();
      await expect(page.getByText("Pengaturan disimpan.").first()).toBeVisible();

      expect((await getRequiredDocuments(admin.request)).slice().sort()).toEqual(["akta", "kk"]);
    } finally {
      await page.close();
      await setRequiredDocuments(admin.request, []);
    }
  });

  test("convert copies the parent's KTP/KK into the guardian records", async () => {
    const ip = nextIp();
    const { token } = await createInvite(admin.request, {
      ip,
      child: CHILD_COPY,
      email: `e2e-salin-${STAMP}@example.com`,
    });

    // Unique parent emails/phones so convert creates NEW Parent rows instead of
    // merging into a seeded family.
    const ayah = { name: "E2E Ayah Salin", email: AYAH_EMAIL, phone: AYAH_PHONE };
    const ibu = { name: "E2E Ibu Salin", email: IBU_EMAIL, phone: IBU_PHONE };
    const draft = await admin.request.patch(`/api/enrollments/token/${token}`, {
      headers: { "X-Forwarded-For": ip },
      data: {
        programId,
        studentData: submitBody({ programId, child: CHILD_COPY }).studentData,
        ayahData: ayah,
        ibuData: ibu,
        consentData: { agreed: true, version: CONSENT_VERSION, ayah: { name: ayah.name }, ibu: { name: ibu.name } },
      },
    });
    expect(draft.status()).toBe(200);

    for (const which of ["ayah", "ibu"] as const) {
      const sig = await postSignature(admin.request, { token, ip, which });
      expect(sig.status()).toBe(200);
    }

    const uploads = [
      { key: "ktp_ayah", name: "ktp-ayah.png", mimeType: "image/png", buffer: PNG_1X1 },
      { key: "ktp_ibu", name: "ktp-ibu.png", mimeType: "image/png", buffer: PNG_1X1 },
      { key: "kk", name: "kk.pdf", mimeType: "application/pdf", buffer: tinyPdf("kk-copy") },
    ];
    for (const u of uploads) {
      const res = await admin.request.post(`/api/enrollments/token/${token}/documents?key=${u.key}`, {
        headers: { "X-Forwarded-For": ip },
        multipart: { file: { name: u.name, mimeType: u.mimeType, buffer: u.buffer } },
      });
      expect(res.status()).toBe(200);
    }

    const submit = await admin.request.post(`/api/enrollments/token/${token}/submit`, {
      headers: { "X-Forwarded-For": ip },
      data: submitBody({ programId, child: CHILD_COPY, ayah, ibu }),
    });
    expect(submit.status()).toBe(201);

    const list = await admin.request.get(
      `/api/enrollments?status=SUBMITTED&search=${encodeURIComponent(CHILD_COPY)}&pageSize=20`,
    );
    expect(list.ok()).toBeTruthy();
    const row = (await list.json()).data.find((r: { childName: string }) => r.childName === CHILD_COPY);
    expect(row).toBeTruthy();
    const appId = row.id as string;

    const accept = await admin.request.patch(`/api/enrollments/${appId}`, { data: { status: "ACCEPTED" } });
    expect(accept.ok()).toBeTruthy();

    const convert = await admin.request.post(`/api/enrollments/${appId}/convert`);
    expect(convert.status()).toBe(200);
    const converted = await convert.json();
    expect(converted.documentsCopied).toEqual({ ktpAyah: "copied", ktpIbu: "copied", kk: "copied" });
    studentId = converted.student.id as string;
    expect(studentId).toBeTruthy();

    // The student's application view: KK present, never a storage token.
    const appRes = await admin.request.get(`/api/students/${studentId}/enrollment-application`);
    expect(appRes.status()).toBe(200);
    const appJson = await appRes.json();
    expect(appJson.data.documents.kk.hasFile).toBe(true);
    expect(JSON.stringify(appJson)).not.toContain("fileToken");

    // Guardian rows created by convert (relationship AYAH / IBU).
    const stu = await admin.request.get(`/api/students/${studentId}`);
    expect(stu.status()).toBe(200);
    const guardians = (await stu.json()).guardians as { relationship: string; parent: { id: string } }[];
    ayahParentId = guardians.find((g) => g.relationship === "AYAH")?.parent.id ?? "";
    ibuParentId = guardians.find((g) => g.relationship === "IBU")?.parent.id ?? "";
    expect(ayahParentId).toBeTruthy();
    expect(ibuParentId).toBeTruthy();

    // Each guardian owns a readable copy: Ayah KTP + KK, Ibu KTP.
    const ayahKtp = await admin.request.get(`/api/parents/${ayahParentId}/ktp`);
    expect(ayahKtp.status()).toBe(200);
    expect(ayahKtp.headers()["content-type"]).toContain("image/png");
    const ayahKk = await admin.request.get(`/api/parents/${ayahParentId}/kk`);
    expect(ayahKk.status()).toBe(200);
    expect(ayahKk.headers()["content-type"]).toContain("application/pdf");
    const ibuKtp = await admin.request.get(`/api/parents/${ibuParentId}/ktp`);
    expect(ibuKtp.status()).toBe(200);
    expect(ibuKtp.headers()["content-type"]).toContain("image/png");
  });

  test("student page shows Kelengkapan Berkas in the Pendaftaran section and the rail row", async () => {
    expect(studentId, "needs the student created by the convert test").toBeTruthy();
    const page = await admin.newPage();
    try {
      await page.goto(`/admin/students/${studentId}`);

      // The Pendaftaran section is lazy and starts collapsed: open it.
      await page.getByRole("button", { name: /Formulir Pendaftaran/ }).click();
      const card = page.locator("#pendaftaran").getByRole("region", { name: "Kelengkapan Berkas" });
      await expect(card).toBeVisible();
      await expect(card.getByText(/\d+ \/ 9 berkas lengkap/)).toBeVisible();

      // Rail checklist row (supplied by /api/students/[id]/overview).
      await expect(page.getByText(/Berkas pendaftaran \(\d+ \/ 9\)/).first()).toBeVisible();
    } finally {
      await page.close();
    }
  });
});
