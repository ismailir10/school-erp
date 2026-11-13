import { render, screen, within } from "@testing-library/react";
import { Info } from "lucide-react";
import { describe, expect, it } from "vitest";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";

describe("Alert", () => {
  it("keeps the legacy assertive role and honors explicit announcement and role choices", () => {
    const { rerender } = render(<Alert>Gagal menyimpan</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Gagal menyimpan");

    rerender(<Alert announcement="polite">Tersimpan</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("Tersimpan");

    rerender(<Alert announcement="off">Semua tagihan sudah lunas</Alert>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Semua tagihan sudah lunas")).toBeInTheDocument();

    rerender(<Alert role="region" aria-label="Ringkasan">Pemberitahuan</Alert>);
    expect(screen.getByRole("region", { name: "Ringkasan" })).toHaveTextContent("Pemberitahuan");
  });

  it("keeps the optional action reachable after the message in a semantic alert", () => {
    render(
      <Alert variant="warning">
        <Info aria-hidden="true" />
        <AlertTitle>Periksa tagihan</AlertTitle>
        <AlertDescription>Ada draf yang belum selesai.</AlertDescription>
        <AlertAction><button type="button">Buka draf</button></AlertAction>
      </Alert>,
    );
    const alert = screen.getByRole("alert");
    const message = within(alert).getByText("Ada draf yang belum selesai.");
    const action = within(alert).getByRole("button", { name: "Buka draf" });
    expect(alert).toHaveClass("bg-warning-subtle", "text-warning-text");
    expect(message.compareDocumentPosition(action)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
