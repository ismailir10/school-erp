import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SwapSessionDialog } from "../swap-session-dialog";
it("renders the teacher label when Select items mount inside a closed popup", async () => {
  render(<SwapSessionDialog selectedSession={{ id: "s", classSectionId: "c", semesterId: "sem", date: "2026-11-13", slot: "FULL_DAY", teacherId: "database-cuid", defaultTeacherId: "database-cuid", substituteReason: null, isBackfilled: false, teacher: { id: "database-cuid", nama: "Guru Satu" }, defaultTeacher: { id: "database-cuid", nama: "Guru Satu" } }} writeAllowed employeeOptions={[{ id: "database-cuid", nama: "Guru Satu", formalName: null }]} employeesTruncated={false} employeesStatus="ready" onRetryEmployees={vi.fn()} onClose={vi.fn()} onSaved={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("Guru Satu"));
  expect(screen.getByRole("combobox")).not.toHaveTextContent("database-cuid");
});
