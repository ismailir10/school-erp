export const ANALYTICS_HEADING_ID = "dashboard-analytics-heading";

/** Section title row shared by the real section and its skeleton. */
export function AnalyticsHeading() {
  return (
    <div>
      <h2 id={ANALYTICS_HEADING_ID} className="text-h2 font-semibold">
        Analitik
      </h2>
      <p className="text-body text-muted-foreground">Tren kehadiran siswa, buku penghubung, dan keuangan sekolah.</p>
    </div>
  );
}
