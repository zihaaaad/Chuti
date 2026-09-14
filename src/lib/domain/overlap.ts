import { eachDay, type ISODate } from './dates';

export interface ExistingLeave {
  id: number;
  start_date: ISODate;
  end_date: ISODate;
  actual_days: number;
}

/**
 * True when adding a leave would put more than one full day of leave on any
 * date. Two half-days on the same date are allowed; a half-day plus a full
 * day is not. Pass `ignoreId` when editing so the record doesn't clash with itself.
 */
export function hasOverlapConflict(
  start: ISODate,
  end: ISODate,
  isHalfDay: boolean,
  existing: readonly ExistingLeave[],
  ignoreId?: number,
): boolean {
  const others = existing.filter((r) => r.id !== ignoreId && r.start_date <= end && r.end_date >= start);
  if (others.length === 0) return false;

  const newWeight = isHalfDay ? 0.5 : 1;
  for (const date of eachDay(start, end)) {
    let taken = 0;
    for (const r of others) {
      if (date >= r.start_date && date <= r.end_date) {
        taken += r.actual_days === 0.5 ? 0.5 : 1;
      }
    }
    if (taken + newWeight > 1) return true;
  }
  return false;
}
