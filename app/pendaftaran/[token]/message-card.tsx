import type { ReactNode } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { SCHOOL_CONTACT_FALLBACK_TEXT, telHref, whatsappHref } from "@/lib/contact";

/**
 * Dead-end card for a link that cannot open the form (not found, expired,
 * already submitted). When the school's contact number is configured it adds
 * one-tap WhatsApp / call links, so the parent is not left to find the school
 * on their own; without a number the card is text only.
 */
export function MessageCard({
  title,
  body,
  phone,
  children,
}: {
  title: string;
  body: string;
  /** `schoolContactPhone()`; omit for cards that need no follow-up. */
  phone?: string | null;
  /** Extra content under the body, e.g. the bring-to-school checklist. */
  children?: ReactNode;
}) {
  const wa = whatsappHref(phone);
  const tel = telHref(phone);
  const linkClass =
    "inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text focus-visible:ring-offset-2";
  return (
    <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {children}
      {/* A card that asks for follow-up must still say where to go when the
          school number is not configured (R2-P-11). */}
      {phone !== undefined && !(wa || tel) && (
        <p className="mt-4 text-sm text-muted-foreground">{SCHOOL_CONTACT_FALLBACK_TEXT}</p>
      )}
      {(wa || tel) && (
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className={linkClass + " bg-primary-text text-white hover:bg-primary-text/90"}>
              <MessageCircle size={18} aria-hidden /> Chat WhatsApp
            </a>
          )}
          {tel && (
            <a href={tel} className={linkClass + " border border-primary-text/40 text-foreground hover:bg-primary/10"}>
              <Phone size={18} aria-hidden /> Telepon sekolah
            </a>
          )}
        </div>
      )}
    </div>
  );
}
