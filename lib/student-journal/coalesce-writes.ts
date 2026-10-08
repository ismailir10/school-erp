import { getJournalCellKey } from "@/lib/student-journal/optimistic-save";

/** One pending cell write, as buffered between flushes. */
export type PendingWrite = {
  studentId: string;
  indicatorId: string;
  /** Value the user last selected for this cell inside the current window. */
  checked: boolean;
  /** Value to restore if the flush carrying this write fails. */
  previousChecked: boolean;
  /** Monotonic per-cell id — lets a late failure skip a cell retapped since. */
  requestId: number;
};

/** The wire shape `POST /api/student-journal/entries/batch` accepts. */
export type BatchEntry = {
  studentId: string;
  indicatorId: string;
  checked: boolean;
};

export type FlushBatch = {
  entries: BatchEntry[];
  /** Same writes keyed by cell, for rollback and for the pending-flag clear. */
  writes: Map<string, PendingWrite>;
  /**
   * True when the batch is being flushed because the page is going away
   * (`pagehide` / tab hidden). The flush callback must then send it with
   * `fetch(..., { keepalive: true })` so the request outlives the document.
   */
  keepalive?: boolean;
};

/**
 * Total body budget for keepalive requests. Browsers cap the *sum* of in-flight
 * keepalive bodies at 64KB; stay clear of it so one over-large batch cannot
 * make `fetch` throw and drop the whole flush.
 */
export const KEEPALIVE_BUDGET_BYTES = 60_000;

/**
 * Default coalescing window. Long enough to fold a burst of taps into one
 * request on an intermittent-4G connection, short enough that a walas who
 * taps once and immediately backgrounds the app still gets the write away.
 */
export const JOURNAL_FLUSH_MS = 500;

/**
 * Buffers journal cell taps and flushes them as a single batch request.
 *
 * The endpoint has always been batch-shaped but the grid posted one
 * single-element array per tap — four taps, four round trips. This folds a
 * burst into one POST while keeping the two properties the per-cell version
 * guaranteed:
 *
 * - **Last tap wins per cell.** Re-tapping a cell inside the window replaces
 *   the buffered value rather than queueing a second write, so a double tap
 *   collapses to a no-op instead of racing.
 * - **Flushes are serialised.** A flush starts only after the previous one
 *   settles, so the server sees windows in the order they closed. Within one
 *   window order is irrelevant — each cell appears exactly once.
 *
 * Rollback is per-flush rather than per-cell: a failed batch restores every
 * cell it carried, skipping any the user has retapped since (stale
 * `requestId`), and raises one error rather than one per cell.
 *
 * Timers are injected so tests can drive them without faking globals.
 */
export class JournalWriteCoalescer {
  private buffer = new Map<string, PendingWrite>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly flush: (batch: FlushBatch) => Promise<void>,
    private readonly windowMs: number = JOURNAL_FLUSH_MS,
  ) {}

  /** Buffer a tap and arm the flush timer if it is not already armed. */
  add(write: PendingWrite): void {
    const key = getJournalCellKey(write.studentId, write.indicatorId);
    const existing = this.buffer.get(key);

    this.buffer.set(key, {
      ...write,
      // Keep the value the cell held when the window opened — otherwise a
      // second tap would record the optimistic value as the rollback target
      // and a failure would restore the wrong state.
      previousChecked: existing?.previousChecked ?? write.previousChecked,
    });

    // Fixed window, not a debounce: continuous tapping must not starve the
    // flush indefinitely.
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.drainAndFlush();
      }, this.windowMs);
    }
  }

  /**
   * Flush immediately (page hide, unmount, explicit save). Pass
   * `{ keepalive: true }` from an unload path so the callback can use a
   * request that survives the document.
   */
  flushNow(opts: { keepalive?: boolean } = {}): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.drainAndFlush(opts.keepalive === true);
  }

  /** True while taps are buffered or a flush is armed. */
  get hasPending(): boolean {
    return this.buffer.size > 0 || this.timer !== null;
  }

  private drainAndFlush(keepalive = false): Promise<void> {
    if (this.buffer.size === 0) return this.inFlight;

    const writes = this.buffer;
    this.buffer = new Map();

    const batch: FlushBatch = {
      entries: [...writes.values()].map((w) => ({
        studentId: w.studentId,
        indicatorId: w.indicatorId,
        checked: w.checked,
      })),
      writes,
      ...(keepalive ? { keepalive: true } : {}),
    };

    // An unloading page cannot wait its turn: a `.then` queued behind a slow
    // in-flight flush may never run. Send now; the in-flight one (if any) is
    // being torn down with the page anyway.
    if (keepalive) {
      const sent = this.flush(batch).catch(() => {});
      this.inFlight = Promise.all([this.inFlight, sent]).then(() => {});
      return sent;
    }

    // Chain off the previous flush so windows reach the server in order.
    // The stored chain is the *caught* promise: one failure must neither
    // poison the chain nor surface as an unhandled rejection from the timer
    // callback, which fires with nobody awaiting it. The flush callback owns
    // error reporting.
    this.inFlight = this.inFlight.then(() => this.flush(batch)).catch(() => {});
    return this.inFlight;
  }
}

/**
 * Flush buffered taps when the page is going away (TCHX-17).
 *
 * The 500ms window means a tap right before closing the tab or switching apps
 * is still buffered when the page dies. `pagehide` is the reliable event on
 * iOS Safari (where `beforeunload` is not), and `visibilitychange` → hidden
 * covers backgrounding a PWA that is never formally unloaded. Both flush with
 * `keepalive` so the request survives the document.
 *
 * Returns the cleanup that removes the listeners. `win` / `doc` are injectable
 * for tests.
 */
export function bindFlushOnPageHide(
  coalescer: JournalWriteCoalescer,
  win: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState"> = document,
): () => void {
  const flush = () => {
    if (coalescer.hasPending) void coalescer.flushNow({ keepalive: true });
  };
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") flush();
  };
  win.addEventListener("pagehide", flush);
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    win.removeEventListener("pagehide", flush);
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
