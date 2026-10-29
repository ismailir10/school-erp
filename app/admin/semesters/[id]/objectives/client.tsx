"use client";

import { BackLink } from "@/components/portal/back-link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import {
  objectiveEditFormSchema,
  indicatorAddFormSchema,
  indicatorEditFormSchema,
} from "@/lib/validations/curriculum";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { DeactivateConfirmDialog } from "@/components/admin/deactivate-confirm-dialog";
import { Pencil, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { formatDateShort } from "@/lib/format";

type AgeGroup = "A" | "B";
type Element =
  | "RELIGIOUS_MORAL"
  | "IDENTITY"
  | "STEAM"
  | "MOTOR_SKILLS"
  | "ART";

const ELEMENT_LABEL: Record<Element, string> = {
  RELIGIOUS_MORAL: "Nilai Agama & Budi Pekerti",
  IDENTITY: "Jati Diri",
  STEAM: "STEAM / Literasi",
  MOTOR_SKILLS: "Motorik",
  ART: "Seni",
};

type Objective = {
  id: string;
  semesterId: string;
  ageGroup: AgeGroup;
  element: Element;
  number: number;
  competencyText: string;
  content: string;
  status: string;
};

type Indicator = {
  id: string;
  objectiveId: string;
  content: string;
  order: number;
  status: string;
  themeLinks?: { themeId: string }[];
};

type Theme = {
  id: string;
  name: string;
  order: number;
  status: string;
};

type ThemeLink = {
  indicatorId: string;
  themeId: string;
};

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

async function fetchList<T>(url: string): Promise<T[]> {
  const r = await fetch(url);
  const j = await r.json();
  return Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
}

async function mutate(
  url: string,
  method: "POST" | "PUT",
  body: unknown,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, ...data };
}

export function ObjectivesClient({
  canWrite,
  semester,
}: {
  canWrite: boolean;
  semester: Semester;
}) {
  const [ageGroup, setAgeGroup] = useState<AgeGroup | "all">("all");
  const [element, setElement] = useState<Element | "all">("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "ACTIVE" | "INACTIVE"
  >("ACTIVE");

  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [links, setLinks] = useState<ThemeLink[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        semesterId: semester.id,
        pageSize: "200",
        status: statusFilter,
      });
      if (ageGroup !== "all") params.set("ageGroup", ageGroup);
      if (element !== "all") params.set("element", element);

      const [objs, themesList] = await Promise.all([
        fetchList<Objective>(
          `/api/admin/curriculum/objectives?${params.toString()}`,
        ),
        fetchList<Theme>(
          `/api/admin/curriculum/themes?semesterId=${semester.id}&status=ACTIVE&pageSize=100`,
        ),
      ]);
      setObjectives(objs);
      setThemes(themesList);

      // Parallel fetch — one request per objective. Independent reads,
      // so Promise.all collapses the wait to a single round-trip slot.
      if (objs.length === 0) {
        setIndicators([]);
        setLinks([]);
      } else {
        const parts = await Promise.all(
          objs.map((o) =>
            fetchList<Indicator>(
              `/api/admin/curriculum/indicators?objectiveId=${o.id}&status=all&pageSize=200`,
            ),
          ),
        );
        const all = parts.flat();
        setIndicators(all);
        // Hydrate theme-link state from the indicator payload —
        // `achievementIndicatorListSelect` includes `themeLinks` for this
        // page (added in T5). Checkbox matrix reflects real DB state on
        // first paint, not just optimistic toggle state.
        setLinks(
          all.flatMap((ind) =>
            (ind.themeLinks ?? []).map((tl) => ({
              indicatorId: ind.id,
              themeId: tl.themeId,
            })),
          ),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [semester.id, ageGroup, element, statusFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-section">
      <div>
        <BackLink href="/admin/semesters" label="Kembali ke daftar semester" />
      </div>

      <PageHeader
        title={`${semester.academicYearName} · Semester ${semester.number} · Tujuan Pembelajaran`}
        description={`Periode ${formatDateShort(toYmd(semester.startDate))} – ${formatDateShort(toYmd(semester.endDate))}. Atur Tujuan Pembelajaran (TP), Indikator Ketercapaian (IKTP), dan kaitan tema.`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <FilterGroup
              label="Kelompok"
              value={ageGroup}
              options={[
                { value: "all", label: "Semua" },
                { value: "A", label: "TK A" },
                { value: "B", label: "TK B" },
              ]}
              onChange={(v) => setAgeGroup(v as AgeGroup | "all")}
            />
            <FilterGroup
              label="Elemen"
              value={element}
              options={[
                { value: "all", label: "Semua" },
                ...Object.keys(ELEMENT_LABEL).map((k) => ({
                  value: k,
                  label: ELEMENT_LABEL[k as Element],
                })),
              ]}
              onChange={(v) => setElement(v as Element | "all")}
            />
            <FilterGroup
              label="Status"
              value={statusFilter}
              options={[
                { value: "all", label: "Semua Status" },
                { value: "ACTIVE", label: "Aktif" },
                { value: "INACTIVE", label: "Tidak Aktif" },
              ]}
              onChange={(v) =>
                setStatusFilter(v as "all" | "ACTIVE" | "INACTIVE")
              }
            />
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-3/4" />
        </div>
      ) : objectives.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Belum ada tujuan pembelajaran untuk filter ini. Import PROMES via
            tombol di halaman semester untuk mengisi data.
          </CardContent>
        </Card>
      ) : (
        <Accordion multiple className="space-y-2">
          {objectives.map((o) => (
            <ObjectiveAccordion
              key={o.id}
              objective={o}
              indicators={indicators.filter((i) => i.objectiveId === o.id)}
              themes={themes}
              links={links}
              canWrite={canWrite}
              onChanged={refresh}
              onLinksChanged={setLinks}
              currentLinks={links}
            />
          ))}
        </Accordion>
      )}
    </div>
  );
}

export function FilterGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-small text-muted-foreground mr-1">{label}:</span>
      {options.map((opt) => (
        <Button
          key={opt.value}
          size="sm"
          variant={value === opt.value ? "default" : "outline"}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

function ObjectiveAccordion({
  objective,
  indicators,
  themes,
  links,
  canWrite,
  onChanged,
  onLinksChanged,
  currentLinks,
}: {
  objective: Objective;
  indicators: Indicator[];
  themes: Theme[];
  links: ThemeLink[];
  canWrite: boolean;
  onChanged: () => void;
  onLinksChanged: (next: ThemeLink[]) => void;
  currentLinks: ThemeLink[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [addIktpOpen, setAddIktpOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  return (
    <AccordionItem
      value={objective.id}
      className="border rounded-md px-4"
    >
      <AccordionTrigger className="hover:no-underline">
        <div className="flex flex-1 items-center justify-between gap-3 pr-2">
          <div className="text-left flex-1">
            <div className="flex items-center gap-2">
              <span className="text-small font-medium">
                TK {objective.ageGroup} · {ELEMENT_LABEL[objective.element]} ·
                #{objective.number}
              </span>
              <StatusBadge
                status={
                  objective.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"
                }
              />
            </div>
            <div className="text-small text-muted-foreground mt-1">
              {objective.content}
            </div>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-4 pt-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Detail Tujuan Pembelajaran</CardTitle>
              {canWrite && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditOpen(true)}
                  >
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  {objective.status === "ACTIVE" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeactivateOpen(true)}
                    >
                      Nonaktifkan
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const r = await mutate(
                          `/api/admin/curriculum/objectives/${objective.id}`,
                          "PUT",
                          { status: "ACTIVE" },
                        );
                        if (!r.ok) {
                          toast.error(r.error ?? "Gagal mengaktifkan");
                          return;
                        }
                        toast.success("TP diaktifkan");
                        onChanged();
                      }}
                    >
                      <RotateCcw className="size-3.5" /> Aktifkan
                    </Button>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-3 text-small">
              <div>
                <div className="text-muted-foreground">
                  Capaian Perkembangan Diri
                </div>
                <div className="whitespace-pre-wrap">
                  {objective.competencyText}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Tujuan Pembelajaran</div>
                <div className="whitespace-pre-wrap">{objective.content}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Indikator Ketercapaian ({indicators.length})
              </CardTitle>
              {canWrite && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAddIktpOpen(true)}
                >
                  <Plus className="size-3.5" /> Tambah IKTP
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {indicators.length === 0 ? (
                <div className="text-small text-muted-foreground">
                  Belum ada indikator.
                </div>
              ) : (
                indicators.map((ind) => (
                  <IndicatorRow
                    key={ind.id}
                    indicator={ind}
                    themes={themes}
                    canWrite={canWrite}
                    currentLinks={currentLinks.filter(
                      (l) => l.indicatorId === ind.id,
                    )}
                    onChanged={onChanged}
                    onLinkToggle={(themeId, linked) => {
                      const next = linked
                        ? [...links, { indicatorId: ind.id, themeId }]
                        : links.filter(
                            (l) =>
                              !(
                                l.indicatorId === ind.id && l.themeId === themeId
                              ),
                          );
                      onLinksChanged(next);
                    }}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <ObjectiveEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          objective={objective}
          onSaved={onChanged}
        />
        <AddIndicatorDialog
          open={addIktpOpen}
          onOpenChange={setAddIktpOpen}
          objectiveId={objective.id}
          existingMax={indicators.reduce((m, i) => Math.max(m, i.order), 0)}
          onSaved={onChanged}
        />
        <DeactivateConfirmDialog
          open={deactivateOpen}
          onOpenChange={setDeactivateOpen}
          entityName={`TP #${objective.number}`}
          onConfirm={async () => {
            const r = await mutate(
              `/api/admin/curriculum/objectives/${objective.id}`,
              "PUT",
              { status: "INACTIVE" },
            );
            if (!r.ok) {
              toast.error(r.error ?? "Gagal menonaktifkan");
              return;
            }
            toast.success("TP dinonaktifkan");
            onChanged();
          }}
        />
      </AccordionContent>
    </AccordionItem>
  );
}

export function IndicatorRow({
  indicator,
  themes,
  canWrite,
  currentLinks,
  onChanged,
  onLinkToggle,
}: {
  indicator: Indicator;
  themes: Theme[];
  canWrite: boolean;
  currentLinks: ThemeLink[];
  onChanged: () => void;
  onLinkToggle: (themeId: string, linked: boolean) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const linkedThemeIds = useMemo(
    () => new Set(currentLinks.map((l) => l.themeId)),
    [currentLinks],
  );

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-small font-medium">#{indicator.order}</span>
            <StatusBadge
              status={indicator.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"}
            />
          </div>
          <div className="text-small mt-1">{indicator.content}</div>
        </div>
        {canWrite && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Ubah IKTP #${indicator.order}`}
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="size-3.5" />
            </Button>
            {indicator.status === "ACTIVE" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDeactivateOpen(true)}
              >
                Nonaktifkan
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Aktifkan IKTP #${indicator.order}`}
                onClick={async () => {
                  const r = await mutate(
                    `/api/admin/curriculum/indicators/${indicator.id}`,
                    "PUT",
                    { status: "ACTIVE" },
                  );
                  if (!r.ok) {
                    toast.error(r.error ?? "Gagal mengaktifkan");
                    return;
                  }
                  toast.success("IKTP diaktifkan");
                  onChanged();
                }}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      {themes.length > 0 && (
        <div className="border-t pt-2">
          <div className="text-small text-muted-foreground mb-1">
            Tema terkait:
          </div>
          <div className="flex flex-wrap gap-2">
            {themes.map((t) => {
              const isLinked = linkedThemeIds.has(t.id);
              return (
                <label
                  key={t.id}
                  className="inline-flex items-center gap-1.5 text-small"
                >
                  <Checkbox
                    checked={isLinked}
                    disabled={!canWrite}
                    onCheckedChange={async (next) => {
                      const wantLinked = Boolean(next);
                      const r = await mutate(
                        "/api/admin/curriculum/indicator-theme-links",
                        "POST",
                        {
                          indicatorId: indicator.id,
                          themeId: t.id,
                          linked: wantLinked,
                        },
                      );
                      if (!r.ok) {
                        toast.error(
                          r.error ?? "Gagal menyimpan kaitan tema",
                        );
                        return;
                      }
                      onLinkToggle(t.id, wantLinked);
                    }}
                  />
                  {t.name}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <IndicatorEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        indicator={indicator}
        onSaved={onChanged}
      />
      <DeactivateConfirmDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        entityName={`IKTP #${indicator.order}`}
        onConfirm={async () => {
          const r = await mutate(
            `/api/admin/curriculum/indicators/${indicator.id}`,
            "PUT",
            { status: "INACTIVE" },
          );
          if (!r.ok) {
            toast.error(r.error ?? "Gagal menonaktifkan");
            return;
          }
          toast.success("IKTP dinonaktifkan");
          onChanged();
        }}
      />
    </div>
  );
}

export function ObjectiveEditDialog({
  open,
  onOpenChange,
  objective,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  objective: Objective;
  onSaved: () => void;
}) {
  const formId = useId();
  const form = useZodForm(objectiveEditFormSchema, {
    defaultValues: { competencyText: objective.competencyText, content: objective.content },
  });

  useEffect(() => {
    form.reset({ competencyText: objective.competencyText, content: objective.content });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objective.id, objective.competencyText, objective.content]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await sendJson(`/api/admin/curriculum/objectives/${objective.id}`, { method: "PUT", body: values }, "Gagal menyimpan");
      toast.success("TP tersimpan");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      applyServerErrors(form, err, "Gagal menyimpan");
    }
  });

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit TP #${objective.number}`}
      description="Hanya capaian + tujuan dapat diubah. Identitas (elemen, nomor, kelompok) tetap."
      footer={
        <FormDialogFooter
          formId={formId}
          pending={form.formState.isSubmitting}
          onCancel={() => onOpenChange(false)}
          submitLabel="Simpan"
          pendingLabel="Menyimpan…"
        />
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-field">
        <FormRootError formState={form.formState} />
        <FormField
          control={form.control}
          name="competencyText"
          label="Capaian Perkembangan Diri"
          required
          id="objective-competencyText"
          render={({ field, controlProps }) => (
            <Textarea {...field} {...controlProps} rows={3} maxLength={2000} />
          )}
        />
        <FormField
          control={form.control}
          name="content"
          label="Tujuan Pembelajaran"
          required
          id="objective-content"
          render={({ field, controlProps }) => (
            <Textarea {...field} {...controlProps} rows={3} maxLength={2000} />
          )}
        />
      </form>
    </ResponsiveFormDialog>
  );
}

export function AddIndicatorDialog({
  open,
  onOpenChange,
  objectiveId,
  existingMax,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  objectiveId: string;
  existingMax: number;
  onSaved: () => void;
}) {
  const formId = useId();
  const form = useZodForm(indicatorAddFormSchema, {
    defaultValues: { content: "", order: existingMax + 1 },
  });

  useEffect(() => {
    if (open) {
      form.reset({ content: "", order: existingMax + 1 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existingMax]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await sendJson("/api/admin/curriculum/indicators", { method: "POST", body: { ...values, objectiveId } }, "Gagal menambah IKTP");
      toast.success("IKTP ditambahkan");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      applyServerErrors(form, err, "Gagal menambah IKTP");
    }
  });

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Tambah IKTP"
      footer={
        <FormDialogFooter
          formId={formId}
          pending={form.formState.isSubmitting}
          onCancel={() => onOpenChange(false)}
          submitLabel="Simpan"
          pendingLabel="Menyimpan…"
        />
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-field">
        <FormRootError formState={form.formState} />
        <FormField
          control={form.control}
          name="content"
          label="Isi Indikator"
          required
          id="indicator-add-content"
          render={({ field, controlProps }) => (
            <Textarea {...field} {...controlProps} rows={3} maxLength={2000} />
          )}
        />
        <FormField
          control={form.control}
          name="order"
          label="Urutan"
          required
          id="indicator-add-order"
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} value={String(field.value ?? "")} type="number" min={1} max={9999} />
          )}
        />
      </form>
    </ResponsiveFormDialog>
  );
}

export function IndicatorEditDialog({
  open,
  onOpenChange,
  indicator,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  indicator: Indicator;
  onSaved: () => void;
}) {
  const formId = useId();
  const form = useZodForm(indicatorEditFormSchema, {
    defaultValues: { content: indicator.content, order: indicator.order },
  });

  useEffect(() => {
    form.reset({ content: indicator.content, order: indicator.order });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicator.id, indicator.content, indicator.order]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await sendJson(`/api/admin/curriculum/indicators/${indicator.id}`, { method: "PUT", body: values }, "Gagal menyimpan");
      toast.success("IKTP tersimpan");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      applyServerErrors(form, err, "Gagal menyimpan");
    }
  });

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit IKTP #${indicator.order}`}
      footer={
        <FormDialogFooter
          formId={formId}
          pending={form.formState.isSubmitting}
          onCancel={() => onOpenChange(false)}
          submitLabel="Simpan"
          pendingLabel="Menyimpan…"
        />
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-field">
        <FormRootError formState={form.formState} />
        <FormField
          control={form.control}
          name="content"
          label="Isi indikator"
          required
          id="indicator-edit-content"
          render={({ field, controlProps }) => (
            <Textarea {...field} {...controlProps} rows={3} maxLength={2000} />
          )}
        />
        <FormField
          control={form.control}
          name="order"
          label="Urutan"
          required
          id="indicator-edit-order"
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} value={String(field.value ?? "")} type="number" min={1} max={9999} />
          )}
        />
      </form>
    </ResponsiveFormDialog>
  );
}
