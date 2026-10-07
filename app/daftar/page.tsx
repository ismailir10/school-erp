import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { TalibWordmark } from "@/components/brand/talib-wordmark";
import DaftarClient from "./client";

export const metadata: Metadata = {
  title: "Pendaftaran Siswa Baru", // root layout template appends " · Talib"
  description:
    "Daftarkan ananda di An Nisaa' Sekolahku. Isi data anak, orang tua, dan preferensi program — tim kami akan menghubungi Bapak/Ibu dalam 1–3 hari kerja.",
  robots: { index: true, follow: true },
};

// RSC: fetch ACTIVE programs server-side and pass to the client form.
// Avoids exposing an admin-shaped programs list via a public GET endpoint.
async function getActivePrograms() {
  try {
    return await prisma.program.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  } catch (err) {
    console.error("[daftar/page] program lookup failed", err);
    return [];
  }
}

export default async function DaftarPage() {
  const programs = await getActivePrograms();

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-4">
          <TalibWordmark size="md" showSublabel />
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 py-8 sm:py-12">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
            Pendaftaran Siswa Baru
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Assalamu&apos;alaikum, Bapak/Ibu. Silakan lengkapi data berikut —
            tim kami akan menghubungi dalam 1–3 hari kerja.
          </p>
        </div>

        <DaftarClient programs={programs} />
      </div>
    </main>
  );
}
