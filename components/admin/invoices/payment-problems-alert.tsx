import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export type PaymentProblemView = { code: string; message: string; createdAt: string };

/**
 * Red "Perlu dicek" alert for gateway money that landed on this invoice and needs a person:
 * a second payment on a Lunas invoice, a payment on a Dibatalkan one, or an overpayment.
 * Renders nothing when there are none.
 */
export function PaymentProblemsAlert({ problems, className }: { problems: PaymentProblemView[]; className?: string }) {
  if (problems.length === 0) return null;
  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>Perlu dicek</AlertTitle>
      <AlertDescription>
        {problems.length === 1 ? (
          <p>{problems[0].message}</p>
        ) : (
          <ul className="list-disc space-y-1 pl-4">
            {problems.map((p, i) => (
              <li key={`${p.code}-${p.createdAt}-${i}`}>{p.message}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}
