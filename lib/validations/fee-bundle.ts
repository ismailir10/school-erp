import { z } from "zod";
import { MAX_FEE_AMOUNT } from "@/lib/validations/fee-structure";

// PUT /api/fee-bundles — the "Harga paket sekolah + daycare" section of Tarif per
// Program (cycle 2026-10-29-school-daycare-bundle-price). One price per
// (school program, daycare program, fee component) for one academic year.
// `amount: null` clears (deactivates) the price; a number sets it. Zero is
// refused on purpose: a free bundle is a keringanan, not a price.
export const MAX_BUNDLE_CHANGES = 200;

const bundleAmount = z
  .number("Harga paket harus berupa angka")
  .int("Harga paket harus rupiah bulat")
  .positive("Harga paket harus lebih dari 0")
  .max(MAX_FEE_AMOUNT, "Harga paket maksimal Rp 10.000.000.000");

export const bundleFeeChangeSchema = z.object({
  schoolProgramId: z.string().min(1, "Pilih satu program sekolah dan satu program daycare"),
  daycareProgramId: z.string().min(1, "Pilih satu program sekolah dan satu program daycare"),
  feeComponentId: z.string().min(1, "Pilih komponen biaya"),
  amount: bundleAmount.nullable(),
});

export const saveBundleFeesSchema = z
  .object({
    academicYearId: z.string().min(1, "Pilih tahun ajaran"),
    changes: z
      .array(bundleFeeChangeSchema)
      .max(MAX_BUNDLE_CHANGES, `Maksimal ${MAX_BUNDLE_CHANGES} perubahan sekali simpan`),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.changes.forEach((c, index) => {
      const key = `${c.schoolProgramId}|${c.daycareProgramId}|${c.feeComponentId}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["changes", index],
          message: "Harga paket yang sama tidak boleh muncul dua kali",
        });
      }
      seen.add(key);
    });
  });

export type SaveBundleFeesInput = z.infer<typeof saveBundleFeesSchema>;
export type BundleFeeChange = z.infer<typeof bundleFeeChangeSchema>;
