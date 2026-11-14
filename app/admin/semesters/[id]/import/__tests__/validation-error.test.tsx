import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { ImportPromesClient } from "../client";
it("shows the failing objective, field and repair reason from row validation", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Validasi baris PROMES gagal", errors: [{ field: "ART · TP 1000 · number", message: "Nomor tujuan pembelajaran tidak realistis" }] }) });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(<ImportPromesClient semester={{ id: "s1", number: 1, academicYearName: "2026/2027", status: "ACTIVE" }} />);
  await user.upload(screen.getByLabelText("Berkas xlsx"), new File(["xlsx"], "PROMES TK A.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  fireEvent.submit(screen.getByRole("button", { name: "Pratinjau PROMES" }).closest("form")!);
  const alert = (await screen.findByText(/Validasi baris PROMES gagal/)).parentElement!;
  expect(alert).toHaveTextContent("ART · TP 1000 · number");
  expect(alert).toHaveTextContent("Nomor tujuan pembelajaran tidak realistis");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
