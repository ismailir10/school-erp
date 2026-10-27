"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatRupiah } from "@/lib/format";

type Fees = { total: number; lines: { label: string; amount: number }[] };
type ProgramSide = { programId: string; programName: string; fees: Fees };
type Impact = {
  academicYear: { id: string; name: string };
  activeStudents: number;
  blockedReason: string | null;
  current: ProgramSide;
  next: ProgramSide | null;
};

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; impact: Impact }
  | { kind: "unavailable" };

/**
 * What moving a class to another program does to its billing, shown under the
 * Program field of Ubah Kelas before the admin saves. The billing run bills a
 * class from its own program's fee structure, so a wrong link shows up as a
 * wrong rate on every invoice; this is where the admin sees it first.
 *
 * `onBlockedChange` reports whether the server will refuse the move (students
 * already invoiced), so the dialog can disable Simpan. When the preview cannot
 * load (a role without the finance permission, a network blip) the save stays
 * allowed: the server enforces the same guards on its own.
 */
export function ProgramChangeImpact({
  classId,
  currentProgramId,
  nextProgramId,
  onBlockedChange,
}: {
  classId: string;
  currentProgramId: string;
  nextProgramId: string;
  onBlockedChange?: (blocked: boolean) => void;
}) {
  const changing = nextProgramId !== "" && nextProgramId !== currentProgramId;
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (!changing) {
      setState({ kind: "idle" });
      onBlockedChange?.(false);
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    onBlockedChange?.(false);
    fetch(
      `/api/admin/classes/${classId}/program-impact?programId=${encodeURIComponent(nextProgramId)}`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error("impact unavailable");
        const impact = (await res.json()) as Impact;
        // A newer choice (or a closed dialog) already cancelled this request.
        if (controller.signal.aborted) return;
        setState({ kind: "ready", impact });
        onBlockedChange?.(impact.blockedReason !== null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error("[program-change-impact] preview failed", err);
        setState({ kind: "unavailable" });
      });
    return () => controller.abort();
    // onBlockedChange is a state setter from the dialog; re-running on its
    // identity would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changing, classId, nextProgramId]);

  if (state.kind === "idle") return null;

  if (state.kind === "loading") {
    return (
      <p role="status" className="text-small text-muted-foreground">
        Memeriksa dampak ke tagihan…
      </p>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <Alert role="status">
        <AlertDescription>
          Dampak ke tagihan tidak bisa ditampilkan sekarang. Tagihan siswa mengikuti tarif program kelasnya,
          jadi draf tagihan yang sudah dibuat perlu dibuat ulang setelah program diubah.
        </AlertDescription>
      </Alert>
    );
  }

  const { impact } = state;
  if (impact.blockedReason) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{impact.blockedReason}</AlertDescription>
      </Alert>
    );
  }

  const next = impact.next;
  if (!next) return null;
  const students = `${impact.activeStudents} siswa aktif`;

  if (next.fees.lines.length === 0) {
    return (
      <Alert role="status">
        <AlertDescription>
          {next.programName} belum ada tarif rutin untuk tahun ajaran {impact.academicYear.name}. {students} di
          kelas ini tidak akan ditagih sampai tarifnya diisi di Biaya → Tarif per Program.
        </AlertDescription>
      </Alert>
    );
  }

  const { current } = impact;
  const same = current.fees.total === next.fees.total;
  return (
    <Alert role="status">
      <AlertDescription>
        {same ? (
          <>
            Tagihan rutin per periode tetap {formatRupiah(next.fees.total)} untuk {students}.
          </>
        ) : (
          <>
            Tagihan rutin per periode berubah dari{" "}
            <span className="font-currency">{formatRupiah(current.fees.total)}</span> ke{" "}
            <span className="font-currency">{formatRupiah(next.fees.total)}</span> untuk {students}.
          </>
        )}{" "}
        Draf tagihan yang sudah dibuat perlu dibuat ulang.
      </AlertDescription>
    </Alert>
  );
}
