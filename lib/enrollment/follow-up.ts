/**
 * WhatsApp messages staff send to a parent about their formulir: the invitation
 * (`inviteWaUrl`, cycle 2026-10-11-pendaftaran-simplify) and the unpaid-fee
 * reminder (cycle 2026-10-10-pendaftaran-fee-payment).
 *
 * Staff tap one button and WhatsApp opens on the parent's number with the
 * message already written, link included. Pure helpers: who to message, what to
 * say. The reminder's final `wa.me` URL is built by its endpoint at click time
 * (`app/api/enrollments/[id]/fee/reminder`), because the message carries the
 * parent's form link and its access token is a credential: lists only ever
 * learn WHETHER a reminder can be sent (`canRemind`), never the token. The
 * invitation URL is built in the browser from the invite response, which only
 * the inviting admin receives.
 */

import { formatRupiah } from "@/lib/format";
import { whatsappHref, whatsappHrefWithText } from "@/lib/contact";

type PhoneSource = {
  admission?: { parentWhatsapp?: string | null; parentPhone?: string | null } | null;
  ayahData?: unknown;
  ibuData?: unknown;
};

function phoneOf(block: unknown): string | null {
  if (!block || typeof block !== "object") return null;
  const v = (block as Record<string, unknown>).phone;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * The number to message, most reliable first: the WhatsApp number given at
 * inquiry, the inquiry phone, then the Ibu's and the Ayah's phone from the
 * form. Only a number WhatsApp can actually open counts (`whatsappHref` rejects
 * anything too short to be one), so a junk value does not hide a good one.
 */
export function resolveFollowUpPhone(src: PhoneSource): string | null {
  const candidates = [
    src.admission?.parentWhatsapp ?? null,
    src.admission?.parentPhone ?? null,
    phoneOf(src.ibuData),
    phoneOf(src.ayahData),
  ];
  for (const c of candidates) {
    if (c && whatsappHref(c)) return c;
  }
  return null;
}

/** Whether a reminder can be sent at all (a number WhatsApp can open exists) — all a list needs to know. */
export function canRemind(src: PhoneSource): boolean {
  return resolveFollowUpPhone(src) !== null;
}

/** The reminder staff send. Parent voice: courteous, no pressure, easy to ignore if already paid. */
export function feeReminderText(input: {
  parentName: string | null | undefined;
  childName: string;
  amount: number;
  formUrl: string;
  /** The tenant's own name; omitted → the line introduces nobody rather than the wrong school. */
  schoolName?: string | null;
}): string {
  const who = input.parentName?.trim() ? `Bapak/Ibu ${input.parentName.trim()}` : "Bapak/Ibu";
  const school = input.schoolName?.trim();
  // The child may not be named yet (a fee created under pay-first).
  const child = input.childName.trim();
  return [
    school ? `Assalamu'alaikum ${who}. Kami dari ${school}.` : `Assalamu'alaikum ${who}.`,
    `Biaya pendaftaran ananda${child ? ` ${child}` : ""} sebesar ${formatRupiah(input.amount)} belum kami terima.`,
    `Bapak/Ibu bisa membayarnya lewat tautan berikut: ${input.formUrl}`,
    "Jika sudah membayar, mohon abaikan pesan ini. Jazakumullah khairan.",
  ].join("\n\n");
}

/** `wa.me` URL with the reminder prefilled, or null when there is no number WhatsApp can open. */
export function feeReminderWaUrl(
  src: PhoneSource & {
    parentName: string | null | undefined;
    childName: string;
    amount: number;
    formUrl: string;
    schoolName?: string | null;
  },
): string | null {
  const phone = resolveFollowUpPhone(src);
  if (!phone) return null;
  return whatsappHrefWithText(phone, feeReminderText(src));
}

/**
 * The message staff send when handing a parent their formulir link (walk-ins and
 * anyone without an email). Parent voice from `voice.md`: greeting, courteous,
 * short, the link last-but-one so it is easy to tap.
 */
export function inviteText(input: {
  parentName: string | null | undefined;
  /** Blank (a lead logged before the child was named) → the line speaks of "ananda" in general. */
  childName?: string | null;
  formUrl: string;
  schoolName?: string | null;
}): string {
  const who = input.parentName?.trim() ? `Bapak/Ibu ${input.parentName.trim()}` : "Bapak/Ibu";
  const school = input.schoolName?.trim();
  const child = input.childName?.trim();
  return [
    school ? `Assalamu'alaikum ${who}. Kami dari ${school}.` : `Assalamu'alaikum ${who}.`,
    `Berikut tautan formulir pendaftaran${child ? ` ananda ${child}` : ""}: ${input.formUrl}`,
    "Mohon dilengkapi dengan teliti. Jika ada yang kurang jelas, silakan balas pesan ini. Jazakumullah khairan.",
  ].join("\n\n");
}

/**
 * `wa.me` URL on the parent's number with the formulir invitation prefilled, or
 * null when `phone` is not a number WhatsApp can open (same normalisation as the
 * fee reminder: `0812…` → `62812…`). Takes one number: callers pick it with
 * `resolveFollowUpPhone`.
 */
export function inviteWaUrl(input: {
  phone: string | null | undefined;
  parentName: string | null | undefined;
  childName?: string | null;
  formUrl: string;
  schoolName?: string | null;
}): string | null {
  return whatsappHrefWithText(input.phone, inviteText(input));
}

/** The public link a parent uses to reach (and pay) the fee: the form link, which leads to the fee once submitted. */
export function parentFormUrl(origin: string, accessToken: string): string {
  return `${origin.replace(/\/+$/, "")}/pendaftaran/${encodeURIComponent(accessToken)}`;
}
