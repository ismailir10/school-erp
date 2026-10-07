import Link from "next/link";

// @tailwindcss/typography is not installed, so `prose` classes were no-ops and
// the legal pages rendered as flat text (PAR-3). The pages are plain
// h1/h2/p/ul markup; style it here once with child selectors.
const LEGAL_PROSE = [
  "text-base leading-relaxed text-foreground",
  "[&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight [&_h1]:text-balance",
  "[&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-snug",
  "[&_p]:mt-3",
  "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5",
  "[&_strong]:font-semibold",
  "[&_a]:text-primary-text [&_a]:underline [&_a]:underline-offset-2 [&_a]:break-words",
].join(" ");

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[65ch] px-5 py-8 sm:py-12">
      <Link
        href="/"
        className="-ml-2 mb-4 inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span aria-hidden>←&nbsp;</span>Kembali
      </Link>
      <article className={LEGAL_PROSE}>{children}</article>
    </main>
  );
}
