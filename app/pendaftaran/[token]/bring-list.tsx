import { DOCUMENT_ITEMS, type DocumentKey } from "@/lib/enrollment/documents";

/** Documents that belong to one parent only. */
const PARENT_DOCUMENTS: Record<"ayah" | "ibu", readonly DocumentKey[]> = {
  ayah: ["ktp_ayah", "foto_ayah"],
  ibu: ["ktp_ibu", "foto_ibu"],
};

/**
 * Drops the waived parent's documents from the bring-list (R2-P-10): a family
 * where only the ibu / wali fills has no Ayah KTP or photo to bring.
 */
export function withoutWaivedParentDocs(keys: readonly DocumentKey[], onlyParent: unknown): DocumentKey[] {
  if (onlyParent !== "ayah" && onlyParent !== "ibu") return [...keys];
  const waived = PARENT_DOCUMENTS[onlyParent === "ayah" ? "ibu" : "ayah"];
  return keys.filter((k) => !waived.includes(k));
}

/**
 * "Berkas yang perlu dibawa ke sekolah" — the paper documents still missing
 * after submit. Shown on the just-submitted card AND on the SUBMITTED card a
 * reload lands on (R2-P-15), so the parent still has the list when they go
 * looking for the documents. Renders nothing for an empty list.
 */
export function BringList({ keys }: { keys: readonly DocumentKey[] }) {
  if (keys.length === 0) return null;
  return (
    <div className="mt-5 rounded-xl border border-emerald-900/15 bg-emerald-50/50 p-4 text-left">
      <h3 className="text-sm font-semibold text-emerald-950">Berkas yang perlu dibawa ke sekolah</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-900/80">
        {keys.map((k) => (
          <li key={k}>{DOCUMENT_ITEMS.find((i) => i.key === k)?.label ?? k}</li>
        ))}
      </ul>
    </div>
  );
}
