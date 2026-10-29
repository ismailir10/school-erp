"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { BookHeart, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/portal/page-header";
import { resolveTeacherDate } from "@/lib/teacher/home-progress";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

type Assignment = {
  id: string;
  classSection: { id: string; name: string; status?: string; academicYear?: {status: string}; program: { name: string } };
};

export default function StudentJournalPickerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `?pick=1` means the guru asked for this form on purpose (the "Ganti kelas
  // atau tanggal" control on the fill page). Without it, a guru who teaches a
  // single class is answering a question with one possible answer three taps
  // before they can tick anything.
  const forcePicker = searchParams.get("pick") === "1";
  const requestedClass = searchParams.get("classId") ?? "";
  const requestedDate = searchParams.get("date");
  const [loadError,setLoadError] = useState(false);
  const [reload,setReload] = useState(0);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const today = getTodayInTimezone("Asia/Jakarta");
  const [date, setDate] = useState(resolveTeacherDate(requestedDate,today));
  const [loading, setLoading] = useState(true);
  const [classError, setClassError] = useState("");
  const [dateError, setDateError] = useState("");

  useEffect(() => {
    let cancelled = false;
    // Fetch lifecycle resets recovery before the next asynchronous result.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setLoadError(false);
    fetch("/api/teaching-assignments/my")
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          toast.error("Daftar kelas tidak bisa dimuat. Coba lagi sebentar ya.");
          setLoading(false); setLoadError(true);
          return;
        }
        return r.json();
      })
      .then((data: Assignment[] | undefined) => {
        if (cancelled || !data) return;
        setAssignments(data);
        if (data.length > 0) setSelectedClass(data.some(a => a.classSection.id === requestedClass) ? requestedClass : (data.find((a: Assignment) => a.classSection.status === "ACTIVE" && a.classSection.academicYear?.status === "ACTIVE") ?? data[0]).classSection.id);
        setDate(resolveTeacherDate(requestedDate,today));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        toast.error("Daftar kelas tidak bisa dimuat. Coba lagi sebentar ya.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [requestedClass, requestedDate, today, reload]);

  // A guru who teaches one class is answering a question with one answer, three
  // taps before they can tick anything. Kept in its own effect, deliberately:
  // folding it into the fetch above put `router` in a dependency array that also
  // triggered the fetch, and since `router` is a fresh object per render under
  // some setups the effect re-ran on its own setState — 642 requests in half a
  // second in the test that caught it. This effect writes no state, so a
  // re-run is inert.
  const willAutoRoute = !forcePicker && assignments.length === 1;
  useEffect(() => {
    if (!willAutoRoute) return;
    // replace, not push: Back from the grid should leave the journal, not
    // bounce through a form that immediately re-routes.
    router.replace(
      `/teacher/student-journal/entry?classId=${assignments[0].classSection.id}&date=${today}`,
    );
  }, [willAutoRoute, assignments, router, today]);

  function handleSubmit() {
    // Mark the missing field(s) at the field, then focus the first one.
    // A toast alone vanishes in seconds and says nothing about which control.
    const missingClass = !selectedClass;
    const missingDate = !resolveTeacherDate(date, "");
    setClassError(missingClass ? "Pilih kelas dulu ya." : "");
    setDateError(missingDate ? "Pilih tanggal dulu ya." : "");
    if (missingClass || missingDate) {
      document.getElementById(missingClass ? "journal-class" : "journal-date")?.focus();
      return;
    }
    router.push(`/teacher/student-journal/entry?classId=${selectedClass}&date=${date}`);
  }

  if (loading || willAutoRoute) {
    return (
      <div className="space-y-4">
        <PageHeader title="Buku Penghubung" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    );
  }

  if (assignments.length === 0 || loadError) {
    return (
      <div>
        <PageHeader title="Buku Penghubung" />
        <EmptyState
          icon={Users}
          title={loadError ? "Daftar kelas tidak bisa dimuat" : "Belum ditugaskan ke kelas"}
          description={loadError ? "Periksa koneksi, lalu coba lagi." : "Hubungi admin untuk ditugaskan mengajar di kelas tertentu."}
          actionLabel={loadError ? "Coba lagi" : undefined}
          onAction={loadError ? () => setReload(n=>n+1) : undefined}
        />
      </div>
    );
  }

  return (
    <div>
      {/*
        One name for one thing. The nav tab says "Jurnal", this page said
        "Jurnal — Buku Penghubung", its CTA said "Isi Penghubung" and the
        destination said "Isi Buku Penghubung" — four labels, one destination.
        The tab keeps "Jurnal" (a width budget, documented in bottom-nav.tsx);
        every page-level surface now says Buku Penghubung.
      */}
      <PageHeader title="Buku Penghubung" subtitle="Pilih kelas dan tanggal" />

      <div className="space-y-4">
        <Field>
          <FieldLabel htmlFor="journal-class">Kelas</FieldLabel>
          <Select value={selectedClass} onValueChange={(v) => {
            if (!v) return;
            setSelectedClass(v);
            setClassError("");
          }} items={assignments.map((a) => ({ label: `${a.classSection.name} — ${a.classSection.program.name}`, value: a.classSection.id }))}>
            <SelectTrigger
              id="journal-class"
              className="tap-target w-full"
              aria-invalid={classError ? true : undefined}
              aria-describedby={classError ? "journal-class-error" : undefined}
            >
              <SelectValue placeholder="Pilih kelas" />
            </SelectTrigger>
            <SelectContent>
              {assignments.map((a) => (
                <SelectItem key={a.classSection.id} value={a.classSection.id}>
                  {a.classSection.name} — {a.classSection.program.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {classError && <FieldError id="journal-class-error">{classError}</FieldError>}
        </Field>

        <Field>
          <FieldLabel htmlFor="journal-date">Tanggal</FieldLabel>
          <Input
            id="journal-date"
            type="date"
            value={date}
            max={today}
            onChange={(e) => {
              setDate(e.target.value);
              if (resolveTeacherDate(e.target.value, "")) setDateError("");
            }}
            className="tap-target w-full"
            aria-invalid={dateError ? true : undefined}
            aria-describedby={dateError ? "journal-date-error" : undefined}
          />
          {dateError && <FieldError id="journal-date-error">{dateError}</FieldError>}
        </Field>

        <Button onClick={handleSubmit} className="tap-target w-full mt-2" size="lg">
          <BookHeart size={18} aria-hidden="true" />
          Isi Buku Penghubung
        </Button>
      </div>
    </div>
  );
}
