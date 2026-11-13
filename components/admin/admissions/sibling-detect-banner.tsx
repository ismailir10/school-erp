import { Users2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ------------------------------------------------------------------
// Sibling-detect edit-form banner (cycle 1.2)
// Split out of `app/admin/admissions/page.tsx` (T5, cycle
// 2026-09-27-admin-finish-standard). No behaviour change — moved verbatim.
// ------------------------------------------------------------------

export function SiblingDetectBanner({
  detectedParent,
}: {
  detectedParent: {
    name: string;
    guardians: Array<{ student: { name: string } }>;
  } | null;
}) {
  if (!detectedParent) return null;
  const names = detectedParent.guardians
    .map((g) => g.student.name)
    .filter(Boolean)
    .join(", ");
  return (
    <Alert
      variant="warning" announcement="polite"
      data-testid="admission-edit-sibling-banner"
    >
      <Users2 aria-hidden="true" />
      <AlertDescription>
        Pendaftar ini terdeteksi sebagai saudara dari keluarga{" "}
        <strong>{detectedParent.name}</strong>
        {names ? ` (${names})` : ""}. Verifikasi sebelum mengonversi ke siswa.
      </AlertDescription>
    </Alert>
  );
}
