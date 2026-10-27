import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { SetupWarning } from "@/lib/classes/setup-check";

function message(w: SetupWarning): string {
  return w.kind === "NO_FEE_STRUCTURE"
    ? `${w.className} memakai program ${w.programName}, yang belum ada tarif rutin tahun ajaran ini. Siswanya tidak akan ditagih.`
    : `Nama ${w.className} tidak cocok dengan program ${w.programName}.`;
}

/**
 * Setup problems between a class, its program and the fee structure that
 * billing follows. Informational: the admin decides, nothing here blocks.
 */
export function ClassSetupWarnings({
  warnings,
  title = "Periksa sebelum lanjut",
}: {
  warnings: SetupWarning[];
  title?: string;
}) {
  // The live region stays mounted while empty (and takes no space), so a
  // screen reader is already listening when a warning appears in it.
  return (
    <div role="status" className="empty:hidden">
      {warnings.length > 0 && (
        <Alert role="none">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {warnings.map((w) => (
                <li key={`${w.kind}-${w.classSectionId}`}>{message(w)}</li>
              ))}
            </ul>
            {/* Said once, however many classes look mislinked. */}
            {warnings.some((w) => w.kind === "PROGRAM_NAME_MISMATCH") && (
              <p className="mt-2">Jika salah, ubah program di Kelas → Ubah Kelas sebelum membuat tagihan.</p>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
