export type BsiRow = {
  bankAccountNo: string;
  nama: string;
  netAmount: number;
  description: string;
};

/**
 * Neutralise spreadsheet formula injection in free-text cells: a leading
 * `= + - @` (or tab / CR) is prefixed with `'` so Excel renders it as text.
 * Only for free text (names, descriptions) — never account numbers or amounts,
 * which the bank file format needs verbatim.
 */
function neutralizeFormula(val: string): string {
  return /^[=+\-@\t\r]/.test(val) ? `'${val}` : val;
}

/** Properly quote a CSV field — escape quotes and wrap if contains comma/quote/newline */
function csvField(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n") || val.includes("\r")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function generateBsiCsv(rows: BsiRow[]): string {
  const header = "rekening_tujuan,nama_pemilik,nominal,keterangan";
  const lines = rows.map((r) =>
    `${csvField(r.bankAccountNo)},${csvField(neutralizeFormula(r.nama))},${Math.round(r.netAmount)},${csvField(neutralizeFormula(r.description))}`
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}

/** Sanitize a string for use in Content-Disposition filename */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
