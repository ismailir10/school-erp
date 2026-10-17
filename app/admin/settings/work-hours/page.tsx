"use client";

import { useEffect, useId, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { parseWorkingDays } from "@/lib/payroll/working-days";
import { FormField, FormRootError } from "@/components/ui/form";
import { orgConfigSchema } from "@/lib/validations/org-config";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes-provider";

const DAYS = [
  { key: "MON", label: "Senin" },
  { key: "TUE", label: "Selasa" },
  { key: "WED", label: "Rabu" },
  { key: "THU", label: "Kamis" },
  { key: "FRI", label: "Jumat" },
  { key: "SAT", label: "Sabtu" },
  { key: "SUN", label: "Minggu" },
];

const EMPTY_FORM = {
  workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
  workStartTime: "07:00",
  workEndTime: "16:00",
  gracePeriodMinutes: "15",
  timezone: "Asia/Jakarta",
  payrollPeriodStartDay: "21",
  payrollPeriodEndDay: "20",
};

export default function OrgConfigPage() {
  const [loading, setLoading] = useState(true);
  const formId = useId();
  const form = useZodForm(orgConfigSchema, { defaultValues: EMPTY_FORM });

  useUnsavedChangesGuard(
    form.formState.isDirty,
    "Perubahan jam kerja yang belum disimpan akan hilang.",
  );

  useEffect(() => {
    fetch("/api/config/org")
      .then((r) => r.json())
      .then((data) => {
        if (data) {
          const days = parseWorkingDays(data.workingDays);
          const current = form.getValues();
          form.reset({
            workingDays: days.length > 0 ? days : current.workingDays,
            workStartTime: data.workStartTime ?? current.workStartTime,
            workEndTime: data.workEndTime ?? current.workEndTime,
            gracePeriodMinutes: String(data.gracePeriodMinutes ?? current.gracePeriodMinutes),
            timezone: data.timezone ?? current.timezone,
            payrollPeriodStartDay: String(data.payrollPeriodStartDay ?? current.payrollPeriodStartDay),
            payrollPeriodEndDay: String(data.payrollPeriodEndDay ?? current.payrollPeriodEndDay),
          });
        }
      })
      .catch(() => {
        toast.error("Gagal memuat konfigurasi");
      })
      .finally(() => {
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = form.handleSubmit(async (values) => {
    try {
      await sendJson("/api/config/org", { method: "PUT", body: values }, "Gagal menyimpan");
      toast.success("Konfigurasi disimpan");
      form.reset(values);
    } catch (err) {
      applyServerErrors(form, err, "Gagal menyimpan");
    }
  });

  if (loading) return <Skeleton className="h-96 w-full rounded-xl" />;

  return (
    <>
      <PageHeader title="Jam Kerja" description="Atur jam kerja, zona waktu, dan periode penggajian" />

      <Card className="p-card max-w-2xl">
        <form id={formId} onSubmit={handleSave} noValidate className="space-y-field">
          <FormRootError formState={form.formState} />

          {/* Working days */}
          <FormField
            control={form.control}
            name="workingDays"
            label="Hari Kerja"
            id="work-hours-days"
            render={({ field }) => (
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => {
                  const checked = field.value.includes(d.key);
                  return (
                    <label
                      key={d.key}
                      className={`flex min-h-11 items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                        checked
                          ? "border-primary bg-primary/5 text-primary-text"
                          : "border-border text-muted-foreground hover:border-primary/30"
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          field.onChange(
                            checked
                              ? field.value.filter((x: string) => x !== d.key)
                              : [...field.value, d.key],
                          )
                        }
                      />
                      {d.label}
                    </label>
                  );
                })}
              </div>
            )}
          />

          {/* Work hours */}
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="workStartTime"
              label="Jam Mulai"
              id="work-hours-start-time"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} type="time" />
              )}
            />
            <FormField
              control={form.control}
              name="workEndTime"
              label="Jam Selesai"
              id="work-hours-end-time"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} type="time" />
              )}
            />
          </div>

          {/* Grace period */}
          <FormField
            control={form.control}
            name="gracePeriodMinutes"
            label="Toleransi Keterlambatan (menit)"
            id="work-hours-grace-period"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} value={field.value as string | number} type="number" min="0" max="60" />
            )}
          />

          {/* Timezone */}
          <FormField
            control={form.control}
            name="timezone"
            label="Zona Waktu"
            id="work-hours-timezone"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} value="Asia/Jakarta" disabled />
            )}
          />

          {/* Payroll period */}
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="payrollPeriodStartDay"
              label="Tanggal Mulai Gaji"
              id="work-hours-payroll-start-day"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={field.value as string | number} type="number" min="1" max="31" />
              )}
            />
            <FormField
              control={form.control}
              name="payrollPeriodEndDay"
              label="Tanggal Selesai Gaji"
              id="work-hours-payroll-end-day"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={field.value as string | number} type="number" min="1" max="31" />
              )}
            />
          </div>

          <div className="pt-2">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Menyimpan..." : "Simpan Konfigurasi"}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Perubahan hanya mempengaruhi perhitungan di masa depan
            </p>
          </div>
        </form>
      </Card>
    </>
  );
}
