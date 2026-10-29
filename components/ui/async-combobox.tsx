"use client"

import * as React from "react"
import { ChevronDown, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

type FetchState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; results: T[] }
  | { kind: "error" }

export interface AsyncComboboxProps<T> {
  value: T | null
  onChange: (item: T | null) => void
  fetcher: (query: string, signal: AbortSignal) => Promise<T[]>
  getKey: (item: T) => string
  getLabel: (item: T) => string
  /**
   * Trigger-only label override — falls back to `getLabel`. Extension
   * point for a picker whose collapsed trigger names more than a list row
   * does (class-section-picker appends the campus, which is otherwise only
   * the group heading).
   */
  getTriggerLabel?: (item: T) => string
  renderItem?: (item: T) => React.ReactNode
  /**
   * Rows that stay visible but cannot be chosen (e.g. a full class). The
   * caller's `renderItem` should say why — a greyed row with no reason reads
   * as a bug.
   */
  isItemDisabled?: (item: T) => boolean
  /**
   * Optional grouping key — renders one `CommandGroup` per distinct value,
   * groups sorted alphabetically (`localeCompare`), matching
   * class-section-picker's original `groupByCampus` order (and its
   * still-separate `ClassSectionMultiPicker`, which sorts the same way).
   * Extension point for pickers whose results have a natural section.
   */
  getGroup?: (item: T) => string
  /**
   * Rendered under the result list — e.g. a "showing N of M" notice. Given
   * the in-view `results`; a caller tracking a server-side total (which
   * doesn't fit in `T[]`) closes over its own state instead of using the
   * argument. Extension point so parent-picker / student-picker keep their
   * truncation notice without AsyncCombobox knowing about pagination.
   */
  footer?: (results: T[]) => React.ReactNode
  placeholder?: string
  searchPlaceholder?: string
  /** Shown before the user has typed enough to satisfy `minQueryLength`. */
  idleText?: string
  /** Static text, or a function of the trimmed query — a picker naming the
   *  query back to the user ("Tidak ada wali cocok dengan "...") passes a
   *  function; the default is the fixed string the spec asks for. */
  emptyText?: React.ReactNode | ((query: string) => React.ReactNode)
  /** Error-row text. Default matches the primitive's spec copy; a picker
   *  that named its domain in the old copy (e.g. "Gagal memuat data wali.
   *  Coba lagi.") passes its own to keep that copy unchanged. */
  errorText?: React.ReactNode
  /** aria-label for the clear (X) button. Default "Hapus pilihan". */
  clearAriaLabel?: string
  debounceMs?: number
  minQueryLength?: number
  disabled?: boolean
  required?: boolean
  id?: string
  clearable?: boolean
  "aria-invalid"?: React.AriaAttributes["aria-invalid"]
  className?: string
}

/**
 * Generic async-search combobox: shadcn Popover + Command, a debounced
 * fetcher, and explicit idle/loading/error/empty states. Built to rebase
 * `components/admin/{parent,student,class-section}-picker.tsx` onto one
 * implementation (docs/cycles/2026-09-26-admin-ui-standard-c1.md, T2).
 */
export function AsyncCombobox<T>({
  value,
  onChange,
  fetcher,
  getKey,
  getLabel,
  getTriggerLabel,
  renderItem,
  isItemDisabled,
  getGroup,
  footer,
  placeholder = "Pilih...",
  searchPlaceholder = "Cari...",
  idleText = "Mulai mengetik untuk mencari.",
  emptyText = "Tidak ditemukan",
  errorText = "Gagal memuat. Coba lagi.",
  clearAriaLabel = "Hapus pilihan",
  debounceMs = 250,
  minQueryLength = 0,
  disabled,
  required,
  id,
  clearable = true,
  "aria-invalid": ariaInvalid,
  className,
}: AsyncComboboxProps<T>) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [state, setState] = React.useState<FetchState<T>>({ kind: "idle" })
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  // Guards against a stale response landing after a newer request started —
  // belt-and-suspenders alongside the AbortController below (a fetcher that
  // ignores its `signal` would otherwise still resolve the old value in).
  const requestId = React.useRef(0)
  // The in-flight request's controller, shared between the debounce effect
  // and `handleRetry` so either one can abort whatever the other started —
  // otherwise a retry's own controller was never stored anywhere, so it
  // outlived unmount, a popover close, or the next keystroke.
  const abortRef = React.useRef<AbortController | null>(null)

  const runFetch = React.useCallback(
    (q: string, signal: AbortSignal) => {
      const thisRequest = ++requestId.current
      setState({ kind: "loading" })
      fetcher(q, signal)
        .then((results) => {
          if (signal.aborted || thisRequest !== requestId.current) return
          setState({ kind: "ok", results })
        })
        .catch((err) => {
          if (signal.aborted || err?.name === "AbortError") return
          if (thisRequest !== requestId.current) return
          setState({ kind: "error" })
        })
    },
    [fetcher]
  )

  React.useEffect(() => {
    if (!open) return
    // Compare the trimmed length — whitespace-only input ("  ") should stay
    // idle exactly like empty input, not read as `minQueryLength` characters
    // of real query and fire a fetch for it.
    if (query.trim().length < minQueryLength) {
      setState({ kind: "idle" })
      return
    }

    const timer = setTimeout(() => {
      const controller = new AbortController()
      abortRef.current = controller
      runFetch(query, controller.signal)
    }, debounceMs)
    return () => {
      clearTimeout(timer)
      // Whatever request is current when this cleanup runs — a debounced
      // fetch that already started, or a retry's — gets aborted here. This
      // fires on the next keystroke (deps change), on close (`open` flips),
      // and on unmount, which is exactly the set of "outlives" cases a bare
      // per-call controller missed.
      abortRef.current?.abort()
    }
  }, [open, query, minQueryLength, debounceMs, runFetch])

  function handleSelect(item: T) {
    onChange(item)
    setOpen(false)
    setQuery("")
  }

  function handleClear(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    onChange(null)
    setQuery("")
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleRetry() {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    runFetch(query, controller.signal)
  }

  const triggerLabel = value
    ? (getTriggerLabel ?? getLabel)(value)
    : placeholder

  const groups = React.useMemo(() => {
    if (state.kind !== "ok" || !getGroup) return null
    const byGroup = new Map<string, T[]>()
    for (const item of state.results) {
      const g = getGroup(item)
      if (!byGroup.has(g)) byGroup.set(g, [])
      byGroup.get(g)!.push(item)
    }
    // Alphabetical, not first-seen — matches groupByCampus's
    // `Object.keys(byCampus).sort((a, b) => a.localeCompare(b))`.
    const order = Array.from(byGroup.keys()).sort((a, b) => a.localeCompare(b))
    return { order, byGroup }
  }, [state, getGroup])

  function renderItemRow(item: T) {
    return (
      <CommandItem
        key={getKey(item)}
        value={`${getLabel(item)} ${getKey(item)}`}
        disabled={isItemDisabled?.(item)}
        onSelect={() => handleSelect(item)}
      >
        {renderItem ? renderItem(item) : getLabel(item)}
      </CommandItem>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (disabled) return
          setOpen(next)
        }}
      >
        <PopoverTrigger
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          aria-required={required || undefined}
          disabled={disabled}
          className={cn(
            "flex h-9 flex-1 [@media(pointer:coarse)]:min-h-11 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-hidden transition-colors hover:bg-accent/30 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate text-left">{triggerLabel}</span>
          <ChevronDown
            size={14}
            className="pointer-events-none shrink-0 opacity-50"
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-[--anchor-width] min-w-[var(--anchor-width)] p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder={searchPlaceholder}
            />
            <CommandList>
              {state.kind === "idle" && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {idleText}
                </div>
              )}
              {state.kind === "loading" && (
                <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                  <Spinner aria-hidden />
                  <span>Memuat...</span>
                </div>
              )}
              {state.kind === "error" && (
                <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-sm text-muted-foreground">
                  <span>{errorText}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRetry}
                  >
                    Coba lagi
                  </Button>
                </div>
              )}
              {state.kind === "ok" && state.results.length === 0 && (
                <CommandEmpty>
                  {typeof emptyText === "function"
                    ? emptyText(query.trim())
                    : emptyText}
                </CommandEmpty>
              )}
              {state.kind === "ok" && state.results.length > 0 && (
                <>
                  {groups
                    ? groups.order.map((g) => (
                        <CommandGroup key={g} heading={g}>
                          {groups.byGroup.get(g)!.map((item) => renderItemRow(item))}
                        </CommandGroup>
                      ))
                    : state.results.map((item) => renderItemRow(item))}
                  {footer?.(state.results)}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {clearable && value && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={clearAriaLabel}
          onClick={handleClear}
          disabled={disabled}
          className="shrink-0 text-muted-foreground"
        >
          <X size={14} />
        </Button>
      )}
    </div>
  )
}
