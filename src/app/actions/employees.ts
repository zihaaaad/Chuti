'use server';

import { revalidatePath } from 'next/cache';
import type { Database } from 'sqlite';
import { adminAction, parseInput, type ActionResult } from '@/lib/action';
import { ActionError, withTransaction } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { deleteAttachment } from '@/lib/attachments';
import { defaultAllocations, upsertAllocations } from '@/lib/ledger';
import { employeeSchema } from '@/lib/validation';
import { parseCsv } from '@/lib/domain/csv';
import { isValidDateString, todayLocal } from '@/lib/domain/dates';

async function findOrCreateDepartment(db: Database, rawName: string): Promise<number> {
  const name = rawName.trim();
  const existing = await db.get<{ id: number }>('SELECT id FROM departments WHERE name = ? COLLATE NOCASE', name);
  if (existing) return existing.id;
  return (await db.run('INSERT INTO departments (name) VALUES (?)', name)).lastID!;
}

function revalidateEmployees() {
  revalidatePath('/dashboard', 'layout');
}

export async function addEmployee(formData: FormData): Promise<ActionResult<{ id: number }>> {
  return adminAction('Could not add the employee.', async () => {
    const input = parseInput(employeeSchema, formData);
    const id = await withTransaction(async (db) => {
      if (await db.get('SELECT 1 FROM employees WHERE employee_id = ?', input.employee_id)) {
        throw new ActionError(`Employee ID ${input.employee_id} is already in use.`);
      }
      if (input.email && (await db.get('SELECT 1 FROM employees WHERE email = ? COLLATE NOCASE', input.email))) {
        throw new ActionError('That email address belongs to another employee.');
      }
      const deptId = await findOrCreateDepartment(db, input.department);
      const res = await db.run(
        `INSERT INTO employees (employee_id, name, designation, department_id, join_date, phone, email, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Active')`,
        input.employee_id, input.name, input.designation, deptId, input.joining_date, input.phone, input.email,
      );
      const newId = res.lastID!;
      await upsertAllocations(db, newId, {
        Casual: input.cl_allocated, Sick: input.sl_allocated, Earned: input.el_allocated, Maternity: input.ml_allocated,
      });
      await logAudit(db, 'created', 'employee', newId, `Added ${input.name} (${input.employee_id})`);
      return newId;
    });
    revalidateEmployees();
    return { id };
  });
}

export async function updateEmployee(formData: FormData): Promise<ActionResult> {
  return adminAction('Could not save the employee.', async () => {
    const input = parseInput(employeeSchema, formData);
    if (!input.id) throw new ActionError('Missing employee.');
    const id = input.id;
    await withTransaction(async (db) => {
      const before = await db.get<{ name: string; status: string }>('SELECT name, status FROM employees WHERE id = ?', id);
      if (!before) throw new ActionError('This employee no longer exists.');
      if (await db.get('SELECT 1 FROM employees WHERE employee_id = ? AND id != ?', input.employee_id, id)) {
        throw new ActionError(`Employee ID ${input.employee_id} is already in use.`);
      }
      if (input.email && (await db.get('SELECT 1 FROM employees WHERE email = ? COLLATE NOCASE AND id != ?', input.email, id))) {
        throw new ActionError('That email address belongs to another employee.');
      }
      const deptId = await findOrCreateDepartment(db, input.department);
      await db.run(
        `UPDATE employees SET employee_id = ?, name = ?, designation = ?, department_id = ?, join_date = ?, phone = ?, status = ?, email = ?
         WHERE id = ?`,
        input.employee_id, input.name, input.designation, deptId, input.joining_date, input.phone, input.status, input.email, id,
      );
      await upsertAllocations(db, id, {
        Casual: input.cl_allocated, Sick: input.sl_allocated, Earned: input.el_allocated, Maternity: input.ml_allocated,
      });
      const statusNote = before.status !== input.status ? `; status ${before.status} → ${input.status}` : '';
      await logAudit(db, 'updated', 'employee', id, `Updated ${input.name} (${input.employee_id})${statusNote}`);
    });
    revalidateEmployees();
  });
}

export async function deleteEmployee(id: number): Promise<ActionResult> {
  return adminAction('Could not delete the employee.', async () => {
    if (!Number.isInteger(id) || id <= 0) throw new ActionError('Missing employee.');
    const attachments = await withTransaction(async (db) => {
      const emp = await db.get<{ name: string; employee_id: string }>('SELECT name, employee_id FROM employees WHERE id = ?', id);
      if (!emp) throw new ActionError('This employee no longer exists.');
      const files = await db.all<{ attachment_path: string }[]>(
        'SELECT attachment_path FROM leave_records WHERE employee_id = ? AND attachment_path IS NOT NULL', id,
      );
      // Foreign keys cascade to balances, leave records and late deductions.
      await db.run('DELETE FROM employees WHERE id = ?', id);
      await logAudit(db, 'deleted', 'employee', id, `Deleted ${emp.name} (${emp.employee_id}) and all their records`);
      return files;
    });
    for (const f of attachments) await deleteAttachment(f.attachment_path);
    revalidateEmployees();
  });
}

const MAX_IMPORT_ROWS = 2000;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export interface ImportSummary {
  imported: number;
  skipped: { row: number; reason: string }[];
}

export async function importEmployeesFromCSV(formData: FormData): Promise<ActionResult<ImportSummary>> {
  return adminAction('The CSV import failed. Nothing was imported.', async () => {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) throw new ActionError('Choose a CSV file to import.');
    if (file.size > MAX_IMPORT_BYTES) throw new ActionError('The CSV file is larger than 5 MB.');

    const rows = parseCsv(await file.text());
    if (rows.length < 2) throw new ActionError('The CSV file has no employee rows under the header.');
    if (rows.length - 1 > MAX_IMPORT_ROWS) throw new ActionError(`Import at most ${MAX_IMPORT_ROWS} employees at a time.`);

    const defaults = defaultAllocations();
    // One transaction: an import either lands completely or not at all.
    const summary = await withTransaction(async (db) => {
      const result: ImportSummary = { imported: 0, skipped: [] };
      const seenIds = new Set<string>();
      for (let i = 1; i < rows.length; i++) {
        const rowNo = i + 1;
        const [employee_id = '', name = '', designation = '', department = '', phone = '', joining = '', emailRaw = ''] = rows[i];
        if (!employee_id || !name || !designation || !department) {
          result.skipped.push({ row: rowNo, reason: 'missing ID, name, designation or department' });
          continue;
        }
        if (employee_id.length > 50 || name.length > 100 || designation.length > 100 || department.length > 100 || phone.length > 20) {
          result.skipped.push({ row: rowNo, reason: 'a value is too long' });
          continue;
        }
        if (seenIds.has(employee_id) || (await db.get('SELECT 1 FROM employees WHERE employee_id = ?', employee_id))) {
          result.skipped.push({ row: rowNo, reason: `employee ID ${employee_id} already exists` });
          continue;
        }
        seenIds.add(employee_id);

        let email: string | null = emailRaw.trim() || null;
        if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || (await db.get('SELECT 1 FROM employees WHERE email = ? COLLATE NOCASE', email)))) {
          email = null;
        }
        const joinDate = isValidDateString(joining) ? joining : todayLocal();

        const deptId = await findOrCreateDepartment(db, department);
        const res = await db.run(
          `INSERT INTO employees (employee_id, name, designation, department_id, join_date, phone, email, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'Active')`,
          employee_id, name, designation, deptId, joinDate, phone, email,
        );
        await upsertAllocations(db, res.lastID!, defaults);
        result.imported++;
      }
      await logAudit(db, 'imported', 'import', null, `Imported ${result.imported} employees from ${file.name} (${result.skipped.length} rows skipped)`);
      return result;
    });
    revalidateEmployees();
    return summary;
  });
}
