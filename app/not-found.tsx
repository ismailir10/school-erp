import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Root 404.
 *
 * Without this file `notFound()` renders Next.js's raw black-on-white English
 * default — no branding, no Indonesian, no way back. It is reachable from the
 * parent portal through any stale or mistyped child link, so a parent could
 * land on it. Mirrors the three portal `error.tsx` boundaries in tone and
 * layout; deliberately at the root so every route inherits it.
 *
 * Links to `/` rather than a portal home: this boundary is shared by admin,
 * teacher, parent and the public pages, and `/` already redirects each role to
 * the right place.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-20 text-center">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
        <Compass className="text-muted-foreground" size={28} />
      </div>
      <h1 className="text-h2 mb-2">Halaman tidak ditemukan</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Tautannya mungkin sudah berubah atau salah ketik. Mari kembali ke
        beranda.
      </p>
      <Button render={<Link href="/" />}>Kembali ke Beranda</Button>
    </div>
  );
}
