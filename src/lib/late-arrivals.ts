import 'server-only';
import type { Database } from 'sqlite';
import { lateDeduction, remainingDays } from './domain/balance';
import { monthBounds } from './domain/dates';
import { readSettings } from './settings';

export interface LateMonthSummary {
  lateCount: number;
  datedCount: number;
  undatedCount: number;
  deducted: number;
  wanted: number;
  capped: boolean;
}

/**
 * Recalculates one employee's late-arrival summary for a month from the dated
 * entries (plus any undated total from before per-date logging) and moves the
 * Casual Leave cut accordingly. Call inside a transaction after every change.
 * The cut never takes CL below zero.
 */
export async function recomputeLateMonth(db: Database, employeeId: number, month: string): Promise<LateMonthSummary> {
  const { start, end } = monthBounds(month);
  const { lateThreshold } = await readSettings(db);

  const existing = await db.get<{ id: number; undated_count: number | null; deducted_cl: number }>(
    'SELECT id, undated_count, deducted_cl FROM late_deductions WHERE employee_id = ? AND month_year = ?',
    employeeId,
    month,
  );
  const dated = (await db.get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM late_arrivals WHERE employee_id = ? AND date BETWEEN ? AND ?',
    employeeId,
    start,
    end,
  ))?.c ?? 0;
  const undated = existing?.undated_count ?? 0;
  const total = dated + undated;

  // Undo the previous cut, then apply the new one against what is available.
  const previous = existing?.deducted_cl ?? 0;
  await db.run("UPDATE leave_balances SET used_days = MAX(0, used_days - ?) WHERE employee_id = ? AND leave_type = 'Casual'", previous, employeeId);
  const balance = await db.get<{ allocated_days: number; used_days: number; encashed_days: number; carried_forward: number }>(
    "SELECT allocated_days, used_days, COALESCE(encashed_days,0) AS encashed_days, COALESCE(carried_forward,0) AS carried_forward FROM leave_balances WHERE employee_id = ? AND leave_type = 'Casual'",
    employeeId,
  );
  const available = Math.max(0, balance ? remainingDays(balance) : 0);
  const wanted = lateDeduction(total, lateThreshold);
  const deducted = Math.min(wanted, Math.floor(available * 2) / 2);

  if (total === 0) {
    if (existing) await db.run('DELETE FROM late_deductions WHERE id = ?', existing.id);
  } else if (existing) {
    await db.run('UPDATE late_deductions SET late_count = ?, deducted_cl = ? WHERE id = ?', total, deducted, existing.id);
  } else {
    await db.run(
      'INSERT INTO late_deductions (employee_id, month_year, late_count, deducted_cl, undated_count) VALUES (?, ?, ?, ?, 0)',
      employeeId,
      month,
      total,
      deducted,
    );
  }
  if (deducted > 0) {
    await db.run("UPDATE leave_balances SET used_days = used_days + ? WHERE employee_id = ? AND leave_type = 'Casual'", deducted, employeeId);
  }

  return { lateCount: total, datedCount: dated, undatedCount: undated, deducted, wanted, capped: deducted < wanted };
}
