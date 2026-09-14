import 'server-only';
import type { Database } from 'sqlite';
import { ActionError } from './db';
import { ENCASHMENT_TYPE, LEAVE_TYPES, UNLIMITED_ALLOCATION, type LeaveTypeCode } from './domain/leave-types';
import { formatDisplayDate } from './domain/dates';
import { readSettings } from './settings';

export type Allocations = Record<Exclude<LeaveTypeCode, 'LWP'>, number>;

/** Creates any missing balance rows and sets quotas. LWP always gets the unlimited sentinel. */
export async function upsertAllocations(db: Database, employeeId: number, allocations: Allocations) {
  for (const [type, days] of Object.entries(allocations)) {
    await db.run(
      `INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?)
       ON CONFLICT(employee_id, leave_type) DO UPDATE SET allocated_days = excluded.allocated_days`,
      employeeId,
      type,
      days,
    );
  }
  await db.run(
    `INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, 'LWP', ?)
     ON CONFLICT(employee_id, leave_type) DO NOTHING`,
    employeeId,
    UNLIMITED_ALLOCATION,
  );
}

export function defaultAllocations(): Allocations {
  return Object.fromEntries(LEAVE_TYPES.filter((t) => t.code !== 'LWP').map((t) => [t.code, t.defaultAllocation])) as Allocations;
}

/** Rejects changes dated inside a leave year that has already been closed. */
export async function assertOpenLeaveYear(db: Database, date: string) {
  const { leaveYearStart } = await readSettings(db);
  if (date < leaveYearStart) {
    throw new ActionError(
      `This date is in a closed leave year (the current year started ${formatDisplayDate(leaveYearStart)}). Closed years are read-only.`,
    );
  }
}

export interface BalanceDrift {
  employeeId: number;
  employeeName: string;
  leaveType: string;
  field: 'used_days' | 'encashed_days';
  stored: number;
  expected: number;
}

/**
 * Recomputes used/encashed days from the ledger (leave records, late
 * deductions, encashments) for the current leave year and reports rows whose
 * stored running totals have drifted. With `apply`, writes the corrections.
 */
export async function reconcileBalances(db: Database, apply: boolean): Promise<BalanceDrift[]> {
  const { leaveYearStart } = await readSettings(db);
  const lateMonthStart = leaveYearStart.slice(0, 7);

  const rows = await db.all<
    { employee_id: number; name: string; leave_type: string; used_days: number; encashed_days: number; expected_used: number; expected_encashed: number }[]
  >(
    `SELECT b.employee_id, e.name, b.leave_type, b.used_days, COALESCE(b.encashed_days, 0) AS encashed_days,
       COALESCE((SELECT SUM(r.actual_days) FROM leave_records r
                 WHERE r.employee_id = b.employee_id AND r.leave_type = b.leave_type AND r.start_date >= ?), 0)
       + CASE WHEN b.leave_type = 'Casual' THEN
           COALESCE((SELECT SUM(l.deducted_cl) FROM late_deductions l WHERE l.employee_id = b.employee_id AND l.month_year >= ?), 0)
         ELSE 0 END AS expected_used,
       CASE WHEN b.leave_type = 'Earned' THEN
           COALESCE((SELECT SUM(r.actual_days) FROM leave_records r
                     WHERE r.employee_id = b.employee_id AND r.leave_type = ? AND r.start_date >= ?), 0)
         ELSE COALESCE(b.encashed_days, 0) END AS expected_encashed
     FROM leave_balances b JOIN employees e ON e.id = b.employee_id
     ORDER BY e.name`,
    leaveYearStart,
    lateMonthStart,
    ENCASHMENT_TYPE,
    leaveYearStart,
  );

  const drift: BalanceDrift[] = [];
  const close = (a: number, b: number) => Math.abs(a - b) < 0.001;
  for (const r of rows) {
    if (!close(r.used_days, r.expected_used)) {
      drift.push({ employeeId: r.employee_id, employeeName: r.name, leaveType: r.leave_type, field: 'used_days', stored: r.used_days, expected: r.expected_used });
    }
    if (!close(r.encashed_days, r.expected_encashed)) {
      drift.push({ employeeId: r.employee_id, employeeName: r.name, leaveType: r.leave_type, field: 'encashed_days', stored: r.encashed_days, expected: r.expected_encashed });
    }
  }

  if (apply) {
    for (const d of drift) {
      await db.run(`UPDATE leave_balances SET ${d.field} = ? WHERE employee_id = ? AND leave_type = ?`, d.expected, d.employeeId, d.leaveType);
    }
  }
  return drift;
}
