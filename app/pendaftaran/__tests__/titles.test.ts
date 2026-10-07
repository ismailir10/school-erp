/**
 * The root layout's title template is "%s · Talib". A page title that already
 * ends in "— Talib" renders as "… — Talib · Talib" in the tab.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/enrollment/resolve-token", () => ({ resolveEnrollmentToken: vi.fn() }));
vi.mock("@/lib/enrollment/required-documents", () => ({ getRequiredDocuments: vi.fn() }));
vi.mock("@/app/pendaftaran/[token]/client", () => ({ default: () => null }));
vi.mock("@/app/daftar/client", () => ({ default: () => null }));
vi.mock("@/components/brand/talib-wordmark", () => ({ TalibWordmark: () => null }));

import { metadata as daftar } from "@/app/daftar/page";
import { metadata as pendaftaran } from "@/app/pendaftaran/[token]/page";

describe("public enrollment page titles", () => {
  it("/pendaftaran/[token] leaves the brand suffix to the root template", () => {
    expect(pendaftaran.title).toBe("Formulir Pendaftaran Murid Baru");
  });

  it("/daftar leaves the brand suffix to the root template", () => {
    expect(daftar.title).toBe("Pendaftaran Siswa Baru");
  });
});
