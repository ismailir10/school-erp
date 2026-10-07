/**
 * RupiahInput — money input with a muted "Rp" adornment, id-ID thousands
 * separators while typing, and an integer (or `null` when empty) emitted to
 * `onChange`. Negative numbers are not supported (unless `allowNegative`).
 * `,` is the decimal separator, `.` the thousands separator (FINX-1).
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RupiahInput, parseRupiahText } from "../rupiah-input";

function Harness({
  onValue,
  initial = null,
  allowNegative,
}: {
  onValue?: (value: number | null) => void;
  initial?: number | null;
  allowNegative?: boolean;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <RupiahInput
      aria-label="Nominal"
      allowNegative={allowNegative}
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
    />
  );
}

describe("parseRupiahText", () => {
  it.each([
    // thousands separators
    ["1.500.000", "1500000"],
    ["1.500", "1500"],
    ["1500000", "1500000"],
    ["Rp 1.500.000", "1500000"],
    ["Rp1.500.000", "1500000"],
    // comma = decimal separator: fraction dropped, never multiplied
    ["1.500.000,50", "1500000"],
    ["1.500.000,5", "1500000"],
    ["1.500.000,", "1500000"],
    ["1500000,50", "1500000"],
    ["Rp 1.500.000,00", "1500000"],
    ["1,5", "1"],
    [",50", ""],
    ["1.500,000", "1500"],
    // dot + 1-2 digits with no comma = en-US decimal point
    ["1500000.5", "1500000"],
    ["1500000.50", "1500000"],
    ["12.5", "12"],
    ["12.50", "12"],
    ["1.500.000.50", "1500000"],
    // dot + 3 digits stays thousands
    ["12.500", "12500"],
    ["1.500.000.500", "1500000500"],
    // a trailing separator with no digits after it adds nothing
    ["1.500.000.", "1500000"],
    // minus sign ignored, magnitude untouched
    ["-5", "5"],
    ["-1.500.000,50", "1500000"],
    // junk
    ["", ""],
    ["   ", ""],
    ["abc", ""],
    [".", ""],
    [",", ""],
    ["Rp", ""],
    [" 1 500 000 ", "1500000"],
    ["Rp 2.000 ", "2000"],
  ])("%j → %j", (raw, digits) => {
    expect(parseRupiahText(raw)).toBe(digits);
  });
});

describe("RupiahInput", () => {
  it("shows id-ID thousands separators while typing and emits the integer", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole("textbox", { name: "Nominal" });

    const user = userEvent.setup();
    await user.type(input, "1500000");

    expect(input).toHaveValue("1.500.000");
    expect(onValue).toHaveBeenLastCalledWith(1500000);
  });

  it("emits null when the field is cleared", async () => {
    const onValue = vi.fn();
    render(<Harness initial={5000} onValue={onValue} />);
    const input = screen.getByRole("textbox", { name: "Nominal" });
    expect(input).toHaveValue("5.000");

    const user = userEvent.setup();
    await user.clear(input);

    expect(input).toHaveValue("");
    expect(onValue).toHaveBeenLastCalledWith(null);
  });

  it("stays empty (no snapped-back 0) when the parent coerces a cleared field to 0", async () => {
    function ZeroCoercing() {
      const [value, setValue] = useState<number>(500000);
      return <RupiahInput aria-label="Tarif" value={value} onChange={(v) => setValue(v ?? 0)} />;
    }
    render(<ZeroCoercing />);
    const input = screen.getByRole("textbox", { name: "Tarif" });

    const user = userEvent.setup();
    await user.clear(input);
    expect(input).toHaveValue("");
    await user.type(input, "750000");
    expect(input).toHaveValue("750.000");
  });

  it("strips a pasted 'Rp 2.000' down to digits and emits 2000", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole("textbox", { name: "Nominal" });

    const user = userEvent.setup();
    await user.click(input);
    await user.paste("Rp 2.000");

    expect(input).toHaveValue("2.000");
    expect(onValue).toHaveBeenLastCalledWith(2000);
  });

  it("never emits a negative number — non-digit characters are stripped", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole("textbox", { name: "Nominal" });

    const user = userEvent.setup();
    await user.type(input, "-500");

    expect(input).toHaveValue("500");
    expect(onValue).toHaveBeenLastCalledWith(500);
  });

  it("renders the muted 'Rp' adornment", () => {
    render(<Harness />);
    expect(screen.getByText("Rp")).toBeInTheDocument();
  });

  it("clamps to Number.MAX_SAFE_INTEGER", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole("textbox", { name: "Nominal" });

    const user = userEvent.setup();
    await user.type(input, "99999999999999999999");

    expect(onValue).toHaveBeenLastCalledWith(Number.MAX_SAFE_INTEGER);
  });

  it("reads a typed id-ID decimal as whole rupiah (1.500.000,50 → 1.500.000)", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole("textbox", { name: "Nominal" });

    const user = userEvent.setup();
    await user.type(input, "1.500.000,50");

    expect(onValue).toHaveBeenLastCalledWith(1500000);
    // Every keystroke along the way stayed at or below the final amount.
    expect(onValue.mock.calls.every(([v]) => v === null || v <= 1500000)).toBe(true);
    await user.tab();
    expect(input).toHaveValue("1.500.000");
  });

  it("does not glue digits typed after a comma onto the amount", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole("textbox", { name: "Nominal" });

    const user = userEvent.setup();
    await user.type(input, "1500000,");
    expect(input).toHaveValue("1.500.000,");
    expect(onValue).toHaveBeenLastCalledWith(1500000);

    await user.type(input, "5");
    expect(input).toHaveValue("1.500.000,5");
    expect(onValue).toHaveBeenLastCalledWith(1500000);

    await user.type(input, "0");
    expect(onValue).toHaveBeenLastCalledWith(1500000);

    await user.tab();
    expect(input).toHaveValue("1.500.000");
  });

  it("reads a typed dot-decimal (1500000.5) as 1.500.000", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole("textbox", { name: "Nominal" });

    const user = userEvent.setup();
    await user.type(input, "1500000.5");

    expect(onValue).toHaveBeenLastCalledWith(1500000);
    await user.tab();
    expect(input).toHaveValue("1.500.000");
  });

  it("still reads thousands separators typed by hand (1.500.000)", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole("textbox", { name: "Nominal" });

    const user = userEvent.setup();
    await user.type(input, "1.500.000");

    expect(input).toHaveValue("1.500.000");
    expect(onValue).toHaveBeenLastCalledWith(1500000);
  });

  it.each([
    ["1.500.000,50", 1500000],
    ["1500000.5", 1500000],
    ["1500000,5", 1500000],
    ["1.500.000", 1500000],
    ["Rp 1.500.000", 1500000],
  ])("paste %j emits %i and settles to 1.500.000 on blur", async (text, expected) => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole("textbox", { name: "Nominal" });

    const user = userEvent.setup();
    await user.click(input);
    await user.paste(text);

    expect(onValue).toHaveBeenLastCalledWith(expected);
    await user.tab();
    expect(input).toHaveValue("1.500.000");
  });

  it("keeps the caret in place when a digit is typed mid-number", async () => {
    const onValue = vi.fn();
    render(<Harness initial={1500000} onValue={onValue} />);
    const input = screen.getByRole("textbox", { name: "Nominal" }) as HTMLInputElement;

    const user = userEvent.setup();
    await user.click(input);
    // Caret after the first "1" of "1.500.000".
    input.setSelectionRange(1, 1);
    await user.keyboard("2");

    expect(input).toHaveValue("12.500.000");
    expect(onValue).toHaveBeenLastCalledWith(12500000);
    await waitFor(() => expect(input.selectionStart).toBe(2));
  });

  it("ignores a typed minus by default and keeps the magnitude", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole("textbox", { name: "Nominal" });

    const user = userEvent.setup();
    await user.type(input, "-5");

    expect(input).toHaveValue("5");
    expect(onValue).toHaveBeenLastCalledWith(5);
  });

  it("keeps 0 as 0", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole("textbox", { name: "Nominal" });

    const user = userEvent.setup();
    await user.type(input, "0");

    expect(input).toHaveValue("0");
    expect(onValue).toHaveBeenLastCalledWith(0);
  });

  describe("allowNegative", () => {
    it("emits a negative number and shows the minus", async () => {
      const onValue = vi.fn();
      render(<Harness allowNegative onValue={onValue} />);
      const input = screen.getByRole("textbox", { name: "Nominal" });

      const user = userEvent.setup();
      await user.type(input, "-1500000,50");

      expect(onValue).toHaveBeenLastCalledWith(-1500000);
      await user.tab();
      expect(input).toHaveValue("-1.500.000");
    });

    it("renders an incoming negative value with its sign", () => {
      render(<Harness allowNegative initial={-250000} />);
      expect(screen.getByRole("textbox", { name: "Nominal" })).toHaveValue("-250.000");
    });

    it("treats a lone minus as no value and clears it on blur", async () => {
      const onValue = vi.fn();
      render(<Harness allowNegative onValue={onValue} />);
      const input = screen.getByRole("textbox", { name: "Nominal" });

      const user = userEvent.setup();
      await user.type(input, "-");
      expect(onValue).toHaveBeenLastCalledWith(null);
      await user.tab();
      expect(input).toHaveValue("");
    });

    it("never emits -0", async () => {
      const onValue = vi.fn();
      render(<Harness allowNegative onValue={onValue} />);
      const input = screen.getByRole("textbox", { name: "Nominal" });

      const user = userEvent.setup();
      await user.type(input, "-0");

      const last = onValue.mock.calls.at(-1)![0];
      expect(Object.is(last, 0)).toBe(true);
    });
  });
});
