'use server';

import { revalidatePath } from 'next/cache';
import { adminAction, parseInput, type ActionResult } from '@/lib/action';
import { ActionError, getDb, withTransaction } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { assertOpenLeaveYear } from '@/lib/ledger';
import { recomputeLateMonth, type LateMonthSummary } from '@/lib/late-arrivals';
import { readPolicy } from '@/lib/settings';
import { lateArrivalSchema } from '@/lib/validation';
import { breakdownLeaveDays } from '@/lib/domain/leave-days';
import { ENCASHMENT_TYPE } from '@/lib/domain/leave-types';
import { formatDisplayDate, isValidMonthString, monthBounds, todayLocal } from '@/lib/domain/dates';

function formatDays(n: number) {
  return `${n} day${n === 1 ? '' : 's'}`;
}

export async function addLateArrival(formData: FormData): Promise<ActionResult<LateMonthSummary>> {
  return adminAction('Could not save the late arrival.', async () => {
    const input = parseInput(lateArrivalSchema, formData);
    if (input.date > todayLocal()) throw new ActionError('A late arrival cannot be recorded for a future date.');

    const summary = await withTransaction(async (db) => {
      const emp = await db.get<{ name: string; status: string }>('SELECT name, status FROM employees WHERE id = ?', input.employee_id);
      if (!emp) throw new ActionError('This employee no longer exists.');
      if (emp.status !== 'Active') throw new ActionError(`${emp.name} is marked ${emp.status}.`);
      await assertOpenLeaveYear(db, input.date);

      const policy = await readPolicy(db, { start: input.date, end: input.date });
      if (breakdownLeaveDays(input.date, input.date, false, policy).workingDays === 0) {
        throw new ActionError(`${formatDisplayDate(input.date)} is a weekly day off or a holiday.`);
      }
      const onLeave = await db.get<{ leave_type: string }>(
        `SELECT leave_type FROM leave_records WHERE employee_id = ? AND ? BETWEEN start_date AND end_date
         AND leave_type != ? AND actual_days != 0.5`,
        input.employee_id, input.date, ENCASHMENT_TYPE,
      );
      if (onLeave) throw new ActionError(`${emp.name} is on ${onLeave.leave_type} leave on ${formatDisplayDate(input.date)}.`);
      if (await db.get('SELECT 1 FROM late_arrivals WHERE employee_id = ? AND date = ?', input.employee_id, input.date)) {
        throw new ActionError(`A late arrival is already recorded for ${emp.name} on ${formatDisplayDate(input.date)}.`);
      }

      const res = await db.run(
        'INSERT INTO late_arrivals (employee_id, date, minutes_late, note) VALUES (?, ?, ?, ?)',
        input.employee_id, input.date, input.minutes_late, input.note || null,
      );
      const month = input.date.slice(0, 7);
      const result = await recomputeLateMonth(db, input.employee_id, month);
      await logAudit(db, 'created', 'late', res.lastID ?? null,
        `${emp.name}: late on ${formatDisplayDate(input.date)}${input.minutes_late ? ` (${input.minutes_late} min)` : ''}; ${result.lateCount} this month → ${formatDays(result.deducted)} CL cut${result.capped ? ' (capped, CL used up)' : ''}`);
      return result;
    });
    revalidatePath('/dashboard', 'layout');
    return summary;
  });
}

export async function deleteLateArrival(id: number): Promise<ActionResult<LateMonthSummary>> {
  return adminAction('Could not remove the late arrival.', async () => {
    if (!Number.isInteger(id) || id <= 0) throw new ActionError('Missing late arrival.');
    const summary = await withTransaction(async (db) => {
      const row = await db.get<{ employee_id: number; date: string; name: string }>(
        'SELECT l.employee_id, l.date, e.name FROM late_arrivals l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?', id,
      );
      if (!row) throw new ActionError('This late arrival no longer exists.');
      await assertOpenLeaveYear(db, row.date);
      await db.run('DELETE FROM late_arrivals WHERE id = ?', id);
      const result = await recomputeLateMonth(db, row.employee_id, row.date.slice(0, 7));
      await logAudit(db, 'deleted', 'late', id, `${row.name}: removed late arrival on ${formatDisplayDate(row.date)}; CL cut now ${formatDays(result.deducted)}`);
      return result;
    });
    revalidatePath('/dashboard', 'layout');
    return summary;
  });
}

/** Removes a monthly total recorded before per-date logging existed. */
export async function clearUndatedLates(employeeId: number, month: string): Promise<ActionResult<LateMonthSummary>> {
  return adminAction('Could not clear the monthly total.', async () => {
    if (!Number.isInteger(employeeId) || employeeId <= 0 || !isValidMonthString(month)) throw new ActionError('Invalid request.');
    const summary = await withTransaction(async (db) => {
      const emp = await db.get<{ name: string }>('SELECT name FROM employees WHERE id = ?', employeeId);
      if (!emp) throw new ActionError('This employee no longer exists.');
      await assertOpenLeaveYear(db, `${month}-01`);
      await db.run('UPDATE late_deductions SET undated_count = 0 WHERE employee_id = ? AND month_year = ?', employeeId, month);
      const result = await recomputeLateMonth(db, employeeId, month);
      await logAudit(db, 'deleted', 'late', employeeId, `${emp.name}: cleared the undated late-arrival total for ${month}`);
      return result;
    });
    revalidatePath('/dashboard', 'layout');
    return summary;
  });
}

export interface LateArrivalEntry {
  id: number;
  date: string;
  minutesLate: number | null;
  note: string | null;
}

/** An employee's late arrivals in a month, for the logger. */
export async function getLateMonth(employeeId: number, month: string): Promise<ActionResult<{ entries: LateArrivalEntry[]; undatedCount: number; deducted: number }>> {
  return adminAction('Could not load late arrivals.', async () => {
    if (!Number.isInteger(employeeId) || employeeId <= 0 || !isValidMonthString(month)) throw new ActionError('Invalid request.');
    const db = await getDb();
    const { start, end } = monthBounds(month);
    const entries = await db.all<LateArrivalEntry[]>(
      'SELECT id, date, minutes_late AS minutesLate, note FROM late_arrivals WHERE employee_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC',
      employeeId, start, end,
    );
    const summary = await db.get<{ undated_count: number | null; deducted_cl: number }>(
      'SELECT undated_count, deducted_cl FROM late_deductions WHERE employee_id = ? AND month_year = ?', employeeId, month,
    );
    return { entries, undatedCount: summary?.undated_count ?? 0, deducted: summary?.deducted_cl ?? 0 };
  });
}
