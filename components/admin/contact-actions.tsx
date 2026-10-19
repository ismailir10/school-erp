"use client";

import { Button } from "@/components/ui/button";
import { telHref, whatsappHref } from "@/lib/contact";
import { cn } from "@/lib/utils";

/**
 * WhatsApp + Telepon buttons for a person's number. Generalises the "Kontak
 * Cepat" markup in the student rail so the wali header and the rail share one
 * implementation.
 *
 * Each button renders only when its link is usable (`lib/contact.ts` returns
 * null for a missing or too-short number); with neither, the whole row is
 * omitted rather than showing dead buttons. WhatsApp falls back to the phone
 * number when no separate WhatsApp number is on file.
 */
export function ContactActions({
  phone,
  whatsapp,
  className,
}: {
  phone: string | null | undefined;
  whatsapp?: string | null;
  className?: string;
}) {
  // A blank or unusable WhatsApp number falls through to the phone, not to nothing.
  const wa = whatsappHref(whatsapp) ?? whatsappHref(phone);
  const tel = telHref(phone);
  if (!wa && !tel) return null;
  return (
    <div className={cn("flex gap-2", className)}>
      {wa && (
        <Button
          size="sm"
          className="flex-1 sm:flex-none"
          render={<a href={wa} target="_blank" rel="noopener noreferrer" />}
        >
          WhatsApp
        </Button>
      )}
      {tel && (
        <Button
          size="sm"
          variant="outline"
          className="flex-1 sm:flex-none"
          render={<a href={tel} />}
        >
          Telepon
        </Button>
      )}
    </div>
  );
}
