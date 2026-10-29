import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation, useSearchParams: () => navigation.params }));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children, ...props }: React.HTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  SelectValue: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: { error: toastError } }));

import ClassAttendancePage from "../page";
import { within } from "@testing-library/react";

const pick = async (child: string, status: string) =>
  within(await screen.findByRole("radiogroup", { name: `Status ${child}` })).getByRole("radio", { name: status });
const markRequests = () =>
  (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url).includes("/mark")).map(([, init]) => JSON.parse(init.body));

const ok = (data: unknown) => ({ ok: true, json: async () => data });
const assignment = [{ id: "a", classSection: { id: "c1", name: "TK A", program: { name: "TK" }, campus: { name: "A" }, _count: { enrollments: 1 } } }];
const roster = [{ student: { id: "s1", name: "Aisyah", nickname: null, gender: null }, attendance: null }];
const classOfThree = [
  ...roster,
  { student: { id: "s2", name: "Bilal", nickname: null, gender: null }, attendance: { status: "SICK", notes: null } },
  { student: { id: "s3", name: "Citra", nickname: null, gender: null }, attendance: null },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ClassAttendancePage recovery", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    toastError.mockClear();
    navigation.params = new URLSearchParams(); navigation.replace.mockClear();
  });

  it("retries assignment loading after failure", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("teaching-assignments") && ++calls === 1 ? Promise.reject(new Error()) : Promise.resolve(ok(url.includes("teaching-assignments") ? assignment : roster))));
    render(<ClassAttendancePage />);
    await screen.findByText("Daftar kelas tidak bisa dimuat");
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Absensi kelas" })).toBeInTheDocument());
  });

  it("retries roster loading after failure", async () => {
    let rosterCalls = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("teaching-assignments")) return Promise.resolve(ok(assignment));
      if (url.includes("student-attendance?")) return ++rosterCalls === 1 ? Promise.reject(new Error()) : Promise.resolve(ok(roster));
      return Promise.resolve(ok({ saved: 1 }));
    }));
    render(<ClassAttendancePage />);
    await screen.findByText("Data siswa tidak bisa dimuat");
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await pick("Aisyah", "Hadir")).toHaveAttribute("aria-checked", "false");
  });

  it("saves the tapped status, exposes failure on the row, and retries the same choice", async () => {
    const pending = deferred<ReturnType<typeof ok>>(); let saves = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("teaching-assignments")) return Promise.resolve(ok(assignment));
      if (url.includes("student-attendance?")) return Promise.resolve(ok(roster));
      return ++saves === 1 ? pending.promise : Promise.resolve(ok({saved:1}));
    }));
    render(<ClassAttendancePage />);
    fireEvent.click(await pick("Aisyah", "Izin"));
    expect(screen.getByRole("status")).toHaveTextContent("Menyimpan absensi");
    expect(screen.getByText("Izin 0")).toBeInTheDocument();
    await act(async () => { pending.reject(new TypeError("Failed to fetch")); });
    expect(screen.getByRole("alert")).toHaveTextContent("Absensi belum tersimpan. Koneksi terputus. Periksa internet, lalu coba lagi.");
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
    // A failed save of the teacher's record stays until dismissed and offers "Coba lagi".
    expect(toastError).toHaveBeenCalledWith(
      "Koneksi terputus. Periksa internet, lalu coba lagi.",
      expect.objectContaining({ duration: Infinity, action: expect.objectContaining({ label: "Coba lagi" }) }),
    );
    expect(await pick("Aisyah", "Izin")).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", {name:"Coba lagi"}));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Absensi tersimpan"));
    expect(markRequests().map((b) => b.records[0].status)).toEqual(["PERMISSION","PERMISSION"]);
    expect(screen.getByText("Izin 1")).toBeInTheDocument();
    expect(await pick("Aisyah", "Izin")).toHaveAttribute("aria-checked", "true");
  });

  it("marks only the children without a status Hadir, in one request", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("teaching-assignments")) return Promise.resolve(ok(assignment));
      if (url.includes("student-attendance?")) return Promise.resolve(ok(classOfThree));
      return Promise.resolve(ok({ saved: JSON.parse(String(init?.body)).records.length }));
    }));
    render(<ClassAttendancePage />);
    const list = await screen.findByRole("list");
    const slot = list.previousElementSibling?.lastElementChild;
    expect(slot).toBeEmptyDOMElement(); // reserved before any save, so rows never jump
    fireEvent.click(await screen.findByRole("button", { name: "Tandai 2 siswa lainnya Hadir" }));
    await screen.findByText("Semua siswa sudah dicatat");
    expect(list.previousElementSibling?.lastElementChild).toBe(slot);
    expect(markRequests()).toHaveLength(1);
    expect(markRequests()[0].records).toEqual([
      { studentId: "s1", status: "PRESENT" },
      { studentId: "s3", status: "PRESENT" },
    ]);
    expect(await pick("Bilal", "Sakit")).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(screen.getByText("Hadir 2")).toBeInTheDocument());
    expect(screen.getByText("Sakit 1")).toBeInTheDocument();
  });

  it("puts the rows back to belum when the bulk save fails, and the button retries", async () => {
    let saves = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("teaching-assignments")) return Promise.resolve(ok(assignment));
      if (url.includes("student-attendance?")) return Promise.resolve(ok(classOfThree));
      return ++saves === 1
        ? Promise.resolve({ ok: false, status: 429, json: async () => ({ error: "Terlalu banyak permintaan" }) })
        : Promise.resolve(ok({ saved: 2 }));
    }));
    render(<ClassAttendancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Tandai 2 siswa lainnya Hadir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Absensi belum tersimpan. Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.");
    expect(await pick("Aisyah", "Hadir")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Hadir 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tandai 2 siswa lainnya Hadir" }));
    await screen.findByText("Semua siswa sudah dicatat");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(markRequests()).toHaveLength(2);
  });

  it("keeps the newest class/date roster when an earlier request resolves late", async () => {
    const firstRoster = deferred<ReturnType<typeof ok>>();
    const secondRoster = deferred<ReturnType<typeof ok>>();
    let rosterCalls = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("teaching-assignments")) return Promise.resolve(ok(assignment));
      if (url.includes("student-attendance?")) {
        return ++rosterCalls === 1 ? firstRoster.promise : secondRoster.promise;
      }
      return Promise.resolve(ok({ saved: 1 }));
    }));

    render(<ClassAttendancePage />);
    await waitFor(() => expect(rosterCalls).toBe(1));

    // Derive the "other" date from whatever the picker currently holds. A
    // hardcoded literal here silently stops testing anything the day the clock
    // reaches it: the input defaults to today, so `change` to the same value is
    // a no-op, no refetch fires, and this assertion fails. That is exactly what
    // happened on 2026-08-04 with the previous literal "2026-08-04".
    const dateInput = screen.getByLabelText(
      "Tanggal kehadiran",
    ) as HTMLInputElement;
    const otherDay = new Date(`${dateInput.value}T00:00:00Z`);
    otherDay.setUTCDate(otherDay.getUTCDate() - 1);
    fireEvent.change(dateInput, {
      target: { value: otherDay.toISOString().slice(0, 10) },
    });
    await waitFor(() => expect(rosterCalls).toBe(2));

    secondRoster.resolve(ok([
      { student: { id: "s2", name: "Bilal", nickname: null, gender: null }, attendance: null },
    ]));
    expect(await screen.findByRole("radiogroup", { name: "Status Bilal" })).toBeInTheDocument();

    // The stale response must be *handled* before we can claim it was
    // ignored. The `waitFor` this replaces was not a barrier — Bilal is
    // already on screen, so it passed on its first poll — which left the
    // assertions below racing the stale response's flush. `await act`
    // makes that flush deterministic.
    await act(async () => {
      firstRoster.resolve(ok(roster));
    });
    expect(screen.getByRole("radiogroup", { name: "Status Bilal" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Status Aisyah" })).toBeNull();
  });

  it("ignores an older failed save after a newer save succeeds for the same student", async () => {
    const olderSave = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const newerSave = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    let saveCalls = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("teaching-assignments")) return Promise.resolve(ok(assignment));
      if (url.includes("student-attendance?")) return Promise.resolve(ok(roster.map(r => ({...r, attendance:{status:"PRESENT",notes:null}}))));
      if (url.includes("student-attendance/mark")) {
        return ++saveCalls === 1 ? olderSave.promise : newerSave.promise;
      }
      return Promise.resolve(ok({}));
    }));

    render(<ClassAttendancePage />);
    fireEvent.click(await pick("Aisyah", "Alpa"));
    fireEvent.click(await pick("Aisyah", "Sakit"));
    await waitFor(() => expect(saveCalls).toBe(1));

    olderSave.resolve({ ok: false, json: async () => ({ error: "stale failure" }) });
    await waitFor(() => expect(saveCalls).toBe(2));
    const requests = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url).includes("student-attendance/mark"));
    expect(JSON.parse(requests[1]![1]!.body).records[0].status).toBe("SICK");
    expect(toastError).not.toHaveBeenCalled();

    newerSave.resolve(ok({ saved: 1 }));
    // Sakit is already checked from the optimistic update, so
    // this find resolves on the first poll and is not a barrier for anything.
    // The live region only flips to "Absensi tersimpan" once the save
    // promise chain settles, so that assertion needs its own wait — asserting
    // it synchronously here read "Menyimpan absensi" on a loaded CI runner.
    expect(await pick("Aisyah", "Sakit")).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Absensi tersimpan"),
    );
    expect(toastError).not.toHaveBeenCalled();
  });
});

it("does not apply an earlier date's failed save to the newly loaded date",async()=>{
 const save=deferred<ReturnType<typeof ok>>();
 vi.stubGlobal("fetch",vi.fn((url:string)=>url.includes("teaching-assignments")?Promise.resolve(ok(assignment)):url.includes("student-attendance?")?Promise.resolve(ok(roster)):save.promise));
 render(<ClassAttendancePage/>);fireEvent.click(await pick("Aisyah","Hadir"));
 await waitFor(()=>expect((fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url])=>String(url).includes("/mark"))).toBe(true));
 const input=screen.getByLabelText("Tanggal kehadiran") as HTMLInputElement;
 const past=new Date(`${input.value}T12:00:00Z`);past.setUTCDate(past.getUTCDate()-1);
 fireEvent.change(input,{target:{value:past.toISOString().slice(0,10)}});
 await waitFor(async()=>expect(await pick("Aisyah","Hadir")).toHaveAttribute("aria-checked","false"));
 await act(async()=>{save.reject(Error("late failure"));});
 expect(screen.queryByRole("alert")).toBeNull();expect(screen.queryByRole("button",{name:"Coba lagi"})).toBeNull();
});

describe("class attendance never offers a future day (TCH-9)", () => {
  const stubFetch = () =>
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(ok(url.includes("teaching-assignments") ? assignment : roster))));

  it("caps the date input at today and ignores a typed future date", async () => {
    vi.unstubAllGlobals(); navigation.params = new URLSearchParams(); navigation.replace.mockClear();
    stubFetch();
    render(<ClassAttendancePage />);
    await pick("Aisyah", "Hadir");
    const input = screen.getByLabelText("Tanggal kehadiran") as HTMLInputElement;
    const today = input.value;
    expect(input.max).toBe(today);
    const future = new Date(`${today}T12:00:00Z`); future.setUTCDate(future.getUTCDate() + 3);
    navigation.replace.mockClear();
    fireEvent.change(input, { target: { value: future.toISOString().slice(0, 10) } });
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(input.value).toBe(today);
  });

  it("pulls a future ?date= back to today instead of loading an unmarkable day", async () => {
    vi.unstubAllGlobals();
    navigation.params = new URLSearchParams("classId=c1&date=2999-01-01"); navigation.replace.mockClear();
    stubFetch();
    render(<ClassAttendancePage />);
    await pick("Aisyah", "Hadir");
    const input = screen.getByLabelText("Tanggal kehadiran") as HTMLInputElement;
    expect(input.value).toBe(input.max);
    expect(input.value).not.toBe("2999-01-01");
  });
});

describe("class attendance failure copy (TCHX-4/15, TCH-10, TCH-11)", () => {
  const mockApi = (mark: () => Promise<unknown>, rosterData: unknown = roster, rosterRes?: () => Promise<unknown>) =>
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("teaching-assignments")) return Promise.resolve(ok(assignment));
      if (url.includes("student-attendance?")) return rosterRes ? rosterRes() : Promise.resolve(ok(rosterData));
      return mark();
    }));
  it("failed save toast persists and its Coba lagi action re-sends the same save", async () => {
    let saves = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("teaching-assignments")) return Promise.resolve(ok(assignment));
      if (url.includes("student-attendance?")) return Promise.resolve(ok(roster));
      return ++saves === 1 ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(ok({ saved: 1 }));
    }));
    render(<ClassAttendancePage />);
    fireEvent.click(await pick("Aisyah", "Izin"));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const options = toastError.mock.calls[0][1];
    expect(options.duration).toBe(Infinity);
    expect(options.action.label).toBe("Coba lagi");
    expect(options.id).toEqual(expect.stringContaining("class-attendance-save"));
    expect(markRequests()).toHaveLength(1);
    await act(async () => { options.action.onClick(); });
    await waitFor(() => expect(markRequests()).toHaveLength(2));
    expect(markRequests()[1]).toEqual(markRequests()[0]);
  });

  const resetAll = () => { vi.unstubAllGlobals(); toastError.mockClear(); navigation.params = new URLSearchParams(); navigation.replace.mockClear(); };

  it("401 on a row save: Indonesian copy, a sign-in link, no Coba lagi, no raw 'Unauthorized'", async () => {
    resetAll();
    mockApi(() => Promise.resolve({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) }));
    render(<ClassAttendancePage />);
    fireEvent.click(await pick("Aisyah", "Izin"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Absensi belum tersimpan. Sesi Anda sudah berakhir. Masuk lagi, lalu simpan ulang.");
    expect(screen.getByRole("link", { name: "Masuk lagi" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
    expect(screen.queryByText(/Unauthorized/)).toBeNull();
    expect(toastError).toHaveBeenCalledWith(
      "Sesi Anda sudah berakhir. Masuk lagi, lalu simpan ulang.",
      expect.objectContaining({ duration: Infinity, action: undefined }),
    );
  });

  it("403 on a row save: permission copy and no retry or sign-in link", async () => {
    resetAll();
    mockApi(() => Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) }));
    render(<ClassAttendancePage />);
    fireEvent.click(await pick("Aisyah", "Hadir"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Anda tidak punya akses ke kelas ini. Hubungi admin sekolah.");
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Masuk lagi" })).toBeNull();
  });

  it("401 on the bulk save shows Masuk lagi and hides the useless bulk button", async () => {
    resetAll();
    mockApi(() => Promise.resolve({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) }), classOfThree);
    render(<ClassAttendancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Tandai 2 siswa lainnya Hadir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sesi Anda sudah berakhir");
    expect(screen.getByRole("link", { name: "Masuk lagi" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tandai/ })).toBeNull();
  });

  it("403 on roster load says it is a permission problem, not the connection", async () => {
    resetAll();
    mockApi(() => Promise.resolve(ok({ saved: 1 })), roster, () => Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) }));
    render(<ClassAttendancePage />);
    await screen.findByText("Data siswa tidak bisa dimuat");
    expect(screen.getByText("Anda tidak punya akses ke kelas ini. Hubungi admin sekolah.")).toBeInTheDocument();
    expect(screen.queryByText(/Periksa koneksi/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
  });

  it("401 on roster load offers Masuk lagi", async () => {
    resetAll();
    mockApi(() => Promise.resolve(ok({ saved: 1 })), roster, () => Promise.resolve({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) }));
    render(<ClassAttendancePage />);
    await screen.findByText("Data siswa tidak bisa dimuat");
    expect(screen.getByRole("link", { name: "Masuk lagi" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
  });

  it("offline roster load keeps Coba lagi with Indonesian copy", async () => {
    resetAll();
    mockApi(() => Promise.resolve(ok({ saved: 1 })), roster, () => Promise.reject(new TypeError("Failed to fetch")));
    render(<ClassAttendancePage />);
    await screen.findByText("Data siswa tidak bisa dimuat");
    expect(screen.getByText("Koneksi terputus. Periksa internet, lalu coba lagi.")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeInTheDocument();
  });

  it("bulk bar says Menyimpan… (not 'Semua siswa sudah dicatat') until the counts catch up", async () => {
    resetAll();
    const pending = deferred<ReturnType<typeof ok>>();
    mockApi(() => pending.promise, classOfThree);
    render(<ClassAttendancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Tandai 2 siswa lainnya Hadir" }));
    expect(await screen.findByText("Menyimpan…")).toBeInTheDocument();
    expect(screen.queryByText("Semua siswa sudah dicatat")).toBeNull();
    expect(screen.getByText("2 belum")).toBeInTheDocument();
    await act(async () => { pending.resolve(ok({ saved: 2 })); });
    await screen.findByText("Semua siswa sudah dicatat");
    expect(screen.getByText("Hadir 2")).toBeInTheDocument();
    expect(screen.queryByText(/belum$/)).toBeNull();
    expect(screen.queryByText("Menyimpan…")).toBeNull();
  });

  it("lets a long name wrap to two lines instead of truncating, keeping 44px status chips", async () => {
    resetAll();
    mockApi(() => Promise.resolve(ok({ saved: 1 })), [{ student: { id: "s1", name: "Abdul Zahra Maulana Ibrahim", nickname: null, gender: null }, attendance: null }]);
    render(<ClassAttendancePage />);
    const name = await screen.findByText("Abdul Zahra Maulana Ibrahim");
    expect(name.className).toContain("line-clamp-2");
    expect(name.className).toContain("break-words");
    expect(name.className).not.toContain("truncate");
    expect(screen.getAllByRole("radio")[0].className).toContain("size-11");
  });
});
