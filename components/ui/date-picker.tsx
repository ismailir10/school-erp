"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { addYears, endOfYear, format, isValid, max as latest, min as earliest, parse, startOfYear } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import type { Matcher } from "react-day-picker"

import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/format"
import { useCoarsePointer } from "@/hooks/use-coarse-pointer"
import { buttonVariants } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const DATE_FORMAT = "yyyy-MM-dd"

/**
 * Parse a "YYYY-MM-DD" string in LOCAL time. `new Date("YYYY-MM-DD")` is
 * banned here on purpose — that constructor form is UTC, so it shifts a day
 * back for any timezone west of UTC (WIB is +7, so this repo never sees it,
 * but a contributor testing from another timezone would). `date-fns#parse`
 * with an explicit reference date always resolves in local time.
 */
function parseLocalDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const parsed = parse(value, DATE_FORMAT, new Date())
  return isValid(parsed) ? parsed : undefined
}

function formatLocalDate(date: Date): string {
  return format(date, DATE_FORMAT)
}

export interface DatePickerProps {
  /** "YYYY-MM-DD", or "" for no value — same shape as the native input. */
  value: string
  onChange: (value: string) => void
  id?: string
  name?: string
  /** "YYYY-MM-DD" bounds, inclusive. */
  min?: string
  max?: string
  disabled?: boolean
  required?: boolean
  placeholder?: string
  className?: string
  "aria-invalid"?: React.AriaAttributes["aria-invalid"]
  "aria-describedby"?: string
  /** For pickers without a visible <label> (e.g. filter bars). */
  "aria-label"?: string
  "data-testid"?: string
}

/**
 * Drop-in replacement for `<Input type="date" value onChange={e =>
 * set(e.target.value)}>`. Renders the native input on a coarse (touch)
 * pointer — the platform date picker is already good there — and a
 * shadcn Button + Calendar popover on a fine pointer (mouse/trackpad).
 *
 * `id` stays on the one focusable/interactive element in both modes, so
 * `<FieldLabel htmlFor>` keeps working no matter which branch rendered.
 */
export function DatePicker({
  value,
  onChange,
  id,
  name,
  min,
  max,
  disabled,
  required,
  placeholder = "Pilih tanggal",
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: DatePickerProps) {
  const coarse = useCoarsePointer()
  const [open, setOpen] = React.useState(false)

  if (coarse) {
    return (
      <Input
        type="date"
        id={id}
        name={name}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel}
        data-testid={testId}
        className={className}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  const selectedDate = parseLocalDate(value)
  const minDate = parseLocalDate(min)
  const maxDate = parseLocalDate(max)
  const disabledMatchers: Matcher[] = []
  if (minDate) disabledMatchers.push({ before: minDate })
  if (maxDate) disabledMatchers.push({ after: maxDate })
  // The dropdown caption only offers years between startMonth and endMonth,
  // and react-day-picker's default end is the current year — which would
  // make next year's semester end or due date unreachable on a mouse. Span
  // min/max when given, else today − 20 … + 5 years (every caller — birth
  // dates of children, hire dates, billing and attendance ranges — sits
  // inside it), always wide enough to include the current value.
  const today = new Date()
  const rangeStart = startOfYear(
    earliest([minDate ?? addYears(today, -20), ...(selectedDate ? [selectedDate] : [])])
  )
  const rangeEnd = endOfYear(
    latest([maxDate ?? addYears(today, 5), ...(selectedDate ? [selectedDate] : [])])
  )

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return
        setOpen(next)
      }}
    >
      <PopoverTrigger
        id={id}
        name={name}
        type="button"
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel}
        data-testid={testId}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "w-full justify-start gap-2 px-2.5 font-normal",
          !selectedDate && "text-muted-foreground",
          className
        )}
      >
        <CalendarIcon aria-hidden="true" className="size-4 shrink-0 opacity-60" />
        <span className="truncate">
          {selectedDate ? formatDate(value) : placeholder}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate ?? minDate ?? maxDate ?? new Date()}
          onSelect={(date) => {
            // Clicking the selected day again deselects it; honour that as
            // "clear" on optional fields, like emptying the native input.
            if (!date) {
              if (!required) {
                onChange("")
                setOpen(false)
              }
              return
            }
            onChange(formatLocalDate(date))
            setOpen(false)
          }}
          disabled={disabledMatchers.length ? disabledMatchers : undefined}
          locale={idLocale}
          captionLayout="dropdown"
          startMonth={rangeStart}
          endMonth={rangeEnd}
        />
        {selectedDate && !required && (
          <div className="border-t p-2">
            <button
              type="button"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full")}
              onClick={() => {
                onChange("")
                setOpen(false)
              }}
            >
              Hapus tanggal
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
