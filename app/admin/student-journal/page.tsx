"use client";

import { MESSAGES } from "@/lib/feedback";
import { useCallback, useEffect, useId, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AdminTabs,
  AdminTabsContent,
  AdminTabsList,
  AdminTabsTrigger,
} from "@/components/admin/admin-tabs";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  CategoryAccordion,
  type CategoryDTO,
  type IndicatorDTO,
} from "@/components/student-journal/category-accordion";
import { categoryFormSchema, indicatorFormSchema } from "@/lib/validations/student-journal";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";

type Scope = "SCHOOL" | "HOME";
type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";

const SCOPE_LABEL: Record<Scope, string> = {
  SCHOOL: "Sekolah",
  HOME: "Rumah",
};

const CATEGORY_EMPTY_FORM = { name: "", scope: "SCHOOL" as Scope };
const INDICATOR_EMPTY_FORM = { label: "" };

// The indicator dialog never shows `categoryId` as a field — it's fixed by
// which category's "+" button opened the dialog — so it's tracked here
// alongside the create/edit target instead of in the RHF form.
type IndicatorTarget =
  | { mode: "create"; categoryId: string; categoryName: string }
  | { mode: "edit"; id: string; categoryId: string; categoryName: string };

export default function StudentJournalAdminPage() {
  const [scope, setScope] = useState<Scope>("SCHOOL");
  const [status, setStatus] = useState<StatusFilter>("ACTIVE");
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryDTO | null>(null);
  const categoryFormId = useId();
  const categoryForm = useZodForm(categoryFormSchema, { defaultValues: CATEGORY_EMPTY_FORM });

  const [indicatorDialogOpen, setIndicatorDialogOpen] = useState(false);
  const [indicatorTarget, setIndicatorTarget] = useState<IndicatorTarget | null>(null);
  const indicatorFormId = useId();
  const indicatorForm = useZodForm(indicatorFormSchema, { defaultValues: INDICATOR_EMPTY_FORM });

  const load = useCallback(async (s: Scope, st: StatusFilter) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/student-journal/categories?scope=${s}&status=${st}`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? MESSAGES.loadFailed("Kategori"));
        setCategories([]);
        return;
      }
      const json = await res.json();
      setCategories(json.data as CategoryDTO[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scope, status);
  }, [scope, status, load]);

  // ------- Category form -------

  function openCreateCategory() {
    setEditingCategory(null);
    categoryForm.reset({ name: "", scope });
    setCategoryDialogOpen(true);
  }

  function openEditCategory(cat: CategoryDTO) {
    setEditingCategory(cat);
    categoryForm.reset({ name: cat.name, scope: cat.scope });
    setCategoryDialogOpen(true);
  }

  const saveCategory = categoryForm.handleSubmit(async (values) => {
    try {
      const url = editingCategory
        ? `/api/student-journal/categories/${editingCategory.id}`
        : "/api/student-journal/categories";
      const method = editingCategory ? "PUT" : "POST";
      const body = editingCategory
        ? { name: values.name, scope: values.scope }
        : { name: values.name, scope: values.scope, order: categories.length };

      await sendJson(url, { method, body }, "Gagal menyimpan kategori");
      toast.success(editingCategory ? "Kategori diperbarui" : "Kategori ditambahkan");
      setCategoryDialogOpen(false);
      // If the scope changed in create mode, load may not show it — but we stay on current tab.
      if (!editingCategory && values.scope !== scope) {
        setScope(values.scope);
      } else {
        await load(scope, status);
      }
    } catch (err) {
      applyServerErrors(categoryForm, err, "Gagal menyimpan kategori");
    }
  });

  // ------- Indicator form -------

  function openCreateIndicator(cat: CategoryDTO) {
    setIndicatorTarget({ mode: "create", categoryId: cat.id, categoryName: cat.name });
    indicatorForm.reset({ label: "" });
    setIndicatorDialogOpen(true);
  }

  function openEditIndicator(ind: IndicatorDTO, cat: CategoryDTO) {
    setIndicatorTarget({ mode: "edit", id: ind.id, categoryId: cat.id, categoryName: cat.name });
    indicatorForm.reset({ label: ind.label });
    setIndicatorDialogOpen(true);
  }

  const saveIndicator = indicatorForm.handleSubmit(async (values) => {
    if (!indicatorTarget) return;
    try {
      const url =
        indicatorTarget.mode === "create"
          ? "/api/student-journal/indicators"
          : `/api/student-journal/indicators/${indicatorTarget.id}`;
      const method = indicatorTarget.mode === "create" ? "POST" : "PUT";

      // Pick an order slot at the end of the category's current indicators.
      const parent = categories.find((c) => c.id === indicatorTarget.categoryId);
      const nextOrder = parent ? parent.indicators.length : 0;

      const body =
        indicatorTarget.mode === "create"
          ? { categoryId: indicatorTarget.categoryId, label: values.label, order: nextOrder }
          : { label: values.label };

      await sendJson(url, { method, body }, "Gagal menyimpan indikator");
      toast.success(
        indicatorTarget.mode === "create" ? "Indikator ditambahkan" : "Indikator diperbarui",
      );
      setIndicatorDialogOpen(false);
      await load(scope, status);
    } catch (err) {
      applyServerErrors(indicatorForm, err, "Gagal menyimpan indikator");
    }
  });

  return (
    <div className="space-y-section">
      <PageHeader
        title="Buku Penghubung — Templat"
        description="Atur kategori dan indikator untuk sekolah dan rumah."
        actions={
          <Button onClick={openCreateCategory}>
            <Plus className="w-4 h-4 mr-2" /> Tambah Kategori
          </Button>
        }
      />

      <AdminTabs value={scope} onValueChange={(v) => setScope(v as Scope)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <AdminTabsList>
            <AdminTabsTrigger value="SCHOOL">Sekolah</AdminTabsTrigger>
            <AdminTabsTrigger value="HOME">Rumah</AdminTabsTrigger>
          </AdminTabsList>
          <div className="w-full sm:w-48">
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)} items={{ ALL: "Semua Status", ACTIVE: "Aktif", INACTIVE: "Tidak Aktif" }}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua Status</SelectItem>
                <SelectItem value="ACTIVE">Aktif</SelectItem>
                <SelectItem value="INACTIVE">Tidak Aktif</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <AdminTabsContent value="SCHOOL" className="mt-4">
          <CategoryAccordion
            categories={categories}
            loading={loading}
            onRefresh={() => load(scope, status)}
            onEditCategory={openEditCategory}
            onAddIndicator={openCreateIndicator}
            onEditIndicator={openEditIndicator}
          />
        </AdminTabsContent>
        <AdminTabsContent value="HOME" className="mt-4">
          <CategoryAccordion
            categories={categories}
            loading={loading}
            onRefresh={() => load(scope, status)}
            onEditCategory={openEditCategory}
            onAddIndicator={openCreateIndicator}
            onEditIndicator={openEditIndicator}
          />
        </AdminTabsContent>
      </AdminTabs>

      {/* Category create/edit dialog */}
      <ResponsiveFormDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        title={editingCategory ? "Edit Kategori" : "Tambah Kategori"}
        footer={
          <FormDialogFooter
            formId={categoryFormId}
            pending={categoryForm.formState.isSubmitting}
            onCancel={() => setCategoryDialogOpen(false)}
            submitLabel={editingCategory ? "Simpan Perubahan" : "Tambah Kategori"}
          />
        }
      >
        <form id={categoryFormId} onSubmit={saveCategory} noValidate className="space-y-field">
          <FormRootError formState={categoryForm.formState} />
          <FormField
            control={categoryForm.control}
            name="name"
            label="Nama Kategori"
            required
            id="journal-category-name"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} placeholder="Contoh: Ibadah" autoFocus />
            )}
          />
          <FormField
            control={categoryForm.control}
            name="scope"
            label="Lingkup"
            required
            id="journal-category-scope"
            render={({ field, controlProps }) => (
              <Select
                value={field.value}
                onValueChange={(v) => v != null && field.onChange(v)}
                items={{ SCHOOL: SCOPE_LABEL.SCHOOL, HOME: SCOPE_LABEL.HOME }}
              >
                <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SCHOOL">{SCOPE_LABEL.SCHOOL}</SelectItem>
                  <SelectItem value="HOME">{SCOPE_LABEL.HOME}</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </form>
      </ResponsiveFormDialog>

      {/* Indicator create/edit dialog */}
      <ResponsiveFormDialog
        open={indicatorDialogOpen}
        onOpenChange={setIndicatorDialogOpen}
        title={
          indicatorTarget?.mode === "create"
            ? `Tambah Indikator — ${indicatorTarget.categoryName}`
            : "Edit Indikator"
        }
        footer={
          <FormDialogFooter
            formId={indicatorFormId}
            pending={indicatorForm.formState.isSubmitting}
            onCancel={() => setIndicatorDialogOpen(false)}
            submitLabel={indicatorTarget?.mode === "create" ? "Tambah Indikator" : "Simpan Perubahan"}
          />
        }
      >
        <form id={indicatorFormId} onSubmit={saveIndicator} noValidate className="space-y-field">
          <FormRootError formState={indicatorForm.formState} />
          <FormField
            control={indicatorForm.control}
            name="label"
            label="Label Indikator"
            required
            id="journal-indicator-label"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} placeholder="Contoh: Tahfizul Qur'an" autoFocus />
            )}
          />
        </form>
      </ResponsiveFormDialog>
    </div>
  );
}
