import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttendanceCalendar } from "../calendar";
describe("calendar day dialog", () => {
  it("moves focus into details, traps Tab and restores the day after Escape", async () => {
    const user = userEvent.setup();
    render(<AttendanceCalendar records={[{ id: "a1", date: "2026-11-14", status: "PRESENT", checkInTime: null, checkOutTime: null }]} month={11} year={2026} onMonthChange={() => {}} />);
    const day = screen.getAllByRole("button").find(button => button.textContent === "14")!;
    day.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.tab();
    // Focus guards wrap asynchronously after the browser moves through a sentinel.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(day).toHaveFocus());
  });
});
