import React from "react";
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { formatRupiah } from "@/lib/format";

import { TEAL, DARK, MUTED_FOREGROUND as GRAY, LIGHT_BG as LIGHT_GRAY, BORDER } from "./brand-tokens";

const s = StyleSheet.create({
  page: {
    padding: 0,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1F2937",
  },

  accentBar: {
    height: 6,
    backgroundColor: TEAL,
  },

  content: {
    padding: 40,
    paddingTop: 28,
  },

  // Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  schoolName: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: DARK,
    letterSpacing: 0.3,
  },
  schoolSubtitle: {
    fontSize: 8,
    color: GRAY,
    marginTop: 2,
  },
  docTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    textTransform: "uppercase",
    letterSpacing: 2,
    textAlign: "right" as const,
  },
  docMeta: {
    fontSize: 8,
    color: GRAY,
    marginTop: 3,
    textAlign: "right" as const,
  },
  docMetaStrong: {
    fontSize: 9,
    color: DARK,
    fontFamily: "Helvetica-Bold",
    marginTop: 3,
    textAlign: "right" as const,
  },

  dividerThick: {
    borderBottomWidth: 2,
    borderBottomColor: DARK,
    marginBottom: 16,
  },

  // Info card
  infoCard: {
    backgroundColor: LIGHT_GRAY,
    borderRadius: 4,
    padding: 14,
    marginBottom: 20,
  },
  infoGrid: {
    flexDirection: "row",
  },
  infoCol: {
    flex: 1,
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 5,
  },
  infoLabel: {
    width: 75,
    fontSize: 8,
    color: GRAY,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  infoValue: {
    flex: 1,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: DARK,
  },

  // Section title
  sectionTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 16,
  },

  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: DARK,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 2,
    marginBottom: 2,
  },
  tableHeaderText: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E5E7EB",
  },
  tableRowAlt: {
    backgroundColor: "#FAFAFA",
  },
  tableNo: { width: 25, fontSize: 8, color: GRAY },
  tableLabel: { flex: 1, fontSize: 9 },
  tableAmount: {
    width: 110,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textAlign: "right" as const,
  },

  subtotalRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    marginTop: 2,
  },
  subtotalLabel: {
    flex: 1,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: DARK,
  },
  subtotalAmount: {
    width: 110,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textAlign: "right" as const,
    color: DARK,
  },

  // Paid box (mirrors netBox)
  paidBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: TEAL,
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  paidLabel: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  paidAmount: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
  },

  // Payments table cells
  payDate: { width: 90, fontSize: 9 },
  payMethod: { width: 90, fontSize: 9 },
  payRef: { flex: 1, fontSize: 9, color: GRAY },
  payAmount: {
    width: 110,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textAlign: "right" as const,
  },

  footer: {
    position: "absolute" as const,
    bottom: 30,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
    paddingTop: 8,
  },
  footerText: { fontSize: 7, color: "#9CA3AF" },
});

export type InvoiceReceiptData = {
  schoolName: string;
  logoUrl?: string;
  invoiceNumber: string;
  periodLabel: string;
  dueDate: string; // formatted id-ID
  paidAt: string | null; // formatted id-ID
  studentName: string;
  studentNickname: string | null;
  className: string | null;
  programName: string | null;
  lines: { label: string; amount: number }[];
  totalDue: number;
  totalPaid: number;
  remaining: number;
  payments: {
    paidAt: string; // formatted id-ID
    method: string;
    reference: string | null;
    amount: number;
  }[];
  generatedDate: string;
};

export function InvoiceReceiptPdf({ data }: { data: InvoiceReceiptData }) {
  // The Referensi column only earns its width when a gateway reference exists
  // (manual payments carry none on a receipt), otherwise it is a column of dashes.
  const showReference = data.payments.some((p) => p.reference);
  const classLine =
    data.className && data.programName
      ? `${data.className} • ${data.programName}`
      : data.className ?? data.programName ?? "—";

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.accentBar} />

        <View style={s.content}>
          {/* Header */}
          <View style={s.headerRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {data.logoUrl && (
                // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image has no alt prop
                <Image src={data.logoUrl} style={{ width: 36, height: 36, borderRadius: 6 }} />
              )}
              <View>
                <Text style={s.schoolName}>{data.schoolName}</Text>
                <Text style={s.schoolSubtitle}>Pendidikan Anak Usia Dini Islam Terpadu</Text>
              </View>
            </View>
            <View>
              <Text style={s.docTitle}>Kuitansi Pembayaran</Text>
              <Text style={s.docMetaStrong}>No. {data.invoiceNumber}</Text>
              <Text style={s.docMeta}>Periode: {data.periodLabel}</Text>
            </View>
          </View>

          <View style={s.dividerThick} />

          {/* Student info card */}
          <View style={s.infoCard}>
            <View style={s.infoGrid}>
              <View style={s.infoCol}>
                <View style={s.infoRow}>
                  <Text style={s.infoLabel}>Nama</Text>
                  <Text style={s.infoValue}>{data.studentName}</Text>
                </View>
                {data.studentNickname && (
                  <View style={s.infoRow}>
                    <Text style={s.infoLabel}>Panggilan</Text>
                    <Text style={s.infoValue}>{data.studentNickname}</Text>
                  </View>
                )}
                <View style={s.infoRow}>
                  <Text style={s.infoLabel}>Kelas</Text>
                  <Text style={s.infoValue}>{classLine}</Text>
                </View>
              </View>
              <View style={s.infoCol}>
                <View style={s.infoRow}>
                  <Text style={s.infoLabel}>Periode</Text>
                  <Text style={s.infoValue}>{data.periodLabel}</Text>
                </View>
                <View style={s.infoRow}>
                  <Text style={s.infoLabel}>Jatuh Tempo</Text>
                  <Text style={s.infoValue}>{data.dueDate}</Text>
                </View>
                {data.paidAt && (
                  <View style={s.infoRow}>
                    <Text style={s.infoLabel}>Lunas Pada</Text>
                    <Text style={s.infoValue}>{data.paidAt}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Line items */}
          <Text style={s.sectionTitle}>Rincian Tagihan</Text>
          <View style={s.tableHeader}>
            <Text style={[s.tableHeaderText, { width: 25 }]}>No</Text>
            <Text style={[s.tableHeaderText, { flex: 1 }]}>Komponen</Text>
            <Text style={[s.tableHeaderText, { width: 110, textAlign: "right" }]}>Jumlah</Text>
          </View>
          {data.lines.map((line, i) => (
            <View key={i} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
              <Text style={s.tableNo}>{i + 1}</Text>
              <Text style={s.tableLabel}>{line.label}</Text>
              <Text style={s.tableAmount}>{formatRupiah(line.amount)}</Text>
            </View>
          ))}

          <View style={s.subtotalRow}>
            <Text style={[s.subtotalLabel, { paddingLeft: 25 }]}>Total Tagihan</Text>
            <Text style={s.subtotalAmount}>{formatRupiah(data.totalDue)}</Text>
          </View>
          <View style={s.subtotalRow}>
            <Text style={[s.subtotalLabel, { paddingLeft: 25 }]}>Total Dibayar</Text>
            <Text style={s.subtotalAmount}>{formatRupiah(data.totalPaid)}</Text>
          </View>
          <View style={s.subtotalRow}>
            <Text style={[s.subtotalLabel, { paddingLeft: 25 }]}>Sisa</Text>
            <Text style={s.subtotalAmount}>{formatRupiah(data.remaining)}</Text>
          </View>

          {/* Payments */}
          {data.payments.length > 0 && (
            <>
              <Text style={s.sectionTitle}>Riwayat Pembayaran</Text>
              <View style={s.tableHeader}>
                <Text style={[s.tableHeaderText, { width: 90 }]}>Tanggal</Text>
                <Text style={[s.tableHeaderText, { width: 90 }]}>Metode</Text>
                {showReference ? <Text style={[s.tableHeaderText, { flex: 1 }]}>Referensi</Text> : <View style={{ flex: 1 }} />}
                <Text style={[s.tableHeaderText, { width: 110, textAlign: "right" }]}>Jumlah</Text>
              </View>
              {data.payments.map((p, i) => (
                <View key={i} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
                  <Text style={s.payDate}>{p.paidAt}</Text>
                  <Text style={s.payMethod}>{p.method}</Text>
                  {showReference ? <Text style={s.payRef}>{p.reference ?? "—"}</Text> : <View style={{ flex: 1 }} />}
                  <Text style={s.payAmount}>{formatRupiah(p.amount)}</Text>
                </View>
              ))}
            </>
          )}

          {/* Paid box */}
          <View style={s.paidBox}>
            {/* A partly paid invoice also gets a receipt; it must not claim "Lunas". */}
            <Text style={s.paidLabel}>{data.remaining > 0 ? "Dibayar" : "Lunas"}</Text>
            <Text style={s.paidAmount}>{formatRupiah(data.totalPaid)}</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>Diterbitkan: {data.generatedDate}</Text>
          <Text style={s.footerText}>
            Kuitansi ini diterbitkan secara otomatis oleh sistem Talib by An Nisaa&apos; Sekolahku.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
