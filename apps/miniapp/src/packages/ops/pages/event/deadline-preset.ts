/** Calendar arithmetic is independent of the device timezone. */
export function previousEvening(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = new Date(`${date}T12:00:00Z`);
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== date
  )
    return null;
  day.setUTCDate(day.getUTCDate() - 1);
  return { date: day.toISOString().slice(0, 10), time: "20:00" };
}
