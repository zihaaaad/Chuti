import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { LATEST_SCHEMA_VERSION, runMigrations } from './migrations';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function tempDb(): Promise<Database> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chuti-mig-'));
  dirs.push(dir);
  return open({ filename: path.join(dir, 'database.db'), driver: sqlite3.Database });
}

/** Mirrors db.ts: foreign keys off while migrating. */
async function migrate(db: Database) {
  await db.exec('PRAGMA foreign_keys=OFF');
  await runMigrations(db);
  await db.exec('PRAGMA foreign_keys=ON');
}

describe('runMigrations', () => {
  it('creates a fresh database at the latest version and flags the default password', async () => {
    const db = await tempDb();
    await migrate(db);
    const version = await db.get("SELECT value FROM system_settings WHERE key='schema_version'");
    expect(Number(version.value)).toBe(LATEST_SCHEMA_VERSION);
    const flag = await db.get("SELECT value FROM system_settings WHERE key='must_change_password'");
    expect(flag.value).toBe('true');
    const cols = (await db.all('PRAGMA table_info(leave_balances)')).map((c: { name: string }) => c.name);
    expect(cols).toContain('carried_forward');
    await db.close();
  });

  it('is idempotent', async () => {
    const db = await tempDb();
    await migrate(db);
    await migrate(db);
    const { count } = await db.get('SELECT COUNT(*) AS count FROM departments');
    expect(count).toBe(4);
    await db.close();
  });

  it('upgrades a legacy text-department schema without cascading away leave data', async () => {
    const db = await tempDb();
    // Shape of the very first release: text department, NOT NULL email, no schema_version.
    await db.exec(`
      CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO system_settings VALUES ('institute_name','Old School');
      CREATE TABLE departments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
      CREATE TABLE employees (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, employee_id TEXT UNIQUE NOT NULL,
        department TEXT, designation TEXT NOT NULL, email TEXT UNIQUE NOT NULL, join_date TEXT NOT NULL);
      INSERT INTO employees (name, employee_id, department, designation, email, join_date)
        VALUES ('Rahim', 'EMP-001', 'Science', 'Lecturer', 'r@example.com', '2024-01-01');
      CREATE TABLE leave_balances (employee_id INTEGER NOT NULL, leave_type TEXT NOT NULL, allocated_days REAL NOT NULL, used_days REAL DEFAULT 0,
        PRIMARY KEY (employee_id, leave_type), FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE);
      INSERT INTO leave_balances VALUES (1, 'Casual', 10, 2);
      CREATE TABLE leave_records (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, leave_type TEXT NOT NULL,
        start_date DATE NOT NULL, end_date DATE NOT NULL, actual_days REAL NOT NULL, reason TEXT NOT NULL, attachment_path TEXT, remarks TEXT,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE);
      INSERT INTO leave_records (employee_id, leave_type, start_date, end_date, actual_days, reason) VALUES (1, 'Casual', '2024-03-03', '2024-03-04', 2, 'Fever');
    `);

    await migrate(db);

    const emp = await db.get('SELECT e.name, d.name AS dept, e.email FROM employees e JOIN departments d ON d.id = e.department_id');
    expect(emp).toEqual({ name: 'Rahim', dept: 'Science', email: 'r@example.com' });
    const emailCol = (await db.all('PRAGMA table_info(employees)')).find((c: { name: string }) => c.name === 'email');
    expect(emailCol.notnull).toBe(0);
    expect((await db.get('SELECT COUNT(*) AS c FROM leave_records')).c).toBe(1);
    expect((await db.get('SELECT used_days FROM leave_balances')).used_days).toBe(2);
    expect((await db.all('PRAGMA foreign_key_check')).length).toBe(0);
    await db.close();
  });
});
