import { Button } from "@/components/ui/button";

export function normalizeWeeklyDate(value: string | undefined, fallback: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? fallback
    : value;
}

export function WeeklyDateRecovery({ date }: { date: string }) {
  return (
    <form action="/teacher/assessments/weekly" method="get" className="space-y-3">
      <label htmlFor="weekly-recovery-date" className="block text-sm font-medium">
        Pilih tanggal lain
      </label>
      <input
        id="weekly-recovery-date"
        name="date"
        type="date"
        defaultValue={date}
        required
        className="tap-target w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      <Button type="submit" className="tap-target w-full">Lihat penilaian</Button>
    </form>
  );
}
