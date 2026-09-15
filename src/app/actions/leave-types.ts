'use server';

import { revalidatePath } from 'next/cache';
import { adminAction, parseInput, type ActionResult } from '@/lib/action';
import { withTransaction } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { leaveTypeSchema } from '@/lib/validation';
import { createLeaveType, deleteLeaveType, updateLeaveType, type LeaveTypeInput } from '@/lib/leave-type-store';

function toInput(formData: FormData) {
  const input = parseInput(leaveTypeSchema, formData);
  const value: LeaveTypeInput & { active: boolean } = {
    label: input.label,
    short: input.short.toUpperCase(),
    defaultAllocation: input.default_allocation,
    hasQuota: input.has_quota,
    isPaid: input.is_paid,
    tone: input.tone,
    active: input.active,
  };
  return value;
}

const describe = (t: LeaveTypeInput) =>
  `${t.label} (${t.short}): ${t.hasQuota ? `${t.defaultAllocation} days a year` : 'no quota'}, ${t.isPaid ? 'paid' : 'unpaid'}`;

export async function addLeaveType(formData: FormData): Promise<ActionResult<{ code: string }>> {
  return adminAction('Could not add the leave type.', async () => {
    const input = toInput(formData);
    const created = await withTransaction(async (db) => {
      const t = await createLeaveType(db, input);
      await logAudit(db, 'created', 'leave_type', t.code, `Leave type ${describe(input)}`);
      return t;
    });
    revalidatePath('/', 'layout');
    return { code: created.code };
  });
}

export async function editLeaveType(code: string, formData: FormData): Promise<ActionResult> {
  return adminAction('Could not save the leave type.', async () => {
    const input = toInput(formData);
    await withTransaction(async (db) => {
      await updateLeaveType(db, code, input);
      await logAudit(db, 'updated', 'leave_type', code, `Leave type ${describe(input)}${input.active ? '' : ', switched off'}`);
    });
    revalidatePath('/', 'layout');
  });
}

export async function removeLeaveType(code: string): Promise<ActionResult> {
  return adminAction('Could not delete the leave type.', async () => {
    await withTransaction(async (db) => {
      const removed = await deleteLeaveType(db, code);
      await logAudit(db, 'deleted', 'leave_type', code, `Leave type ${removed.label} (${removed.short})`);
    });
    revalidatePath('/', 'layout');
  });
}
