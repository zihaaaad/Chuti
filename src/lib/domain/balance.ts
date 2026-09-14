export interface BalanceRow {
  allocated_days: number;
  used_days: number;
  encashed_days?: number | null;
  carried_forward?: number | null;
}

/** Days still available: yearly quota + carry-forward − used − encashed. */
export function remainingDays(b: BalanceRow): number {
  return round2(b.allocated_days + (b.carried_forward ?? 0) - b.used_days - (b.encashed_days ?? 0));
}

/** SQL expression for the same formula, for aliased `leave_balances` rows. */
export function remainingSql(alias = 'b'): string {
  return `(${alias}.allocated_days + COALESCE(${alias}.carried_forward, 0) - ${alias}.used_days - COALESCE(${alias}.encashed_days, 0))`;
}

/** CL days cut for `lateCount` late arrivals at `threshold` lates per day. */
export function lateDeduction(lateCount: number, threshold: number): number {
  if (!Number.isFinite(lateCount) || lateCount <= 0) return 0;
  const t = Math.max(1, Math.floor(threshold));
  return Math.floor(lateCount / t);
}

/** Earned leave carried into a new leave year, capped. Never negative. */
export function carryForward(remaining: number, cap: number): number {
  return round2(Math.max(0, Math.min(remaining, Math.max(0, cap))));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
