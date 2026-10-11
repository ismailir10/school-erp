/**
 * The form link and the payment page under pay-first, driven by one shared "database":
 * following redirects from either page always ends on a screen. The unpaid state
 * must never bounce between the two (a loop would show the parent a blank page).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

type World = {
  status: string;
  fee: null | { status: "UNPAID" | "PAID" | "WAIVED"; started: boolean };
  lead: "NEW" | "CANCELLED";
  expired: boolean;
  programId: string | null;
};

const { world, clientProps, reconcile, afterResolve } = vi.hoisted(() => ({
  world: { current: null as unknown as World },
  /** Runs right after the token is classified: lets a test settle the fee "in between" two reads. */
  afterResolve: { current: null as null | (() => void) },
  clientProps: { current: null as unknown as Record<string, unknown> },
  reconcile: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/db", () => ({ prisma: { enrollmentFee: { findUnique: async () => ({ id: "fee-1" }) } } }));
vi.mock("@/lib/enrollment/resolve-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/enrollment/resolve-token")>();
  return {
    ...actual,
    resolveEnrollmentToken: async () => {
      const w = world.current;
      const row = {
        id: "app-1",
        status: w.status,
        tokenExpiresAt: new Date(Date.now() + (w.expired ? -1 : 1) * 86_400_000),
        fee: w.fee ? { status: w.fee.status } : null,
      };
      const access = actual.classifyEnrollmentAccess(row, new Date());
      afterResolve.current?.();
      return {
        access,
        tenantId: "t-1",
        application: {
          id: "app-1",
          status: w.status,
          childName: "",
          programId: w.programId,
          dcareAddon: false,
          studentData: {},
          ayahData: {},
          ibuData: {},
          consentData: {},
          documents: {},
          admission: { status: w.lead },
        },
      };
    },
  };
});
vi.mock("@/lib/enrollment/fee-view", () => ({
  getPublicFeeView: async () =>
    world.current.fee && {
      amount: 300_000,
      baseAmount: 300_000,
      discountPercent: 0,
      paidAt: null,
      status: world.current.fee.status,
      started: world.current.fee.started,
    },
}));
vi.mock("@/lib/enrollment/payment-gate", () => ({
  getPaymentGateView: async () => {
    const w = world.current;
    if (!w.fee) return null;
    return {
      programName: "TK A",
      dcareAddon: false,
      fee: { amount: 300_000, baseAmount: 300_000, discountPercent: 0, paidAt: null, status: w.fee.status, started: w.fee.started },
      steps: ["Data Anak", "Data Ayah", "Data Ibu", "Program", "Berkas", "Persetujuan", "Tinjau"],
      requiredDocuments: [],
      closed: w.lead === "CANCELLED",
    };
  },
}));
vi.mock("@/lib/payments/reconcile", () => ({ reconcileEnrollmentFee: reconcile }));
vi.mock("@/lib/enrollment/fee-config", () => ({ getProgramFees: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/enrollment/required-documents", () => ({ getRequiredDocuments: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/contact", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contact")>()),
  schoolContactPhone: () => null,
}));
vi.mock("../client", () => ({
  default: (props: Record<string, unknown>) => {
    clientProps.current = props;
    return <div data-testid="form" />;
  },
}));
vi.mock("@/components/brand/talib-wordmark", () => ({ TalibWordmark: () => null }));
vi.mock("@/components/brand/school-photos", () => ({ SchoolHero: () => null }));

import TokenPage from "../page";
import PembayaranPage from "../pembayaran/page";

const TOKEN = "a".repeat(43);

const state = (over: Partial<World> = {}): World => ({
  status: "INVITED",
  fee: { status: "UNPAID", started: false },
  lead: "NEW",
  expired: false,
  programId: "p-1",
  ...over,
});

type Where = "token" | "pembayaran";

/** What a browser would do: open `start`, follow redirects, stop when a page renders. */
async function browse(start: Where): Promise<{ trail: Where[] }> {
  const trail: Where[] = [];
  let at = start;
  for (let hop = 0; hop < 6; hop++) {
    trail.push(at);
    try {
      const ui =
        at === "token"
          ? await TokenPage({ params: Promise.resolve({ token: TOKEN }) })
          : await PembayaranPage({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve({}) });
      render(ui);
      return { trail };
    } catch (e) {
      const to = /^REDIRECT:(.+)$/.exec(e instanceof Error ? e.message : "")?.[1];
      if (!to) throw e;
      at = to.endsWith("/pembayaran") ? "pembayaran" : "token";
    }
  }
  throw new Error(`redirect loop: ${trail.join(" -> ")}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  afterResolve.current = null;
  reconcile.mockResolvedValue({ code: "NO_CHANGE" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("pay-first: the two pages never redirect to each other in a loop", () => {
  it.each([
    ["not started", { fee: { status: "UNPAID", started: false } } as Partial<World>],
    ["payment started", { fee: { status: "UNPAID", started: true } } as Partial<World>],
  ])("unpaid (%s): the form link lands on the pay screen and stays there", async (_n, over) => {
    world.current = state(over);
    expect((await browse("token")).trail).toEqual(["token", "pembayaran"]);
    expect(screen.getByRole("heading", { level: 1, name: "Bayar biaya formulir untuk mulai mengisi" })).toBeInTheDocument();
    expect(screen.queryByTestId("form")).not.toBeInTheDocument();
  });

  it("unpaid: opening the payment page directly renders it without a hop", async () => {
    world.current = state();
    expect((await browse("pembayaran")).trail).toEqual(["pembayaran"]);
  });

  it.each(["PAID", "WAIVED"] as const)("%s: the payment page hands on to the form, which opens", async (status) => {
    world.current = state({ fee: { status, started: true } });
    expect((await browse("pembayaran")).trail).toEqual(["pembayaran", "token"]);
    expect(screen.getByTestId("form")).toBeInTheDocument();
  });

  it.each(["PAID", "WAIVED"] as const)("%s: the form link opens the form directly", async (status) => {
    world.current = state({ fee: { status, started: true } });
    expect((await browse("token")).trail).toEqual(["token"]);
    expect(clientProps.current.lockedProgram).toEqual({ programName: "TK A", dcareAddon: false, feeStatus: status });
  });

  it("a formulir sent before pay-first (no fee row) opens the form with the program still editable", async () => {
    world.current = state({ fee: null });
    expect((await browse("token")).trail).toEqual(["token"]);
    expect(clientProps.current.lockedProgram).toBeNull();
    expect((await browse("pembayaran")).trail).toEqual(["pembayaran", "token"]);
  });

  it("a cancelled lead's unpaid link is a dead end on both pages", async () => {
    world.current = state({ lead: "CANCELLED" });
    expect((await browse("token")).trail).toEqual(["token", "pembayaran"]);
    expect(screen.getByRole("heading", { name: "Mohon maaf, Bapak/Ibu" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("an expired link is an expired link on both pages", async () => {
    world.current = state({ expired: true });
    expect((await browse("token")).trail).toEqual(["token"]);
    expect((await browse("pembayaran")).trail).toEqual(["pembayaran"]);
  });

  it("a submitted legacy form: the thank-you card and its payment page both render", async () => {
    world.current = state({ status: "SUBMITTED", fee: { status: "UNPAID", started: false } });
    expect((await browse("token")).trail).toEqual(["token"]);
    expect((await browse("pembayaran")).trail).toEqual(["pembayaran"]);
  });

  it("a fee settled between the two reads: the payment page hands on to the form once, no loop", async () => {
    // Access was classified as owed; the webhook lands before the screen reads the fee.
    world.current = state({ fee: { status: "UNPAID", started: true } });
    afterResolve.current = () => {
      world.current.fee = { status: "PAID", started: true };
    };
    expect((await browse("pembayaran")).trail).toEqual(["pembayaran", "token"]);
  });
});
