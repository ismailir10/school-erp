import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PeriodStepper } from "@/components/ui/period-stepper";

describe("PeriodStepper", () => {
  it("shows the label and steps both ways", async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <PeriodStepper label="Oktober 2026" onPrev={onPrev} onNext={onNext} prevLabel="Bulan sebelumnya" nextLabel="Bulan berikutnya" />,
    );
    expect(screen.getByText("Oktober 2026")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bulan sebelumnya" }));
    await user.click(screen.getByRole("button", { name: "Bulan berikutnya" }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
