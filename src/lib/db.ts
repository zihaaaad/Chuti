import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

// Setup database file path
const DB_PATH = path.join(process.cwd(), 'database.db');
const BACKUP_DIR = path.join(process.cwd(), 'backups');

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

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      designation TEXT NOT NULL,
      department TEXT NOT NULL,
      joining_date DATE NOT NULL,
      phone TEXT,
      status TEXT DEFAULT 'Active'
    );

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
  `);

  // Run safe schema migrations (adds columns to existing DB files if code updates)
  try { await db.exec('ALTER TABLE employees ADD COLUMN phone TEXT;'); } catch (e) {}
  try { await db.exec('ALTER TABLE employees ADD COLUMN status TEXT DEFAULT "Active";'); } catch (e) {}
  try { await db.exec('ALTER TABLE leave_balances ADD COLUMN encashed_days REAL DEFAULT 0;'); } catch (e) {}

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
