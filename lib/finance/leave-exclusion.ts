/**
 * Reason stored on a billing-run row's `error` when recording a student leave
 * (cuti) parks the row as EXCLUDED after the draft was built. Rebuilding the
 * draft must NOT carry this exclusion forward: the rebuilt row follows the
 * leave rules itself (SKIPPED_ON_LEAVE, or the remaining enrollments' fees).
 */
export const LEAVE_RECORDED_AFTER_DRAFT_REASON = "Cuti dicatat setelah draf dibuat";
