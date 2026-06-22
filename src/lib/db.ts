import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

// Setup database file path (Supports Electron APP_DATA_DIR)
const dataDir = process.env.APP_DATA_DIR || process.cwd();
const DB_PATH = path.join(dataDir, 'database.db');
const BACKUP_DIR = path.join(dataDir, 'backups');

let dbInstance: Database | null = null;

// Clean up old backups keeping only the last 30
function rotateBackups() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      return;
    }
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('database_backup_') && f.endsWith('.db'))
      .map(f => ({
        name: f,
        time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time); // Descending order (newest first)

    if (files.length > 30) {
      const toDelete = files.slice(30);
      for (const file of toDelete) {
        fs.unlinkSync(path.join(BACKUP_DIR, file.name));
      }
    }
  } catch (err) {
    console.error('Failed to rotate backups:', err);
  }
}

// Perform database backup
function backupDatabase() {
  try {
    if (fs.existsSync(DB_PATH)) {
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(BACKUP_DIR, `database_backup_${timestamp}.db`);
      fs.copyFileSync(DB_PATH, backupPath);
      console.log(`Database backup created successfully at: ${backupPath}`);
      rotateBackups();
    }
  } catch (err) {
    console.error('Database backup failed:', err);
  }
}

export async function getDb(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  // Backup the database on startup before opening the connection (run only once per process)
  if (!(global as any).backupPerformed) {
    backupDatabase();
    // Schedule periodic backup every 12 hours (43200000 ms)
    setInterval(backupDatabase, 12 * 60 * 60 * 1000);
    (global as any).backupPerformed = true;
  }

  // Open the database
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  // Enable WAL (Write-Ahead Logging) mode
  await db.exec('PRAGMA journal_mode=WAL;');

  // Enable Foreign Key support
  await db.exec('PRAGMA foreign_keys=ON;');

  // Set busy timeout to 5000ms to prevent locked exceptions during concurrent requests
  await db.exec('PRAGMA busy_timeout=5000;');

  // Create tables if they do not exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
  `);

  // Create or migrate employees table to use department_id
  await db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      employee_id TEXT UNIQUE NOT NULL,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      designation TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      join_date TEXT NOT NULL,
      phone TEXT,
      status TEXT DEFAULT 'Active'
    )
  `);

  // Schema Migration: Convert text 'department' column to 'department_id' foreign key if needed
  const columns = await db.all("PRAGMA table_info(employees)");
  const hasTextDepartment = columns.some((col: any) => col.name === 'department');
  if (hasTextDepartment) {
    console.log("Migrating employees table from text 'department' to 'department_id'...");
    
    // Ensure all text departments exist in departments table
    const uniqueDepts = await db.all("SELECT DISTINCT department FROM employees WHERE department IS NOT NULL");
    for (const row of uniqueDepts) {
      await db.run("INSERT OR IGNORE INTO departments (name) VALUES (?)", row.department);
    }

    // Check if phone exists in old table
    const hasPhone = columns.some((col: any) => col.name === 'phone');

    // Create new table
    await db.exec(`
      CREATE TABLE employees_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        employee_id TEXT UNIQUE NOT NULL,
        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        designation TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        join_date TEXT NOT NULL,
        phone TEXT,
        status TEXT DEFAULT 'Active'
      )
    `);

    // Copy data mapping text names to IDs
    if (hasPhone) {
      await db.exec(`
        INSERT INTO employees_new (id, name, employee_id, department_id, designation, email, join_date, phone, status)
        SELECT e.id, e.name, e.employee_id, d.id, e.designation, e.email, e.join_date, e.phone, e.status
        FROM employees e
        LEFT JOIN departments d ON e.department = d.name
      `);
    } else {
      await db.exec(`
        INSERT INTO employees_new (id, name, employee_id, department_id, designation, email, join_date, status)
        SELECT e.id, e.name, e.employee_id, d.id, e.designation, e.email, e.join_date, e.status
        FROM employees e
        LEFT JOIN departments d ON e.department = d.name
      `);
    }

    // Swap tables
    await db.exec("DROP TABLE employees");
    await db.exec("ALTER TABLE employees_new RENAME TO employees");
    console.log("Migration complete.");
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
      month_year TEXT NOT NULL, -- Format: YYYY-MM
      late_count INTEGER DEFAULT 0,
      deducted_cl REAL DEFAULT 0,
      UNIQUE(employee_id, month_year),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_leave_records_employee_id ON leave_records (employee_id);
    CREATE INDEX IF NOT EXISTS idx_leave_records_dates ON leave_records (start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_employees_status ON employees (status);

    CREATE TABLE IF NOT EXISTS admin_sessions (
      session_id TEXT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Run safe schema migrations (adds columns to existing DB files if code updates)
  try { await db.exec('ALTER TABLE employees ADD COLUMN phone TEXT;'); } catch {}
  try { await db.exec('ALTER TABLE employees ADD COLUMN status TEXT DEFAULT "Active";'); } catch {}
  try { await db.exec('ALTER TABLE leave_balances ADD COLUMN encashed_days REAL DEFAULT 0;'); } catch {}
  try { await db.exec('ALTER TABLE leave_records ADD COLUMN modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;'); } catch {}

  // Seed default settings if they do not exist
  const settingsCount = await db.get('SELECT COUNT(*) as count FROM system_settings');
  if (settingsCount.count === 0) {
    const adminPasswordHash = bcrypt.hashSync('admin123', 10);
    
    await db.run('INSERT INTO system_settings (key, value) VALUES (?, ?)', 'institute_name', 'Chuti Leave Management');
    await db.run('INSERT INTO system_settings (key, value) VALUES (?, ?)', 'weekend_days', 'friday,saturday');
    await db.run('INSERT INTO system_settings (key, value) VALUES (?, ?)', 'sandwich_rule', 'true');
    await db.run('INSERT INTO system_settings (key, value) VALUES (?, ?)', 'late_cl_threshold', '3');
    await db.run('INSERT INTO system_settings (key, value) VALUES (?, ?)', 'admin_password_hash', adminPasswordHash);
    
    // Seed some default departments
    await db.run('INSERT OR IGNORE INTO departments (name) VALUES (?)', 'Administration');
    await db.run('INSERT OR IGNORE INTO departments (name) VALUES (?)', 'HR');
    await db.run('INSERT OR IGNORE INTO departments (name) VALUES (?)', 'Accounts');
    await db.run('INSERT OR IGNORE INTO departments (name) VALUES (?)', 'IT');
  }

  dbInstance = db;
  return dbInstance;
}
