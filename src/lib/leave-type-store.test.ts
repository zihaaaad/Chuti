import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chuti-types-'));
process.env.APP_DATA_DIR = dataDir;

type Mods = { db: typeof import('./db'); store: typeof import('./leave-type-store') };
let m: Mods;
let empId: number;

const study = { label: 'Study Leave', short: 'STL', defaultAllocation: 7, hasQuota: true, isPaid: true, tone: 'teal' as const };

beforeAll(async () => {
  m = { db: await import('./db'), store: await import('./leave-type-store') };
  const db = await m.db.getDb();
  await db.run("INSERT INTO departments (name) VALUES ('Science')");
  const res = await db.run("INSERT INTO employees (name, employee_id, designation, department_id, join_date) VALUES ('Rahim', 'EMP-001', 'Lecturer', 1, '2026-01-01')");
  empId = res.lastID!;
  await m.db.withTransaction((tx) => m.store.applyAllocations(tx, empId, { Casual: 12 }));
});

afterAll(async () => {
  await m.db.withExclusiveAccess(() => m.db.closeDbUnlocked());
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const balance = async (type: string) =>
  (await m.db.getDb()).get<{ allocated_days: number }>('SELECT allocated_days FROM leave_balances WHERE employee_id = ? AND leave_type = ?', empId, type);

describe('leave type store', () => {
  it('seeds the built-in types and gives new employees a balance for each', async () => {
    const types = await m.store.readLeaveTypes(await m.db.getDb());
    expect(types.map((t) => t.code)).toEqual(['Casual', 'Sick', 'Earned', 'Maternity', 'LWP']);
    expect((await balance('Casual'))?.allocated_days).toBe(12);
    expect((await balance('Sick'))?.allocated_days).toBe(14);
    expect((await balance('LWP'))?.allocated_days).toBe(9999);
  });

  it('creates a custom type with balances for existing employees, ordered before LWP', async () => {
    const t = await m.db.withTransaction((tx) => m.store.createLeaveType(tx, study));
    expect(t).toMatchObject({ code: 'Study Leave', builtin: false, active: true });
    expect((await balance('Study Leave'))?.allocated_days).toBe(7);
    const codes = (await m.store.readLeaveTypes(await m.db.getDb())).map((x) => x.code);
    expect(codes.indexOf('Study Leave')).toBeLessThan(codes.indexOf('LWP'));
  });

  it('rejects duplicate names and short names', async () => {
    await expect(m.db.withTransaction((tx) => m.store.createLeaveType(tx, { ...study, label: 'study leave', short: 'X' }))).rejects.toThrow(/already exists/);
    await expect(m.db.withTransaction((tx) => m.store.createLeaveType(tx, { ...study, label: 'Duty Leave', short: 'cl' }))).rejects.toThrow(/already used/);
  });

  it('protects required types and fixed rules', async () => {
    const casual = { label: 'Casual Leave', short: 'CL', defaultAllocation: 10, hasQuota: true, isPaid: true, tone: 'green' as const };
    await expect(m.db.withTransaction((tx) => m.store.updateLeaveType(tx, 'Casual', { ...casual, active: false }))).rejects.toThrow(/cannot be switched off/);
    await expect(m.db.withTransaction((tx) => m.store.updateLeaveType(tx, 'Casual', { ...casual, isPaid: false, active: true }))).rejects.toThrow(/fixed/);
    await expect(m.db.withTransaction((tx) => m.store.deleteLeaveType(tx, 'Sick'))).rejects.toThrow(/built in/);
  });

  it('locks the rules of a used custom type but still allows switching it off', async () => {
    await m.db.withTransaction((tx) =>
      tx.run("INSERT INTO leave_records (employee_id, leave_type, start_date, end_date, actual_days, reason) VALUES (?, 'Study Leave', '2026-03-02', '2026-03-02', 1, 'Exam')", empId),
    );
    await expect(m.db.withTransaction((tx) => m.store.updateLeaveType(tx, 'Study Leave', { ...study, hasQuota: false, active: true }))).rejects.toThrow(/already been used/);
    await expect(m.db.withTransaction((tx) => m.store.deleteLeaveType(tx, 'Study Leave'))).rejects.toThrow(/Switch it off/);

    await m.db.withTransaction((tx) => m.store.updateLeaveType(tx, 'Study Leave', { ...study, active: false }));
    await expect(m.db.withTransaction((tx) => m.store.requireActiveLeaveType(tx, 'Study Leave'))).rejects.toThrow(/no longer in use/);
    // Editing an existing record of the switched-off type is still allowed.
    await expect(m.db.withTransaction((tx) => m.store.requireActiveLeaveType(tx, 'Study Leave', 'Study Leave'))).resolves.toMatchObject({ active: false });
  });

  it('deletes an unused custom type together with its balances', async () => {
    const duty = await m.db.withTransaction((tx) => m.store.createLeaveType(tx, { ...study, label: 'Duty Leave', short: 'DL', hasQuota: false }));
    expect((await balance(duty.code))?.allocated_days).toBe(9999);
    await m.db.withTransaction((tx) => m.store.deleteLeaveType(tx, duty.code));
    expect(await balance(duty.code)).toBeUndefined();
  });
});
