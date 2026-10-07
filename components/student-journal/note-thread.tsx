"use client";

import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateShort, formatTime } from "@/lib/format";
import {
  roleLabel,
  getNoteAuthorInitials,
  getNoteAuthorLabel,
} from "@/lib/student-journal/note-display";

type Note = {
  id: string;
  date: string;
  authorRole: string;
  authorUserId?: string;
  authorName?: string;
  body: string;
  createdAt: string | Date;
};

function toIso(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}

type NoteThreadProps = {
  notes: Note[];
  onEdit?: (noteId: string, note: { date: string; body: string }) => void;
  onDelete?: (noteId: string) => void;
  canEdit?: (note: Note) => boolean;
  /**
   * Who is reading. "parent" makes TEACHER-authored notes render the warmer
   * "Ustadzah" label (matching app/parent/attendance/page.tsx's
   * `n.authorRole === "TEACHER" ? "Ustadzah" : "Anda"`) instead of the generic
   * "Guru" role label. Both values also pick the empty-state copy: the default
   * ("catatan dari guru akan tampil di sini") told a guru reading their own
   * student's week to wait for a guru. Admin callers omit the prop.
   */
  audience?: "parent" | "teacher";
}

/**
 * Empty-state description per reader. Notes are week-scoped, so the copy says
 * "pekan ini" rather than implying the student has never had a note.
 */
const EMPTY_DESCRIPTION: Record<"parent" | "teacher" | "admin", string> = {
  parent: "Tulis catatan pertama, atau tunggu catatan dari Ustadzah.",
  teacher: "Belum ada catatan di pekan ini. Tulis catatan pertama untuk wali murid.",
  admin: "Catatan dari guru akan tampil di sini setelah dituliskan.",
};

/**
 * Edit / Hapus are 28px icon buttons; an invisible 8px halo above and below
 * lifts the tap area to 44px without growing the card (PAR-14). Width already
 * reaches 44px on touch via the Button's coarse-pointer rule.
 */
const ICON_HIT_AREA = "relative before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']";

export function NoteThread({
  notes,
  onEdit,
  onDelete,
  canEdit = () => false,
  audience,
}: NoteThreadProps) {
  if (notes.length === 0) {
    return (
      <EmptyState
        title="Belum ada catatan"
        description={EMPTY_DESCRIPTION[audience ?? "admin"]}
      />
    );
  }

  return (
    <div className="space-y-3">
      {notes.map((note) => {
        const editable = canEdit(note) && (onEdit || onDelete);
        return (
          <div
            key={note.id}
            className="min-w-0 rounded-lg border border-border bg-card p-3 space-y-1.5"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Avatar size="sm">
                <AvatarFallback>
                  {getNoteAuthorInitials(note.authorName, note.authorRole)}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs font-medium text-foreground">
                {getNoteAuthorLabel(note.authorName, note.authorRole)}
              </span>
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                {audience === "parent" && note.authorRole === "TEACHER"
                  ? "Ustadzah"
                  : roleLabel(note.authorRole)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatDateShort(note.date)} &middot; {formatTime(toIso(note.createdAt))}
              </span>
              {editable && (
                <div className="ml-auto flex items-center gap-1">
                  {onEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={ICON_HIT_AREA}
                      aria-label="Edit catatan"
                      onClick={() =>
                        onEdit(note.id, { date: note.date, body: note.body })
                      }
                    >
                      <Pencil />
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={ICON_HIT_AREA}
                      aria-label="Hapus catatan"
                      onClick={() => onDelete(note.id)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              )}
            </div>
            {/* `anywhere` (not just break-words) also shrinks min-content, so one
                unbroken string or URL cannot stretch the page or dialog (PARX-3). */}
            <p className="min-w-0 text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {note.body}
            </p>
          </div>
        );
      })}
    </div>
  );
}
