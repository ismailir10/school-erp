"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface DataTableToolbarProps {
  searchPlaceholder?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (search: string) => void;
  onSearchChange?: (search: string) => void;
  onReset?: () => void;
  /**
   * Marks the Reset button active for filters this toolbar does not own.
   * Needed when a control cannot live in `filters` — e.g. the grouped Kelas
   * select on /admin/student-attendance, which needs SelectGroup headings that
   * the flat `{value,label}[]` shape here cannot express. Without this, Reset
   * renders disabled while that filter is the only active one.
   */
  hasExternalFilter?: boolean;
  filters?: {
    key: string;
    label: string;
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
    resetValue?: string;
  }[];
  actions?: React.ReactNode;
}

export function DataTableToolbar({
  searchPlaceholder = "Cari...",
  value,
  defaultValue = "",
  onValueChange,
  onSearchChange,
  onReset,
  filters,
  hasExternalFilter = false,
  actions,
}: DataTableToolbarProps) {
  const [internalSearch, setInternalSearch] = useState(defaultValue);
  const isControlled = value !== undefined;
  const search = value ?? internalSearch;
  const hasSearch = Boolean(onValueChange || onSearchChange || value !== undefined);
  const filterIsActive = (filter: NonNullable<DataTableToolbarProps["filters"]>[number]) => {
    const resetValue = filter.resetValue ?? filter.options[0]?.value ?? "";
    return filter.value !== resetValue;
  };
  const canReset =
    Boolean(search) || Boolean(filters?.some(filterIsActive)) || hasExternalFilter;

  const setSearch = (nextSearch: string) => {
    if (!isControlled) {
      setInternalSearch(nextSearch);
    }
    if (onValueChange) {
      onValueChange(nextSearch);
    } else if (isControlled) {
      onSearchChange?.(nextSearch);
    }
  };

  const handleReset = () => {
    setSearch("");
    filters?.forEach((filter) => {
      const resetValue = filter.resetValue ?? filter.options[0]?.value;
      if (resetValue !== undefined && filter.value !== resetValue) {
        filter.onChange(resetValue);
      }
    });
    onReset?.();
  };

  // Debounce search
  useEffect(() => {
    if (isControlled && !onValueChange) return;
    if (!onSearchChange) return;
    const timeout = setTimeout(() => {
      onSearchChange(search);
    }, 300);
    return () => clearTimeout(timeout);
  }, [isControlled, onValueChange, search, onSearchChange]);

  return (
    // Phone: a two-column grid (search spans both, dropdowns pair up, an odd
    // last dropdown spans both, reset and actions get their own row). Tablet
    // up: the single row it always was.
    <div className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:flex-row">
      {hasSearch && (
        <div className="relative col-span-2 max-w-sm flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            // The search box has no visible label by design — the magnifier
            // icon carries the affordance. A placeholder is not an accessible
            // name (it disappears on input), so name the control explicitly.
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      )}

      {filters?.map((filter, index) => (
        <Select
          key={filter.key}
          value={filter.value}
          onValueChange={(v) => {
            if (v !== null) filter.onChange(v);
          }}
        >
          {/* `filter.value` always matches one of `filter.options`, so the
              SelectValue placeholder never renders and cannot name the
              control. Name the trigger explicitly instead. "Filter X" rather
              than bare "X": a page often has a form field of the same name
              (e.g. Status), and the accessible name should say which one this
              is. */}
          <SelectTrigger
            aria-label={`Filter ${filter.label}`}
            className={cn(
              "h-9 w-full sm:w-40",
              index === filters.length - 1 && filters.length % 2 === 1 && "col-span-2 sm:col-span-1",
            )}
          >
            <SelectValue placeholder={filter.label} />
          </SelectTrigger>
          <SelectContent>
            {filter.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      {canReset && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="col-span-2 h-9 w-full sm:col-span-1 sm:w-auto"
          onClick={handleReset}
        >
          <X size={14} className="mr-1.5" aria-hidden="true" />
          Atur Ulang
        </Button>
      )}

      {actions && <div className="col-span-2 ml-auto flex gap-2">{actions}</div>}
    </div>
  );
}
