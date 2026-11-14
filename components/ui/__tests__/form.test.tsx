/**
 * Admin form foundation — `FormField` (Controller + shadcn `Field`,
 * generated id, label association, aria-invalid/aria-describedby wiring,
 * focus-on-error proxy), `FormRootError` and `FormDialogFooter`.
 *
 * The harness below exercises every widget the pattern is meant to support
 * behind `FormField`: a native `Input` (required, and optional-with-
 * description), a base-ui `Select`, a base-ui `Checkbox` (horizontal), a
 * `DatePicker` and a `RupiahInput` — mirroring the real worked example at
 * `app/admin/settings/holidays/page.tsx`.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod";

import { FormDialogFooter, FormField, FormRootError } from "../form";
import { Input } from "../input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select";
import { Checkbox } from "../checkbox";
import { DatePicker } from "../date-picker";
import { RupiahInput } from "../rupiah-input";
import { useZodForm } from "@/lib/forms/use-zod-form";

const ymdRegex = /^\d{4}-\d{2}-\d{2}$/;

const testSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi"),
  notes: z.string().trim().optional(),
  type: z.string().trim().min(1, "Jenis wajib diisi"),
  agree: z.boolean().optional(),
  date: z
    .string()
    .min(1, "Tanggal wajib diisi")
    .regex(ymdRegex, "Format tanggal harus YYYY-MM-DD"),
  amount: z.number().nullable().optional(),
});

type TestValues = z.infer<typeof testSchema>;

const DEFAULTS: TestValues = {
  name: "",
  notes: "",
  type: "",
  agree: false,
  date: "",
  amount: null,
};

function Harness({ onSubmit }: { onSubmit: (values: TestValues) => void }) {
  const form = useZodForm(testSchema, { defaultValues: DEFAULTS });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FormRootError formState={form.formState} />
      <FormField
        control={form.control}
        name="name"
        label="Nama"
        required
        render={({ field, controlProps }) => <Input {...field} {...controlProps} />}
      />
      <FormField
        control={form.control}
        name="notes"
        label="Catatan"
        description="Opsional, tampil di riwayat"
        render={({ field, controlProps }) => <Input {...field} {...controlProps} />}
      />
      <FormField
        control={form.control}
        name="type"
        label="Jenis"
        required
        render={({ field, controlProps }) => (
          <Select value={field.value} onValueChange={(v) => v && field.onChange(v)}>
            <SelectTrigger {...controlProps} onBlur={field.onBlur}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="A">Jenis A</SelectItem>
              <SelectItem value="B">Jenis B</SelectItem>
            </SelectContent>
          </Select>
        )}
      />
      <FormField
        control={form.control}
        name="agree"
        label="Setuju"
        orientation="horizontal"
        render={({ field, controlProps }) => (
          <Checkbox
            {...controlProps}
            checked={!!field.value}
            onCheckedChange={(c) => field.onChange(!!c)}
            onBlur={field.onBlur}
          />
        )}
      />
      <FormField
        control={form.control}
        name="date"
        label="Tanggal"
        required
        render={({ field, controlProps }) => (
          <DatePicker {...controlProps} value={field.value} onChange={field.onChange} />
        )}
      />
      <FormField
        control={form.control}
        name="amount"
        label="Jumlah"
        render={({ field, controlProps }) => (
          <RupiahInput {...controlProps} value={field.value ?? null} onChange={field.onChange} />
        )}
      />
      <button type="submit">Kirim</button>
    </form>
  );
}

function mockCoarsePointer() {
  return vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("coarse"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FormField", () => {
  it("associates every widget's label with its control", () => {
    mockCoarsePointer();
    render(<Harness onSubmit={vi.fn()} />);

    expect(screen.getByLabelText("Nama", { exact: false })).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText("Catatan", { exact: false })).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText("Jenis", { exact: false })).toHaveAttribute("role", "combobox");
    // Not getByLabelText: base-ui's Checkbox puts the `id` we pass on a
    // hidden, aria-hidden shadow input (for native form participation), so a
    // `label[for]` lookup resolves to that hidden node instead of the
    // visible `role=checkbox` — getByRole's accessible-name computation is
    // what a screen reader user actually goes by, and correctly skips it.
    expect(screen.getByRole("checkbox", { name: /Setuju/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Tanggal", { exact: false })).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Jumlah", { exact: false })).toBeInstanceOf(HTMLInputElement);
  });

  it("puts the description id in aria-describedby even before any error", () => {
    mockCoarsePointer();
    render(<Harness onSubmit={vi.fn()} />);

    const notes = screen.getByLabelText("Catatan", { exact: false });
    const describedBy = notes.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const descriptionEl = document.getElementById(describedBy!.split(" ")[0]!);
    expect(descriptionEl).toHaveTextContent("Opsional, tampil di riwayat");
  });

  it("submitting empty shows the schema message inline, wires aria-invalid/aria-describedby, and focuses the first invalid control", async () => {
    mockCoarsePointer();
    const user = userEvent.setup();
    render(<Harness onSubmit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Kirim" }));

    const errorText = await screen.findByText("Nama wajib diisi");
    expect(errorText).toHaveAttribute("role", "alert");

    const nameInput = screen.getByLabelText("Nama", { exact: false });
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    const describedBy = nameInput.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toBe(errorText);

    // `name` is the first field registered, so it — not `type` or `date`,
    // both also empty and invalid — gets focus from shouldFocusError.
    await waitFor(() => expect(document.activeElement).toBe(nameInput));
  });

  it("clears the inline error once a valid value is typed", async () => {
    mockCoarsePointer();
    const user = userEvent.setup();
    render(<Harness onSubmit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Kirim" }));
    await screen.findByText("Nama wajib diisi");

    await user.type(screen.getByLabelText("Nama", { exact: false }), "Kegiatan A");

    await waitFor(() => expect(screen.queryByText("Nama wajib diisi")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("Nama", { exact: false })).not.toHaveAttribute("aria-invalid"));
  });

  it("submits a Checkbox as a boolean and a RupiahInput as a number", async () => {
    mockCoarsePointer();
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Nama", { exact: false }), "Kegiatan A");

    await user.click(screen.getByLabelText("Jenis", { exact: false }));
    await user.click(await screen.findByRole("option", { name: "Jenis A" }));

    await user.click(screen.getByRole("checkbox", { name: /Setuju/ }));

    fireEvent.change(screen.getByLabelText("Tanggal", { exact: false }), { target: { value: "2026-03-01" } });

    await user.type(screen.getByLabelText("Jumlah", { exact: false }), "150000");

    await user.click(screen.getByRole("button", { name: "Kirim" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [values] = onSubmit.mock.calls[0]!;
    expect(values).toEqual({
      name: "Kegiatan A",
      notes: "",
      type: "A",
      agree: true,
      date: "2026-03-01",
      amount: 150000,
    });
    expect(typeof values.agree).toBe("boolean");
    expect(typeof values.amount).toBe("number");
  });
});

const requiredCheckboxSchema = z.object({
  agree: z.boolean().refine((v) => v === true, { message: "Anda harus menyetujui" }),
});

function RequiredCheckboxHarness({ onSubmit }: { onSubmit: (values: { agree: boolean }) => void }) {
  const form = useZodForm(requiredCheckboxSchema, { defaultValues: { agree: false } });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FormField
        control={form.control}
        name="agree"
        label="Setuju"
        orientation="horizontal"
        required
        render={({ field, controlProps }) => (
          <Checkbox
            {...controlProps}
            checked={!!field.value}
            onCheckedChange={(c) => field.onChange(!!c)}
            onBlur={field.onBlur}
          />
        )}
      />
      <button type="submit">Kirim</button>
    </form>
  );
}

describe("FormField focus-on-error fallback (base-ui Checkbox)", () => {
  it("moves focus to the visible role=checkbox element, not the hidden shadow input, when a required checkbox fails validation", async () => {
    const user = userEvent.setup();
    render(<RequiredCheckboxHarness onSubmit={vi.fn()} />);

    const checkbox = screen.getByRole("checkbox", { name: /Setuju/ });
    // The hidden shadow input base-ui mounts for native form participation
    // carries the `id` FormField generated — the thing shouldFocusError
    // must NOT land on, since it's `aria-hidden` and `tabindex="-1"`.
    const hiddenInput = document.querySelector('input[type="checkbox"][aria-hidden="true"]');
    expect(hiddenInput).not.toBeNull();
    expect(hiddenInput).toHaveAttribute("tabindex", "-1");

    await user.click(screen.getByRole("button", { name: "Kirim" }));

    expect(await screen.findByText("Anda harus menyetujui")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(checkbox));
    expect(document.activeElement).not.toBe(hiddenInput);
  });
});

describe("FormRootError", () => {
  it("renders errors.root.server.message in an alert", () => {
    render(
      <FormRootError
        formState={{ errors: { root: { server: { type: "server", message: "Server sedang sibuk" } } } }}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Server sedang sibuk");
  });

  it("renders nothing when there is no root.server error", () => {
    const { container } = render(<FormRootError formState={{ errors: {} }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FormDialogFooter", () => {
  it("shows the pending label, disables submit, and keeps the form attribute wired while pending", () => {
    render(
      <FormDialogFooter
        formId="my-form"
        submitLabel="Simpan"
        pending
        onCancel={vi.fn()}
      />,
    );

    const submit = screen.getByRole("button", { name: "Menyimpan..." });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("form", "my-form");
    expect(submit).toHaveAttribute("type", "submit");
    // Cancelling mid-request would let the first save close a reopened dialog.
    expect(screen.getByRole("button", { name: "Batal" })).toBeDisabled();
  });

  it("shows the submit label and stays enabled when not pending", () => {
    render(
      <FormDialogFooter
        formId="my-form"
        submitLabel="Simpan"
        pending={false}
        onCancel={vi.fn()}
      />,
    );

    const submit = screen.getByRole("button", { name: "Simpan" });
    expect(submit).toBeEnabled();
    expect(screen.getByRole("button", { name: "Batal" })).toBeEnabled();
    expect(submit).toHaveAttribute("form", "my-form");
  });
});

it("reveals the full focused invalid field including its error explanation", async () => {
 const scroll = vi.fn();
 const original = HTMLElement.prototype.scrollIntoView;
 HTMLElement.prototype.scrollIntoView = scroll;
 try {
  render(<Harness onSubmit={vi.fn()} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Kirim" }));
  const input = screen.getByRole("textbox", { name: /Nama/ });
  await waitFor(() => expect(input).toHaveFocus());
  await waitFor(() => expect(scroll).toHaveBeenCalled());
  const field = scroll.mock.instances.find((element) => element instanceof HTMLElement && element.contains(input));
  expect(field).toHaveTextContent("Nama wajib diisi");
  expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
 } finally { HTMLElement.prototype.scrollIntoView = original; }
});
