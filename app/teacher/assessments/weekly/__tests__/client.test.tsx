import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WeeklyClient } from "../client";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const week = {
  id: "week-1",
  number: 3,
  startDate: "2026-05-11",
  endDate: "2026-05-15",
  subTheme: { id: "sub-1", name: "Diriku" },
  theme: { id: "theme-1", name: "Aku" },
};

function renderWeeklyClient() {
  return render(
    <WeeklyClient
      initialDate="2026-05-11"
      week={week}
      classSection={{ id: "class-1", name: "TK-B Anggur", ageGroup: "B" }}
      students={[{ id: "student-1", name: "Aisyah", nickname: null, status: "ACTIVE" }]}
      indicators={[
        {
          id: "indicator-1",
          content: "Mengikuti kegiatan",
          order: 1,
          objective: { id: "objective-1", ageGroup: "B", element: "Karakter" },
        },
      ]}
      initialEntries={[]}
    />,
  );
}

describe("WeeklyClient radio groups", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  async function expectLevelSelected(radio: HTMLElement) {
    await waitFor(() => {
      expect(radio).toBeChecked();
      expect(radio).not.toBeDisabled();
    });
  }

  it("gives each native radio group one tab stop", async () => {
    const user = userEvent.setup();
    renderWeeklyClient();

    await user.tab();
    expect(screen.getByRole("link", { name: "Kembali" })).toHaveFocus();

    // WeekNavigator sits between the back link and the day strip.
    await user.tab();
    expect(screen.getByRole("link", { name: "Pekan sebelumnya" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Pekan berikutnya" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("radio", { name: "Sen 11" })).toHaveFocus();

    await user.tab();
    // Native radios form one tab stop: the next Tab leaves the day group
    // instead of visiting each weekday option.
    expect(screen.getAllByRole("radio", { name: /^(Sen|Sel|Rab|Kam|Jum) / }))
      .not.toContain(document.activeElement);
  });

  it("moves the day selection with arrows, Home, End, Enter, and Space", async () => {
    const user = userEvent.setup();
    renderWeeklyClient();
    const days = within(screen.getByRole("radiogroup", { name: "Hari dalam pekan" }));
    const monday = days.getByRole("radio", { name: "Sen 11" });
    expect(monday.closest("label")).toHaveClass("min-h-11");
    expect(monday.closest("label")).toHaveClass("has-[input:focus-visible]:ring-2");
    const tuesday = days.getByRole("radio", { name: "Sel 12" });
    const wednesday = days.getByRole("radio", { name: "Rab 13" });
    const friday = days.getByRole("radio", { name: "Jum 15" });

    expect(monday).toBeChecked();
    monday.focus();
    await user.keyboard("{ArrowRight}");
    expect(tuesday).toBeChecked();
    expect(tuesday).toHaveFocus();

    await user.keyboard("{End}");
    expect(friday).toBeChecked();
    expect(friday).toHaveFocus();

    await user.keyboard("{Home}");
    expect(monday).toBeChecked();
    expect(monday).toHaveFocus();

    wednesday.focus();
    await user.keyboard("{Enter}");
    expect(wednesday).toBeChecked();

    tuesday.focus();
    await user.keyboard(" ");
    expect(tuesday).toBeChecked();
  });

  it("keeps assessment level radios checked, focused, and keyboard-selectable", async () => {
    const user = userEvent.setup();
    renderWeeklyClient();
    const levels = within(
      screen.getByRole("radiogroup", { name: "Pilih tingkat untuk Aisyah" }),
    );
    const mampu = levels.getByRole("radio", { name: "Mampu untuk Aisyah" });
    const belum = levels.getByRole("radio", { name: "Belum untuk Aisyah" });
    const perlu = levels.getByRole("radio", { name: "Perlu untuk Aisyah" });

    expect(mampu.closest("label")).toHaveClass("has-[input:focus-visible]:ring-2");
    mampu.focus();
    await user.keyboard(" ");
    await expectLevelSelected(mampu);

    await user.keyboard("{ArrowRight}");
    await expectLevelSelected(belum);
    expect(belum).toHaveFocus();

    await user.keyboard("{End}");
    await expectLevelSelected(perlu);
    expect(perlu).toHaveFocus();

    await user.keyboard("{Home}");
    await expectLevelSelected(mampu);

    belum.focus();
    await user.keyboard("{Enter}");
    await expectLevelSelected(belum);
  });

  describe("save status (DOC-4)", () => {
    it("says nothing before the first tap, then saving, then saved", async () => {
      const user = userEvent.setup();
      const save = deferred<{ ok: boolean }>();
      vi.stubGlobal("fetch", vi.fn().mockReturnValue(save.promise));
      renderWeeklyClient();
      expect(within(screen.getByTestId("weekly-save-state")).queryByRole("status")).toBeNull();

      await user.click(screen.getByRole("radio", { name: "Mampu untuk Aisyah" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Menyimpan penilaian");

      save.resolve({ ok: true });
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Penilaian tersimpan"));
    });

    it("says the tap did not save when the request fails, and recovers on the next tap", async () => {
      const user = userEvent.setup();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "x" }) })
        .mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      renderWeeklyClient();

      await user.click(screen.getByRole("radio", { name: "Belum untuk Aisyah" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Penilaian belum tersimpan");
      // R2-T-8: never "belum tersimpan" and "tersimpan otomatis" together.
      expect(screen.queryByText(/Penilaian tersimpan otomatis/)).toBeNull();
      expect(screen.getByText(/Ketuk tingkat untuk menyimpan\./)).toBeInTheDocument();

      await user.click(screen.getByRole("radio", { name: "Mampu untuk Aisyah" }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Penilaian tersimpan"));
      expect(screen.getByText(/Penilaian tersimpan otomatis/)).toBeInTheDocument();
    });

    it("hides the auto-save line while a save is pending, shows it when idle", async () => {
      const user = userEvent.setup();
      const save = deferred<{ ok: boolean }>();
      vi.stubGlobal("fetch", vi.fn().mockReturnValue(save.promise));
      renderWeeklyClient();
      expect(screen.getByText(/Penilaian tersimpan otomatis/)).toBeInTheDocument();
      await user.click(screen.getByRole("radio", { name: "Mampu untuk Aisyah" }));
      await screen.findByText("Menyimpan penilaian…");
      expect(screen.queryByText(/Penilaian tersimpan otomatis/)).toBeNull();
      save.resolve({ ok: true });
      await waitFor(() => expect(screen.getByText(/Penilaian tersimpan otomatis/)).toBeInTheDocument());
    });
  });
});

describe("WeeklyClient with no IKTP for the week (TCH-5)", () => {
  it("shows the empty state only: no level chips and no save hint", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(
      <WeeklyClient
        initialDate="2026-05-11"
        week={week}
        classSection={{ id: "class-1", name: "TK-B Anggur", ageGroup: "B" }}
        students={[{ id: "student-1", name: "Aisyah", nickname: null, status: "ACTIVE" }]}
        indicators={[]}
        initialEntries={[]}
      />,
    );

    expect(screen.getByText(/Belum ada IKTP untuk tema pekan ini/)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /untuk Aisyah/ })).toBeNull();
    expect(screen.queryByTestId("weekly-roster")).toBeNull();
    expect(screen.queryByText(/Ketuk tingkat untuk menyimpan/)).toBeNull();
  });
});

