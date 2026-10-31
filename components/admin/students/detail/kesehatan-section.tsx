"use client";

import { useState } from "react";
import { DossierSubsection } from "@/components/admin/dossier-section";
import { StudentHealthBlock } from "@/components/admin/student-health-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import type { MetadataExtraRow, StudentSystemMetadata } from "@/lib/student/metadata";

/**
 * "Kesehatan & Kelahiran" — the typed view/edit of `Student.metadata`'s known
 * fields (`StudentHealthBlock`, a metadata grid with no schema validation of
 * its own — every field is optional free text/number, so there is nothing
 * for a zod schema to reject that the block doesn't already coerce).
 *
 * Saves through the page's single `persistMetadata` writer, which always
 * sends the *whole* metadata blob (known + extra + system) so this editor
 * can never clobber Informasi Tambahan's rows or the machine-owned system
 * keys. `getExtraRows` reads Informasi Tambahan's current rows at save time
 * (even mid-edit, unsaved) — the same coupling the pre-split page had via
 * one shared `metadataRows` state, preserved here through a ref the other
 * section keeps current.
 */
export function KesehatanSection({
  known,
  system,
  hasAllergy,
  persistMetadata,
  getExtraRows,
  onSaved,
  canEdit,
}: {
  known: Record<string, string>;
  system: StudentSystemMetadata;
  hasAllergy: boolean;
  persistMetadata: (next: { known: Record<string, string>; extra: MetadataExtraRow[] }) => Promise<boolean>;
  getExtraRows: () => MetadataExtraRow[];
  onSaved: () => void;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(known);
  const [saving, setSaving] = useState(false);

  function startEditing() {
    setDraft(known);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setDraft(known);
  }

  async function save() {
    setSaving(true);
    const ok = await persistMetadata({ known: draft, extra: getExtraRows() });
    if (ok) {
      toast.success("Data kesehatan diperbarui");
      setEditing(false);
      onSaved();
    }
    setSaving(false);
  }

  return (
    <DossierSubsection
      id="kesehatan"
      label="Kesehatan & Kelahiran"
      badge={hasAllergy ? <Badge variant="info">Ada alergi</Badge> : undefined}
      actions={canEdit && (
        editing ? (
          <>
            <Button size="sm" variant="outline" onClick={cancelEditing} disabled={saving}>
              <X size={14} className="mr-1" aria-hidden="true" /> Batal
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Save size={14} className="mr-1" aria-hidden="true" /> {saving ? "Menyimpan..." : "Simpan"}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={startEditing}>
            <Pencil size={12} className="mr-1" aria-hidden="true" /> Ubah
          </Button>
        ))
      }
    >
      <StudentHealthBlock
        canEdit={canEdit}
        known={editing ? draft : known}
        system={system}
        editing={editing}
        onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
      />
    </DossierSubsection>
  );
}
