"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { ClassSetupWarnings } from "@/components/admin/classes/class-setup-warnings";
import { checkClassSetup } from "@/lib/classes/setup-check";

type UsedClass = {
  id: string;
  name: string;
  ageGroup?: string | null;
  campus: { name: string };
  enrolledCount: number;
};

// `classes: null` = the request for `key` failed. Loading is derived (the
// stored answer belongs to another program/year), never set from the effect.
type Answer = { key: string; classes: UsedClass[] | null };

/**
 * The classes a program's fee structure is actually billed to, for the year
 * picked above it. Billing follows each class's own program, so this is the
 * answer to "who pays these rates?" — and the place an admin notices a class
 * wired to the wrong program.
 */
export function ProgramClassesUsage({
  programId,
  programName,
  yearId,
}: {
  programId: string;
  programName: string;
  yearId: string;
}) {
  const key = `${programId}|${yearId}`;
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ programId, yearId, status: "ACTIVE", pageSize: "100" });
    fetch(`/api/admin/classes?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("classes read failed");
        const json = await res.json();
        if (controller.signal.aborted) return;
        setAnswer({ key, classes: Array.isArray(json?.data) ? json.data : [] });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error("[program-classes-usage] classes fetch failed", err);
        setAnswer({ key, classes: null });
      });
    return () => controller.abort();
  }, [key, programId, yearId]);

  const current = answer?.key === key ? answer : null;
  const classes = current?.classes ?? null;

  const warnings = useMemo(
    () =>
      classes
        ? checkClassSetup(classes.map((c) => ({ id: c.id, name: c.name, ageGroup: c.ageGroup, programName })))
        : [],
    [classes, programName],
  );

  return (
    <section aria-labelledby="program-usage-heading" className="mt-section space-y-field">
      <h3 id="program-usage-heading" className="text-h2 font-semibold">
        Dipakai oleh
      </h3>

      {!current && <Skeleton className="h-16 rounded-xl" />}

      {current && classes === null && (
        <p className="text-small text-muted-foreground">Daftar kelas tidak bisa dimuat sekarang. Muat ulang halaman untuk mencoba lagi.</p>
      )}

      {classes && (
        <>
          <ClassSetupWarnings warnings={warnings} title="Periksa kelas ini" />
          {classes.length === 0 ? (
            <p className="text-small text-muted-foreground">
              Belum ada kelas yang memakai program ini di tahun ajaran ini. Tarif di atas baru dipakai setelah ada kelas
              yang terhubung ke program ini.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {classes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/admin/classes/${c.id}`} className="truncate text-body font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="truncate text-small text-muted-foreground">{c.campus.name}</p>
                  </div>
                  <span className="shrink-0 text-small text-muted-foreground">{c.enrolledCount} siswa</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
