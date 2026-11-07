"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Masked display for a government identity number (NIK, No. KK).
 *
 * The dossier layout concentrates identity documents that used to be spread
 * across three pages onto one screen. UU PDP 27/2022 treats NIK as specific
 * personal data, so the default render shows only the last few digits and the
 * full value is a deliberate, per-field reveal.
 *
 * This is a display control, not a security boundary — the full value is in the
 * payload either way. It exists so a shoulder-surfer, a screen share, or a
 * screenshot does not leak every family's NIK by default.
 */
export function MaskedValue({
  value,
  label,
  tail = 4,
}: {
  value: string;
  /** Used in the toggle's accessible name, e.g. "NIK siswa". */
  label: string;
  tail?: number;
}) {
  const [revealed, setRevealed] = useState(false);

  const trimmed = value.trim();
  // Too short to mask meaningfully — hiding 2 of 3 characters protects nothing
  // and just costs the admin a click.
  if (trimmed.length <= tail) {
    return <span className="font-currency">{trimmed}</span>;
  }

  // Dot run is capped rather than matching the hidden length: a 16-digit NIK
  // rendered 12 dots plus the toggle, which overflowed its grid cell on a
  // 390px screen and collided with the neighbouring field. A fixed-width mask
  // also stops the placeholder from leaking the value's length.
  const masked = "•".repeat(Math.min(8, Math.max(0, trimmed.length - tail))) + trimmed.slice(-tail);

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1">
      <span className="font-currency">{revealed ? trimmed : masked}</span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="size-6 text-muted-foreground"
        aria-pressed={revealed}
        aria-label={revealed ? `Sembunyikan ${label}` : `Tampilkan ${label}`}
        onClick={() => setRevealed((v) => !v)}
      >
        {revealed ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
      </Button>
    </span>
  );
}
