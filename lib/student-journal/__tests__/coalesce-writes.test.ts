import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  JournalWriteCoalescer,
  bindFlushOnPageHide,
  type FlushBatch,
} from "@/lib/student-journal/coalesce-writes";

function write(
  studentId: string,
  indicatorId: string,
  checked: boolean,
  previousChecked = !checked,
  requestId = 1,
) {
  return { studentId, indicatorId, checked, previousChecked, requestId };
}

describe("JournalWriteCoalescer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("folds a burst of taps into one flush", async () => {
    // m12: four taps used to mean four POSTs to a batch-shaped endpoint.
    const flush = vi.fn<(b: FlushBatch) => Promise<void>>().mockResolvedValue();
    const c = new JournalWriteCoalescer(flush, 500);

    c.add(write("s1", "i1", true));
    c.add(write("s1", "i2", true));
    c.add(write("s2", "i1", true));
    c.add(write("s2", "i2", true));
    expect(flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]![0].entries).toEqual([
      { studentId: "s1", indicatorId: "i1", checked: true },
      { studentId: "s1", indicatorId: "i2", checked: true },
      { studentId: "s2", indicatorId: "i1", checked: true },
      { studentId: "s2", indicatorId: "i2", checked: true },
    ]);
  });

  it("collapses a re-tap of the same cell to its final value", async () => {
    const flush = vi.fn<(b: FlushBatch) => Promise<void>>().mockResolvedValue();
    const c = new JournalWriteCoalescer(flush, 500);

    c.add(write("s1", "i1", true, false, 1));
    c.add(write("s1", "i1", false, true, 2));

    await vi.advanceTimersByTimeAsync(500);

    const batch = flush.mock.calls[0]![0];
    expect(batch.entries).toEqual([
      { studentId: "s1", indicatorId: "i1", checked: false },
    ]);
    // Rollback target stays the value the cell held when the window opened,
    // not the intermediate optimistic value.
    expect(batch.writes.get("s1:i1")!.previousChecked).toBe(false);
    expect(batch.writes.get("s1:i1")!.requestId).toBe(2);
  });

  it("uses a fixed window, so continuous tapping cannot starve the flush", async () => {
    const flush = vi.fn<(b: FlushBatch) => Promise<void>>().mockResolvedValue();
    const c = new JournalWriteCoalescer(flush, 500);

    // A debounce would reset on every tap and never fire.
    c.add(write("s1", "i1", true));
    await vi.advanceTimersByTimeAsync(300);
    c.add(write("s1", "i2", true));
    await vi.advanceTimersByTimeAsync(300);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]![0].entries).toHaveLength(2);
  });

  it("serialises flushes so windows reach the server in order", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((r) => {
      releaseFirst = r;
    });

    const flush = vi
      .fn<(b: FlushBatch) => Promise<void>>()
      .mockImplementationOnce(async () => {
        order.push("first:start");
        await firstDone;
        order.push("first:end");
      })
      .mockImplementationOnce(async () => {
        order.push("second:start");
      });

    const c = new JournalWriteCoalescer(flush, 500);

    c.add(write("s1", "i1", true));
    await vi.advanceTimersByTimeAsync(500);

    c.add(write("s2", "i1", true));
    await vi.advanceTimersByTimeAsync(500);

    // Second window must not start while the first is still in flight.
    expect(order).toEqual(["first:start"]);

    releaseFirst();
    await vi.advanceTimersByTimeAsync(0);

    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("keeps the chain alive after a failed flush, without leaking a rejection", async () => {
    const flush = vi
      .fn<(b: FlushBatch) => Promise<void>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce();

    const c = new JournalWriteCoalescer(flush, 500);

    c.add(write("s1", "i1", true));
    await vi.advanceTimersByTimeAsync(500);
    c.add(write("s2", "i1", true));
    await vi.advanceTimersByTimeAsync(500);

    expect(flush).toHaveBeenCalledTimes(2);
    // The timer fires with nobody awaiting it, so a rejecting flush would
    // otherwise reach window.onunhandledrejection.
    await expect(c.flushNow()).resolves.toBeUndefined();
  });

  it("flushNow drains without waiting for the window", async () => {
    const flush = vi.fn<(b: FlushBatch) => Promise<void>>().mockResolvedValue();
    const c = new JournalWriteCoalescer(flush, 500);

    c.add(write("s1", "i1", true));
    await c.flushNow();

    expect(flush).toHaveBeenCalledTimes(1);
    // Timer disarmed — no second, empty flush.
    await vi.advanceTimersByTimeAsync(500);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("reports pending state and does not flush an empty buffer", async () => {
    const flush = vi.fn<(b: FlushBatch) => Promise<void>>().mockResolvedValue();
    const c = new JournalWriteCoalescer(flush, 500);

    expect(c.hasPending).toBe(false);
    c.add(write("s1", "i1", true));
    expect(c.hasPending).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    expect(c.hasPending).toBe(false);

    await c.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe("flush on page hide (TCHX-17)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function harness() {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
    const flush = vi.fn<(b: FlushBatch) => Promise<void>>().mockResolvedValue();
    const c = new JournalWriteCoalescer(flush, 500);
    const unbind = bindFlushOnPageHide(c, win as unknown as Window, doc as unknown as Document);
    return { win, doc, flush, c, unbind };
  }

  it("flushes a buffered tap on pagehide, flagged keepalive, before the window closes", async () => {
    const { win, flush, c } = harness();
    c.add(write("s1", "i1", true));
    expect(flush).not.toHaveBeenCalled();

    win.dispatchEvent(new Event("pagehide"));

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]![0].keepalive).toBe(true);
    expect(flush.mock.calls[0]![0].entries).toEqual([{ studentId: "s1", indicatorId: "i1", checked: true }]);
    // The armed timer was cleared: nothing is sent twice.
    await vi.advanceTimersByTimeAsync(500);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("flushes on visibilitychange only when the page became hidden", () => {
    const { doc, flush, c } = harness();
    c.add(write("s1", "i1", true));

    doc.dispatchEvent(new Event("visibilitychange"));
    expect(flush).not.toHaveBeenCalled();

    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]![0].keepalive).toBe(true);
  });

  it("sends immediately even when an earlier flush is still in flight", async () => {
    const { win, flush, c } = harness();
    flush.mockImplementationOnce(() => new Promise(() => {})); // never settles
    c.add(write("s1", "i1", true));
    void c.flushNow();
    await vi.advanceTimersByTimeAsync(0); // let the first flush start and hang
    c.add(write("s1", "i2", true));

    win.dispatchEvent(new Event("pagehide"));

    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush.mock.calls[1]![0].keepalive).toBe(true);
  });

  it("does nothing when nothing is buffered, and stops listening after cleanup", () => {
    const { win, flush, c, unbind } = harness();
    win.dispatchEvent(new Event("pagehide"));
    expect(flush).not.toHaveBeenCalled();

    unbind();
    c.add(write("s1", "i1", true));
    win.dispatchEvent(new Event("pagehide"));
    expect(flush).not.toHaveBeenCalled();
  });
});
