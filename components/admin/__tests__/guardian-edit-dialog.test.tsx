/**
 * T3 (2026-09-27, admin-finish-standard) — `GuardianFormBody` moved off a
 * `form`/`setForm` prop contract onto react-hook-form's `control`. Every
 * assertion here now needs a real RHF form around the component (`Harness`
 * below), since `FormField` (components/ui/form.tsx) reads/writes through
 * `Controller` rather than the prop the pre-T3 version of this file stubbed
 * with a bare `vi.fn()`.
 *
 * The doc comment this file used to carry about `getByLabelText` still
 * applies unchanged: `components/ui/field.tsx`'s `FieldLabel` is a sibling
 * `<Label>`, not a wrapper, so every control needs an explicit `htmlFor`/`id`
 * pair (prefixed `guardian-`) to resolve by accessible name at all.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, type FieldValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import {
  GuardianFormBody,
  EMPTY_GUARDIAN_FORM,
  guardianCreatePayload,
  type GuardianForm,
} from "../guardian-edit-dialog";

/**
 * Only `name` is required — every other `GuardianForm` field is optional or
 * permissive at the wire level (see lib/validations/guardian.ts), so it's
 * the one field this component can reject client-side, and the one T3's
 * spec calls out by name ("inline required error on Nama").
 */
const harnessSchema = z.object({ name: z.string().min(1, "Nama wajib diisi") });

function Harness({
  showRelationship = true,
  defaultValues = EMPTY_GUARDIAN_FORM,
  onValid = vi.fn(),
}: {
  showRelationship?: boolean;
  defaultValues?: GuardianForm;
  onValid?: (values: GuardianForm) => void;
}) {
  const form = useForm<GuardianForm, unknown, GuardianForm>({
    resolver: zodResolver(harnessSchema) as never,
    defaultValues,
  });
  return (
    <form onSubmit={form.handleSubmit(onValid)} noValidate>
      <GuardianFormBody control={form.control} showRelationship={showRelationship} />
      <button type="submit">Simpan</button>
    </form>
  );
}

describe("GuardianFormBody — accessible names (AC1)", () => {
  it("resolves getByLabelText for representative fields when showRelationship is true (student-detail entry point)", () => {
    render(<Harness showRelationship />);

    // Required field. The label's textContent includes a trailing
    // `aria-hidden` asterisk span ("Nama*"), so the query anchors on it
    // rather than requiring an exact string match.
    const nameInput = screen.getByLabelText(/^Nama\*?$/);
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toBeRequired();
    expect(nameInput).toHaveAttribute("aria-required", "true");

    // Plain Input.
    expect(screen.getByLabelText("No. HP")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();

    // shadcn <Select> — id lives on <SelectTrigger>.
    expect(screen.getByLabelText("Hubungan")).toBeInTheDocument();
    expect(screen.getByLabelText("Pendidikan")).toBeInTheDocument();

    // NIK + Jumlah Anak render in the showRelationship=true branch here —
    // both share an id with their showRelationship=false counterpart, but
    // the two branches are mutually exclusive within a single render.
    expect(screen.getByLabelText("NIK")).toBeInTheDocument();
    expect(screen.getByLabelText("Jumlah Anak")).toBeInTheDocument();

    // Junction fields (childOrder / isPrimary) only render in this branch.
    expect(screen.getByLabelText("Anak ke-")).toBeInTheDocument();
    // Query the interactive `role="switch"` directly: its underlying hidden
    // checkbox also answers to the `guardian-primary` label. Base UI < 1.9
    // replaced the switch's own aria-label with the field label ("Wali
    // Utama"); 1.9 keeps the aria-label ("Tandai sebagai wali utama"). Either
    // way the name must contain the visible label (WCAG 2.5.3 Label in Name).
    expect(screen.getByRole("switch", { name: /wali utama/i })).toBeInTheDocument();
  });

  it("resolves getByLabelText for the showRelationship=false branch (guardians list / detail entry points)", () => {
    render(<Harness showRelationship={false} />);

    expect(screen.getByLabelText("NIK")).toBeInTheDocument();
    expect(screen.getByLabelText("Jumlah Anak")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hubungan")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Anak ke-")).not.toBeInTheDocument();
  });

  // CORE-11: the create dialog used to show the edit-only hint too.
  it("shows no 'kosongkan' hint on the Email field in create mode (empty form)", () => {
    render(<Harness showRelationship={false} />);
    expect(screen.getByLabelText("Email")).not.toHaveAccessibleDescription(/kosongkan/i);
    expect(screen.queryByText(/Kosongkan untuk mempertahankan/)).not.toBeInTheDocument();
  });

  it("explains a blank value keeps the existing one in edit mode when an email is already stored (Assumption 1)", () => {
    render(
      <Harness
        showRelationship={false}
        defaultValues={{ ...EMPTY_GUARDIAN_FORM, name: "Siti", email: "siti@example.com" }}
      />,
    );
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(/kosongkan/i);
  });

  it("shows no hint in edit mode when the guardian has no stored email", () => {
    render(
      <Harness showRelationship={false} defaultValues={{ ...EMPTY_GUARDIAN_FORM, name: "Siti", email: "" }} />,
    );
    expect(screen.queryByText(/Kosongkan untuk mempertahankan/)).not.toBeInTheDocument();
  });
});

describe("GuardianFormBody — email hint follows reset() (edit dialogs reset after open)", () => {
  function ResetHarness() {
    const form = useForm<GuardianForm, unknown, GuardianForm>({ defaultValues: EMPTY_GUARDIAN_FORM });
    return (
      <form>
        <GuardianFormBody control={form.control} showRelationship={false} />
        <button type="button" onClick={() => form.reset({ ...EMPTY_GUARDIAN_FORM, email: "siti@example.com" })}>
          Muat wali
        </button>
      </form>
    );
  }

  it("shows the hint once the form is reset with a stored email", async () => {
    const user = userEvent.setup();
    render(<ResetHarness />);
    expect(screen.queryByText(/Kosongkan untuk mempertahankan/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Muat wali" }));

    expect(await screen.findByText(/Kosongkan untuk mempertahankan/)).toBeInTheDocument();
  });
});

describe("GuardianFormBody — RHF validation (T3)", () => {
  it("shows an inline required error on Nama after an invalid submit, and calls no onValid handler", async () => {
    const user = userEvent.setup();
    const onValid = vi.fn();
    render(<Harness defaultValues={{ ...EMPTY_GUARDIAN_FORM, name: "" }} onValid={onValid} />);

    await user.click(screen.getByRole("button", { name: "Simpan" }));

    expect(await screen.findByText("Nama wajib diisi")).toBeInTheDocument();
    expect(onValid).not.toHaveBeenCalled();
  });

  it("submits once Nama is filled in", async () => {
    const user = userEvent.setup();
    const onValid = vi.fn();
    render(<Harness defaultValues={{ ...EMPTY_GUARDIAN_FORM, name: "" }} onValid={onValid} />);

    await user.type(screen.getByLabelText(/^Nama\*?$/), "Siti Aminah");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(onValid).toHaveBeenCalledTimes(1));
    expect((onValid.mock.calls[0][0] as FieldValues).name).toBe("Siti Aminah");
  });
});

describe("guardianCreatePayload (FIND-010)", () => {
  it("omits isPrimary from the CREATE payload when the Switch is off", () => {
    const body = guardianCreatePayload({ ...EMPTY_GUARDIAN_FORM, isPrimary: false });
    expect("isPrimary" in body).toBe(false);
  });

  it("sends isPrimary: true when the admin switched it on", () => {
    const body = guardianCreatePayload({ ...EMPTY_GUARDIAN_FORM, isPrimary: true });
    expect(body).toMatchObject({ isPrimary: true });
  });

  it("passes every other field through unchanged", () => {
    const form = { ...EMPTY_GUARDIAN_FORM, name: "Siti Aminah", relationship: "IBU", isPrimary: false };
    const body = guardianCreatePayload(form);
    expect(body).toMatchObject({ name: "Siti Aminah", relationship: "IBU" });
  });

  it("is generic over any object carrying isPrimary — not just GuardianForm — so an RHF-parsed schema output can reuse it", () => {
    const parsedOutput = { name: "Budi", childrenTotal: 2, childOrder: null, isPrimary: false };
    const body = guardianCreatePayload(parsedOutput);
    expect("isPrimary" in body).toBe(false);
    expect(body).toMatchObject({ name: "Budi", childrenTotal: 2 });
  });
});
