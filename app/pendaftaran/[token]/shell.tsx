import Image from "next/image";
import { TalibWordmark } from "@/components/brand/talib-wordmark";

/**
 * Page chrome shared by every public pendaftaran screen: the form, its
 * dead-end cards, and the payment return page. One header, one column.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-4">
          <Image
            src="/logo.png"
            alt=""
            width={44}
            height={44}
            priority
            className="rounded-[13px] outline -outline-offset-1 outline-black/10"
          />
          <TalibWordmark size="md" showSublabel />
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-5 py-8 sm:py-12">{children}</div>
    </main>
  );
}
