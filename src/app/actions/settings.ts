'use server';

import { revalidatePath } from 'next/cache';
import { adminAction, parseInput, type ActionResult } from '@/lib/action';
import { ActionError, withTransaction } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { readSettings, setSetting } from '@/lib/settings';
import { departmentSchema, holidaySchema, settingsSchema } from '@/lib/validation';
import { formatDisplayRange } from '@/lib/domain/dates';

function revalidateAll() {
  revalidatePath('/', 'layout');
}

export async function updateSystemSettings(formData: FormData): Promise<ActionResult> {
  return adminAction('Could not save settings.', async () => {
    const input = parseInput(settingsSchema, formData);
    await withTransaction(async (db) => {
      const before = await readSettings(db);
      await setSetting(db, 'institute_name', input.institute_name);
      await setSetting(db, 'weekend_days', input.weekend_days.join(','));
      await setSetting(db, 'sandwich_rule', String(input.sandwich_rule));
      await setSetting(db, 'late_cl_threshold', String(input.late_cl_threshold));
      await setSetting(db, 'el_carry_cap', String(input.el_carry_cap));

      const changes: string[] = [];
      if (before.instituteName !== input.institute_name) changes.push(`name → "${input.institute_name}"`);
      if (before.weekendDays.join(',') !== input.weekend_days.join(',')) changes.push(`weekend → ${input.weekend_days.join(', ') || 'none'}`);
      if (before.sandwichRule !== input.sandwich_rule) changes.push(`sandwich rule ${input.sandwich_rule ? 'on' : 'off'}`);
      if (before.lateThreshold !== input.late_cl_threshold) changes.push(`late threshold → ${input.late_cl_threshold}`);
      if (before.elCarryCap !== input.el_carry_cap) changes.push(`EL carry cap → ${input.el_carry_cap}`);
      if (changes.length) await logAudit(db, 'updated', 'settings', null, `Settings: ${changes.join('; ')}`);
    });
    revalidateAll();
  });
}

export async function addHoliday(formData: FormData): Promise<ActionResult> {
  return adminAction('Could not add the holiday.', async () => {
    const input = parseInput(holidaySchema, formData);
    await withTransaction(async (db) => {
      const res = await db.run('INSERT INTO holidays (title, start_date, end_date) VALUES (?, ?, ?)', input.title, input.start_date, input.end_date);
      await logAudit(db, 'created', 'holiday', res.lastID ?? null, `Holiday "${input.title}", ${formatDisplayRange(input.start_date, input.end_date)}`);
    });
    revalidateAll();
  });
}

export async function deleteHoliday(id: number): Promise<ActionResult> {
  return adminAction('Could not delete the holiday.', async () => {
    await withTransaction(async (db) => {
      const h = await db.get<{ title: string }>('SELECT title FROM holidays WHERE id = ?', id);
      if (!h) throw new ActionError('This holiday no longer exists.');
      await db.run('DELETE FROM holidays WHERE id = ?', id);
      await logAudit(db, 'deleted', 'holiday', id, `Removed holiday "${h.title}"`);
    });
    revalidateAll();
  });
}

export async function addDepartment(formData: FormData): Promise<ActionResult> {
  return adminAction('Could not add the department.', async () => {
    const input = parseInput(departmentSchema, formData);
    await withTransaction(async (db) => {
      const existing = await db.get<{ name: string }>('SELECT name FROM departments WHERE name = ? COLLATE NOCASE', input.name);
      if (existing) throw new ActionError(`The department "${existing.name}" already exists.`);
      const res = await db.run('INSERT INTO departments (name) VALUES (?)', input.name);
      await logAudit(db, 'created', 'department', res.lastID ?? null, `Department "${input.name}"`);
    });
    revalidateAll();
  });
}

export async function deleteDepartment(id: number): Promise<ActionResult> {
  return adminAction('Could not delete the department.', async () => {
    await withTransaction(async (db) => {
      const dept = await db.get<{ name: string }>('SELECT name FROM departments WHERE id = ?', id);
      if (!dept) throw new ActionError('This department no longer exists.');
      const { count } = (await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM employees WHERE department_id = ?', id)) ?? { count: 0 };
      if (count > 0) {
        throw new ActionError(`${count} employee${count === 1 ? ' is' : 's are'} still in "${dept.name}". Move them to another department first.`);
      }
      await db.run('DELETE FROM departments WHERE id = ?', id);
      await logAudit(db, 'deleted', 'department', id, `Removed department "${dept.name}"`);
    });
    revalidateAll();
  });
}
