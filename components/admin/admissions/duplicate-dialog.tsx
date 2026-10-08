import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// ------------------------------------------------------------------
// R2-ADMIN-1: shown when the convert route answers 409 POSSIBLE_DUPLICATE —
// a student with the same name (+ same birth date or shared guardian contact)
// or a wali with the same phone/WhatsApp/email is already on file. The admin
// can look first ("Lihat" opens the record in a new tab, so this dialog and
// the list stay put) or go ahead ("Tetap konversi" re-sends with
// confirmDuplicate; a matched wali is then reused, not duplicated).
// ------------------------------------------------------------------

export type PossibleDuplicate = {
  admissionId: string;
  childName: string;
  mergeWithDetected: boolean;
  existingStudents: Array<{ id: string; name: string; status: string }>;
  existingParent: { id: string; name: string } | null;
};

export type AdmissionDuplicateDialogProps = {
  duplicate: PossibleDuplicate | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (duplicate: PossibleDuplicate) => void;
};

function SeeLink({ href, label }: { href: string; label: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      render={<a href={href} target="_blank" rel="noreferrer" aria-label={`Lihat ${label}`} />}
    >
      Lihat
    </Button>
  );
}

export function AdmissionDuplicateDialog({
  duplicate,
  pending,
  onClose,
  onConfirm,
}: AdmissionDuplicateDialogProps) {
  return (
    <Dialog
      open={!!duplicate}
      onOpenChange={(o) => {
        if (!o && !pending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Kemungkinan sudah terdaftar</DialogTitle>
        </DialogHeader>
        {duplicate && (
          <div className="space-y-4">
            <p className="text-sm">
              Kemungkinan siswa/wali ini sudah terdaftar. Periksa dulu sebelum menambah data baru untuk{" "}
              <strong>{duplicate.childName}</strong>.
            </p>
            <ul className="space-y-2">
              {duplicate.existingStudents.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3"
                >
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground"> · siswa</span>
                  </span>
                  <SeeLink href={`/admin/students/${s.id}`} label={s.name} />
                </li>
              ))}
              {duplicate.existingParent && (
                <li className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{duplicate.existingParent.name}</span>
                    <span className="text-muted-foreground"> · wali</span>
                  </span>
                  <SeeLink
                    href={`/admin/guardians/${duplicate.existingParent.id}`}
                    label={duplicate.existingParent.name}
                  />
                </li>
              )}
            </ul>
            {duplicate.existingParent && (
              <p className="text-xs text-muted-foreground">
                Kalau tetap dikonversi, siswa baru ditautkan ke wali yang sudah ada, bukan dibuatkan wali baru.
              </p>
            )}
          </div>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={pending}>Batal</Button>
          <Button disabled={pending} onClick={() => duplicate && onConfirm(duplicate)}>
            {pending ? "Memproses..." : "Tetap konversi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
