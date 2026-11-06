"use client";

import { Checkbox } from "@/components/ui/checkbox";

/** Multi-select as a labelled checkbox group (no combobox needed for ≤ ~50 rows). */
export function CheckList({
  legend,
  options,
  value,
  onChange,
  emptyText,
  error,
  describedBy,
}: {
  legend: string;
  options: { id: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
  error?: string;
  describedBy?: string;
}) {
  const toggle = (id: string, checked: boolean) =>
    onChange(checked ? [...value, id] : value.filter((v) => v !== id));
  return (
    <fieldset className="space-y-2" aria-describedby={describedBy}>
      <legend className="text-sm font-medium">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="max-h-48 overflow-y-auto rounded-md border">
          <ul className="divide-y">
            {options.map((o) => (
              <li key={o.id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                  <Checkbox
                    checked={value.includes(o.id)}
                    onCheckedChange={(c) => toggle(o.id, c === true)}
                  />
                  <span className="min-w-0 break-words">{o.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p id={describedBy} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
