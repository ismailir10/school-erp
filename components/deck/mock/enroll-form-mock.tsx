import { Check, Copy, Eraser, RefreshCw } from "lucide-react";
import Image from "next/image";
import { ENROLLMENT_FORM_STEPS } from "@/lib/enrollment/steps";
import { cn } from "@/lib/utils";
import { Float, Phone } from "./frames";
import { Stage } from "./stage";

const CURRENT = 0;

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="mb-1 text-xs font-medium leading-none">{label}</p>
      <div className="flex h-8 items-center rounded-lg border border-input bg-background px-2.5 text-sm">
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

/** The public pendaftaran formulir on a phone: the seven-step progress and the address step with Kode pos filling the region, beside the signature card for the other parent. */
export function EnrollFormMock() {
  return (
    <Stage label="enroll-form">
      <Phone className="left-6 top-3" height={476}>
        <div className="flex items-center gap-2.5 border-b border-border bg-card px-4 py-2">
          <Image src="/logo.png" alt="" width={28} height={28} className="rounded-[9px]" />
          <span className="inline-flex flex-col leading-none">
            <span className="text-base font-semibold tracking-tight">Talib</span>
            <span className="mt-0.5 text-[0.6875rem] text-muted-foreground">by An Nisaa&apos; Sekolahku</span>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden bg-background px-4 pt-3">
          <div className="space-y-2">
            <p className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-semibold">Langkah {CURRENT + 1} dari {ENROLLMENT_FORM_STEPS.length}</span>
              <span className="text-muted-foreground">{ENROLLMENT_FORM_STEPS[CURRENT]}</span>
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-primary-text" style={{ width: `${((CURRENT + 1) / ENROLLMENT_FORM_STEPS.length) * 100}%` }} />
            </div>
            <div className="space-y-1">
              {[ENROLLMENT_FORM_STEPS.slice(0, 4), ENROLLMENT_FORM_STEPS.slice(4)].map((row, r) => (
                <ol key={r} className="flex gap-1">
                  {row.map((label, j) => {
                    const i = r * 4 + j;
                    return (
                      <li
                        key={label}
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[0.6875rem] whitespace-nowrap",
                          i === CURRENT ? "bg-primary-text font-medium text-white" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {i + 1}. {label}
                      </li>
                    );
                  })}
                </ol>
              ))}
            </div>
          </div>

          <div className="mt-2.5 rounded-2xl border border-border bg-card p-3 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold">Alamat</h3>
            <div className="space-y-2">
              <Field label="Kode pos" value="55281" />
              <div>
                <p className="text-xs leading-snug text-muted-foreground">Wilayah terisi dari kode pos 55281. Silakan periksa.</p>
                <p className="mt-0.5 text-sm font-medium text-primary-text underline underline-offset-2">Tidak tahu kode pos?</p>
              </div>
              <Field label="Kelurahan / Desa" value="Caturtunggal" />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Kecamatan" value="Depok" />
                <Field label="Kota / Kabupaten" value="Sleman" />
              </div>
            </div>
          </div>
        </div>
      </Phone>

      <Float className="left-[376px] top-[48px] w-[288px] space-y-3 p-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Tanda tangan Ayah</span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-text">
              <Check size={14} strokeWidth={2.5} /> Tersimpan
            </span>
          </div>
          <div className="rounded-lg border border-dashed border-border bg-muted">
            <svg viewBox="0 0 240 72" className="block h-[72px] w-full text-foreground" fill="none" aria-hidden="true">
              <path
                d="M28 50 C 38 14, 52 10, 56 34 S 64 58, 78 30 C 86 14, 96 18, 98 40 S 112 56, 126 26 C 134 10, 146 16, 150 38 S 168 52, 184 30 L 214 22"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="mt-2 flex gap-1.5">
            <span className="inline-flex h-8 items-center whitespace-nowrap gap-1 rounded-lg border border-border bg-background px-2 text-[0.8125rem] font-medium">
              <Eraser size={14} /> Hapus
            </span>
            <span className="inline-flex h-8 items-center whitespace-nowrap rounded-lg bg-primary-text px-2 text-[0.8125rem] font-medium text-white">Simpan tanda tangan</span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card px-2.5 py-2 text-left text-sm">
          <p className="font-medium">Tanda tangan Ibu belum ada</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            Jika Ibu berada di tempat lain, bagikan link formulir ini. Data yang sudah diisi tersimpan otomatis.
          </p>
          <div className="mt-2 flex gap-2">
            <span className="inline-flex h-8 items-center whitespace-nowrap gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium">
              <Copy size={14} /> Salin link
            </span>
            <span className="inline-flex h-8 items-center whitespace-nowrap gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium">
              <RefreshCw size={14} /> Periksa lagi
            </span>
          </div>
        </div>
      </Float>
    </Stage>
  );
}
