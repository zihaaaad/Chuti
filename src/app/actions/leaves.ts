'use server';

import { revalidatePath } from 'next/cache';
import type { Database } from 'sqlite';
import { adminAction, parseInput, type ActionResult } from '@/lib/action';
import { ActionError, getDb, withTransaction } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { attachmentError, deleteAttachment, saveAttachment } from '@/lib/attachments';
import { assertOpenLeaveYear } from '@/lib/ledger';
import { readPolicy, readSettings } from '@/lib/settings';
import { encashmentSchema, leavePreviewSchema, leaveSchema } from '@/lib/validation';
import { breakdownLeaveDays, exceedsMaxSpan, MAX_LEAVE_SPAN_DAYS, type DayBreakdown } from '@/lib/domain/leave-days';
import { hasOverlapConflict } from '@/lib/domain/overlap';
import { remainingDays } from '@/lib/domain/balance';
import { EARNED, ENCASHMENT_TYPE, UNLIMITED_ALLOCATION, leaveTypeInfo, type LeaveTypeDef } from '@/lib/domain/leave-types';
import { readLeaveTypes, requireActiveLeaveType } from '@/lib/leave-type-store';
import { formatDisplayRange, todayLocal } from '@/lib/domain/dates';

function revalidateLeaves() {
  revalidatePath('/dashboard', 'layout');
}

function formatDays(n: number) {
  return `${n} day${n === 1 ? '' : 's'}`;
}

interface BalanceSnapshot {
  allocated_days: number;
  used_days: number;
  encashed_days: number;
  carried_forward: number;
}

async function getBalance(db: Database, employeeId: number, leaveType: string): Promise<BalanceSnapshot | undefined> {
  return db.get<BalanceSnapshot>(
    'SELECT allocated_days, used_days, COALESCE(encashed_days,0) AS encashed_days, COALESCE(carried_forward,0) AS carried_forward FROM leave_balances WHERE employee_id = ? AND leave_type = ?',
    employeeId,
    leaveType,
  );
}

async function overlappingLeaves(db: Database, employeeId: number, start: string, end: string) {
  return db.all<{ id: number; start_date: string; end_date: string; actual_days: number }[]>(
    `SELECT id, start_date, end_date, actual_days FROM leave_records
     WHERE employee_id = ? AND start_date <= ? AND end_date >= ? AND leave_type != ?`,
    employeeId, end, start, ENCASHMENT_TYPE,
  );
}

async function assertActiveEmployee(db: Database, employeeId: number) {
  const emp = await db.get<{ name: string; status: string }>('SELECT name, status FROM employees WHERE id = ?', employeeId);
  if (!emp) throw new ActionError('This employee no longer exists.');
  if (emp.status !== 'Active') throw new ActionError(`${emp.name} is marked ${emp.status}. Set them to Active before recording leave.`);
  return emp;
}

/**
 * Checks and charges a leave inside an open transaction. Shared by add and
 * edit so both apply identical rules. Returns the charged days.
 */
async function chargeLeave(
  db: Database,
  input: { employee_id: number; leave_type: string; start_date: string; end_date: string; is_half_day: boolean },
  ignoreRecordId?: number,
  previousType?: string,
): Promise<{ days: number; type: LeaveTypeDef }> {
  // Editing a record may keep a type that has since been switched off.
  const type = await requireActiveLeaveType(db, input.leave_type, previousType);
  if (exceedsMaxSpan(input.start_date, input.end_date)) {
    throw new ActionError(`A single leave can cover at most ${MAX_LEAVE_SPAN_DAYS} days. Split longer absences into separate records.`);
  }
  await assertOpenLeaveYear(db, input.start_date);

  const policy = await readPolicy(db, { start: input.start_date, end: input.end_date });
  const days = breakdownLeaveDays(input.start_date, input.end_date, input.is_half_day, policy).days;
  if (days <= 0) {
    throw new ActionError('These dates are all weekends or holidays, so no leave would be charged. Check the dates.');
  }

  const existing = await overlappingLeaves(db, input.employee_id, input.start_date, input.end_date);
  if (hasOverlapConflict(input.start_date, input.end_date, input.is_half_day, existing, ignoreRecordId)) {
    throw new ActionError('This employee already has leave recorded on some of these dates.');
  }

  // Make sure a balance row exists (e.g. a type added after this employee), so the charge is never lost.
  await db.run(
    'INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?) ON CONFLICT(employee_id, leave_type) DO NOTHING',
    input.employee_id, type.code, type.hasQuota ? type.defaultAllocation : UNLIMITED_ALLOCATION,
  );

  if (type.hasQuota) {
    const balance = await getBalance(db, input.employee_id, input.leave_type);
    const available = balance ? remainingDays(balance) : 0;
    if (days > available) {
      throw new ActionError(
        `Not enough ${type.label}: ${formatDays(available)} left, ${formatDays(days)} requested. Record the extra days as unpaid leave.`,
      );
    }
  }

  await db.run('UPDATE leave_balances SET used_days = used_days + ? WHERE employee_id = ? AND leave_type = ?', days, input.employee_id, input.leave_type);
  return { days, type };
}

async function refundLeave(db: Database, record: { employee_id: number; leave_type: string; actual_days: number }) {
  if (record.leave_type === ENCASHMENT_TYPE) {
    await db.run(
      "UPDATE leave_balances SET encashed_days = MAX(0, encashed_days - ?) WHERE employee_id = ? AND leave_type = 'Earned'",
      record.actual_days, record.employee_id,
    );
  } else {
    await db.run(
      'UPDATE leave_balances SET used_days = MAX(0, used_days - ?) WHERE employee_id = ? AND leave_type = ?',
      record.actual_days, record.employee_id, record.leave_type,
    );
  }
}

export async function addLeaveRecord(formData: FormData): Promise<ActionResult> {
  return adminAction('Could not record the leave.', async () => {
    const input = parseInput(leaveSchema, formData);
    const file = formData.get('attachment');
    const upload = file instanceof File && file.size > 0 ? file : null;
    const fileProblem = attachmentError(upload);
    if (fileProblem) throw new ActionError(fileProblem);

    // Filesystem work happens before the transaction so the write lock is held briefly.
    const savedPath = upload ? await saveAttachment(upload) : null;
    try {
      await withTransaction(async (db) => {
        const emp = await assertActiveEmployee(db, input.employee_id);
        const { days, type } = await chargeLeave(db, input);
        const res = await db.run(
          `INSERT INTO leave_records (employee_id, leave_type, start_date, end_date, actual_days, reason, attachment_path, remarks, modified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          input.employee_id, input.leave_type, input.start_date, input.end_date, days, input.reason, savedPath, input.remarks,
        );
        await logAudit(db, 'created', 'leave', res.lastID ?? null,
          `${emp.name}: ${type.short} ${formatDays(days)}, ${formatDisplayRange(input.start_date, input.end_date)}`);
      });
    } catch (err) {
      await deleteAttachment(savedPath);
      throw err;
    }
    revalidateLeaves();
  });
}

export async function updateLeaveRecord(formData: FormData): Promise<ActionResult> {
  return adminAction('Could not save the leave record.', async () => {
    const input = parseInput(leaveSchema, formData);
    if (!input.id) throw new ActionError('Missing leave record.');
    const recordId = input.id;
    const file = formData.get('attachment');
    const upload = file instanceof File && file.size > 0 ? file : null;
    const fileProblem = attachmentError(upload);
    if (fileProblem) throw new ActionError(fileProblem);

    const savedPath = upload ? await saveAttachment(upload) : null;
    let obsoletePath: string | null = null;
    try {
      await withTransaction(async (db) => {
        const old = await db.get<{ employee_id: number; leave_type: string; start_date: string; actual_days: number; attachment_path: string | null }>(
          'SELECT employee_id, leave_type, start_date, actual_days, attachment_path FROM leave_records WHERE id = ?', recordId,
        );
        if (!old) throw new ActionError('This leave record no longer exists.');
        if (old.leave_type === ENCASHMENT_TYPE) throw new ActionError('Encashment entries cannot be edited. Delete it and log the encashment again.');
        await assertOpenLeaveYear(db, old.start_date);

        const emp = await assertActiveEmployee(db, input.employee_id);
        await refundLeave(db, old);
        const { days, type } = await chargeLeave(db, input, recordId, old.leave_type);

        let attachment = old.attachment_path;
        if (savedPath || input.delete_attachment) {
          obsoletePath = old.attachment_path;
          attachment = savedPath;
        }
        await db.run(
          `UPDATE leave_records SET employee_id = ?, leave_type = ?, start_date = ?, end_date = ?, actual_days = ?, reason = ?,
             attachment_path = ?, remarks = ?, modified_at = CURRENT_TIMESTAMP WHERE id = ?`,
          input.employee_id, input.leave_type, input.start_date, input.end_date, days, input.reason, attachment, input.remarks, recordId,
        );
        await logAudit(db, 'updated', 'leave', recordId,
          `${emp.name}: now ${type.short} ${formatDays(days)}, ${formatDisplayRange(input.start_date, input.end_date)} (was ${formatDays(old.actual_days)})`);
      });
    } catch (err) {
      await deleteAttachment(savedPath);
      throw err;
    }
    await deleteAttachment(obsoletePath);
    revalidateLeaves();
  });
}

export async function deleteLeaveRecord(id: number): Promise<ActionResult<{ refunded: number }>> {
  return adminAction('Could not delete the leave record.', async () => {
    if (!Number.isInteger(id) || id <= 0) throw new ActionError('Missing leave record.');
    const record = await withTransaction(async (db) => {
      const rec = await db.get<{ employee_id: number; leave_type: string; start_date: string; end_date: string; actual_days: number; attachment_path: string | null; name: string }>(
        `SELECT r.employee_id, r.leave_type, r.start_date, r.end_date, r.actual_days, r.attachment_path, e.name
         FROM leave_records r JOIN employees e ON e.id = r.employee_id WHERE r.id = ?`, id,
      );
      if (!rec) throw new ActionError('This leave record no longer exists.');
      await assertOpenLeaveYear(db, rec.start_date);
      await refundLeave(db, rec);
      await db.run('DELETE FROM leave_records WHERE id = ?', id);
      const short = leaveTypeInfo(await readLeaveTypes(db), rec.leave_type).short;
      await logAudit(db, 'deleted', rec.leave_type === ENCASHMENT_TYPE ? 'encashment' : 'leave', id,
        `${rec.name}: removed ${short} ${formatDays(rec.actual_days)}, ${formatDisplayRange(rec.start_date, rec.end_date)}; refunded to balance`);
      return rec;
    });
    await deleteAttachment(record.attachment_path);
    revalidateLeaves();
    return { refunded: record.actual_days };
  });
}

export async function logLeaveEncashment(formData: FormData): Promise<ActionResult> {
  return adminAction('Could not log the encashment.', async () => {
    const input = parseInput(encashmentSchema, formData);
    await withTransaction(async (db) => {
      const emp = await db.get<{ name: string }>('SELECT name FROM employees WHERE id = ?', input.employee_id);
      if (!emp) throw new ActionError('This employee no longer exists.');
      const today = todayLocal();
      await assertOpenLeaveYear(db, today);
      const balance = await getBalance(db, input.employee_id, EARNED);
      const available = balance ? remainingDays(balance) : 0;
      if (input.encash_days > available) {
        throw new ActionError(`${emp.name} has ${formatDays(available)} of Earned Leave available to encash.`);
      }
      await db.run("UPDATE leave_balances SET encashed_days = COALESCE(encashed_days,0) + ? WHERE employee_id = ? AND leave_type = 'Earned'", input.encash_days, input.employee_id);
      const res = await db.run(
        `INSERT INTO leave_records (employee_id, leave_type, start_date, end_date, actual_days, reason, remarks, modified_at)
         VALUES (?, ?, ?, ?, ?, 'Earned Leave encashment', ?, CURRENT_TIMESTAMP)`,
        input.employee_id, ENCASHMENT_TYPE, today, today, input.encash_days, input.remarks,
      );
      await logAudit(db, 'created', 'encashment', res.lastID ?? null, `${emp.name}: encashed ${formatDays(input.encash_days)} of EL`);
    });
    revalidateLeaves();
  });
}

export interface LeavePreview extends DayBreakdown {
  balanceBefore: number | null;
  balanceAfter: number | null;
  overlap: boolean;
  closedYear: boolean;
}

/** Live "what will this charge?" feedback for the leave form. Read-only. */
export async function previewLeave(input: {
  employee_id?: number;
  leave_type: string;
  start_date: string;
  end_date: string;
  is_half_day: boolean;
  ignore_record_id?: number;
}): Promise<ActionResult<LeavePreview>> {
  return adminAction('Could not calculate the leave.', async () => {
    const v = parseInput(leavePreviewSchema, input);
    const end = v.is_half_day ? v.start_date : v.end_date;
    const db = await getDb();
    const settings = await readSettings(db);
    const policy = await readPolicy(db, { start: v.start_date, end });
    const breakdown = breakdownLeaveDays(v.start_date, end, v.is_half_day, policy);

    let balanceBefore: number | null = null;
    let overlap = false;
    if (v.employee_id) {
      const existing = await overlappingLeaves(db, v.employee_id, v.start_date, end);
      overlap = hasOverlapConflict(v.start_date, end, v.is_half_day, existing, v.ignore_record_id);
      const type = (await readLeaveTypes(db)).find((t) => t.code === v.leave_type);
      if (type?.hasQuota) {
        const balance = await getBalance(db, v.employee_id, v.leave_type);
        balanceBefore = balance ? remainingDays(balance) : 0;
        if (v.ignore_record_id) {
          // Editing: the record's own days are refunded before re-charging, so count them as available.
          const old = await db.get<{ employee_id: number; leave_type: string; actual_days: number }>(
            'SELECT employee_id, leave_type, actual_days FROM leave_records WHERE id = ?', v.ignore_record_id,
          );
          if (old && old.leave_type === v.leave_type && old.employee_id === v.employee_id) balanceBefore += old.actual_days;
        }
      }
    }
    return {
      ...breakdown,
      balanceBefore,
      balanceAfter: balanceBefore === null ? null : balanceBefore - breakdown.days,
      overlap,
      closedYear: v.start_date < settings.leaveYearStart,
    };
  });
}

