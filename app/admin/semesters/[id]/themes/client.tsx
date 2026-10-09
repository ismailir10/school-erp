"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type DependencyList } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DeactivateConfirmDialog } from "@/components/admin/deactivate-confirm-dialog";
import { ArrowLeft, ChevronRight, FileUp, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatDateShort } from "@/lib/format";

type Theme = { id: string; semesterId: string; name: string; order: number; status: string; _count: { subThemes: number } };
type SubTheme = { id: string; themeId: string; name: string; order: number; status: string; _count: { weeks: number } };
type Week = { id: string; subThemeId: string; number: number; startDate: string; endDate: string; status: string };

type Semester = {
  id: string;
  number: 1 | 2;
  academicYearName: string;
  startDate: string;
  endDate: string;
  status: string;
};

function toYmd(iso: string) {
  return iso.slice(0, 10);
}

/**
 * `deps` MUST be a stable, primitive-or-memoized array. The hook forwards
 * it directly to `useCallback`; inline objects/functions defeat memoization
 * and `refresh` will then close over stale state. ESLint's
 * `react-hooks/exhaustive-deps` rule cannot verify a forwarded array, so
 * the contract lives here in the type signature + this comment.
 */
function useList<T extends { id: string }>(
  fetcher: () => Promise<T[]>,
  deps: DependencyList,
): [T[], boolean, () => Promise<void>] {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetcher());
    } finally {
      setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    refresh();
  }, [refresh]);
  return [rows, loading, refresh];
}

async function fetchJson<T>(url: string): Promise<T[]> {
  const r = await fetch(url);
  const j = await r.json();
  return Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
}

async function mutate(url: string, method: "POST" | "PUT", body: unknown): Promise<{ ok: boolean; data?: unknown; error?: string; conflictingWeekId?: string }> {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, ...data };
}

export function ThemesClient({ canWrite, semester }: { canWrite: boolean; semester: Semester }) {
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  const [selectedSubThemeId, setSelectedSubThemeId] = useState<string | null>(null);

  const [themes, themesLoading, refreshThemes] = useList<Theme>(
    () => fetchJson<Theme>(`/api/admin/curriculum/themes?semesterId=${semester.id}&status=all&pageSize=100`),
    [semester.id],
  );
  const [subThemes, subThemesLoading, refreshSubThemes] = useList<SubTheme>(
    () =>
      selectedThemeId
        ? fetchJson<SubTheme>(`/api/admin/curriculum/subthemes?themeId=${selectedThemeId}&status=all&pageSize=100`)
        : Promise.resolve([]),
    [selectedThemeId],
  );
  const [weeks, weeksLoading, refreshWeeks] = useList<Week>(
    () =>
      selectedSubThemeId
        ? fetchJson<Week>(`/api/admin/curriculum/weeks?subThemeId=${selectedSubThemeId}&status=all&pageSize=100`)
        : Promise.resolve([]),
    [selectedSubThemeId],
  );

  const activeTheme = themes.find((t) => t.id === selectedThemeId) ?? null;
  const activeSubTheme = subThemes.find((s) => s.id === selectedSubThemeId) ?? null;

  return (
    <div className="space-y-section">
      <div>
        <Link
          href="/admin/semesters"
          className="inline-flex items-center gap-1 text-small text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Kembali ke daftar semester
        </Link>
      </div>

      <PageHeader
        title={`${semester.academicYearName} · Semester ${semester.number}`}
        description={`Periode ${formatDateShort(toYmd(semester.startDate))} – ${formatDateShort(toYmd(semester.endDate))}. Atur tema, subtema, dan pekan.`}
        actions={
          <div className="flex items-center gap-2">
            {canWrite && (
              <Link
                href={`/admin/semesters/${semester.id}/import`}
                className="inline-flex items-center gap-2 h-9 rounded-md border border-input bg-background px-3 text-small font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <FileUp className="size-4" /> Impor PROMES (Program Semester)
              </Link>
            )}
            <StatusBadge status={semester.status} />
          </div>
        }
      />

      <div className="grid gap-card lg:grid-cols-3">
        <ThemeCard
          themes={themes}
          loading={themesLoading}
          canWrite={canWrite}
          selectedId={selectedThemeId}
          onSelect={(id) => {
            setSelectedThemeId(id);
            setSelectedSubThemeId(null);
          }}
          semesterId={semester.id}
          refresh={refreshThemes}
        />

        <SubThemeCard
          subThemes={subThemes}
          loading={subThemesLoading}
          canWrite={canWrite}
          parentTheme={activeTheme}
          selectedId={selectedSubThemeId}
          onSelect={setSelectedSubThemeId}
          refresh={refreshSubThemes}
        />

        <WeekCard
          weeks={weeks}
          loading={weeksLoading}
          canWrite={canWrite}
          parentSubTheme={activeSubTheme}
          refresh={refreshWeeks}
        />
      </div>
    </div>
  );
}

export function ThemeCard({
  themes,
  loading,
  canWrite,
  selectedId,
  onSelect,
  semesterId,
  refresh,
}: {
  themes: Theme[];
  loading: boolean;
  canWrite: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  semesterId: string;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Theme | null>(null);
  const [form, setForm] = useState({ name: "", order: "0" });
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<Theme | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<Theme | null>(null);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", order: String(themes.length) });
    setOpen(true);
  }
  function openEdit(t: Theme) {
    setEditing(t);
    setForm({ name: t.name, order: String(t.order) });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error("Nama tema wajib diisi");
      return;
    }
    setSaving(true);
    const body = { name: form.name.trim(), order: Number(form.order) || 0 };
    const url = editing ? `/api/admin/curriculum/themes/${editing.id}` : `/api/admin/curriculum/themes`;
    const r = await mutate(url, editing ? "PUT" : "POST", editing ? body : { ...body, semesterId });
    if (r.ok) {
      toast.success(editing ? "Tema diperbarui" : "Tema ditambahkan");
      setOpen(false);
      refresh();
    } else {
      toast.error(r.error ?? "Gagal");
    }
    setSaving(false);
  }

  async function flipStatus(t: Theme, status: "ACTIVE" | "INACTIVE") {
    const r = await mutate(`/api/admin/curriculum/themes/${t.id}`, "PUT", { status });
    if (r.ok) {
      toast.success(status === "ACTIVE" ? "Diaktifkan" : "Dinonaktifkan");
      refresh();
    } else {
      toast.error(r.error ?? "Gagal");
    }
  }

  return (
    <Card data-testid="theme-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-h2">Tema</CardTitle>
        {canWrite ? (
          <Button size="sm" onClick={openCreate} className="gap-1">
            <Plus className="size-4" /> Tambah
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-3/4" />
          </div>
        ) : themes.length === 0 ? (
          <p className="text-small text-muted-foreground">Belum ada tema. Tambahkan untuk mulai mengisi subtema dan pekan.</p>
        ) : (
          themes.map((t) => (
            <div
              key={t.id}
              className={`flex w-full items-center rounded-lg border border-border hover:bg-muted/40 ${
                selectedId === t.id ? "bg-muted ring-1 ring-primary/20" : ""
              }`}
              data-testid="theme-row"
            >
              <button
                type="button"
                aria-pressed={selectedId === t.id}
                onClick={() => onSelect(t.id)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-l-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div>
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Urutan {t.order} · {t._count.subThemes} subtema
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={t.status} />
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </button>
              {canWrite ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="mr-2 shrink-0"
                  onClick={() => openEdit(t)}
                  aria-label="Ubah tema"
                >
                  <Pencil className="size-3.5" />
                </Button>
              ) : null}
            </div>
          ))
        )}
        {canWrite && themes.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-2 text-xs">
            {themes.map((t) =>
              t.status === "ACTIVE" ? (
                <Button
                  key={`d-${t.id}`}
                  size="xs"
                  variant="ghost"
                  onClick={() => setDeactivateTarget(t)}
                >
                  Nonaktifkan {t.name}
                </Button>
              ) : (
                <Button
                  key={`a-${t.id}`}
                  size="xs"
                  variant="ghost"
                  onClick={() => setReactivateTarget(t)}
                >
                  Aktifkan {t.name}
                </Button>
              ),
            )}
          </div>
        ) : null}
      </CardContent>

      <ResponsiveFormDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Ubah Tema" : "Tambah Tema"}
        description={editing ? "Perbarui nama atau urutan tema." : "Tambah tema baru pada semester ini."}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Menyimpan..." : "Simpan"}
            </Button>
          </>
        }
      >
        <div className="space-y-field">
          <Field>
            <FieldLabel htmlFor="theme-name" required>Nama tema</FieldLabel>
            <Input
              id="theme-name"
              required
              aria-required="true"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Saya Anak Sehat"
              data-testid="theme-name-input"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="theme-order" required>Urutan</FieldLabel>
            <Input
              id="theme-order"
              required
              aria-required="true"
              type="number"
              min={0}
              value={form.order}
              onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))}
            />
          </Field>
        </div>
      </ResponsiveFormDialog>

      <DeactivateConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(v) => !v && setDeactivateTarget(null)}
        entityName={deactivateTarget ? `tema ${deactivateTarget.name}` : "tema"}
        extraWarning={
          deactivateTarget && deactivateTarget._count.subThemes > 0
            ? `${deactivateTarget._count.subThemes} subtema terkait tetap aktif.`
            : undefined
        }
        onConfirm={async () => {
          if (deactivateTarget) {
            await flipStatus(deactivateTarget, "INACTIVE");
            setDeactivateTarget(null);
          }
        }}
      />

      <ConfirmDialog
        open={!!reactivateTarget}
        onOpenChange={(v) => !v && setReactivateTarget(null)}
        title="Aktifkan kembali tema?"
        description={reactivateTarget ? `"${reactivateTarget.name}" akan muncul di daftar aktif.` : ""}
        confirmLabel="Aktifkan"
        onConfirm={async () => {
          if (reactivateTarget) {
            await flipStatus(reactivateTarget, "ACTIVE");
            setReactivateTarget(null);
          }
        }}
      />
    </Card>
  );
}

export function SubThemeCard({
  subThemes,
  loading,
  canWrite,
  parentTheme,
  selectedId,
  onSelect,
  refresh,
}: {
  subThemes: SubTheme[];
  loading: boolean;
  canWrite: boolean;
  parentTheme: Theme | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SubTheme | null>(null);
  const [form, setForm] = useState({ name: "", order: "0" });
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<SubTheme | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<SubTheme | null>(null);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", order: String(subThemes.length) });
    setOpen(true);
  }
  function openEdit(s: SubTheme) {
    setEditing(s);
    setForm({ name: s.name, order: String(s.order) });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error("Nama subtema wajib diisi");
      return;
    }
    if (!editing && !parentTheme) {
      toast.error("Pilih tema dulu");
      return;
    }
    setSaving(true);
    const body = { name: form.name.trim(), order: Number(form.order) || 0 };
    const url = editing ? `/api/admin/curriculum/subthemes/${editing.id}` : `/api/admin/curriculum/subthemes`;
    const r = await mutate(url, editing ? "PUT" : "POST", editing ? body : { ...body, themeId: parentTheme!.id });
    if (r.ok) {
      toast.success(editing ? "Subtema diperbarui" : "Subtema ditambahkan");
      setOpen(false);
      refresh();
    } else {
      toast.error(r.error ?? "Gagal");
    }
    setSaving(false);
  }

  async function flipStatus(s: SubTheme, status: "ACTIVE" | "INACTIVE") {
    const r = await mutate(`/api/admin/curriculum/subthemes/${s.id}`, "PUT", { status });
    if (r.ok) {
      toast.success(status === "ACTIVE" ? "Diaktifkan" : "Dinonaktifkan");
      refresh();
    } else {
      toast.error(r.error ?? "Gagal");
    }
  }

  return (
    <Card data-testid="subtheme-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-h2">
          Subtema
          {parentTheme ? <span className="text-small text-muted-foreground"> · {parentTheme.name}</span> : null}
        </CardTitle>
        {canWrite && parentTheme ? (
          <Button size="sm" onClick={openCreate} className="gap-1">
            <Plus className="size-4" /> Tambah
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {!parentTheme ? (
          <p className="text-small text-muted-foreground">Pilih tema di kolom kiri untuk melihat dan menambah subtema.</p>
        ) : loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-3/4" />
          </div>
        ) : subThemes.length === 0 ? (
          <p className="text-small text-muted-foreground">Belum ada subtema. Tambahkan untuk mulai mengisi pekan.</p>
        ) : (
          subThemes.map((s) => (
            <div
              key={s.id}
              className={`flex w-full items-center rounded-lg border border-border hover:bg-muted/40 ${
                selectedId === s.id ? "bg-muted ring-1 ring-primary/20" : ""
              }`}
              data-testid="subtheme-row"
            >
              <button
                type="button"
                aria-pressed={selectedId === s.id}
                onClick={() => onSelect(s.id)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-l-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div>
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Urutan {s.order} · {s._count.weeks} pekan
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={s.status} />
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </button>
              {canWrite ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="mr-2 shrink-0"
                  onClick={() => openEdit(s)}
                  aria-label="Ubah subtema"
                >
                  <Pencil className="size-3.5" />
                </Button>
              ) : null}
            </div>
          ))
        )}
        {canWrite && subThemes.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-2 text-xs">
            {subThemes.map((s) =>
              s.status === "ACTIVE" ? (
                <Button
                  key={`d-${s.id}`}
                  size="xs"
                  variant="ghost"
                  onClick={() => setDeactivateTarget(s)}
                >
                  Nonaktifkan {s.name}
                </Button>
              ) : (
                <Button
                  key={`a-${s.id}`}
                  size="xs"
                  variant="ghost"
                  onClick={() => setReactivateTarget(s)}
                >
                  Aktifkan {s.name}
                </Button>
              ),
            )}
          </div>
        ) : null}
      </CardContent>

      <ResponsiveFormDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Ubah Subtema" : "Tambah Subtema"}
        description={parentTheme ? `Di bawah tema "${parentTheme.name}".` : undefined}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Menyimpan..." : "Simpan"}
            </Button>
          </>
        }
      >
        <div className="space-y-field">
          <Field>
            <FieldLabel htmlFor="subtheme-name" required>Nama subtema</FieldLabel>
            <Input
              id="subtheme-name"
              required
              aria-required="true"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Tubuhku"
              data-testid="subtheme-name-input"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="subtheme-order" required>Urutan</FieldLabel>
            <Input
              id="subtheme-order"
              required
              aria-required="true"
              type="number"
              min={0}
              value={form.order}
              onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))}
            />
          </Field>
        </div>
      </ResponsiveFormDialog>

      <DeactivateConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(v) => !v && setDeactivateTarget(null)}
        entityName={deactivateTarget ? `subtema ${deactivateTarget.name}` : "subtema"}
        extraWarning={
          deactivateTarget && deactivateTarget._count.weeks > 0
            ? `${deactivateTarget._count.weeks} pekan terkait tetap aktif.`
            : undefined
        }
        onConfirm={async () => {
          if (deactivateTarget) {
            await flipStatus(deactivateTarget, "INACTIVE");
            setDeactivateTarget(null);
          }
        }}
      />

      <ConfirmDialog
        open={!!reactivateTarget}
        onOpenChange={(v) => !v && setReactivateTarget(null)}
        title="Aktifkan kembali subtema?"
        description={reactivateTarget ? `"${reactivateTarget.name}" akan muncul di daftar aktif.` : ""}
        confirmLabel="Aktifkan"
        onConfirm={async () => {
          if (reactivateTarget) {
            await flipStatus(reactivateTarget, "ACTIVE");
            setReactivateTarget(null);
          }
        }}
      />
    </Card>
  );
}

function WeekCard({
  weeks,
  loading,
  canWrite,
  parentSubTheme,
  refresh,
}: {
  weeks: Week[];
  loading: boolean;
  canWrite: boolean;
  parentSubTheme: SubTheme | null;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Week | null>(null);
  const [form, setForm] = useState({ number: "1", startDate: "", endDate: "" });
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Week | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<Week | null>(null);

  function openCreate() {
    setEditing(null);
    setFieldError(null);
    setForm({ number: String(weeks.length + 1), startDate: "", endDate: "" });
    setOpen(true);
  }
  function openEdit(w: Week) {
    setEditing(w);
    setFieldError(null);
    setForm({ number: String(w.number), startDate: toYmd(w.startDate), endDate: toYmd(w.endDate) });
    setOpen(true);
  }

  async function save() {
    if (!form.startDate || !form.endDate) {
      toast.error("Tanggal mulai dan selesai wajib diisi");
      return;
    }
    if (!editing && !parentSubTheme) {
      toast.error("Pilih subtema dulu");
      return;
    }
    setSaving(true);
    setFieldError(null);
    const body = {
      number: Number(form.number),
      startDate: form.startDate,
      endDate: form.endDate,
    };
    const url = editing ? `/api/admin/curriculum/weeks/${editing.id}` : `/api/admin/curriculum/weeks`;
    const r = await mutate(url, editing ? "PUT" : "POST", editing ? body : { ...body, subThemeId: parentSubTheme!.id });
    if (r.ok) {
      toast.success(editing ? "Pekan diperbarui" : "Pekan ditambahkan");
      setOpen(false);
      refresh();
    } else if (r.conflictingWeekId) {
      setFieldError(r.error ?? "Pekan bertumpang tindih dengan pekan lain.");
    } else {
      toast.error(r.error ?? "Gagal");
    }
    setSaving(false);
  }

  async function flipStatus(w: Week, status: "ACTIVE" | "INACTIVE") {
    const r = await mutate(`/api/admin/curriculum/weeks/${w.id}`, "PUT", { status });
    if (r.ok) {
      toast.success(status === "ACTIVE" ? "Diaktifkan" : "Dinonaktifkan");
      refresh();
    } else {
      toast.error(r.error ?? "Gagal");
    }
  }

  return (
    <Card data-testid="week-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-h2">
          Pekan
          {parentSubTheme ? <span className="text-small text-muted-foreground"> · {parentSubTheme.name}</span> : null}
        </CardTitle>
        {canWrite && parentSubTheme ? (
          <Button size="sm" onClick={openCreate} className="gap-1">
            <Plus className="size-4" /> Tambah
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {!parentSubTheme ? (
          <p className="text-small text-muted-foreground">Pilih subtema di kolom tengah untuk melihat dan menambah pekan.</p>
        ) : loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-3/4" />
          </div>
        ) : weeks.length === 0 ? (
          <p className="text-small text-muted-foreground">Belum ada pekan. Tambahkan Senin–Jumat pada subtema ini.</p>
        ) : (
          weeks.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              data-testid="week-row"
            >
              <div>
                <p className="text-sm font-medium">Pekan {w.number}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateShort(toYmd(w.startDate))} – {formatDateShort(toYmd(w.endDate))}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={w.status} />
                {canWrite ? (
                  <>
                    <Button size="icon-sm" variant="ghost" onClick={() => openEdit(w)} aria-label="Ubah pekan">
                      <Pencil className="size-3.5" />
                    </Button>
                    {w.status === "ACTIVE" ? (
                      <Button size="xs" variant="ghost" onClick={() => setDeactivateTarget(w)}>
                        Nonaktifkan
                      </Button>
                    ) : (
                      <Button size="xs" variant="ghost" onClick={() => setReactivateTarget(w)}>
                        Aktifkan
                      </Button>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          ))
        )}
      </CardContent>

      <ResponsiveFormDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setFieldError(null);
        }}
        title={editing ? "Ubah Pekan" : "Tambah Pekan"}
        description={parentSubTheme ? `Pada subtema "${parentSubTheme.name}". Rentang Senin–Jumat tidak boleh bertumpang tindih.` : undefined}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button onClick={save} disabled={saving} data-testid="week-save">
              {saving ? "Menyimpan..." : "Simpan"}
            </Button>
          </>
        }
      >
        <div className="space-y-field">
          <Field>
            <FieldLabel htmlFor="week-number" required>Nomor pekan</FieldLabel>
            <Input
              id="week-number"
              required
              aria-required="true"
              type="number"
              min={1}
              value={form.number}
              onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-field">
            <Field>
              <FieldLabel htmlFor="week-start-date" required>Mulai (Senin)</FieldLabel>
              <DatePicker
                id="week-start-date"
                required
                max={form.endDate || undefined}
                value={form.startDate}
                onChange={(v) => setForm((f) => ({ ...f, startDate: v }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="week-end-date" required>Selesai (Jumat)</FieldLabel>
              <DatePicker
                id="week-end-date"
                required
                min={form.startDate || undefined}
                value={form.endDate}
                onChange={(v) => setForm((f) => ({ ...f, endDate: v }))}
              />
            </Field>
          </div>
          {fieldError ? (
            <p className="text-small text-destructive" data-testid="week-overlap-error">
              {fieldError}
            </p>
          ) : null}
        </div>
      </ResponsiveFormDialog>

      <DeactivateConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(v) => !v && setDeactivateTarget(null)}
        entityName={deactivateTarget ? `pekan ${deactivateTarget.number}` : "pekan"}
        onConfirm={async () => {
          if (deactivateTarget) {
            await flipStatus(deactivateTarget, "INACTIVE");
            setDeactivateTarget(null);
          }
        }}
      />

      <ConfirmDialog
        open={!!reactivateTarget}
        onOpenChange={(v) => !v && setReactivateTarget(null)}
        title="Aktifkan kembali pekan?"
        description={reactivateTarget ? `Pekan ${reactivateTarget.number} akan muncul kembali.` : ""}
        confirmLabel="Aktifkan"
        onConfirm={async () => {
          if (reactivateTarget) {
            await flipStatus(reactivateTarget, "ACTIVE");
            setReactivateTarget(null);
          }
        }}
      />
    </Card>
  );
}
