"use client";

/**
 * ReminderQueueDialog — the admin's WhatsApp reminder queue (cycle
 * 2026-10-17-payment-link-reminders, D6/D7/D8).
 *
 * One row per unpaid invoice whose guardian has a number WhatsApp can open, in the
 * order the API sends (never reminded first, then the oldest reminder). Each row's
 * primary action is a real `<a href="https://wa.me/...">`: the app cannot send
 * WhatsApp messages, it opens the chat with the salam message and the invoice's
 * payment link written, and the admin presses send. Hence "Diingatkan", never
 * "Terkirim".
 *
 * Design notes:
 * - The anchor's click handler fires the stamp POST (`keepalive`) and does NOT
 *   `preventDefault`: the navigation must stay synchronous or mobile browsers
 *   block the new tab as a popup. A failed stamp toasts; WhatsApp has opened anyway.
 * - A row is a list item, not a table row: it has to read at 390px with no
 *   sideways scroll and a 44px action.
 * - A row with no payment link offers "Buat link dulu" (needs `invoices.create`);
 *   without that capability it says who to ask instead of a dead button.
 * - Pages append ("Muat lebih banyak"). The server orders reminded rows last, so a
 *   stamp shifts rows between pages; every load past page 1 therefore re-fetches
 *   pages 1..n in order and merges: rows already on screen keep their place (data
 *   refreshed), rows not yet shown are appended in server order. The same path
 *   re-fetches after a link is made so the row comes back with its wa.me URL.
 * - One sr-only status region announces results; focus follows the work (to the
 *   new "Buka WhatsApp" after "Buat link dulu", to the next row after a PAID
 *   removal).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageCircle, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { readApiError, userMessage } from "@/lib/api/client-errors";
import { getYmdInTimezone } from "@/lib/attendance/timezone";
import { stampReminder } from "@/lib/finance/stamp-reminder";
import { DISPLAY_TIME_ZONE, formatInvoicePeriod, formatRelativeTime, formatRupiah } from "@/lib/format";

type ReminderRow = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  dueDate: string;
  status: string;
  remaining: number;
  studentName: string;
  guardianName: string | null;
  hasLink: boolean;
  waUrl: string | null;
  lastRemindedAt: string | null;
  lastRemindedByName: string | null;
  remindCount: number;
};

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };
type Meta = { excludedNoNumber: number; truncated: boolean };
type ReminderPage = { data: ReminderRow[]; pagination: Pagination; meta: Meta };

const PAGE_SIZE = 50;
// Mirrors the API's safety cap (lib/finance/reminder-queue); worded for the admin.
const TRUNCATED_AT = 2000;
const WA_ORIGIN = "https://wa.me/";

async function fetchPage(page: number): Promise<ReminderPage> {
  const res = await fetch(`/api/invoices/reminders?page=${page}&pageSize=${PAGE_SIZE}`);
  if (!res.ok) throw await readApiError(res, "Daftar pengingat belum dapat dimuat.");
  return res.json();
}

/** The row's WhatsApp link, or null when it has none or it is not a wa.me URL. */
function waLinkOf(row: ReminderRow): string | null {
  return row.hasLink && row.waUrl?.startsWith(WA_ORIGIN) ? row.waUrl : null;
}

function isRemindedToday(row: ReminderRow, today: string): boolean {
  return !!row.lastRemindedAt && getYmdInTimezone(new Date(row.lastRemindedAt), DISPLAY_TIME_ZONE) === today;
}

function reminderLine(row: ReminderRow): string {
  if (!row.lastRemindedAt) return "Belum diingatkan";
  const when = `Diingatkan ${formatRelativeTime(row.lastRemindedAt)}`;
  return row.lastRemindedByName ? `${when} · oleh ${row.lastRemindedByName}` : when;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `create` gates "Buat link dulu"; the queue itself needs `payments.record` (the caller's gate). */
  capabilities: { create: boolean };
}

export function ReminderQueueDialog({ open, onOpenChange, capabilities }: Props) {
  const [rows, setRows] = useState<ReminderRow[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [meta, setMeta] = useState<Meta>({ excludedNoNumber: 0, truncated: false });
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [creatingIds, setCreatingIds] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  // Latest request wins: a slow first load must not overwrite a fresher refetch.
  const requestRef = useRef(0);
  const pagesLoadedRef = useRef(1);
  // Rows whose stamp POST is in flight: a second tap still opens the link but must not POST again.
  const stampingRef = useRef(new Set<string>());
  // Where focus goes once the next render has settled; `rowId: null` means the dialog heading.
  const focusRequestRef = useRef<{ rowId: string | null; link: boolean } | null>(null);
  const headingRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  /**
   * Fetches pages 1..`pages` one after another. `merge: false` replaces the list (open,
   * retry); `merge: true` keeps every row on screen in place, refreshes its data from
   * the fetch, and appends the rest in server order. Resolves true when it applied.
   */
  const load = useCallback(async (pages: number, opts: { merge?: boolean; errorMessage?: string } = {}) => {
    const request = ++requestRef.current;
    if (!opts.merge) setStatus("loading");
    try {
      const results: ReminderPage[] = [];
      for (let p = 1; p <= pages; p++) {
        const result = await fetchPage(p);
        if (request !== requestRef.current) return false;
        results.push(result);
        if (result.pagination.page >= result.pagination.totalPages) break;
      }
      const fetched = results.flatMap((r) => r.data);
      const last = results[results.length - 1]!;
      pagesLoadedRef.current = results.length;
      setRows((prev) => {
        const fresh = new Map(fetched.map((r) => [r.id, r]));
        const kept = opts.merge ? prev.map((r) => fresh.get(r.id) ?? r) : [];
        const seen = new Set(kept.map((r) => r.id));
        return [...kept, ...fetched.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))];
      });
      setPagination(last.pagination);
      setMeta(last.meta);
      setStatus("ready");
      return true;
    } catch (err) {
      if (request !== requestRef.current) return false;
      if (opts.merge) toast.error(userMessage(err, opts.errorMessage ?? "Daftar pengingat belum dapat diperbarui."));
      else setStatus("error");
      return false;
    }
  }, []);

  useEffect(() => {
    if (open) void load(1);
  }, [open, load]);

  // Moves focus once the rows that the request refers to are in the DOM.
  useEffect(() => {
    const request = focusRequestRef.current;
    if (!request) return;
    focusRequestRef.current = null;
    const action =
      request.rowId === null
        ? undefined
        : Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-row-action]") ?? []).find(
            (el) => el.dataset.rowAction === request.rowId && (!request.link || el.tagName === "A"),
          );
    (action ?? (request.link ? null : headingRef.current))?.focus();
  }, [rows]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      await load(pagesLoadedRef.current + 1, { merge: true, errorMessage: "Daftar berikutnya belum dapat dimuat." });
    } finally {
      setLoadingMore(false);
    }
  }, [load]);

  // Runs from the anchor's click, after the browser has already been handed the
  // navigation. No preventDefault anywhere on this path.
  const handleOpenWhatsApp = useCallback((row: ReminderRow) => {
    if (stampingRef.current.has(row.id)) return;
    stampingRef.current.add(row.id);
    stampReminder(row.id)
      .then((stamp) => {
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? { ...r, lastRemindedAt: stamp.lastRemindedAt, remindCount: stamp.remindCount, lastRemindedByName: "Anda" }
              : r,
          ),
        );
        setAnnouncement(`Pengingat untuk ${row.studentName} tercatat.`);
      })
      .catch((err) => toast.error(userMessage(err, "Pengingat belum tercatat.")))
      .finally(() => stampingRef.current.delete(row.id));
  }, []);

  const handleCreateLink = useCallback(
    async (row: ReminderRow) => {
      setCreatingIds((ids) => [...ids, row.id]);
      try {
        const res = await fetch(`/api/invoices/${row.id}/replace-payment-link`, { method: "POST" });
        if (!res.ok) throw await readApiError(res, "Link pembayaran belum bisa dibuat.");
        const body = (await res.json()) as { outcome: "REPLACED" | "PAID"; message?: string };
        if (body.outcome === "PAID") {
          toast.info(body.message ?? "Tagihan ini sudah lunas.");
          const index = rows.findIndex((r) => r.id === row.id);
          focusRequestRef.current = { rowId: rows[index + 1]?.id ?? null, link: false };
          setRows((prev) => prev.filter((r) => r.id !== row.id));
          setPagination((p) => (p ? { ...p, total: Math.max(0, p.total - 1) } : p));
        } else {
          focusRequestRef.current = { rowId: row.id, link: true };
          if (await load(pagesLoadedRef.current, { merge: true })) setAnnouncement(`Link untuk ${row.studentName} siap.`);
          else focusRequestRef.current = null;
        }
      } catch (err) {
        toast.error(userMessage(err, "Link pembayaran belum bisa dibuat."));
      } finally {
        setCreatingIds((ids) => ids.filter((id) => id !== row.id));
      }
    },
    [load, rows],
  );

  const today = getYmdInTimezone(new Date(), DISPLAY_TIME_ZONE);
  const hasMore = !!pagination && pagination.page < pagination.totalPages;
  const allRemindedToday = !hasMore && rows.length > 0 && rows.every((r) => isRemindedToday(r, today));

  const notes = [
    meta.excludedNoNumber > 0 && (
      <p key="no-number">
        {meta.excludedNoNumber} tagihan belum lunas tanpa nomor WhatsApp wali — lengkapi di data wali.
      </p>
    ),
    meta.truncated && <p key="truncated">Daftar menampilkan {TRUNCATED_AT} tagihan pertama.</p>,
  ].filter(Boolean);

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span ref={headingRef} tabIndex={-1} className="outline-none">
          Pengingat WhatsApp
        </span>
      }
      description="Satu ketukan per keluarga. WhatsApp terbuka dengan pesan dan link tagihan; Anda yang menekan kirim."
      size="xl"
      // The dialog's own close control covers dismissal; the footer only docks
      // the notes so they stay in view while the list scrolls.
      footer={notes.length > 0 ? <div className="w-full space-y-1 text-small text-muted-foreground">{notes}</div> : null}
    >
      <p className="sr-only" role="status">
        {status === "loading" ? "Memuat daftar pengingat" : announcement}
      </p>

      {/* The wording is the school's to change: say so where the admin sees the message go out. */}
      <p className="text-small text-muted-foreground" data-testid="reminder-template-hint">
        Isi pesan bisa disesuaikan dengan gaya sekolah.{" "}
        <Link
          href="/admin/settings/pengingat-whatsapp"
          className="font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Ubah templat pesan
        </Link>
      </p>

      {status === "loading" && (
        <div aria-busy="true" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {status === "error" && (
        <EmptyState
          title="Daftar pengingat belum dapat dimuat"
          description="Periksa koneksi dan coba lagi. Tagihan tidak diubah."
          actionLabel="Coba lagi"
          onAction={() => void load(1)}
        />
      )}

      {status === "ready" && rows.length === 0 && (
        <EmptyState
          icon={MessageCircle}
          title="Tidak ada tagihan belum lunas yang bisa diingatkan"
          description="Tagihan belum lunas dengan nomor WhatsApp wali akan muncul di sini."
        />
      )}

      {status === "ready" && rows.length > 0 && (
        <>
          <p className="text-small text-muted-foreground">{pagination?.total ?? rows.length} tagihan di antrean</p>
          {allRemindedToday && (
            <p className="rounded-lg bg-muted px-3 py-2 text-small text-muted-foreground">
              Semua tagihan di daftar ini sudah diingatkan hari ini.
            </p>
          )}
          <ul ref={listRef} className="space-y-2" aria-label="Tagihan belum lunas">
            {rows.map((row) => {
              const waUrl = waLinkOf(row);
              return (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="min-w-0 break-words text-body font-medium">{row.studentName}</p>
                      <StatusBadge status={row.status} />
                    </div>
                    <p className="break-words text-small text-muted-foreground">
                      {formatInvoicePeriod(row.periodLabel)}
                      {row.guardianName ? ` · Wali: ${row.guardianName}` : ""}
                    </p>
                    <p className="text-body">
                      <span className="text-muted-foreground">Sisa </span>
                      <span className="font-currency font-medium tabular-nums">{formatRupiah(row.remaining)}</span>
                    </p>
                    <p className="text-small text-muted-foreground">{reminderLine(row)}</p>
                  </div>

                  <div className="sm:shrink-0">
                    {waUrl ? (
                      <Button
                        className="w-full sm:w-auto"
                        nativeButton={false}
                        // Base UI would otherwise mark the anchor role="button"; it navigates.
                        role="link"
                        data-row-action={row.id}
                        onClick={() => handleOpenWhatsApp(row)}
                        render={
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Buka WhatsApp untuk ${row.guardianName ?? "wali"}, tagihan ${row.studentName}`}
                          />
                        }
                      >
                        <MessageCircle aria-hidden="true" />
                        Buka WhatsApp
                      </Button>
                    ) : capabilities.create ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full sm:w-auto"
                        data-row-action={row.id}
                        disabled={creatingIds.includes(row.id)}
                        onClick={() => void handleCreateLink(row)}
                      >
                        <LinkIcon aria-hidden="true" />
                        {creatingIds.includes(row.id) ? "Membuat link..." : "Buat link dulu"}
                      </Button>
                    ) : (
                      <p className="max-w-56 text-small text-muted-foreground">
                        Belum ada link — minta admin tagihan membuatnya.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Memuat..." : "Muat lebih banyak"}
            </Button>
          )}
        </>
      )}
    </ResponsiveFormDialog>
  );
}
