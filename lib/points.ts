/** Detective points the sender of a video earns once it has been revealed. */
export const SENDER_BONUS = 0.5;

/** Detective points are whole numbers plus the odd half: 3 -> "3", 3.5 -> "3.5". */
export function fmtPoints(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
