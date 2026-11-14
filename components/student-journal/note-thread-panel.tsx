"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NoteThread } from "@/components/student-journal/note-thread";

export type ThreadNote = {
  id: string;
  date: string;
  authorRole: string;
  authorUserId?: string;
  authorName?: string;
  body: string;
  createdAt: string;
};

type Props = {
  studentId: string;
  /** Omit for admin — `NoteThread` already treats no audience as the admin case. */
  audience?: "teacher" | "parent";
  /** Bump to refetch from the first page — after a note is written, edited or deleted. */
  reloadToken?: number;
  /** Whether opening this panel should clear the reader's unread badge. */
  markReadOnOpen?: boolean;
  /**
   * Widened to `createdAt: string | Date` to match `NoteThread`'s own Note
   * type: the predicate is handed straight to it, and a narrower parameter
   * type here would make the two incompatible for no gain — every caller
   * decides on `authorRole`/`authorUserId`, not the timestamp.
   */
  canEdit?: (note: Omit<ThreadNote, "createdAt"> & { createdAt: string | Date }) => boolean;
  onEdit?: (noteId: string, note: { date: string; body: string }) => void;
  onDelete?: (noteId: string) => void;
  /** Reports the server's unread count after each first-page load. */
  onUnreadChange?: (unread: number) => void;
};

/**
 * The note thread, read from `/api/student-journal/notes` — the whole
 * conversation, not the viewed week.
 *
 * Shared by the teacher's per-student page and the parent's Catatan tab so the
 * two cannot drift on paging, ordering, or when the unread badge clears. Both
 * used to render `weekData.notes`, which is why a catatan disappeared the
 * Monday after it was written.
 */
export function NoteThreadPanel({
  studentId,
  audience,
  reloadToken = 0,
  markReadOnOpen = true,
  canEdit,
  onEdit,
  onDelete,
  onUnreadChange,
}: Props) {
  const [notes, setNotes] = useState<ThreadNote[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  // Guards against a stale first page landing after a newer one (student switch).
  const requestId = useRef(0);
  const markedFor = useRef<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `/api/student-journal/notes?studentId=${encodeURIComponent(studentId)}`,
      );
      if (!res.ok) throw new Error("load failed");
      const json = (await res.json()) as {
        data: { notes: ThreadNote[]; nextCursor: string | null; unreadCount: number };
      };
      if (id !== requestId.current) return;
      setNotes(json.data.notes);
      setNextCursor(json.data.nextCursor);
      onUnreadChange?.(json.data.unreadCount);
      if (markReadOnOpen && markedFor.current !== studentId) {
        const read = await fetch("/api/student-journal/notes/read", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId }),
        }).catch(() => null);
        if (read?.ok && id === requestId.current) {
          markedFor.current = studentId;
          onUnreadChange?.(0);
        }
      }
    } catch {
      if (id !== requestId.current) return;
      setError(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [studentId, onUnreadChange, markReadOnOpen]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage, reloadToken]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/student-journal/notes?studentId=${encodeURIComponent(studentId)}&cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (!res.ok) throw new Error("load failed");
      const json = (await res.json()) as {
        data: { notes: ThreadNote[]; nextCursor: string | null };
      };
      setNotes((prev) => [...prev, ...json.data.notes]);
      setNextCursor(json.data.nextCursor);
    } catch {
      toast.error("Catatan lama belum bisa dimuat. Coba lagi sebentar ya.");
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Catatan belum bisa dimuat.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="tap-target mt-3"
          onClick={loadFirstPage}
        >
          Coba lagi
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <NoteThread
        notes={notes}
        audience={audience}
        canEdit={canEdit}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="outline"
            className="tap-target"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Memuat…" : "Muat catatan lama"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
