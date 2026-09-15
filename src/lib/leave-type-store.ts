import 'server-only';
import { cache } from 'react';
import type { Database } from 'sqlite';
import { ActionError, getDb } from './db';
import { BUILTIN_LEAVE_TYPES, PROTECTED_CODES, TONES, UNLIMITED_ALLOCATION, codeFromLabel, type LeaveTypeDef, type Tone } from './domain/leave-types';

interface Row {
  code: string;
  label: string;
  short: string;
  default_allocation: number;
  has_quota: number;
  is_paid: number;
  tone: string;
  sort_order: number;
  active: number;
  builtin: number;
}

function toDef(r: Row): LeaveTypeDef {
  return {
    code: r.code,
    label: r.label,
    short: r.short,
    defaultAllocation: r.default_allocation,
    hasQuota: !!r.has_quota,
    isPaid: !!r.is_paid,
    tone: (TONES as readonly string[]).includes(r.tone) ? (r.tone as Tone) : 'slate',
    sortOrder: r.sort_order,
    active: !!r.active,
    builtin: !!r.builtin,
  };
}

/** All leave types in display order (built-ins first by sort order). Inactive types included unless `activeOnly`. */
export async function readLeaveTypes(db: Database, options: { activeOnly?: boolean } = {}): Promise<LeaveTypeDef[]> {
  try {
    const rows = await db.all<Row[]>(
      `SELECT code, label, short, default_allocation, has_quota, is_paid, tone, sort_order, active, builtin
       FROM leave_types ${options.activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, label COLLATE NOCASE`,
    );
    return rows.map(toDef);
  } catch {
    // Before migration 5 has run (should not happen at runtime): fall back to built-ins.
    return [...BUILTIN_LEAVE_TYPES];
  }
}

/** Per-request cached list for Server Components. */
export const getLeaveTypes = cache(async (): Promise<LeaveTypeDef[]> => readLeaveTypes(await getDb()));

export async function requireActiveLeaveType(db: Database, code: string, allowInactiveCode?: string): Promise<LeaveTypeDef> {
  const types = await readLeaveTypes(db);
  const type = types.find((t) => t.code === code);
  if (!type) throw new ActionError('Choose a leave type.');
  if (!type.active && code !== allowInactiveCode) throw new ActionError(`${type.label} is no longer in use. Choose another leave type.`);
  return type;
}

/**
 * Creates or updates an employee's balance rows for every leave type.
 * Quota types take the given allocation (or the type's default); types
 * without a quota get the unlimited sentinel. Existing used/encashed days are kept.
 */
export async function applyAllocations(db: Database, employeeId: number, allocations: Record<string, number | undefined>) {
  const types = await readLeaveTypes(db);
  for (const t of types) {
    if (t.hasQuota) {
      const given = allocations[t.code];
      if (given === undefined) {
        await db.run(
          `INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?) ON CONFLICT(employee_id, leave_type) DO NOTHING`,
          employeeId, t.code, t.defaultAllocation,
        );
      } else {
        await db.run(
          `INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?)
           ON CONFLICT(employee_id, leave_type) DO UPDATE SET allocated_days = excluded.allocated_days`,
          employeeId, t.code, given,
        );
      }
    } else {
      await db.run(
        `INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?)
         ON CONFLICT(employee_id, leave_type) DO UPDATE SET allocated_days = excluded.allocated_days`,
        employeeId, t.code, UNLIMITED_ALLOCATION,
      );
    }
  }
}

export interface LeaveTypeInput {
  label: string;
  short: string;
  defaultAllocation: number;
  hasQuota: boolean;
  isPaid: boolean;
  tone: Tone;
}

async function assertUniqueNames(db: Database, input: LeaveTypeInput, exceptCode?: string) {
  const clash = await db.get<{ label: string; short: string }>(
    `SELECT label, short FROM leave_types WHERE (label = ? COLLATE NOCASE OR short = ? COLLATE NOCASE) AND code != ?`,
    input.label, input.short, exceptCode ?? '',
  );
  if (clash) {
    throw new ActionError(clash.label.toLowerCase() === input.label.toLowerCase()
      ? `A leave type called "${clash.label}" already exists.`
      : `The short name "${clash.short}" is already used by ${clash.label}.`);
  }
}

/** Adds a custom type and gives every existing employee a balance row for it. */
export async function createLeaveType(db: Database, input: LeaveTypeInput): Promise<LeaveTypeDef> {
  const code = codeFromLabel(input.label);
  if (!code) throw new ActionError('Give the leave type a name made of letters or numbers.');
  if (await db.get('SELECT 1 FROM leave_types WHERE code = ? COLLATE NOCASE', code)) {
    throw new ActionError(`A leave type with the code "${code}" already exists. Choose a different name.`);
  }
  await assertUniqueNames(db, input);
  const max = (await db.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM leave_types WHERE code != ?', 'LWP'))?.m ?? 40;

  await db.run(
    `INSERT INTO leave_types (code, label, short, default_allocation, has_quota, is_paid, tone, sort_order, active, builtin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
    code, input.label, input.short, input.hasQuota ? input.defaultAllocation : 0, input.hasQuota ? 1 : 0, input.isPaid ? 1 : 0, input.tone, Math.min(89, max + 1),
  );
  await db.run(
    `INSERT INTO leave_balances (employee_id, leave_type, allocated_days)
     SELECT id, ?, ? FROM employees WHERE true -- the WHERE lets SQLite parse the upsert after a SELECT
     ON CONFLICT(employee_id, leave_type) DO NOTHING`,
    code, input.hasQuota ? input.defaultAllocation : UNLIMITED_ALLOCATION,
  );
  return (await readLeaveTypes(db)).find((t) => t.code === code)!;
}

/**
 * Edits names, colour and default quota. Whether a type has a quota and is
 * paid can only change for custom types that have never been used, because
 * existing balances and payroll history depend on it.
 */
export async function updateLeaveType(db: Database, code: string, input: LeaveTypeInput & { active: boolean }): Promise<void> {
  const current = (await readLeaveTypes(db)).find((t) => t.code === code);
  if (!current) throw new ActionError('This leave type no longer exists.');
  if (!input.active && PROTECTED_CODES.includes(code)) throw new ActionError(`${current.label} is required by Chuti and cannot be switched off.`);
  await assertUniqueNames(db, input, code);

  const rulesChanged = input.hasQuota !== current.hasQuota || input.isPaid !== current.isPaid;
  if (rulesChanged) {
    if (current.builtin) throw new ActionError(`The quota and pay rules of ${current.label} are fixed.`);
    if (await db.get('SELECT 1 FROM leave_records WHERE leave_type = ? LIMIT 1', code)) {
      throw new ActionError(`${current.label} has already been used, so its quota and pay rules can no longer change. Create a new leave type instead.`);
    }
  }

  await db.run(
    `UPDATE leave_types SET label = ?, short = ?, default_allocation = ?, has_quota = ?, is_paid = ?, tone = ?, active = ? WHERE code = ?`,
    input.label, input.short, input.hasQuota ? input.defaultAllocation : 0, input.hasQuota ? 1 : 0, input.isPaid ? 1 : 0, input.tone, input.active ? 1 : 0, code,
  );
  if (rulesChanged) {
    await db.run('UPDATE leave_balances SET allocated_days = ? WHERE leave_type = ?', input.hasQuota ? input.defaultAllocation : UNLIMITED_ALLOCATION, code);
  }
}

/** Deletes a custom type that has never been used. Used types can only be switched off. */
export async function deleteLeaveType(db: Database, code: string): Promise<LeaveTypeDef> {
  const current = (await readLeaveTypes(db)).find((t) => t.code === code);
  if (!current) throw new ActionError('This leave type no longer exists.');
  if (current.builtin) throw new ActionError(`${current.label} is built in and cannot be deleted.`);
  if (await db.get('SELECT 1 FROM leave_records WHERE leave_type = ? LIMIT 1', code)) {
    throw new ActionError(`${current.label} has leave recorded against it. Switch it off instead, so the history stays intact.`);
  }
  await db.run('DELETE FROM leave_balances WHERE leave_type = ?', code);
  await db.run('DELETE FROM leave_types WHERE code = ?', code);
  return current;
}
