"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"

const MAX_SAFE = Number.MAX_SAFE_INTEGER

function digitsOnly(raw: string): string {
  return raw.replace(/[^0-9]/g, "")
}

/** A final ".d" / ".dd" with no comma anywhere — an en-US style decimal point. */
const DOT_DECIMAL = /^(.*)\.(\d{1,2})$/

/**
 * The whole-rupiah digits of whatever was typed or pasted, id-ID style:
 * `,` is the decimal separator (it and everything after it is dropped) and
 * `.` is the thousands separator — except a text with no comma that ends in
 * `.` + 1–2 digits (`1500000.5`, `12.50`), which reads as a decimal point and
 * is dropped likewise. `1.500` / `1.500.000` stay thousands. Anything else
 * that is not a digit (letters, spaces, "Rp", a minus sign) is ignored.
 * Leading zeros are kept — callers strip them.
 */
export function parseRupiahText(raw: string): string {
  return splitRupiahText(raw).digits
}

/**
 * Splits typed text into the whole-rupiah `digits` plus the decimal `tail`
 * the user typed after them ("" | "," | ",50" | "." | ".5"). The tail never
 * counts toward the value; the component only keeps it on screen so the next
 * keystroke is read in context (see handleChange).
 */
function splitRupiahText(raw: string): { digits: string; tail: string } {
  const text = raw.trim()
  const comma = text.indexOf(",")
  if (comma !== -1) {
    return {
      digits: digitsOnly(text.slice(0, comma)),
      tail: "," + digitsOnly(text.slice(comma + 1)),
    }
  }
  const dot = DOT_DECIMAL.exec(text)
  if (dot) return { digits: digitsOnly(dot[1]!), tail: "." + dot[2] }
  return { digits: digitsOnly(text), tail: text.endsWith(".") ? "." : "" }
}

/** Drops leading zeros ("007" → "7") but keeps a lone "0". */
function stripLeadingZeros(digits: string): string {
  const stripped = digits.replace(/^0+(?=\d)/, "")
  return stripped || (digits ? "0" : "")
}

function groupThousands(digits: string): string {
  if (!digits) return ""
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

function toDisplay(
  value: number | null | undefined,
  allowNegative = false,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return ""
  const grouped = groupThousands(String(Math.trunc(Math.abs(value))))
  return allowNegative && value < 0 ? `-${grouped}` : grouped
}

/** Count of digit characters at/after `caret` in `str`. */
function digitsFromCaretToEnd(str: string, caret: number): number {
  let count = 0
  for (let i = caret; i < str.length; i++) {
    if (/\d/.test(str[i]!)) count++
  }
  return count
}

/** The index in `str` that leaves exactly `digitsFromEnd` digits after it. */
function caretForDigitsFromEnd(str: string, digitsFromEnd: number): number {
  if (digitsFromEnd <= 0) return str.length
  let seen = 0
  for (let i = str.length - 1; i >= 0; i--) {
    if (/\d/.test(str[i]!)) {
      seen++
      if (seen === digitsFromEnd) return i
    }
  }
  return 0
}

export interface RupiahInputProps
  extends Omit<
    React.ComponentProps<"input">,
    "value" | "onChange" | "type" | "inputMode"
  > {
  value: number | null
  onChange: (value: number | null) => void
  /**
   * Accept a leading minus sign (a correction or discount line). Off by
   * default: every other caller treats a negative amount as invalid, so the
   * minus is ignored.
   */
  allowNegative?: boolean
}

/**
 * Money input with a muted "Rp" adornment, id-ID thousands separators while
 * typing, and an integer (or `null` when empty) emitted to `onChange`.
 *
 * Typed or pasted text is read the id-ID way (see `parseRupiahText`): `,` is
 * the decimal separator and `.` the thousands separator, so `1.500.000,50`
 * is Rp 1.500.000, never 150.000.050. Rupiah are whole numbers, so a
 * fraction is dropped. While the user is typing, a trailing `,` / `.` and
 * the fraction digits after it stay on screen so the next digit is read as
 * part of the fraction instead of being glued onto the amount; blur settles
 * the text to the plain grouped integer.
 *
 * Negative numbers are not supported unless `allowNegative` is set — the
 * field is for amounts, and most callers (fees, keringanan, invoices,
 * salary) treat a negative as invalid.
 */
export function RupiahInput({
  value,
  onChange,
  id,
  name,
  disabled,
  placeholder,
  className,
  required,
  onBlur,
  allowNegative = false,
  ...rest
}: RupiahInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [display, setDisplay] = React.useState(() =>
    toDisplay(value, allowNegative),
  )
  // Tracks the last value WE emitted, so an external reset (a different
  // field recomputing this one, a form reset) resyncs the display, but our
  // own onChange round-trip does not — which would otherwise fight the
  // caret while the user is mid-keystroke.
  const lastEmitted = React.useRef(value)

  React.useEffect(() => {
    if (value !== lastEmitted.current) {
      // A parent that coerces a cleared field to 0 (`v ?? 0`) must not snap
      // "0" back into the box mid-edit — the caret would land before it and
      // the next keystrokes would build "7500000" from "750000". An empty
      // box already reads as zero.
      const clearedToZero = lastEmitted.current === null && value === 0
      lastEmitted.current = value
      if (!clearedToZero) setDisplay(toDisplay(value, allowNegative))
    }
  }, [value, allowNegative])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    const caret = e.target.selectionStart ?? raw.length
    const digitsFromEnd = digitsFromCaretToEnd(raw, caret)

    const negative = allowNegative && /^[^0-9]*-/.test(raw)
    const parsed = splitRupiahText(raw)
    let digits = stripLeadingZeros(parsed.digits)
    let tail = digits ? parsed.tail : ""
    if (digits && Number(digits) > MAX_SAFE) {
      digits = String(MAX_SAFE)
      tail = ""
    }
    const sign = negative ? "-" : ""
    const nextDisplay = sign + groupThousands(digits) + tail
    // A lone "-" is a number in progress, not a value.
    const nextValue = digits ? (negative ? -Number(digits) || 0 : Number(digits)) : null

    setDisplay(nextDisplay)
    lastEmitted.current = nextValue
    onChange(nextValue)

    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el || document.activeElement !== el) return
      const pos = caretForDigitsFromEnd(nextDisplay, digitsFromEnd)
      el.setSelectionRange(pos, pos)
    })
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    // Settle "1.500.000," / "1.500.000.5" to the whole amount the form holds.
    // A lone "-" is not an amount; drop it.
    setDisplay(toDisplay(lastEmitted.current, allowNegative))
    onBlur?.(e)
  }

  return (
    <InputGroup
      className={cn("w-full", className)}
      data-disabled={disabled || undefined}
    >
      <InputGroupAddon className="pointer-events-none text-muted-foreground select-none">
        Rp
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        // The numeric keypad has no minus key.
        inputMode={allowNegative ? "text" : "numeric"}
        autoComplete="off"
        disabled={disabled}
        required={required}
        placeholder={placeholder ?? "0"}
        value={display}
        onChange={handleChange}
        onBlur={handleBlur}
        className="font-currency text-right tabular-nums"
        {...rest}
      />
    </InputGroup>
  )
}
