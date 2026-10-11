import type { Metadata } from "next";
import Image from "next/image";
import { prisma } from "@/lib/db";
import { TalibWordmark } from "@/components/brand/talib-wordmark";
import { SchoolGallery, SchoolHero } from "@/components/brand/school-photos";
import { LegalFooter } from "@/components/layout/legal-footer";
import DaftarClient from "./client";

export const metadata: Metadata = {
  title: "Pendaftaran Siswa Baru", // root layout template appends " · Talib"
  description:
    "Daftarkan ananda di An Nisaa' Sekolahku. Tinggalkan nama dan kontak Bapak/Ibu — tim kami akan menghubungi dalam 1–3 hari kerja.",
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
    <main className="flex min-h-screen flex-col bg-background">
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

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 py-8 sm:py-12">
        <SchoolHero />

        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
            Pendaftaran Siswa Baru
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Assalamu&apos;alaikum, Bapak/Ibu. Cukup isi nama dan nomor HP atau email —
            tim kami akan menghubungi dalam 1–3 hari kerja.
          </p>
        </div>

        <DaftarClient programs={programs} />

        <SchoolGallery />

        <LegalFooter tone="onLight" className="mt-auto pt-12" />
      </div>
    </main>
  );
}
