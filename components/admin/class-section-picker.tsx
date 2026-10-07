"use client";

import { useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatClassOptionLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ClassSection = {
  id: string;
  name: string;
  program: { name: string };
  academicYear: { name: string };
  campus: { name: string };
  _count: { enrollments: number };
  capacity: number;
};

function label(s: ClassSection) {
  return formatClassOptionLabel({
    name: s.name,
    academicYearName: s.academicYear.name,
    enrolled: s._count.enrollments,
    capacity: s.capacity,
  });
}

// A class at capacity cannot take another student (the enrol and promote
// routes both refuse it), so the single-select shows it disabled instead of
// letting the admin pick it and bounce off a server error.
function isFull(s: ClassSection) {
  return s._count.enrollments >= s.capacity;
}

// Class names are campus-free ("TK B 3", not "TK B Metland 3") — kampus was
// stripped this cycle because it is already its own column. Grouping by
// kampus keeps that context visible as structure instead of re-inflating
// every option label, and keeps two campuses' same-numbered classes (now
// legal under the per-campus unique key) unambiguous in the picker.
function groupByCampus(sections: ClassSection[]) {
  const byCampus = sections.reduce<Record<string, ClassSection[]>>((acc, s) => {
    (acc[s.campus.name] ??= []).push(s);
    return acc;
  }, {});
  const campusNames = Object.keys(byCampus).sort((a, b) => a.localeCompare(b));
  return { byCampus, campusNames };
}

// ------------------------------------------------------------------
// Single-select — rebased onto the shared AsyncCombobox primitive
// (components/ui/async-combobox.tsx). The section list is small and
// pre-fetched by the caller, so the "fetcher" is a synchronous client-side
// filter wrapped in a resolved promise — no server round-trip per
// keystroke, `debounceMs={0}` so it stays instant like the original cmdk
// client-side filtering did.
// ------------------------------------------------------------------

export function ClassSectionCombobox({
  id,
  sections,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id?: string;
  sections: ClassSection[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const selected = sections.find((s) => s.id === value) ?? null;

  // Kampus is the group heading only — it is deliberately NOT part of each
  // item's search text. Both campus names share the "An Nisaa' Sekolahku "
  // prefix, so folding it into the match text made typing "Aster" still
  // match every Metland row (confirmed on preview). Searching matches the
  // class name + year, which is what an admin types.
  const filterSections = useCallback(
    async (query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return sections;
      return sections.filter((s) => label(s).toLowerCase().includes(q));
    },
    [sections],
  );

  return (
    <AsyncCombobox<ClassSection>
      id={id}
      value={selected}
      onChange={(s) => onChange(s?.id ?? "")}
      fetcher={filterSections}
      getKey={(s) => s.id}
      getLabel={(s) => label(s)}
      // The trigger names the kampus explicitly — in the grouped list it is
      // the group heading, but once collapsed there is no other cue.
      getTriggerLabel={(s) => `${label(s)} · ${s.campus.name}`}
      getGroup={(s) => s.campus.name}
      isItemDisabled={isFull}
      renderItem={(s) => (
        <>
          <span className="truncate">{label(s)}</span>
          {isFull(s) && (
            <Badge variant="secondary" className="ml-auto shrink-0">
              Penuh
            </Badge>
          )}
        </>
      )}
      placeholder={placeholder}
      searchPlaceholder="Cari kelas..."
      emptyText="Tidak ada kelas yang cocok."
      debounceMs={0}
      disabled={disabled}
      required
      clearable={false}
    />
  );
}

// ------------------------------------------------------------------
// Multi-select — same Popover + Command shell + campus grouping as the
// single-select above, but each CommandItem toggles membership instead of
// replacing the value and closing. Built for the billing-run wizard's step
// 1 class scope. No existing multi-select combobox precedent in the repo
// (checked components/ui + components/admin), so this defines the pattern:
// explicit `role="listbox"`/`aria-multiselectable` on the list and
// `role="option"`/`aria-selected` per item, since cmdk itself sets none of
// cmdk's own primitives (Command/CommandList/CommandItem render bare divs
// with no ARIA roles baked in — confirmed against node_modules/cmdk).
// ------------------------------------------------------------------

export function ClassSectionMultiPicker({
  id,
  sections,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id?: string;
  sections: ClassSection[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedSet = new Set(value);
  const { byCampus, campusNames } = groupByCampus(sections);

  function toggle(sectionId: string) {
    if (selectedSet.has(sectionId)) {
      onChange(value.filter((v) => v !== sectionId));
    } else {
      onChange([...value, sectionId]);
    }
  }

  // Trigger summary: none → placeholder; one → that class's label; many →
  // count. Keeps the collapsed trigger legible without truncating a list of
  // names — the expanded popover is where the full selection lives.
  let triggerLabel: string = placeholder;
  if (value.length === 1) {
    const only = sections.find((s) => s.id === value[0]);
    triggerLabel = only ? label(only) : placeholder;
  } else if (value.length > 1) {
    triggerLabel = `${value.length} kelas dipilih`;
  }

  const visibleIds = sections.map((s) => s.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((sid) => selectedSet.has(sid));

  function selectAll() {
    const merged = new Set(value);
    visibleIds.forEach((sid) => merged.add(sid));
    onChange(Array.from(merged));
  }

  function clearAll() {
    const visible = new Set(visibleIds);
    onChange(value.filter((v) => !visible.has(v)));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={value.length > 0 ? triggerLabel : placeholder}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-hidden transition-colors hover:bg-accent/30 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          value.length === 0 && "text-muted-foreground",
        )}
      >
        <span className="truncate text-left">{triggerLabel}</span>
        <ChevronDown size={14} className="pointer-events-none shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        className="w-[--anchor-width] min-w-[var(--anchor-width)] p-0"
        align="start"
        sideOffset={4}
      >
        <Command>
          <CommandInput placeholder="Cari kelas..." />
          {sections.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
              <span className="text-xs text-muted-foreground">
                {value.length > 0 ? `${value.length} dipilih` : "Belum ada kelas dipilih"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={allVisibleSelected ? clearAll : selectAll}
              >
                {allVisibleSelected ? "Kosongkan" : "Pilih semua"}
              </Button>
            </div>
          )}
          <CommandList role="listbox" aria-multiselectable="true">
            <CommandEmpty>Tidak ada kelas yang cocok.</CommandEmpty>
            {campusNames.map((campusName) => (
              <CommandGroup key={campusName} heading={campusName}>
                {byCampus[campusName].map((s) => {
                  const checked = selectedSet.has(s.id);
                  return (
                    <CommandItem
                      key={s.id}
                      value={`${label(s)} ${s.id}`}
                      role="option"
                      aria-selected={checked}
                      // Multi-select must not close the popover on select —
                      // the admin is expected to toggle several classes in a
                      // row, unlike the single-select variant above.
                      onSelect={() => toggle(s.id)}
                    >
                      <Checkbox
                        checked={checked}
                        className="pointer-events-none"
                        tabIndex={-1}
                        aria-hidden="true"
                      />
                      {label(s)}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
