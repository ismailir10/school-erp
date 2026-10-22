import { cache } from "react";
import { createClient } from "./supabase/server";
import { prisma } from "./db";
import { getSystemRolePermissions } from "./permissions";
import { isDemoAuthEnabled } from "./security/demo-mode";

/**
 * Backfill Parent.email from a known User.email at session-resolve time.
 *
 * Background: F-7 from the 2026-05-13 staging E2E sweep — `Parent.email` is
 * NULL for every Parent row on staging, while every signed-in guardian has
 * a non-NULL `User.email`. Auth resolves via User.email; any feature that
 * reads Parent.email silently breaks for these guardians. T3 ships a one-shot
 * migration; this hook keeps newly-created or rolled-back records self-healing.
 *
 * Invariants:
 *   - Only writes when `Parent.email IS NULL`. `updateMany` returns count=0
 *     for already-healed rows; we never overwrite a non-NULL email.
 *   - Never throws: a failed heal must not block session resolution. Errors
 *     log to `[AUTH]` and the next signed request retries opportunistically.
 *   - Caller filters role + presence of `parentId` + presence of `userEmail`,
 *     so this helper does not re-validate them.
 */
export async function selfHealParentEmail(
  parentId: string,
  userEmail: string,
): Promise<void> {
  try {
    await prisma.parent.updateMany({
      where: { id: parentId, email: null },
      data: { email: userEmail },
    });
  } catch (err) {
    console.error("[AUTH] Parent.email self-heal failed", err);
  }
}

// User row shape we cache — includes the optional customRole relation because
// session resolution needs the role's permission JSON and code on every hit.
type CachedUser = NonNullable<
  Awaited<ReturnType<typeof prisma.user.findFirst>>
> & {
  customRole?: {
    id: string;
    code: string;
    permissions: string;
  } | null;
};

type CachedEntry = {
  user: CachedUser;
  permissions: string[];
  customRoleCode: string | null;
  expiresAt: number;
};

// In-memory cache of Prisma User rows keyed by email. Every API route and
// every server-rendered page calls getSession(), and previously each call hit
// the database for the same User row. TTL is 10s — long enough to collapse
// the cluster of fetches a single page render makes, short enough that
// role/tenant/status changes propagate within one user page-navigation.
// See README ADR on userCache staleness window.
//
// The cache stores the derived permissions/customRoleCode alongside the raw
// User row so we don't re-parse the customRole.permissions JSON on every hit —
// every request can trigger many getSession() calls, and re-derivation would
// mean repeated JSON.parse + getSystemRolePermissions() for the same user.
const USER_CACHE_TTL_MS = 10_000;
const userCache = new Map<string, CachedEntry>();

function getCachedEntry(email: string): CachedEntry | undefined {
  const entry = userCache.get(email);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    userCache.delete(email);
    return undefined;
  }
  return entry;
}

function setCachedEntry(
  email: string,
  user: CachedUser,
  permissions: string[],
  customRoleCode: string | null,
) {
  userCache.set(email, {
    user,
    permissions,
    customRoleCode,
    expiresAt: Date.now() + USER_CACHE_TTL_MS,
  });
}

/**
 * Drop cached session entries so a role/status change applies on the next
 * request instead of after USER_CACHE_TTL_MS. The cache is per server
 * instance, so on serverless this only guarantees the instance that handled
 * the write; other instances still converge within the TTL.
 */
export function invalidateUserCache(...emails: Array<string | null | undefined>): void {
  for (const email of emails) if (email) userCache.delete(email);
}

/**
 * Derive the effective permission set + custom-role code for a loaded user.
 *
 * Precedence:
 *   1. customRole present → parse customRole.permissions JSON.
 *   2. No customRole → fall back to getSystemRolePermissions(user.role).
 *
 * Defensive on malformed JSON: we log and fall back to role defaults rather
 * than silently granting `[]` to a user who should have access. Failing closed
 * here would lock an admin out of the whole app if one customRole row gets
 * corrupted.
 */
// Self-service essentials — perms that any user with an Employee record needs
// to access their own data. A custom role JSON that pre-dates F-09 won't list
// these codes, but we still want the user to be able to clock in or submit a
// leave request for themselves. We union them in for any role linked to an
// Employee row so a stale customRole.permissions cannot lock an employee out
// of self-service. Custom roles can still gate or restrict every other perm.
const SELF_SERVICE_ESSENTIALS = ["attendance.checkin", "leave.submit"];

function derivePermissions(
  user: CachedUser,
): { permissions: string[]; customRoleCode: string | null } {
  const customRole = user.customRole;
  if (customRole) {
    try {
      const parsed = JSON.parse(customRole.permissions);
      if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) {
        const merged = user.employeeId
          ? Array.from(new Set([...parsed, ...SELF_SERVICE_ESSENTIALS]))
          : parsed;
        return { permissions: merged, customRoleCode: customRole.code };
      }
      console.error(
        `[AUTH] customRole.permissions for role ${JSON.stringify(customRole.code)} is not a string[] — falling back to role defaults`,
      );
    } catch {
      console.error(
        `[AUTH] Failed to parse customRole.permissions for role ${JSON.stringify(customRole.code)} — falling back to role defaults`,
      );
    }
    // malformed → fall back to enum-role defaults, but keep customRoleCode
    // so downstream code can still see which role the user is linked to.
    return {
      permissions: getSystemRolePermissions(user.role),
      customRoleCode: customRole.code,
    };
  }
  return {
    permissions: getSystemRolePermissions(user.role),
    customRoleCode: null,
  };
}

// Multi-tenant safety rail. Session resolution currently keys on email
// alone (single-tenant MVP). Throwing early forces whoever onboards a
// second tenant to implement tenant-from-host resolution before the
// silent cross-tenant collapse bug lands in production.
//
// Result is cached for SINGLE_TENANT_CHECK_TTL_MS so hot paths don't
// hit the DB on every getSession() call. The TTL is short enough that a
// freshly seeded second tenant fires the guard within ~1 minute — we
// explicitly refuse to cache forever, because the one moment the guard
// must fire (tenant seeded after process start) is exactly when a
// permanent flag would silently bypass it.
const SINGLE_TENANT_CHECK_TTL_MS = 60_000;
let singleTenantCheckedAt = 0;
export async function assertSingleTenant(): Promise<void> {
  if (Date.now() - singleTenantCheckedAt < SINGLE_TENANT_CHECK_TTL_MS) return;
  const count = await prisma.tenant.count();
  if (count > 1) {
    throw new Error(
      `[AUTH] Multi-tenant seed detected (tenant.count=${count}) but session ` +
        `resolver keys on email alone. Implement tenant-from-host resolution ` +
        `in lib/auth.ts before onboarding a second tenant.`,
    );
  }
  singleTenantCheckedAt = Date.now();
}

export type SessionUser = {
  id: string;
  email: string;
  role: "SUPER_ADMIN" | "SCHOOL_ADMIN" | "TEACHER" | "GUARDIAN";
  name: string | null;
  tenantId: string | null;
  employeeId: string | null;
  parentId: string | null;
  /**
   * Effective permission codes for this session. Derived from either the
   * user's customRole (JSON array) or getSystemRolePermissions(role) when no
   * custom role is assigned. Always an array — never null — so callers can
   * `.includes()` without a guard.
   */
  permissions: string[];
  /**
   * Code of the assigned customRole, or null when the user falls back to
   * their enum role defaults. Useful for UI labels ("Peran: Finance Admin").
   */
  customRoleCode: string | null;
};

/** Full access including payroll and salary data. */
export const isSuperAdmin = (role: string): boolean => role === "SUPER_ADMIN";

/** Either admin persona — can access /admin but not necessarily salary data. */
export const isAdminRole = (role: string): boolean =>
  role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN";

/**
 * Map a session role to its canonical landing route. Used by layout guards
 * to redirect cross-portal navigations to the user's own home instead of
 * the login page — "you can't access /admin" should land a teacher on
 * /teacher, not bounce them through the login form.
 *
 * Returns "/" for unknown roles so callers can still fall through to the
 * login flow when the role isn't recognised.
 */
export function homePathForRole(role: string): string {
  if (role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN") return "/admin";
  if (role === "TEACHER") return "/teacher";
  if (role === "GUARDIAN") return "/parent";
  return "/";
}

/**
 * Get the current session user.
 * Reads Supabase Auth session, then looks up the Prisma User by email.
 * Auto-creates the Prisma User on first login if employee exists with that email.
 *
 * Wrapped in React's `cache()` so that layout + page + server components in
 * the same request dedupe to a single Supabase auth + Prisma lookup. This is
 * complementary to the 60s in-memory `userCache` above: `cache()` dedupes
 * within a single request, `userCache` dedupes across requests.
 */
export const getSession = cache(_getSession);

async function _getSession(): Promise<SessionUser | null> {
  // Demo mode requires explicit opt-in via DEMO_MODE=true and is refused on
  // Vercel — see lib/security/demo-mode.ts.
  if (isDemoAuthEnabled()) {
    return getDemoSession();
  }

  try {
    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (!authUser?.email) return null;

    // Google is the only sign-in the app offers (app/page.tsx), and the User
    // lookup and auto-provision below trust the auth email. An account created
    // through any other Supabase provider — e.g. an email/password signUp made
    // straight against the public anon key — could claim an employee's or
    // parent's email before they ever sign in. `provider` is the account's
    // first provider, so a pre-registered email stays locked out even if the
    // real owner later links Google to it.
    if (authUser.app_metadata?.provider !== "google") {
      console.error("[AUTH] Refused non-Google Supabase account", {
        provider: authUser.app_metadata?.provider ?? null,
      });
      return null;
    }

    // Multi-tenant safety rail: single-tenant MVP resolves User by email
    // alone. The moment a second tenant is seeded, `findFirst({ email })`
    // collapses across tenants and returns whichever row Postgres picks
    // first — silent cross-tenant leak. Fail loud instead.
    await assertSingleTenant();

    // Look up Prisma User by email — serve from cache if fresh.
    // status: "ACTIVE" filter ensures a deactivated user loses access
    // within USER_CACHE_TTL_MS of the admin-UI toggle.
    let cached = getCachedEntry(authUser.email);
    let user: CachedUser | null = cached?.user ?? null;
    if (!cached) {
      // email is unique per-tenant — findFirst returns the only match
      // in the single-tenant MVP; guarded by assertSingleTenant above.
      // include customRole so derivePermissions can read its JSON without
      // a follow-up query.
      user = (await prisma.user.findFirst({
        where: { email: authUser.email, status: "ACTIVE" },
        include: { customRole: true },
      })) as CachedUser | null;
      if (user) {
        const derived = derivePermissions(user);
        setCachedEntry(authUser.email, user, derived.permissions, derived.customRoleCode);
        cached = getCachedEntry(authUser.email);
      }
    }

    // Auto-create User on first Supabase Auth login.
    //
    // Precedence: Employee-first. If an email matches both Employee and
    // Parent (e.g. a teacher whose spouse is also a guardian using the
    // same email), the user is auto-provisioned as TEACHER. This matches
    // the routing fallback in app/auth/callback/route.ts (Employee check
    // before Parent check) so both code paths agree on the final role.
    // Admin override: an admin can manually create a GUARDIAN User row
    // before first login to force the Parent role.
    if (!user) {
      // Check if there's an employee with this email
      const employee = await prisma.employee.findFirst({
        where: { email: authUser.email },
      });

      if (employee) {
        // Reconcile-by-employeeId, do NOT blind-create. If a User row is
        // already linked to this Employee (seeded, an admin-created invite, or
        // the Employee email was changed after the User was created), its email
        // may be stale relative to the verified Google auth email. A blind
        // `prisma.user.create({ employeeId })` would violate the unique
        // `User_employeeId_key`; the catch below swallows it, getSession
        // returns null, and the teacher bounces to login in a silent loop
        // (pilot audit 2026-06-02). employeeId is @unique, so look the row up,
        // sync the stale email to the verified auth email, and reuse it —
        // preserving the existing role (admin intent). Only create when no
        // User is linked to the Employee yet.
        const linked = await prisma.user.findUnique({
          where: { employeeId: employee.id },
          include: { customRole: true },
        });
        // A linked User that is not ACTIVE was deliberately deactivated
        // (users page, or employee deactivate). The ACTIVE-only lookup above
        // missed it, so without this guard the reconcile path would hand the
        // session back and the deactivation would be a no-op (HR-4). An
        // INACTIVE Employee with no User yet must not be auto-provisioned.
        if (linked ? linked.status !== "ACTIVE" : employee.status !== "ACTIVE") {
          return null;
        }
        user = (linked
          ? linked.email === authUser.email
            ? linked
            : await prisma.user.update({
                where: { id: linked.id },
                data: { email: authUser.email },
                include: { customRole: true },
              })
          : await prisma.user.create({
              data: {
                tenantId: employee.tenantId,
                email: authUser.email,
                role: "TEACHER",
                name: employee.nama,
                employeeId: employee.id,
              },
              include: { customRole: true },
            })) as CachedUser;
        const derived = derivePermissions(user);
        setCachedEntry(authUser.email, user, derived.permissions, derived.customRoleCode);
        cached = getCachedEntry(authUser.email);
      } else {
        // Check if there's a parent with this email
        const parent = await prisma.parent.findFirst({
          where: { email: authUser.email },
        });

        if (parent) {
          user = (await prisma.user.create({
            data: {
              tenantId: parent.tenantId,
              email: authUser.email,
              role: "GUARDIAN",
              name: parent.name,
              parentId: parent.id,
            },
            include: { customRole: true },
          })) as CachedUser;
          const derived = derivePermissions(user);
          setCachedEntry(authUser.email, user, derived.permissions, derived.customRoleCode);
          cached = getCachedEntry(authUser.email);
        } else {
          // Not an employee, not a guardian, no existing User → deny access
          return null;
        }
      }
    }

    if (!user) return null;

    // Update last login — skip if updated within last 5 minutes to avoid
    // writing on every single getSession() call (every API route + page load).
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    if (!user.lastLoginAt || user.lastLoginAt < fiveMinutesAgo) {
      const updated = (await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: now },
        include: { customRole: true },
      })) as CachedUser;
      const derived = derivePermissions(updated);
      setCachedEntry(updated.email, updated, derived.permissions, derived.customRoleCode);
      cached = getCachedEntry(updated.email);
      user = updated;
    }

    // For guardian users, find their parent ID + sync display name from
    // the authoritative Parent row (Parent.name is the source of truth for
    // guardians; User.name may be stale from a pre-wipe seed or manual
    // invite). Same pattern for teachers — Employee.nama wins over User.name.
    let parentId: string | null = (user as { parentId?: string | null }).parentId ?? null;
    let displayName: string | null = user.name;
    if (user.role === "GUARDIAN") {
      // Email-fallback lookup only runs when email is a non-empty string —
      // an empty/falsy email would otherwise hit `findFirst({ where: { email: "" } })`,
      // which is a leak-class query if any parent row shares that value.
      // Tenant-scoped: Parent.email is unique PER TENANT (see schema
      // @@unique([tenantId, email])), not globally, so an unscoped lookup
      // could also match another tenant's parent sharing the same email.
      const parent = parentId
        ? await prisma.parent.findFirst({ where: { id: parentId }, select: { id: true, name: true } })
        : user.email
          ? await prisma.parent.findFirst({ where: { email: user.email, tenantId: user.tenantId }, select: { id: true, name: true } })
          : null;
      if (parent) {
        parentId = parent.id;
        displayName = parent.name;
      }
    } else if (user.role === "TEACHER" && user.employeeId) {
      const employee = await prisma.employee.findFirst({ where: { id: user.employeeId }, select: { nama: true } });
      if (employee) displayName = employee.nama;
    }

    // Self-heal F-7 (cycle 2026-05-13 staging-sweep-majors-cycle1). See
    // selfHealParentEmail() docstring for behaviour + invariants.
    if (parentId && user.role === "GUARDIAN" && user.email) {
      await selfHealParentEmail(parentId, user.email);
    }

    // Fallback derivation in the rare case the cache entry wasn't populated
    // above (e.g. setCachedEntry skipped due to race). Matches the
    // invariant that SessionUser.permissions is always populated.
    const { permissions, customRoleCode } = cached
      ? { permissions: cached.permissions, customRoleCode: cached.customRoleCode }
      : derivePermissions(user);

    return {
      id: user.id,
      email: user.email,
      role: user.role as SessionUser["role"],
      name: displayName,
      tenantId: user.tenantId,
      employeeId: user.employeeId,
      parentId,
      permissions,
      customRoleCode,
    };
  } catch (err) {
    // In production, don't fall back to demo mode on auth errors.
    // Return null so the middleware redirects to login.
    //
    // Log the actual error — a bare `console.error("...failed")` with no
    // detail hid the teacher auto-provision unique-violation loop for an
    // entire pilot audit (2026-06-02). A swallowed exception here always
    // surfaces to the user as a silent login bounce, so it MUST be
    // diagnosable in the server logs.
    console.error("[AUTH] Session retrieval failed", err);
    return null;
  }
}

/**
 * Demo mode fallback — cookie-based auth for local development.
 */
async function getDemoSession(): Promise<SessionUser | null> {
  // Dynamic import to avoid issues in production
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const userId = cookieStore.get("school-erp-session")?.value;
  if (!userId) return null;

  const legacyRoleFallback: Record<string, "SUPER_ADMIN" | "SCHOOL_ADMIN" | "TEACHER" | "GUARDIAN"> = {
    u_super_admin: "SUPER_ADMIN",
    u_school_admin: "SCHOOL_ADMIN",
    u_teacher: "TEACHER",
    u_parent: "GUARDIAN",
  };

  let user = (await prisma.user.findFirst({
    where: { id: userId, status: "ACTIVE" },
    include: { customRole: true },
  })) as CachedUser | null;

  if (!user && userId === "u_teacher") {
    const homeroomEmployee = await prisma.employee.findFirst({
      where: {
        status: "ACTIVE",
        teachingAssignments: {
          some: {
            role: "HOMEROOM",
            classSection: {
              status: "ACTIVE",
              academicYear: { status: "ACTIVE" },
            },
          },
        },
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        nama: true,
      },
      orderBy: { nama: "asc" },
    });

    if (homeroomEmployee) {
      return {
        id: `demo:${homeroomEmployee.id}`,
        email: homeroomEmployee.email,
        role: "TEACHER",
        name: homeroomEmployee.nama,
        tenantId: homeroomEmployee.tenantId,
        employeeId: homeroomEmployee.id,
        parentId: null,
        permissions: getSystemRolePermissions("TEACHER"),
        customRoleCode: null,
      };
    }
  }

  if (!user && legacyRoleFallback[userId]) {
    user = (await prisma.user.findFirst({
      where: { role: legacyRoleFallback[userId], status: "ACTIVE" },
      include: { customRole: true },
      orderBy: { name: "asc" },
    })) as CachedUser | null;
  }

  if (!user) return null;

  let parentId: string | null = (user as { parentId?: string | null }).parentId ?? null;
  let displayName: string | null = user.name;
  if (user.role === "GUARDIAN") {
    // Email-fallback lookup only runs when email is a non-empty string, and
    // is tenant-scoped — same rationale as the production getSession() path
    // above (Parent.email is unique PER TENANT, not globally).
    const parent = parentId
      ? await prisma.parent.findFirst({ where: { id: parentId }, select: { id: true, name: true } })
      : user.email
        ? await prisma.parent.findFirst({ where: { email: user.email, tenantId: user.tenantId }, select: { id: true, name: true } })
        : null;
    if (parent) {
      parentId = parent.id;
      displayName = parent.name;
    }
  } else if (user.role === "TEACHER" && user.employeeId) {
    const employee = await prisma.employee.findFirst({ where: { id: user.employeeId }, select: { nama: true } });
    if (employee) displayName = employee.nama;
  }

  const { permissions, customRoleCode } = derivePermissions(user);

  return {
    id: user.id,
    email: user.email,
    role: user.role as SessionUser["role"],
    name: displayName,
    tenantId: user.tenantId,
    employeeId: user.employeeId,
    parentId,
    permissions,
    customRoleCode,
  };
}
