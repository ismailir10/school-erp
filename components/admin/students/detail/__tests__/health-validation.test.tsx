import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KesehatanSection } from "../kesehatan-section";

it("rejects invalid health values and clears their errors when editing is cancelled", async () => {
  const user = userEvent.setup();
  const persistMetadata = vi.fn(async () => true);
  render(<KesehatanSection known={{}} system={{ fromEnrollmentApplication: null, dcareAddon: false, priorFamilyAttendees: [] }} hasAllergy={false} persistMetadata={persistMetadata} getExtraRows={() => []} onSaved={vi.fn()} canEdit />);
  await user.click(screen.getByRole("button", { name: "Ubah" }));
  await user.type(screen.getByLabelText(/^Berat Badan/), "-1");
  await user.click(screen.getByRole("button", { name: "Simpan" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Berat badan harus antara 0 dan 200.");
  expect(persistMetadata).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Batal" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Ubah" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText(/^Berat Badan/)).toHaveValue(null);
});
