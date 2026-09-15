import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chuti-late-'));
process.env.APP_DATA_DIR = dataDir;

type Mods = { db: typeof import('./db'); late: typeof import('./late-arrivals') };
let m: Mods;
let empId: number;

beforeAll(async () => {
  m = { db: await import('./db'), late: await import('./late-arrivals') };
  const db = await m.db.getDb();
  await db.run("UPDATE system_settings SET value = '3' WHERE key = 'late_cl_threshold'");
  await db.run("INSERT INTO departments (name) VALUES ('Science')");
  const res = await db.run("INSERT INTO employees (name, employee_id, designation, department_id, join_date) VALUES ('Rahim', 'EMP-001', 'Lecturer', 1, '2026-01-01')");
  empId = res.lastID!;
  await db.run("INSERT INTO leave_balances (employee_id, leave_type, allocated_days, used_days) VALUES (?, 'Casual', 2, 0)", empId);
});

afterAll(async () => {
  await m.db.withExclusiveAccess(() => m.db.closeDbUnlocked());
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function addLate(date: string) {
  return m.db.withTransaction(async (tx) => {
    await tx.run('INSERT INTO late_arrivals (employee_id, date) VALUES (?, ?)', empId, date);
    return m.late.recomputeLateMonth(tx, empId, date.slice(0, 7));
  });
}

async function casualUsed() {
  return (await (await m.db.getDb()).get<{ used_days: number }>("SELECT used_days FROM leave_balances WHERE employee_id = ? AND leave_type = 'Casual'", empId))!.used_days;
}

describe('recomputeLateMonth', () => {
  it('cuts one CL day for every three dated late arrivals in a month', async () => {
    expect((await addLate('2026-03-02')).deducted).toBe(0);
    expect((await addLate('2026-03-03')).deducted).toBe(0);
    const third = await addLate('2026-03-04');
    expect(third).toMatchObject({ lateCount: 3, datedCount: 3, deducted: 1, capped: false });
    expect(await casualUsed()).toBe(1);
  });

  it('keeps months separate', async () => {
    const april = await addLate('2026-04-01');
    expect(april).toMatchObject({ lateCount: 1, deducted: 0 });
    expect(await casualUsed()).toBe(1);
  });

  it('adds undated totals from before per-date logging', async () => {
    const db = await m.db.getDb();
    await db.run("UPDATE late_deductions SET undated_count = 2, late_count = 3 WHERE employee_id = ? AND month_year = '2026-04'", empId);
    const april = await m.db.withTransaction((tx) => m.late.recomputeLateMonth(tx, empId, '2026-04'));
    expect(april).toMatchObject({ lateCount: 3, datedCount: 1, undatedCount: 2, deducted: 1 });
    expect(await casualUsed()).toBe(2);
  });

  it('never cuts CL below zero, and reports the cap', async () => {
    for (const d of ['2026-03-05', '2026-03-06', '2026-03-09']) await addLate(d); // March now 6 → wants 2
    const march = await m.db.withTransaction((tx) => m.late.recomputeLateMonth(tx, empId, '2026-03'));
    expect(march.wanted).toBe(2);
    expect(march.deducted).toBe(1); // only 1 CL was left after April's cut
    expect(march.capped).toBe(true);
    expect(await casualUsed()).toBe(2);
  });

  it('gives the CL back when entries are removed, and drops empty months', async () => {
    const db = await m.db.getDb();
    await db.run("DELETE FROM late_arrivals WHERE employee_id = ? AND date LIKE '2026-03-%'", empId);
    const march = await m.db.withTransaction((tx) => m.late.recomputeLateMonth(tx, empId, '2026-03'));
    expect(march).toMatchObject({ lateCount: 0, deducted: 0 });
    expect(await db.get("SELECT 1 FROM late_deductions WHERE employee_id = ? AND month_year = '2026-03'", empId)).toBeUndefined();
    expect(await casualUsed()).toBe(1); // only April's cut remains
  });
});
