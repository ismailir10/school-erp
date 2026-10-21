import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDateTime } from "@/lib/format";

export type PaymentProblemView = { code: string; message: string; createdAt: string };

/** The payment's time (WIB) leads, so two flagged payments of the same amount can be told apart and matched in the gateway dashboard. */
function ProblemLine({ problem }: { problem: PaymentProblemView }) {
  return (
    <>
      <span className="font-medium tabular-nums">{formatDateTime(problem.createdAt)}</span> — {problem.message}
    </>
  );
}

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
          <p><ProblemLine problem={problems[0]} /></p>
        ) : (
          <ul className="list-disc space-y-1 pl-4">
            {problems.map((p, i) => (
              <li key={`${p.code}-${p.createdAt}-${i}`}><ProblemLine problem={p} /></li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}
