import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClassSessionsCalendar, type SessionRow } from "@/components/admin/class-sessions-calendar";

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));

const session: SessionRow = {
  id: "s1",
  classSectionId: "c1",
  semesterId: "sem1",
  date: "2026-10-05",
  slot: "MORNING",
  teacherId: "t2",
  defaultTeacherId: "t1",
  substituteReason: null,
  isBackfilled: false,
  teacher: { id: "t2", nama: "Guru Dua" },
  defaultTeacher: { id: "t1", nama: "Guru Satu" },
};

function renderCalendar(onOpenSession = vi.fn()) {
  render(
    <ClassSessionsCalendar
      year={2026}
      month={10}
      onPrevMonth={() => {}}
      onNextMonth={() => {}}
      sessions={[session]}
      loading={false}
      error={false}
      onRetry={() => {}}
      onOpenSession={onOpenSession}
    />,
  );
  return onOpenSession;
}

describe("ClassSessionsCalendar", () => {
  beforeEach(() => {
    mobile.value = false;
  });

  it("renders the month grid with weekday headers on desktop", () => {
    renderCalendar();
    expect(screen.getByText("Sen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pagi/ })).toBeInTheDocument();
  });

  it("renders a day-by-day list on a phone, with full-width session buttons", async () => {
    mobile.value = true;
    const user = userEvent.setup();
    const onOpen = renderCalendar();
    expect(screen.queryByText("Sen")).not.toBeInTheDocument();
    expect(screen.getByText(/Senin, 5 Oktober/)).toBeInTheDocument();
    expect(screen.getByText("Pengganti")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Pagi/ }));
    expect(onOpen).toHaveBeenCalledWith(session);
  });
});
