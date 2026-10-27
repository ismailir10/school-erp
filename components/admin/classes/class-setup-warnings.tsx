import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { SetupWarning } from "@/lib/classes/setup-check";

function message(w: SetupWarning): string {
  return w.kind === "NO_FEE_STRUCTURE"
    ? `${w.className} memakai program ${w.programName}, yang belum punya tarif rutin tahun ajaran ini. Siswanya tidak akan ditagih.`
    : `Nama ${w.className} tidak cocok dengan program ${w.programName}. Kalau salah, ubah program kelas ini lewat Kelas → Ubah Kelas sebelum membuat tagihan.`;
}

/**
 * Setup problems between a class, its program and the fee structure that
 * billing follows. Informational: the admin decides, nothing here blocks.
 */
export function ClassSetupWarnings({
  warnings,
  title = "Periksa dulu sebelum lanjut",
}: {
  warnings: SetupWarning[];
  title?: string;
}) {
  if (warnings.length === 0) return null;
  return (
    <Alert role="status">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-4">
          {warnings.map((w) => (
            <li key={`${w.kind}-${w.classSectionId}`}>{message(w)}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
