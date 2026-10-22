import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression: teacher first-login auto-provision must not silently loop.
 *
 * Bug (2026-06-02 pilot audit): `_getSession` auto-provision called
 * `prisma.user.create({ employeeId })` unconditionally. When the matched
 * Employee ALREADY has a User row whose email diverged from the verified
 * Google auth email, the create violated `User_employeeId_key`, the bare
 * catch swallowed it, getSession returned null, and the teacher bounced to
 * login in an undiagnosable loop. The fix reconciles by employeeId instead
 * of blind-creating.
 */

const prismaMock = {
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  tenant: { count: vi.fn().mockResolvedValue(1) },
  parent: { findFirst: vi.fn().mockResolvedValue(null) },
  employee: { findFirst: vi.fn() },
};

const getUserMock = vi.fn();

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
  })),
}));

async function loadAuth() {
  vi.resetModules();
  delete process.env.DEMO_MODE; // exercise the production (Supabase) path
  return import("@/lib/auth");
}

const AUTH_EMAIL = "newteacher@example.com";
const EMPLOYEE = {
  id: "emp1",
  tenantId: "t1",
  nama: "Guru Baru",
  email: AUTH_EMAIL,
  status: "ACTIVE",
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.tenant.count.mockResolvedValue(1);
  prismaMock.parent.findFirst.mockResolvedValue(null);
  getUserMock.mockResolvedValue({
    data: { user: { email: AUTH_EMAIL, app_metadata: { provider: "google" } } },
  });
});

afterEach(() => {
  delete process.env.DEMO_MODE;
});

describe("_getSession teacher auto-provision", () => {
  it("Employee already has a User with a divergent email → reconciles, no loop", async () => {
    const { getSession } = await loadAuth();

    // No User matches the verified auth email (the existing row's email is stale).
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.employee.findFirst.mockResolvedValue(EMPLOYEE);
    // The Employee already owns a User row, email diverged.
    const existing = {
      id: "u_old",
      email: "old-placeholder@seed.test",
      role: "TEACHER",
      name: "Guru Baru",
      tenantId: "t1",
      employeeId: "emp1",
      parentId: null,
      status: "ACTIVE",
      customRoleId: null,
      customRole: null,
      lastLoginAt: new Date(), // recent → skip lastLogin write
    };
    prismaMock.user.findUnique.mockResolvedValue(existing);
    prismaMock.user.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...existing,
      ...data,
    }));
    // Blind create would throw the real unique violation — fail loud if reached.
    prismaMock.user.create.mockRejectedValue(
      new Error('Unique constraint failed on the fields: ("employeeId")'),
    );

    const session = await getSession();

    expect(session).not.toBeNull();
    expect(session?.role).toBe("TEACHER");
    expect(session?.email).toBe(AUTH_EMAIL);
    expect(session?.employeeId).toBe("emp1");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    // email reconciled on the existing row
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u_old" },
        data: expect.objectContaining({ email: AUTH_EMAIL }),
      }),
    );
  });

  it("genuinely fresh Employee (no linked User) → creates a TEACHER User", async () => {
    const { getSession } = await loadAuth();

    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.employee.findFirst.mockResolvedValue(EMPLOYEE);
    prismaMock.user.findUnique.mockResolvedValue(null); // no existing link
    const created = {
      id: "u_new",
      email: AUTH_EMAIL,
      role: "TEACHER",
      name: "Guru Baru",
      tenantId: "t1",
      employeeId: "emp1",
      parentId: null,
      customRoleId: null,
      customRole: null,
      lastLoginAt: new Date(),
    };
    prismaMock.user.create.mockResolvedValue(created);

    const session = await getSession();

    expect(session).not.toBeNull();
    expect(session?.role).toBe("TEACHER");
    expect(session?.email).toBe(AUTH_EMAIL);
    expect(prismaMock.user.create).toHaveBeenCalledOnce();
  });

  // HR-4: the ACTIVE-only lookup misses a deactivated User, and the
  // reconcile-by-employeeId path used to hand that row straight back.
  it("Employee's linked User is INACTIVE → no session, no email sync, no create", async () => {
    const { getSession } = await loadAuth();

    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.employee.findFirst.mockResolvedValue(EMPLOYEE);
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u_off",
      email: "old-placeholder@seed.test",
      role: "TEACHER",
      tenantId: "t1",
      employeeId: "emp1",
      status: "INACTIVE",
      customRole: null,
      lastLoginAt: new Date(),
    });

    expect(await getSession()).toBeNull();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("INACTIVE Employee with no User yet → not auto-provisioned", async () => {
    const { getSession } = await loadAuth();

    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.employee.findFirst.mockResolvedValue({ ...EMPLOYEE, status: "INACTIVE" });
    prismaMock.user.findUnique.mockResolvedValue(null);

    expect(await getSession()).toBeNull();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

describe("_getSession Google-only provider guard", () => {
  it.each([
    ["email/password signUp", { provider: "email" }],
    ["magic link / OTP", { provider: "email", providers: ["email", "google"] }],
    ["no provider metadata", {}],
  ])("%s account claiming an Employee email → no session, no provision", async (_label, appMetadata) => {
    getUserMock.mockResolvedValue({ data: { user: { email: AUTH_EMAIL, app_metadata: appMetadata } } });
    const { getSession } = await loadAuth();

    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.employee.findFirst.mockResolvedValue(EMPLOYEE);
    prismaMock.user.findUnique.mockResolvedValue(null);

    expect(await getSession()).toBeNull();
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});
