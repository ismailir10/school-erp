import { test, expect, type Page } from "@playwright/test";

/**
 * T12 — kesiswaan CRUD parity.
 *
 * Verifies the `/admin/guardians/[id]` detail route renders (no 404, the
 * pre-cycle regression the audit caught) AND that editing a field from the
 * detail-page Edit dialog round-trips through `PUT /api/parents/[id]`
 * (see saveParent in app/admin/guardians/[id]/page.tsx). It previously went
 * through `PUT /api/guardians/[junctionId]` against the first StudentGuardian
 * row, which left a wali with no linked student uneditable.
 *
 * Auth: demo cookie school-erp-session=u_super_admin.
 * Isolation: creates a fresh student + parent + StudentGuardian link via
 * API so the spec doesn't depend on seed ordering.
 */

const ADMIN_USER_ID = "u_super_admin";

async function loginAsAdmin(page: Page) {
  await page.context().addCookies([
    {
      name: "school-erp-session",
      value: ADMIN_USER_ID,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test.describe("Admin guardian detail — navigate + edit round-trip", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("navigate from /admin/guardians to /admin/guardians/[id], edit phone, assert persistence via API + DOM", async ({
    page,
  }) => {
    const suffix = Date.now();

    // ---------- Build a fresh student + linked parent via API ----------
    // POST /api/students returns 201 with the new student; we then add a
    // guardian via POST /api/students/[id]/guardians which upserts the
    // Parent row and creates the StudentGuardian junction.
    const studentRes = await page.request.post("/api/students", {
      data: { name: `E2E GuardianHost ${suffix}` },
    });
    expect(studentRes.status()).toBe(201);
    const student = (await studentRes.json()) as { id: string };

    const initialPhone = "0811000" + String(suffix).slice(-4);
    const guardianRes = await page.request.post(
      `/api/students/${student.id}/guardians`,
      {
        data: {
          name: `E2E ParentDetail ${suffix}`,
          relationship: "IBU",
          phone: initialPhone,
          email: `e2e-guardian-detail-${suffix}@example.test`,
          isPrimary: true,
        },
      },
    );
    expect(guardianRes.status()).toBe(201);
    const guardian = (await guardianRes.json()) as {
      id: string;
      parent: { id: string; name: string };
    };
    const parentId = guardian.parent.id;
    const parentName = guardian.parent.name;

    // ---------- Land on /admin/guardians ----------
    await page.goto("/admin/guardians");
    await page.waitForLoadState("networkidle");

    // The list paginates 20-at-a-time; search by name to surface the row.
    await page
      .getByPlaceholder("Cari nama, email, atau telepon...")
      .fill(parentName);
    // Wait for the filtered fetch to land. URLSearchParams encodes spaces as
    // `+`, not %20, so substring-matching encodeURIComponent() output races
    // against the actual request URL. Just look for `search=` on /api/guardians.
    await page.waitForResponse(
      (res) =>
        res.url().includes("/api/guardians") &&
        res.url().includes("search=") &&
        res.ok(),
      { timeout: 15_000 },
    );

    // Click the name link → routes to /admin/guardians/[parentId] (T7 —
    // "name is the link" replaced the separate button + Lihat action).
    await page.getByRole("link", { name: parentName }).first().click();
    await page.waitForURL(`**/admin/guardians/${parentId}`, { timeout: 15_000 });

    // Detail page renders (not 404 — the pre-cycle regression).
    await expect(
      page.getByRole("heading", { name: parentName }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(initialPhone).first()).toBeVisible();

    // ---------- Edit via the detail page Edit button ----------
    // The detail page exposes an "Edit" button in the DetailPageHeader actions
    // slot. Click → renders the inline GuardianFormBody with editForm hydrated
    // from the GET /api/parents/[id] payload.
    await page.getByRole("button", { name: /^Edit$/ }).click();

    // Wait for the form fields to mount — the address Input has a stable
    // placeholder via GuardianFormBody.
    const newPhone = `0822999${String(suffix).slice(-4)}`;

    // The Phone field uses placeholder "081234567890" inside the GuardianFormBody.
    // Locate via placeholder (label associations aren't htmlFor-bound here).
    const phoneInput = page.getByPlaceholder("081234567890").first();
    await expect(phoneInput).toBeVisible({ timeout: 10_000 });
    await phoneInput.fill(newPhone);

    // Save — header surfaces "Simpan Perubahan" while editing.
    // Bio saves through PUT /api/parents/[id]. It used to go through
    // PUT /api/guardians/[junctionId] against whichever StudentGuardian row
    // happened to be first, which made a wali with no linked student
    // uneditable and rewrote that child's relationship on every save.
    const savePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/parents/${parentId}`) &&
        res.request().method() === "PUT",
    );
    await page.getByRole("button", { name: /Simpan Perubahan/ }).click();
    const saveRes = await savePromise;
    if (!saveRes.ok()) {
      const errBody = await saveRes.text();
      throw new Error(`PUT ${saveRes.url()} returned ${saveRes.status()}: ${errBody}`);
    }

    // ---------- Assert persistence — API readback + DOM render ----------
    const apiRes = await page.request.get(`/api/parents/${parentId}`);
    expect(apiRes.ok()).toBeTruthy();
    const stored = (await apiRes.json()) as { phone: string };
    expect(stored.phone).toBe(newPhone);

    // DOM render — the detail page re-fetches after save, so the new phone
    // surfaces in the read-only display block.
    await expect(page.getByText(newPhone).first()).toBeVisible({
      timeout: 15_000,
    });

    // ---------- Cleanup ----------
    // Deactivate the host student so the marathon run does not accumulate.
    await page.request
      .put(`/api/students/${student.id}`, { data: { status: "INACTIVE" } })
      .catch(() => undefined);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Siswa ↔ wali linking.
  //
  // Travel used to be one-way: a wali's page listed clickable children, but a
  // student's Orang Tua tab rendered plain text, so getting back to a parent
  // meant the sidebar and the search box. This walks the full loop.
  // ────────────────────────────────────────────────────────────────────────
  test("walks student → wali → child → student, and links a second child to the same wali without creating a parent", async ({
    page,
  }) => {
    const suffix = Date.now();

    // ---------- Two students, one shared wali ----------
    const kakakRes = await page.request.post("/api/students", {
      data: { name: `E2E Kakak ${suffix}` },
    });
    expect(kakakRes.status()).toBe(201);
    const kakak = (await kakakRes.json()) as { id: string };

    const adikRes = await page.request.post("/api/students", {
      data: { name: `E2E Adik ${suffix}` },
    });
    expect(adikRes.status()).toBe(201);
    const adik = (await adikRes.json()) as { id: string };

    const waliName = `E2E Ibu Bersama ${suffix}`;
    const waliRes = await page.request.post(
      `/api/students/${kakak.id}/guardians`,
      {
        data: {
          name: waliName,
          relationship: "IBU",
          phone: `0813444${String(suffix).slice(-4)}`,
          email: `e2e-wali-bersama-${suffix}@example.test`,
          isPrimary: true,
        },
      },
    );
    expect(waliRes.status()).toBe(201);
    const wali = (await waliRes.json()) as { parent: { id: string } };
    const parentId = wali.parent.id;

    // Parent count before linking — the whole point of the link path is that
    // this number does not move when a sibling reuses an existing wali.
    const beforeRes = await page.request.get("/api/guardians?pageSize=1");
    const parentsBefore = ((await beforeRes.json()) as {
      pagination: { total: number };
    }).pagination.total;

    // ---------- Link the same wali to the second child, via the API ----------
    const linkRes = await page.request.post(
      `/api/students/${adik.id}/guardians`,
      { data: { parentId, relationship: "IBU", childOrder: 2 } },
    );
    expect(linkRes.status()).toBe(201);

    const afterRes = await page.request.get("/api/guardians?pageSize=1");
    const parentsAfter = ((await afterRes.json()) as {
      pagination: { total: number };
    }).pagination.total;
    expect(parentsAfter).toBe(parentsBefore);

    // Re-linking the same parent is rejected rather than silently duplicated.
    const dupeRes = await page.request.post(
      `/api/students/${adik.id}/guardians`,
      { data: { parentId, relationship: "IBU" } },
    );
    expect(dupeRes.status()).toBe(409);

    // ---------- student → wali ----------
    await page.goto(`/admin/students/${kakak.id}`);
    await page.getByRole("link", { name: new RegExp(waliName) }).click();
    await page.waitForURL(`**/admin/guardians/${parentId}`, { timeout: 15_000 });

    // The wali page should now show both children.
    await expect(page.getByText(`E2E Kakak ${suffix}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(`E2E Adik ${suffix}`)).toBeVisible();

    // ---------- wali → child ----------
    await page.getByRole("link", { name: new RegExp(`E2E Adik ${suffix}`) }).click();
    await page.waitForURL(`**/admin/students/${adik.id}`, { timeout: 15_000 });

    // ---------- Saudara surfaces the sibling on the student page ----------
    // Target the heading, not loose text: the dossier layout nests sections
    // deeper and adds "Saudara Kandung"/"Tiri"/"Angkat" field labels, so a bare
    // getByText("Saudara") is ambiguous.
    await expect(
      page.getByRole("heading", { name: "Saudara", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    const saudaraLink = page.getByRole("link", {
      name: new RegExp(`E2E Kakak ${suffix}`),
    });
    await expect(saudaraLink).toBeVisible();

    // ---------- back to the first student, closing the loop ----------
    await saudaraLink.click();
    await page.waitForURL(`**/admin/students/${kakak.id}`, { timeout: 15_000 });

    // ---------- Cleanup ----------
    for (const s of [kakak.id, adik.id]) {
      await page.request
        .put(`/api/students/${s}`, { data: { status: "INACTIVE" } })
        .catch(() => undefined);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // Cycle 2026-10-19-wali-detail-clarity: the page answers first. Contact in
  // the header, "Perlu perhatian" for what is missing, and a child can be
  // linked from the wali side.
  // ────────────────────────────────────────────────────────────────────────
  test("shows contact and what needs attention first, and links a child from the wali page", async ({
    page,
  }) => {
    const suffix = Date.now();
    const hostRes = await page.request.post("/api/students", { data: { name: `E2E Host ${suffix}` } });
    expect(hostRes.status()).toBe(201);
    const host = (await hostRes.json()) as { id: string };
    const newcomerName = `E2E Anak Baru ${suffix}`;
    const newRes = await page.request.post("/api/students", { data: { name: newcomerName } });
    expect(newRes.status()).toBe(201);
    const newcomer = (await newRes.json()) as { id: string };

    const waliName = `E2E Wali Perhatian ${suffix}`;
    const waliRes = await page.request.post(`/api/students/${host.id}/guardians`, {
      data: {
        name: waliName,
        relationship: "IBU",
        phone: `0812555${String(suffix).slice(-4)}`,
        isPrimary: true,
      },
    });
    expect(waliRes.status()).toBe(201);
    const parentId = ((await waliRes.json()) as { parent: { id: string } }).parent.id;

    await page.goto(`/admin/guardians/${parentId}`);
    await expect(page.getByRole("heading", { name: waliName, level: 1 })).toBeVisible({ timeout: 15_000 });

    // Contact is in the header, before any section.
    await expect(page.getByRole("link", { name: "WhatsApp" }).first()).toHaveAttribute("href", /^https:\/\/wa\.me\/62/);
    await expect(page.getByRole("link", { name: "Telepon" }).first()).toHaveAttribute("href", /^tel:/);

    // No KTP / KK uploaded: the strip says so, with one action that opens Dokumen.
    const strip = page.getByRole("region", { name: "Perlu perhatian" });
    await expect(strip.getByText("KTP dan KK belum diunggah")).toBeVisible();
    await strip.getByRole("button", { name: "Unggah" }).click();
    await expect(page.getByRole("button", { name: "Lihat" })).toHaveCount(0); // nothing on file, so no preview button

    // Link a second child from this side.
    await page.getByRole("button", { name: "Tautkan anak" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Tautkan anak" });
    await dialog.getByRole("combobox", { name: /Siswa/ }).click();
    await page.getByPlaceholder("Cari nama siswa...").fill(newcomerName);
    await page.getByRole("option", { name: new RegExp(newcomerName) }).click();
    const linked = page.waitForResponse(
      (res) => res.url().includes(`/api/students/${newcomer.id}/guardians`) && res.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Tautkan anak" }).click();
    expect((await linked).ok()).toBe(true);
    await expect(page.getByRole("link", { name: new RegExp(newcomerName) })).toBeVisible({ timeout: 15_000 });

    for (const s of [host.id, newcomer.id]) {
      await page.request.put(`/api/students/${s}`, { data: { status: "INACTIVE" } }).catch(() => undefined);
    }
  });
});
