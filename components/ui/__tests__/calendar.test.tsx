/**
 * ADM-8 — the shared Calendar shipped half in English ("Choose the Month",
 * "Go to the Next Month", "Today, …") and a 111-year dropdown. Labels are
 * Indonesian by default and the year list is today − 20 … + 5 unless the
 * caller sets bounds.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Calendar } from "../calendar";

const thisYear = new Date().getFullYear();

describe("Calendar", () => {
  it("labels the month/year dropdowns and navigation in Indonesian", () => {
    render(<Calendar mode="single" captionLayout="dropdown" />);

    expect(screen.getByRole("combobox", { name: "Pilih bulan" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Pilih tahun" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bulan sebelumnya" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bulan berikutnya" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Choose the|Go to the/)).not.toBeInTheDocument();
  });

  it("describes today in Indonesian and marks the selected day", () => {
    const today = new Date();
    render(<Calendar mode="single" selected={today} defaultMonth={today} />);

    const todayButton = screen.getByRole("button", { name: /^Hari ini, .*, dipilih$/ });
    expect(todayButton).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Today,/)).not.toBeInTheDocument();
  });

  it("offers years from today − 20 to today + 5 by default", () => {
    render(<Calendar mode="single" captionLayout="dropdown" />);

    const years = Array.from(
      (screen.getByRole("combobox", { name: "Pilih tahun" }) as HTMLSelectElement).options,
    ).map((o) => Number(o.value));
    expect(years[0]).toBe(thisYear - 20);
    expect(years[years.length - 1]).toBe(thisYear + 5);
    expect(years).toHaveLength(26);
  });

  it("honours caller-provided bounds instead of the default window", () => {
    render(
      <Calendar
        mode="single"
        captionLayout="dropdown"
        startMonth={new Date(1990, 0, 1)}
        endMonth={new Date(2030, 11, 31)}
        defaultMonth={new Date(2000, 5, 1)}
      />,
    );

    const years = Array.from(
      (screen.getByRole("combobox", { name: "Pilih tahun" }) as HTMLSelectElement).options,
    ).map((o) => Number(o.value));
    expect(years[0]).toBe(1990);
    expect(years[years.length - 1]).toBe(2030);
  });
});
