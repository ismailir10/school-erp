"use client";

/**
 * Templat Pengingat WhatsApp (cycle 2026-10-23-reminder-template): the admin writes the
 * message the "Chat WhatsApp" button and the Pengingat WhatsApp queue prefill. Placeholder
 * chips insert at the cursor, and the right-hand preview shows the message the way the
 * wali will see it in a chat, filled with sample data, as the admin types.
 */

import { MESSAGES } from "@/lib/feedback";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/page-header";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, userMessage } from "@/lib/api/client-errors";
import { sendJson } from "@/lib/api/send-json";
import {
  DEFAULT_REMINDER_TEMPLATE,
  MAX_REMINDER_TEMPLATE_LENGTH,
  REMINDER_PLACEHOLDERS,
  renderReminderTemplate,
  sampleReminderValues,
  validateReminderTemplate,
} from "@/lib/finance/reminder-template";

const SAVE_FALLBACK = MESSAGES.saveFailed;
const SAMPLE = sampleReminderValues();

type Stored = { template?: unknown; defaultTemplate?: unknown };

/** The chat text with the sample payment link styled as WhatsApp styles a link. */
function BubbleText({ text }: { text: string }) {
  const parts = text.split(SAMPLE.tautan);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="text-primary underline underline-offset-2">{SAMPLE.tautan}</span>}
          {part}
        </span>
      ))}
    </>
  );
}

export default function ReminderTemplatePage() {
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [noAccess, setNoAccess] = useState(false);
  const [saved, setSaved] = useState(DEFAULT_REMINDER_TEMPLATE);
  const [defaultText, setDefaultText] = useState(DEFAULT_REMINDER_TEMPLATE);
  const [text, setText] = useState(DEFAULT_REMINDER_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const areaId = useId();
  const errorId = useId();
  const previewId = useId();

  const dirty = text !== saved;
  useUnsavedChangesGuard(dirty, "Perubahan templat pesan yang belum disimpan akan hilang.");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setNoAccess(false);
    try {
      const res = await fetch("/api/config/invoice-reminder");
      if (res.status === 403) {
        setNoAccess(true);
        return;
      }
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as Stored;
      const template = typeof data.template === "string" ? data.template : DEFAULT_REMINDER_TEMPLATE;
      setDefaultText(typeof data.defaultTemplate === "string" ? data.defaultTemplate : DEFAULT_REMINDER_TEMPLATE);
      setSaved(template);
      setText(template);
    } catch (err) {
      console.error(err);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const problem = useMemo(() => (text.trim() ? validateReminderTemplate(text) : "Tulis pesan, atau kembalikan ke bawaan."), [text]);
  const preview = useMemo(() => renderReminderTemplate(text, SAMPLE), [text]);

  function edit(next: string) {
    setServerError(null);
    setText(next);
  }

  function insertPlaceholder(key: string) {
    const token = `{${key}}`;
    const area = areaRef.current;
    const start = area?.selectionStart ?? text.length;
    const end = area?.selectionEnd ?? text.length;
    edit(text.slice(0, start) + token + text.slice(end));
    // After React re-renders the value, put the caret behind the inserted isian.
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function handleSave() {
    if (problem || saving) return;
    setSaving(true);
    setServerError(null);
    try {
      const data = await sendJson<Stored>("/api/config/invoice-reminder", { method: "PUT", body: { template: text } }, SAVE_FALLBACK);
      const template = typeof data?.template === "string" ? data.template : text;
      setSaved(template);
      setText(template);
      toast.success("Templat pesan disimpan.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setNoAccess(true);
        return;
      }
      setServerError(userMessage(err, SAVE_FALLBACK));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-96 w-full rounded-xl" />;

  const shownError = serverError ?? (dirty ? problem : null);
  const atDefault = text === defaultText;

  return (
    <>
      <PageHeader
        title="Templat pengingat WhatsApp"
        description="Atur isi pesan yang terbuka di WhatsApp saat admin mengingatkan wali tentang tagihan. Pesan tetap dikirim oleh admin."
      />

      {noAccess ? (
        <Card className="max-w-2xl p-card">
          <p role="status" className="text-sm text-muted-foreground">
            Anda tidak memiliki akses ke pengaturan ini.
          </p>
        </Card>
      ) : loadFailed ? (
        <Card className="max-w-2xl space-y-2 p-card">
          <p className="text-sm text-muted-foreground">Gagal memuat templat pesan.</p>
          <Button type="button" variant="outline" onClick={() => void load()}>
            Coba lagi
          </Button>
        </Card>
      ) : (
        <div className="grid items-start gap-card lg:grid-cols-2">
          <Card className="space-y-field p-card">
            <div className="space-y-2">
              <label htmlFor={areaId} className="text-sm font-medium">
                Isi pesan
              </label>
              <p className="text-small text-muted-foreground">Ketuk untuk menyisipkan isian di posisi kursor:</p>
              <div role="group" aria-label="Sisipkan isian" className="flex flex-wrap gap-2">
                {REMINDER_PLACEHOLDERS.map((p) => (
                  <Button
                    key={p.key}
                    type="button"
                    variant="outline"
                    size="sm"
                    title={`Sisipkan {${p.key}}`}
                    onClick={() => insertPlaceholder(p.key)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <Textarea
                id={areaId}
                ref={areaRef}
                value={text}
                rows={10}
                maxLength={MAX_REMINDER_TEMPLATE_LENGTH + 200}
                aria-invalid={!!shownError}
                aria-describedby={[shownError ? errorId : null, previewId].filter(Boolean).join(" ")}
                onChange={(e) => edit(e.target.value)}
                className="font-mono"
              />
              <div className="flex items-start justify-between gap-3 text-small">
                <p id={errorId} role={shownError ? "alert" : undefined} className="text-destructive">
                  {shownError}
                </p>
                <p className="shrink-0 tabular-nums text-muted-foreground">
                  {text.length}/{MAX_REMINDER_TEMPLATE_LENGTH}
                </p>
              </div>
              <p className="text-small text-muted-foreground">
                Isian seperti <code>{"{siswa}"}</code> diganti otomatis dengan data tagihan. Wajib memuat{" "}
                <code>{"{tautan}"}</code>.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={!dirty || !!problem || saving} onClick={() => void handleSave()}>
                {saving ? "Menyimpan..." : "Simpan"}
              </Button>
              <Button type="button" variant="outline" disabled={atDefault || saving} onClick={() => edit(defaultText)}>
                Kembalikan ke bawaan
              </Button>
            </div>
          </Card>

          <Card className="space-y-3 p-card" data-testid="reminder-preview">
            <div>
              <h2 className="text-h2">Pratinjau</h2>
              <p className="text-small text-muted-foreground">Begini pesan tampil di WhatsApp wali. Datanya contoh.</p>
            </div>
            <div className="rounded-xl bg-muted p-3 sm:p-4">
              <div
                id={previewId}
                aria-label="Pratinjau pesan"
                className="max-w-[92%] break-words whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-border bg-card px-3 py-2 text-body shadow-sm"
              >
                <BubbleText text={preview} />
                <p className="mt-1 text-right text-xs text-muted-foreground">09.41</p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
