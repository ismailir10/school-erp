import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

import { TEAL, DARK, MUTED_FOREGROUND as GRAY, LIGHT_BG as LIGHT, BORDER } from "./brand-tokens";
import { LEVEL_HEX, type Level } from "@/lib/curriculum/level-presentation";

export type ReportCardSection = {
  label: string;
  level: string | null; // already display-formatted (Indonesian) or null
  levelKey?: Level | null; // raw level key — drives chip color via LEVEL_HEX
  narrative: string;
};

export type ReportCardData = {
  schoolName: string;
  studentName: string;
  className: string | null;
  termLabel: string;
  sections: ReportCardSection[];
  attendance: { sick: number; permitted: number; unexcused: number; total: number };
  hafalan: string | null;
  height: string | null;
  weight: string | null;
  generatedDate: string;
};

const s = StyleSheet.create({
  page: { padding: 0, fontSize: 10, fontFamily: "Helvetica", color: "#1F2937" },
  accentBar: { height: 6, backgroundColor: TEAL },
  content: { padding: 40, paddingTop: 26 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  schoolName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: DARK, letterSpacing: 0.3 },
  docTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", color: TEAL, textTransform: "uppercase", letterSpacing: 2, textAlign: "right" },
  docMeta: { fontSize: 8, color: GRAY, marginTop: 3, textAlign: "right" },
  divider: { borderBottomWidth: 2, borderBottomColor: TEAL, marginTop: 6, marginBottom: 14 },
  metaRow: { flexDirection: "row", marginBottom: 3 },
  metaLabel: { width: 90, color: GRAY },
  metaValue: { fontFamily: "Helvetica-Bold", color: DARK },
  section: { marginBottom: 12 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 3 },
  sectionTitle: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: DARK },
  levelChip: { fontSize: 8, fontFamily: "Helvetica-Bold", color: TEAL, backgroundColor: LIGHT, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3 },
  narrative: { fontSize: 9.5, lineHeight: 1.5, color: "#374151" },
  empty: { fontSize: 9.5, color: GRAY, fontStyle: "italic" },
  attTable: { flexDirection: "row", borderWidth: 1, borderColor: BORDER, borderRadius: 4, marginBottom: 12, overflow: "hidden" },
  attCell: { flex: 1, padding: 6, borderRightWidth: 1, borderRightColor: BORDER },
  attCellLast: { flex: 1, padding: 6 },
  attLabel: { fontSize: 7.5, color: GRAY, textTransform: "uppercase" },
  attValue: { fontSize: 13, fontFamily: "Helvetica-Bold", color: DARK, marginTop: 2 },
  smallHead: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: DARK, marginBottom: 3 },
  signRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 36 },
  signCol: { width: "30%", alignItems: "center" },
  signLine: { borderTopWidth: 1, borderTopColor: DARK, width: "100%", marginTop: 40, paddingTop: 3, textAlign: "center", fontSize: 8, color: GRAY },
});

export function ReportCardPdf({ data }: { data: ReportCardData }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.accentBar} />
        <View style={s.content}>
          <View style={s.headerRow}>
            <View>
              <Text style={s.schoolName}>{data.schoolName}</Text>
              <Text style={{ fontSize: 8, color: GRAY, marginTop: 2 }}>Laporan Perkembangan Anak</Text>
            </View>
            <View>
              <Text style={s.docTitle}>Rapor Triwulan</Text>
              <Text style={s.docMeta}>{data.generatedDate}</Text>
            </View>
          </View>
          <View style={s.divider} />

          <View style={{ marginBottom: 14 }}>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Nama</Text>
              <Text style={s.metaValue}>{data.studentName}</Text>
            </View>
            {data.className ? (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Kelas</Text>
                <Text style={s.metaValue}>{data.className}</Text>
              </View>
            ) : null}
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Periode</Text>
              <Text style={s.metaValue}>{data.termLabel}</Text>
            </View>
          </View>

          {data.sections.map((sec, i) => (
            <View key={i} style={s.section} wrap={false}>
              <View style={s.sectionHead}>
                <Text style={s.sectionTitle}>{sec.label}</Text>
                {sec.level ? (
                  <Text style={[s.levelChip, ...(sec.levelKey ? [{ color: LEVEL_HEX[sec.levelKey] }] : [])]}>
                    {sec.level}
                  </Text>
                ) : null}
              </View>
              {sec.narrative ? (
                <Text style={s.narrative}>{sec.narrative}</Text>
              ) : (
                <Text style={s.empty}>—</Text>
              )}
            </View>
          ))}

          <Text style={s.smallHead}>Kehadiran</Text>
          <View style={s.attTable}>
            <View style={s.attCell}>
              <Text style={s.attLabel}>Sakit</Text>
              <Text style={s.attValue}>{data.attendance.sick}</Text>
            </View>
            <View style={s.attCell}>
              <Text style={s.attLabel}>Izin</Text>
              <Text style={s.attValue}>{data.attendance.permitted}</Text>
            </View>
            <View style={s.attCell}>
              <Text style={s.attLabel}>Alpa</Text>
              <Text style={s.attValue}>{data.attendance.unexcused}</Text>
            </View>
            <View style={s.attCellLast}>
              <Text style={s.attLabel}>Hari Sekolah</Text>
              <Text style={s.attValue}>{data.attendance.total}</Text>
            </View>
          </View>

          {data.height || data.weight ? (
            <>
              <Text style={s.smallHead}>Pertumbuhan</Text>
              <Text style={s.narrative}>
                {data.height ? `Tinggi: ${data.height} cm` : ""}
                {data.height && data.weight ? "   ·   " : ""}
                {data.weight ? `Berat: ${data.weight} kg` : ""}
              </Text>
            </>
          ) : null}

          {data.hafalan ? (
            <View style={{ marginTop: 12 }}>
              <Text style={s.smallHead}>Hafalan</Text>
              <Text style={s.narrative}>{data.hafalan}</Text>
            </View>
          ) : null}

          <View style={s.signRow}>
            <View style={s.signCol}>
              <Text style={s.signLine}>Wali Kelas</Text>
            </View>
            <View style={s.signCol}>
              <Text style={s.signLine}>Kepala Sekolah</Text>
            </View>
            <View style={s.signCol}>
              <Text style={s.signLine}>Orang Tua / Wali</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
