import { MessageCircle, Phone } from "lucide-react";
import { telHref, whatsappHref } from "@/lib/contact";

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
}: {
  title: string;
  body: string;
  /** `schoolContactPhone()`; omit for cards that need no follow-up. */
  phone?: string | null;
}) {
  const wa = whatsappHref(phone);
  const tel = telHref(phone);
  const linkClass =
    "inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0C5C3F] focus-visible:ring-offset-2";
  return (
    <div className="rounded-2xl border border-emerald-900/10 bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-semibold text-emerald-950">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-emerald-900/70">{body}</p>
      {(wa || tel) && (
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className={linkClass + " bg-[#0C5C3F] text-white"}>
              <MessageCircle size={18} aria-hidden /> Chat WhatsApp
            </a>
          )}
          {tel && (
            <a href={tel} className={linkClass + " border border-[#0C5C3F]/40 text-emerald-950"}>
              <Phone size={18} aria-hidden /> Telepon sekolah
            </a>
          )}
        </div>
      )}
    </div>
  );
}
