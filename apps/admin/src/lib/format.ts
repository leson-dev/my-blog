const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD HH:mm" in the browser's time zone. */
export function formatLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatClock(iso)}`;
}

/** "HH:mm" in the browser's time zone. */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
