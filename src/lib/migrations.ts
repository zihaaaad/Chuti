import bcrypt from 'bcryptjs';
import type { Database } from 'sqlite';

// Versioned schema migrations. `system_settings.schema_version` records the
// last applied version; each migration runs once, inside its own transaction.
// The caller turns foreign keys OFF around this so table rebuilds can't cascade.
//
// Rules for adding a migration: append to MIGRATIONS with the next version,
// never edit a migration that has shipped, and keep each one self-contained.

interface Migration {
  version: number;
  name: string;
  up: (db: Database) => Promise<void>;
}

const EMPLOYEES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    employee_id TEXT UNIQUE NOT NULL,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    designation TEXT NOT NULL,
    email TEXT UNIQUE,
    join_date TEXT NOT NULL,
    phone TEXT,
    status TEXT DEFAULT 'Active'
  )`;

async function columnNames(db: Database, table: string): Promise<string[]> {
  const cols = await db.all<{ name: string }[]>(`PRAGMA table_info(${table})`);
  return cols.map((c) => c.name);
}

async function addColumnIfMissing(db: Database, table: string, column: string, definition: string) {
  if (!(await columnNames(db, table)).includes(column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function rebuildEmployees(db: Database, selectSql: string) {
  await db.exec(EMPLOYEES_TABLE_SQL.replace('IF NOT EXISTS employees', 'employees_new'));
  await db.exec(`INSERT INTO employees_new (id, name, employee_id, department_id, designation, email, join_date, phone, status) ${selectSql}`);
  await db.exec('DROP TABLE employees');
  await db.exec('ALTER TABLE employees_new RENAME TO employees');
}

const MIGRATIONS: Migration[] = [
  {
    // Baseline: everything the pre-versioned releases created or migrated by
    // probing columns. Idempotent, so it is safe on any historical schema.
    version: 1,
    name: 'baseline',
    up: async (db) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS holidays (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          start_date DATE NOT NULL,
          end_date DATE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
      `);
      await db.exec(EMPLOYEES_TABLE_SQL);
      await addColumnIfMissing(db, 'employees', 'phone', 'TEXT');
      await addColumnIfMissing(db, 'employees', 'status', "TEXT DEFAULT 'Active'");

      const cols = await columnNames(db, 'employees');
      if (cols.includes('department')) {
        await db.exec(`INSERT OR IGNORE INTO departments (name)
                       SELECT DISTINCT department FROM employees WHERE department IS NOT NULL`);
        await rebuildEmployees(
          db,
          `SELECT e.id, e.name, e.employee_id, d.id, e.designation, e.email, e.join_date, e.phone, e.status
           FROM employees e LEFT JOIN departments d ON e.department = d.name`,
        );
      }

      const emailCol = (await db.all<{ name: string; notnull: number }[]>('PRAGMA table_info(employees)')).find((c) => c.name === 'email');
      if (emailCol?.notnull === 1) {
        await rebuildEmployees(db, 'SELECT id, name, employee_id, department_id, designation, email, join_date, phone, status FROM employees');
      }

      await db.exec(`
        CREATE TABLE IF NOT EXISTS leave_balances (
          employee_id INTEGER NOT NULL,
          leave_type TEXT NOT NULL,
          allocated_days REAL NOT NULL,
          used_days REAL DEFAULT 0,
          encashed_days REAL DEFAULT 0,
          PRIMARY KEY (employee_id, leave_type),
          FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS leave_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_id INTEGER NOT NULL,
          leave_type TEXT NOT NULL,
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          actual_days REAL NOT NULL,
          reason TEXT NOT NULL,
          attachment_path TEXT,
          remarks TEXT,
          recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS late_deductions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          employee_id INTEGER NOT NULL,
          month_year TEXT NOT NULL,
          late_count INTEGER DEFAULT 0,
          deducted_cl REAL DEFAULT 0,
          UNIQUE(employee_id, month_year),
          FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_leave_records_employee_id ON leave_records (employee_id);
        CREATE INDEX IF NOT EXISTS idx_leave_records_dates ON leave_records (start_date, end_date);
        CREATE INDEX IF NOT EXISTS idx_employees_status ON employees (status);
        CREATE TABLE IF NOT EXISTS admin_sessions (session_id TEXT PRIMARY KEY, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      `);
      await addColumnIfMissing(db, 'leave_balances', 'encashed_days', 'REAL DEFAULT 0');
      await addColumnIfMissing(db, 'leave_records', 'modified_at', 'TIMESTAMP');

      const { count } = (await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM system_settings')) ?? { count: 0 };
      if (count === 0) {
        const seed: [string, string][] = [
          ['institute_name', 'Chuti Leave Management'],
          ['weekend_days', 'friday,saturday'],
          ['sandwich_rule', 'true'],
          ['late_cl_threshold', '3'],
          ['admin_password_hash', bcrypt.hashSync('admin123', 10)],
        ];
        for (const [key, value] of seed) {
          await db.run('INSERT INTO system_settings (key, value) VALUES (?, ?)', key, value);
        }
        for (const dept of ['Administration', 'HR', 'Accounts', 'IT']) {
          await db.run('INSERT OR IGNORE INTO departments (name) VALUES (?)', dept);
        }
      }
    },
  },
  {
    version: 2,
    name: 'leave-year, audit log, forced password change',
    up: async (db) => {
      await addColumnIfMissing(db, 'leave_balances', 'carried_forward', 'REAL DEFAULT 0');

      await db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          action TEXT NOT NULL,
          entity TEXT NOT NULL,
          entity_id TEXT,
          summary TEXT NOT NULL,
          client TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log (at);

        CREATE TABLE IF NOT EXISTS leave_year_closings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          closed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          previous_start DATE NOT NULL,
          new_start DATE NOT NULL,
          el_carry_cap REAL NOT NULL,
          backup_file TEXT
        );
        CREATE TABLE IF NOT EXISTS leave_balance_archive (
          closing_id INTEGER NOT NULL REFERENCES leave_year_closings(id) ON DELETE CASCADE,
          employee_id INTEGER NOT NULL,
          leave_type TEXT NOT NULL,
          allocated_days REAL NOT NULL,
          carried_forward REAL NOT NULL,
          used_days REAL NOT NULL,
          encashed_days REAL NOT NULL,
          PRIMARY KEY (closing_id, employee_id, leave_type)
        );

        CREATE INDEX IF NOT EXISTS idx_leave_records_type ON leave_records (leave_type);
        CREATE INDEX IF NOT EXISTS idx_late_deductions_month ON late_deductions (month_year);
      `);

      // '0001-01-01' means "no leave year has been closed yet": every record counts.
      await db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('leave_year_start', '0001-01-01')");
      await db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('el_carry_cap', '30')");

      // Anyone still on the published default password must change it before using the app.
      const hash = await db.get<{ value: string }>("SELECT value FROM system_settings WHERE key = 'admin_password_hash'");
      const onDefault = !!hash && bcrypt.compareSync('admin123', hash.value);
      await db.run(
        "INSERT OR REPLACE INTO system_settings (key, value) VALUES ('must_change_password', ?)",
        onDefault ? 'true' : 'false',
      );
    },
  },
  {
    // Session tokens are now stored hashed (see hashSessionToken in auth.ts).
    // Existing rows hold raw tokens that would also have been copied into every
    // backup, so drop them: everyone signs in again once after this update.
    version: 3,
    name: 'hash stored session tokens',
    up: async (db) => {
      await db.exec('DELETE FROM admin_sessions');
    },
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export async function runMigrations(db: Database): Promise<void> {
  await db.exec('CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT)');
  const row = await db.get<{ value: string }>("SELECT value FROM system_settings WHERE key = 'schema_version'");
  const current = row ? parseInt(row.value, 10) || 0 : 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    console.log(`Applying migration ${migration.version}: ${migration.name}`);
    await db.exec('BEGIN IMMEDIATE');
    try {
      await migration.up(db);
      await db.run(
        "INSERT INTO system_settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        String(migration.version),
      );
      await db.exec('COMMIT');
    } catch (err) {
      await db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${(err as Error).message}`);
    }
  }
}
