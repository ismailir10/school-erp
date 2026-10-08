import React from "react";
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { formatRupiah } from "@/lib/format";

import { TEAL, DARK, MUTED_FOREGROUND as GRAY, LIGHT_BG as LIGHT_GRAY, BORDER } from "./brand-tokens";

// A4 portrait: 595 pt wide × 842 pt tall (portrait is the @react-pdf default).
// Content area after padding: 595 - 2×24 = 547 pt — equivalent to ~414 px device
// width when scaled to mobile. Column widths, font sizes, and padding are tuned
// so no horizontal overflow occurs at 414 px viewport width.

const s = StyleSheet.create({
  page: {
    padding: 0,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1F2937",
  },

  // Top accent bar
  accentBar: {
    height: 5,
    backgroundColor: TEAL,
  },

  // Content wrapper — reduced side padding vs. old 40 pt so content maps
  // more cleanly onto a 414 px mobile screenshot without horizontal scroll.
  content: {
    padding: 24,
    paddingTop: 20,
  },

  // Header — stacked (logo+name on left, doc title on right) — unchanged.
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  schoolName: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: DARK,
    letterSpacing: 0.2,
  },
  schoolSubtitle: {
    fontSize: 7,
    color: GRAY,
    marginTop: 2,
  },
  docTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  docPeriod: {
    fontSize: 7,
    color: GRAY,
    marginTop: 3,
    textAlign: "right" as const,
  },

  // Divider
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    marginBottom: 12,
  },
  dividerThick: {
    borderBottomWidth: 2,
    borderBottomColor: DARK,
    marginBottom: 12,
  },

  // Employee info card — single column to avoid width pressure on portrait.
  infoCard: {
    backgroundColor: LIGHT_GRAY,
    borderRadius: 4,
    padding: 10,
    marginBottom: 14,
  },
  // infoGrid is now a single column (no flexDirection: "row") so all four
  // info rows stack vertically — guarantees fit on narrow portrait.
  infoGrid: {
    flexDirection: "column",
  },
  infoCol: {
    flex: 1,
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  infoLabel: {
    width: 68,
    fontSize: 7,
    color: GRAY,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  infoValue: {
    flex: 1,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: DARK,
  },

  // Table — amount column narrowed from 110 to 90 pt to fit portrait content area.
  tableHeader: {
    flexDirection: "row",
    backgroundColor: DARK,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 2,
    marginBottom: 2,
  },
  tableHeaderText: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E5E7EB",
  },
  tableRowAlt: {
    backgroundColor: "#FAFAFA",
  },
  tableNo: { width: 20, fontSize: 7, color: GRAY },
  tableLabel: { flex: 1, fontSize: 8 },
  tableAmount: {
    width: 90,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textAlign: "right" as const,
  },

  // Subtotal row
  subtotalRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    marginTop: 2,
  },
  subtotalLabel: {
    flex: 1,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: DARK,
  },
  subtotalAmount: {
    width: 90,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textAlign: "right" as const,
    color: DARK,
  },

  // Net pay box
  netBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: TEAL,
    borderRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  netLabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  netAmount: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
  },

  // Bank info
  bankInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    padding: 8,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 4,
  },
  bankLabel: { fontSize: 7, color: GRAY },
  bankValue: { fontSize: 8, fontFamily: "Helvetica-Bold" },

  // Footer
  footer: {
    position: "absolute" as const,
    bottom: 24,
    left: 24,
    right: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
    paddingTop: 6,
  },
  footerText: { fontSize: 7, color: "#9CA3AF" },

  // Section title
  sectionTitle: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 5,
    marginTop: 12,
  },
});

export type SlipData = {
  schoolName: string;
  logoUrl?: string;
  period: string;
  employeeName: string;
  employeeCode: string;
  position: string;
  workingDays: number;
  bankName: string | null;
  bankAccountNo: string | null;
  incomeLines: { label: string; amount: number }[];
  deductionLines: { label: string; amount: number }[];
  totalIncome: number;
  totalDeductions: number;
  netPay: number;
  generatedDate: string;
};

// A4 portrait — no landscape variant; no explicit landscape consumer found via grep.
// Landscape was removed outright per task A4 acceptance criteria (no consumer = replace).
export function SalarySlipPdf({ data }: { data: SlipData }) {
  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        {/* Accent bar */}
        <View style={s.accentBar} />

        <View style={s.content}>
          {/* Header */}
          <View style={s.headerRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {data.logoUrl && (
                // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image has no alt prop
                <Image src={data.logoUrl} style={{ width: 30, height: 30, borderRadius: 5 }} />
              )}
              <View>
                <Text style={s.schoolName}>{data.schoolName}</Text>
                <Text style={s.schoolSubtitle}>Pendidikan Anak Usia Dini Islam Terpadu</Text>
              </View>
            </View>
            <View>
              <Text style={s.docTitle}>Slip Gaji</Text>
              <Text style={s.docPeriod}>Periode: {data.period}</Text>
            </View>
          </View>

          <View style={s.dividerThick} />

          {/* Employee info card — single-column stack, all four rows */}
          <View style={s.infoCard}>
            <View style={s.infoGrid}>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Nama</Text>
                <Text style={s.infoValue}>{data.employeeName}</Text>
              </View>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>NIP</Text>
                <Text style={s.infoValue}>{data.employeeCode}</Text>
              </View>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Jabatan</Text>
                <Text style={s.infoValue}>{data.position}</Text>
              </View>
              <View style={[s.infoRow, { marginBottom: 0 }]}>
                <Text style={s.infoLabel}>Hari Kerja</Text>
                <Text style={s.infoValue}>{data.workingDays} hari</Text>
              </View>
            </View>
          </View>

          {/* Income table */}
          <Text style={s.sectionTitle}>Pendapatan</Text>
          <View style={s.tableHeader}>
            <Text style={[s.tableHeaderText, { width: 20 }]}>No</Text>
            <Text style={[s.tableHeaderText, { flex: 1 }]}>Komponen</Text>
            <Text style={[s.tableHeaderText, { width: 90, textAlign: "right" }]}>Jumlah</Text>
          </View>
          {data.incomeLines.map((line, i) => (
            <View key={i} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
              <Text style={s.tableNo}>{i + 1}</Text>
              <Text style={s.tableLabel}>{line.label}</Text>
              <Text style={s.tableAmount}>{formatRupiah(line.amount)}</Text>
            </View>
          ))}
          <View style={s.subtotalRow}>
            <Text style={[s.subtotalLabel, { paddingLeft: 20 }]}>Total Pendapatan</Text>
            <Text style={s.subtotalAmount}>{formatRupiah(data.totalIncome)}</Text>
          </View>

          {/* Deductions table */}
          {data.deductionLines.length > 0 && (
            <>
              <Text style={s.sectionTitle}>Potongan</Text>
              <View style={s.tableHeader}>
                <Text style={[s.tableHeaderText, { width: 20 }]}>No</Text>
                <Text style={[s.tableHeaderText, { flex: 1 }]}>Komponen</Text>
                <Text style={[s.tableHeaderText, { width: 90, textAlign: "right" }]}>Jumlah</Text>
              </View>
              {data.deductionLines.map((line, i) => (
                <View key={i} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
                  <Text style={s.tableNo}>{i + 1}</Text>
                  <Text style={s.tableLabel}>{line.label}</Text>
                  <Text style={s.tableAmount}>{formatRupiah(line.amount)}</Text>
                </View>
              ))}
              <View style={s.subtotalRow}>
                <Text style={[s.subtotalLabel, { paddingLeft: 20 }]}>Total Potongan</Text>
                <Text style={s.subtotalAmount}>{formatRupiah(data.totalDeductions)}</Text>
              </View>
            </>
          )}

          {/* Net pay */}
          <View style={s.netBox}>
            <Text style={s.netLabel}>Gaji Bersih</Text>
            <Text style={s.netAmount}>{formatRupiah(data.netPay)}</Text>
          </View>

          {/* Bank info */}
          {data.bankAccountNo && (
            <View style={s.bankInfo}>
              <View>
                <Text style={s.bankLabel}>Ditransfer ke</Text>
                <Text style={s.bankValue}>{data.bankName ?? "Bank"}</Text>
              </View>
              <View>
                <Text style={s.bankLabel}>No. Rekening</Text>
                <Text style={s.bankValue}>{data.bankAccountNo}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>Diterbitkan: {data.generatedDate}</Text>
          <Text style={s.footerText}>Dokumen resmi — dihasilkan oleh Talib by An Nisaa&apos; Sekolahku</Text>
        </View>
      </Page>
    </Document>
  );
}
