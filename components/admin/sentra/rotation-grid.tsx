"use client";

import { TriangleAlert } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { sentraLabel } from "@/lib/sentra/rotation";

import {
  cellKey,
  duplicateNote,
  findDuplicates,
  findInactiveCells,
  inactiveNote,
  type GridState,
  type SentraOption,
} from "./grid-utils";

const NONE = "__none__";

/**
 * Putaran grid: rows = days, columns = classes, cell = sentra select.
 * Duplicate sentra in a row and nonaktif sentra get the warning style plus
 * a note under the grid (colour is never the only cue).
 */
export function RotationGrid({
  grid,
  onChange,
  labels,
  classes,
  sentra,
  startDate,
  readOnly,
}: {
  grid: GridState;
  onChange: (key: string, sentraId: string | null) => void;
  labels: string[];
  classes: { classSectionId: string; name: string }[];
  sentra: SentraOption[];
  startDate: string;
  readOnly: boolean;
}) {
  const classIds = classes.map((c) => c.classSectionId);
  const dup = findDuplicates(grid, labels.length, classIds);
  const inactive = findInactiveCells(grid, labels.length, classIds, sentra);
  const active = sentra.filter((s) => s.status === "ACTIVE");

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border" tabIndex={0} role="region" aria-label="Tabel putaran, geser untuk melihat semua kelas">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Sentra per kelas untuk setiap hari putaran</caption>
          <thead>
            <tr className="bg-muted/50">
              <th scope="col" className="sticky left-0 z-10 min-w-36 bg-muted px-3 py-2 text-left font-medium">
                Hari
              </th>
              {classes.map((c) => (
                <th key={c.classSectionId} scope="col" className="min-w-44 px-3 py-2 text-left font-medium">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, d) => (
              <tr key={d} className="border-t">
                <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-background px-3 py-2 text-left font-medium">
                  {label}
                </th>
                {classes.map((c) => {
                  const key = cellKey(d, c.classSectionId);
                  const value = grid[key] ?? null;
                  const isInactive = inactive.cells.has(key);
                  const warn = isInactive || dup.cells.has(key);
                  const current = value ? sentra.find((s) => s.id === value) : undefined;
                  return (
                    <td key={c.classSectionId} className="px-2 py-1.5">
                      <Select
                        value={value ?? NONE}
                        onValueChange={(v) => onChange(key, !v || v === NONE ? null : v)}
                        disabled={readOnly}
                      >
                        <SelectTrigger
                          aria-label={`${c.name}, ${label}`}
                          data-warning={warn ? "true" : undefined}
                          className={cn(
                            "w-full",
                            warn && "border-warning bg-warning-subtle text-warning-text",
                          )}
                        >
                          {warn && <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />}
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>—</SelectItem>
                          {active.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {sentraLabel(s.name)}
                            </SelectItem>
                          ))}
                          {isInactive && current && (
                            <SelectItem value={current.id}>{sentraLabel(current.name)} (nonaktif)</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div aria-live="polite" className="space-y-1 text-sm text-warning-text">
        {inactive.sentraIds.map((id) => (
          <p key={id}>{inactiveNote(id, sentra)}</p>
        ))}
        {dup.notes.map((n) => (
          <p key={`${n.dayIndex}:${n.sentraId}`}>{duplicateNote(n, sentra, startDate)}</p>
        ))}
      </div>
    </div>
  );
}
