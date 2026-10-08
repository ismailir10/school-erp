"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DISPLAY_TIME_ZONE, formatLearningCenter, formatDate } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { ClipboardList, CalendarDays, Building2, AlertCircle, FileText } from "lucide-react";
import Link from "next/link";

type WalasRow = {
  classSectionId: string;
  className: string;
  programName: string;
  enrolled: number;
  assessed: number;
};
type SentraRow = { center: string; entries: number; studentsAssessed: number };
type Monitor = {
  academicYear: string;
  weekDate: string;
  sentraDate: string;
  week: { id: string; number: number; subThemeName: string; themeName: string } | null;
  walas: WalasRow[];
  sentra: SentraRow[];
};

function todayYmd() {
  return getTodayInTimezone(DISPLAY_TIME_ZONE);
}

function CompletionBadge({ assessed, enrolled }: { assessed: number; enrolled: number }) {
  if (enrolled === 0) {
    return <Badge variant="outline" className="text-muted-foreground">— belum ada siswa</Badge>;
  }
  const done = assessed >= enrolled;
  const started = assessed > 0;
  const cls = done
    ? "bg-status-present-subtle text-status-present-text"
    : started
      ? "bg-status-late-subtle text-status-late-text"
      : "text-muted-foreground";
  return (
    <Badge variant="outline" className={cn(cls, "font-currency")}>
      {assessed}/{enrolled} dinilai
    </Badge>
  );
}

export default function AdminPenilaianPage() {
  const [weekDate, setWeekDate] = useState(todayYmd);
  const [sentraDay, setSentraDay] = useState(todayYmd);
  const [data, setData] = useState<Monitor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ week: weekDate, day: sentraDay });
      const res = await fetch(`/api/admin/assessments?${params}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Gagal memuat data penilaian.");
        setData(null);
        return;
      }
      const json = (await res.json()) as { data: Monitor };
      setData(json.data);
    } catch {
      setError("Gagal memuat data penilaian.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [weekDate, sentraDay]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Pemantauan"
        description={
          data
            ? `Pantau kelengkapan penilaian — Tahun Ajaran ${data.academicYear}`
            : "Pantau kelengkapan penilaian walas pekanan & sentra harian"
        }
        actions={
          <Link href="/admin/report-cards" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <FileText className="size-4" /> Susun Rapor
          </Link>
        }
      />

      <div className="space-y-section">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <Field className="sm:w-48">
          <FieldLabel htmlFor="week-date">Pekan (tanggal acuan)</FieldLabel>
          <DatePicker
            id="week-date"
            value={weekDate}
            onChange={(v) => setWeekDate(v)}
          />
        </Field>
        <Field className="sm:w-48">
          <FieldLabel htmlFor="sentra-day">Hari sentra</FieldLabel>
          <DatePicker
            id="sentra-day"
            value={sentraDay}
            onChange={(v) => setSentraDay(v)}
          />
        </Field>
      </div>

      {error ? (
        <EmptyState
          icon={AlertCircle}
          title="Tidak dapat memuat penilaian."
          description={error}
          actionLabel="Coba lagi"
          onAction={load}
        />
      ) : loading ? (
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : data ? (
        <div className="space-y-8">
          {/* Walas weekly */}
          <section aria-labelledby="walas-heading">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="size-4 text-primary" />
              <h2 id="walas-heading" className="text-h2 font-semibold">
                Penilaian Pekanan (Walas)
              </h2>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {data.week
                ? `Pekan ${data.week.number} · ${data.week.subThemeName} (${data.week.themeName})`
                : "Belum ada Pekan aktif untuk tanggal acuan ini."}
            </p>
            {data.walas.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="Belum ada kelas aktif."
                description="Buat kelas pada tahun ajaran aktif untuk memantau penilaian pekanan."
              />
            ) : (
              <Card className="overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="h-auto p-3">Kelas</TableHead>
                      <TableHead className="h-auto p-3">Program</TableHead>
                      <TableHead className="h-auto p-3 text-right">Kelengkapan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.walas.map((row) => (
                      <TableRow key={row.classSectionId}>
                        <TableCell className="p-3 font-medium whitespace-normal">{row.className}</TableCell>
                        <TableCell className="p-3 text-muted-foreground whitespace-normal">{row.programName}</TableCell>
                        <TableCell className="p-3 text-right">
                          <CompletionBadge assessed={row.assessed} enrolled={row.enrolled} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </section>

          {/* Sentra daily */}
          <section aria-labelledby="sentra-heading">
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="size-4 text-primary" />
              <h2 id="sentra-heading" className="text-h2 font-semibold">
                Penilaian Sentra Harian
              </h2>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Entri pada {formatDate(data.sentraDate)}. Sentra tidak memiliki target siswa tetap (rotasi
              fleksibel) — angka menunjukkan jumlah entri & siswa yang dinilai.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.sentra.map((row) => (
                <Card key={row.center} className="p-card">
                  <p className="text-sm font-semibold mb-1">{formatLearningCenter(row.center)}</p>
                  <p className="text-xs text-muted-foreground font-currency">
                    {row.entries} entri · {row.studentsAssessed} siswa dinilai
                  </p>
                </Card>
              ))}
            </div>
          </section>
        </div>
      ) : null}
      </div>
    </>
  );
}
