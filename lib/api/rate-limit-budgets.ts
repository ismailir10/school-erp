/**
 * Shared rate-limit budgets for API routes.
 *
 * Per-route constants live here so multiple routes that share a budget
 * (e.g. C4 walas weekly POST + C5 sentra session POST both write to
 * AssessmentEntry) can import the same numbers without cross-route
 * coupling.
 */

// Tap-friendly: 60 writes/min/user. Walas weekly UI taps once per
// student-indicator pair; sentra session POSTs a whole session at once
// but the throttling window still protects against runaway clients.
export const PENILAIAN_WRITE_BUDGET = 60 as const;
export const PENILAIAN_WRITE_WINDOW_MS = 60_000 as const;

// Teacher write budgets are keyed per signed-in user, never per IP: a whole
// school shares one Wi-Fi NAT address, so an IP bucket makes every teacher on
// campus throttle each other.

// Absensi kelas saves one POST per tap (tap = Hadir, tap again cycles the
// status). A 30-child class with a few status corrections is ~100 taps; the
// old 10/min/IP budget failed the 11th child.
export const ATTENDANCE_TAP_BUDGET = 180 as const;
export const ATTENDANCE_TAP_WINDOW_MS = 60_000 as const;

// Session attendance posts the whole roster in one request per "Simpan".
export const SESSION_ATTENDANCE_SAVE_BUDGET = 30 as const;
export const SESSION_ATTENDANCE_SAVE_WINDOW_MS = 60_000 as const;

// Gerbang (gate) mode records one child per tap; a morning drop-off queue is
// ~100 children in a few minutes on one shared tablet.
export const GATE_TAP_BUDGET = 180 as const;
export const GATE_TAP_WINDOW_MS = 60_000 as const;
