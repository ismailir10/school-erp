"use client";

// Harga paket sekolah + daycare — docs/cycles/2026-10-29-school-daycare-bundle-price.md (T4).
//
// Mounted by Tarif per Program under the program fee table. Self-contained: it
// owns its fetch of /api/fee-bundles, its edits and its own "Simpan harga paket"
// button, and tells the page only whether it has unsaved edits (the year-switch
// discard gate). Inputs are rendered inline in the row loop — no component is
// defined inside a render — so a keystroke never remounts an input and drops
// focus (see the TarifContext note in app/admin/fees/page.tsx).
//
// Edits are kept as overrides on top of the loaded rows, never copied into
// state, so a refetch (the page bumps `refreshKey` after "Simpan Tarif") can
// refresh the "Jumlah biasa" hints without wiping what the admin is typing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { RupiahInput } from "@/components/ui/rupiah-input";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, userMessage } from "@/lib/api/client-errors";
import { sendJson } from "@/lib/api/send-json";
import { formatRupiah } from "@/lib/format";
import { MAX_FEE_AMOUNT } from "@/lib/validations/fee-structure";

type BundleProgram = { id: string; code: string; name: string; type: string; status: string };
type BundleComponent = { id: string; code: string; label: string };
type ProgramFee = { programId: string; feeComponentId: string; amount: number };
type BundleRow = {
  id: string;
  schoolProgramId: string;
  daycareProgramId: string;
  feeComponentId: string;
  amount: number;
  status: string;
};
type BundleData = {
  canEdit: boolean;
  programs: BundleProgram[];
  components: BundleComponent[];
  programFees: ProgramFee[];
  bundles: BundleRow[];
};

// `key` is the academic year the answer belongs to: switching year derives
// "loading" from a mismatch instead of resetting state from an effect.
type Answer = { key: string; status: "ready" | "error" | "forbidden"; data: BundleData | null };
type Edits = { key: string; values: Record<string, number | null> };

type Cell = {
  cellKey: string;
  schoolProgram: BundleProgram;
  daycareProgram: BundleProgram;
  component: BundleComponent;
  usual: number;
  baseline: number | null;
};
type Block = { daycareProgram: BundleProgram; cells: Cell[] };

const SCHOOL_TYPE = "SEMESTER";
const DAYCARE_TYPE = "YEAR_ROUND";
const SAVED_MESSAGE = "Harga paket disimpan. Draf tagihan yang sudah dibuat perlu dihitung ulang.";

const cellKeyOf = (schoolId: string, daycareId: string, componentId: string) =>
  `${schoolId}|${daycareId}|${componentId}`;

/** The first field message of a validateBody 400 reads better than its "Validasi gagal" headline. */
function saveErrorMessage(err: unknown): string {
  const fieldMessage = err instanceof ApiError ? err.fieldErrors[0]?.message : undefined;
  return fieldMessage ?? userMessage(err, "Gagal menyimpan harga paket");
}

function buildBlocks(data: BundleData): Block[] {
  const feeOf = new Map(data.programFees.map((f) => [`${f.programId}|${f.feeComponentId}`, f.amount]));
  const bundleOf = new Map(
    data.bundles.map((b) => [cellKeyOf(b.schoolProgramId, b.daycareProgramId, b.feeComponentId), b]),
  );
  // A program stays listed while an ACTIVE price still points at it, so that
  // price can be cleared even after the program was switched off.
  const hasActiveBundle = (programId: string) =>
    data.bundles.some(
      (b) => b.status === "ACTIVE" && (b.schoolProgramId === programId || b.daycareProgramId === programId),
    );
  const listed = (p: BundleProgram, type: string) =>
    p.type === type && (p.status === "ACTIVE" || hasActiveBundle(p.id));
  const schools = data.programs.filter((p) => listed(p, SCHOOL_TYPE));
  const daycares = data.programs.filter((p) => listed(p, DAYCARE_TYPE));

  const blocks: Block[] = [];
  for (const daycareProgram of daycares) {
    const cells: Cell[] = [];
    for (const schoolProgram of schools) {
      for (const component of data.components) {
        const schoolFee = feeOf.get(`${schoolProgram.id}|${component.id}`);
        const daycareFee = feeOf.get(`${daycareProgram.id}|${component.id}`);
        const cellKey = cellKeyOf(schoolProgram.id, daycareProgram.id, component.id);
        const bundle = bundleOf.get(cellKey);
        const shared = schoolFee !== undefined && daycareFee !== undefined && schoolFee + daycareFee > 0;
        if (!shared && !bundle) continue;
        cells.push({
          cellKey,
          schoolProgram,
          daycareProgram,
          component,
          usual: (schoolFee ?? 0) + (daycareFee ?? 0),
          // A cleared (INACTIVE) price shows empty: typing a value reactivates it.
          baseline: bundle && bundle.status === "ACTIVE" ? bundle.amount : null,
        });
      }
    }
    if (cells.length > 0) blocks.push({ daycareProgram, cells });
  }
  return blocks;
}

export function BundleFeesSection({
  academicYearId,
  refreshKey,
  onDirtyChange,
}: {
  academicYearId: string;
  /** Bumped by the page after "Simpan Tarif" succeeds, so the "Jumlah biasa" hints refetch. */
  refreshKey: number;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [edits, setEdits] = useState<Edits>({ key: academicYearId, values: {} });
  const [reloadToken, setReloadToken] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** Resolves true when `key`'s rows were read and stored. */
  const load = useCallback(async (key: string, isCancelled: () => boolean): Promise<boolean> => {
    const keep = (prev: Answer | null, next: Answer): Answer =>
      // A failed refresh must not blank a table the admin is already working in.
      next.status !== "ready" && prev?.key === key && prev.status === "ready" ? prev : next;
    try {
      const res = await fetch(`/api/fee-bundles?academicYearId=${encodeURIComponent(key)}`);
      if (isCancelled()) return false;
      if (res.status === 403) {
        setAnswer((prev) => keep(prev, { key, status: "forbidden", data: null }));
        return false;
      }
      if (!res.ok) throw new Error(`fee-bundles read failed (${res.status})`);
      const data = (await res.json()) as BundleData;
      if (isCancelled()) return false;
      if (!Array.isArray(data?.programs) || !Array.isArray(data.components) || !Array.isArray(data.programFees) || !Array.isArray(data.bundles)) {
        throw new Error("fee-bundles read returned an unexpected shape");
      }
      setAnswer({ key, status: "ready", data });
      return true;
    } catch (err) {
      if (isCancelled()) return false;
      console.error("[bundle-fees-section] fetch failed", err);
      setAnswer((prev) => keep(prev, { key, status: "error", data: null }));
      toast.error("Gagal memuat harga paket");
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load(academicYearId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [academicYearId, refreshKey, reloadToken, load]);

  const current = answer?.key === academicYearId ? answer : null;
  const data = current?.status === "ready" ? current.data : null;
  const canEdit = data?.canEdit ?? false;
  const blocks = useMemo(() => (data ? buildBlocks(data) : []), [data]);
  const editValues = edits.key === academicYearId ? edits.values : null;

  const valueOf = (cell: Cell): number | null =>
    editValues && cell.cellKey in editValues ? (editValues[cell.cellKey] ?? null) : cell.baseline;

  const changedCells = blocks.flatMap((b) => b.cells).filter((cell) => valueOf(cell) !== cell.baseline);
  const dirty = changedCells.length > 0;

  const onDirtyRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyRef.current = onDirtyChange;
  });
  useEffect(() => {
    onDirtyRef.current(dirty);
  }, [dirty]);
  useEffect(() => () => onDirtyRef.current(false), []);

  function setCell(cellKey: string, value: number | null) {
    setSaveError(null);
    setEdits((prev) => ({
      key: academicYearId,
      values: { ...(prev.key === academicYearId ? prev.values : {}), [cellKey]: value },
    }));
  }

  async function save() {
    const changes = changedCells.map((cell) => ({
      schoolProgramId: cell.schoolProgram.id,
      daycareProgramId: cell.daycareProgram.id,
      feeComponentId: cell.component.id,
      // Empty only when a saved price was cleared (an empty cell over no price is not a change).
      amount: valueOf(cell),
    }));
    const invalid = changedCells.find((cell) => {
      const v = valueOf(cell);
      return v !== null && (v <= 0 || v > MAX_FEE_AMOUNT);
    });
    if (invalid) {
      const v = valueOf(invalid) as number;
      setSaveError(
        v <= 0
          ? "Harga paket harus lebih dari 0. Kosongkan kolom untuk memakai jumlah biasa."
          : `Harga paket maksimal ${formatRupiah(MAX_FEE_AMOUNT)}`,
      );
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await sendJson(
        "/api/fee-bundles",
        { method: "PUT", body: { academicYearId, changes } },
        "Gagal menyimpan harga paket",
      );
      toast.success(SAVED_MESSAGE);
      // Drop the edits only once the saved rows are back, so the inputs never
      // flash their old values; if the refresh fails the edits stay (saving the
      // same values again is a no-op on the server).
      if (await load(academicYearId, () => false)) setEdits({ key: academicYearId, values: {} });
    } catch (err) {
      setSaveError(saveErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const footer =
    data && canEdit && blocks.length > 0 ? (
      <div className="flex flex-wrap items-center justify-end gap-3">
        {saveError && (
          <p role="alert" className="mr-auto text-small text-destructive">
            {saveError}
          </p>
        )}
        {dirty && <span className="text-small text-muted-foreground">Ada perubahan belum disimpan</span>}
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          <Save size={14} className="mr-1.5" aria-hidden="true" /> {saving ? "Menyimpan..." : "Simpan harga paket"}
        </Button>
      </div>
    ) : undefined;

  return (
    <SectionCard
      className="mt-section"
      title="Harga paket sekolah + daycare"
      description="Isi kalau anak yang ikut sekolah dan daycare ditagih satu harga paket. Kosongkan untuk memakai jumlah biasa: tarif sekolah + tarif daycare."
      contentClassName="space-y-field"
      footer={footer}
    >
      {!current && <Skeleton className="h-24 rounded-xl" />}

      {current?.status === "forbidden" && (
        <p className="text-small text-muted-foreground">Harga paket hanya terlihat oleh peran dengan akses biaya.</p>
      )}

      {current?.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-small text-muted-foreground">Harga paket tidak bisa dimuat sekarang.</p>
          <Button variant="outline" size="sm" onClick={() => setReloadToken((n) => n + 1)}>
            Coba lagi
          </Button>
        </div>
      )}

      {data && blocks.length === 0 && (
        <p className="text-small text-muted-foreground">
          Harga paket butuh satu program sekolah dan satu program daycare yang sama-sama punya tarif untuk komponen biaya
          yang sama di tahun ajaran ini. Isi dan simpan tarif program di atas dulu.
        </p>
      )}

      {data && blocks.length > 0 && !canEdit && (
        <p className="text-small text-muted-foreground">
          Anda hanya bisa melihat harga paket. Mengubahnya butuh izin mengedit biaya.
        </p>
      )}

      {data &&
        blocks.map((block) => (
          <div key={block.daycareProgram.id} className="space-y-2">
            <h3 className="text-body font-medium">Daycare: {block.daycareProgram.name}</h3>
            {/*
              One table, one set of inputs. From `sm` up it is the plain four-column
              table. Below `sm` the same elements turn into stacked blocks (`max-sm:`
              only, so nothing changes at >= 640px): a row becomes name + component,
              then "Jumlah biasa", then "Harga paket" over a full-width input, so the
              field the admin must fill never scrolls off a 390px screen. The labels
              come from `data-label` through a CSS ::before; each input keeps its own
              aria-label, and the header row is hidden once the columns are gone.
            */}
            <Table aria-label={`Harga paket untuk ${block.daycareProgram.name}`} className="max-sm:block">
              <TableHeader className="max-sm:hidden">
                <TableRow>
                  <TableHead>Program sekolah</TableHead>
                  <TableHead>Komponen</TableHead>
                  <TableHead className="text-right">Jumlah biasa</TableHead>
                  <TableHead className="text-right">Harga paket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="max-sm:block">
                {block.cells.map((cell) => (
                  <TableRow key={cell.cellKey} className="max-sm:flex max-sm:flex-col max-sm:gap-1.5 max-sm:px-2 max-sm:py-3">
                    <TableCell className="whitespace-normal font-medium max-sm:block max-sm:p-0">
                      {cell.schoolProgram.name}
                    </TableCell>
                    <TableCell className="whitespace-normal max-sm:-mt-1 max-sm:block max-sm:p-0 max-sm:text-muted-foreground">
                      {cell.component.label}
                    </TableCell>
                    <TableCell
                      data-label="Jumlah biasa"
                      className="text-right font-currency tabular-nums text-muted-foreground max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:gap-3 max-sm:p-0 max-sm:before:font-sans max-sm:before:content-[attr(data-label)]"
                    >
                      {formatRupiah(cell.usual)}
                    </TableCell>
                    <TableCell
                      data-label="Harga paket"
                      className="max-sm:flex max-sm:flex-col max-sm:gap-1 max-sm:p-0 max-sm:before:text-sm max-sm:before:font-medium max-sm:before:text-foreground max-sm:before:content-[attr(data-label)]"
                    >
                      <RupiahInput
                        aria-label={`Harga paket ${cell.component.label}, ${cell.schoolProgram.name} + ${cell.daycareProgram.name}`}
                        placeholder="Belum diisi"
                        value={valueOf(cell)}
                        onChange={(v) => setCell(cell.cellKey, v)}
                        disabled={!canEdit || saving}
                        className="ml-auto max-w-44 max-sm:max-w-none"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
    </SectionCard>
  );
}
