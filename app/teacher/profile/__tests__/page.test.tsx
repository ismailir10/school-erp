import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const employeeFindUnique = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { employee: { findUnique: employeeFindUnique } } }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { getSession } from "@/lib/auth";
import TeacherProfilePage from "../page";

describe("TeacherProfilePage", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockResolvedValue({ employeeId: "employee-1" } as never);
    employeeFindUnique.mockResolvedValue({
      nama: "Bu Sari",
      formalName: null,
      jabatan: "Guru",
      campus: { name: "Pusat" },
      email: "sari@example.test",
      noHp: null,
      bankAccountNo: null,
      bankName: null,
      kode: "G-01",
    });
  });

  it("gives the salary quick link a visible 44px focus target", async () => {
    render(await TeacherProfilePage());
    const slips = screen.getByRole("link", { name: /Slip gaji/ });
    expect(slips).toHaveAttribute("href", "/teacher/slips");
    expect(slips).toHaveClass("min-h-11");
    expect(slips).toHaveClass("focus-visible:focus-outline");
  });
});
