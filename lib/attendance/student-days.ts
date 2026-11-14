/** One school date contributes one status. A daily mark overrides session marks;
 * without a daily mark, attendance in any session counts as present, then
 * excused absence takes precedence over an unexcused absence. */
export function studentDays<T extends { studentId: string; date: string; sessionId: string | null; status: string; classSectionId?: string }>(records: T[]): T[] {
  const days = new Map<string, T>();
  const rank: Record<string, number> = { PRESENT: 4, SICK: 3, PERMISSION: 2, ABSENT: 1 };
  for (const record of records) {
    const key = `${record.studentId}:${record.classSectionId ?? ""}:${record.date}`;
    const previous = days.get(key);
    if (!previous || (record.sessionId === null && previous.sessionId !== null) ||
      ((record.sessionId === null) === (previous.sessionId === null) && (rank[record.status] ?? 0) > (rank[previous.status] ?? 0))) {
      days.set(key, record);
    }
  }
  return [...days.values()];
}
