import 'server-only';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './migrations';
import { singleton } from './singleton';

// Data lives in the Electron-selected APP_DATA_DIR, or the project folder when
// run from source (start.bat / npm start).
const dataDir = process.env.APP_DATA_DIR || process.cwd();
const DB_PATH = path.join(dataDir, 'database.db');
const BACKUP_DIR = path.join(dataDir, 'backups');
const MAX_BACKUPS = 30;
const BACKUP_PREFIX = 'database_backup_';

export type { Database };

// ─── Connection ──────────────────────────────────────────────────────────────
// All connection state is process-wide (see singleton.ts): Next.js may load
// this module in several bundles, and there must still be exactly one
// connection, one write lock and one swap gate.
const state = singleton('db', () => ({
  // The in-flight initialization PROMISE, not the resolved instance, so
  // concurrent cold-start requests share one init instead of each running the
  // migrations (which include DROP TABLE + RENAME steps).
  dbPromise: null as Promise<Database> | null,
  backupIntervalScheduled: false,
  // Set while a restore swaps the database file. Queries wait for it, so nobody
  // reopens the file mid-swap (on Windows an open handle makes the old WAL file
  // impossible to delete) or runs a query on the connection being closed.
  swapGate: null as Promise<void> | null,
  inFlight: 0,
  lockTail: Promise.resolve() as Promise<void>,
}));

export function getPaths() {
  return { DB_PATH, BACKUP_DIR, DATA_DIR: dataDir };
}

async function connection(): Promise<Database> {
  while (state.swapGate) await state.swapGate;
  if (!state.dbPromise) {
    state.dbPromise = initializeDb().catch((err) => {
      state.dbPromise = null;
      throw err;
    });
  }
  return state.dbPromise;
}

const QUERY_METHODS = new Set(['get', 'all', 'run', 'exec', 'each']);

/**
 * The handle every caller receives. Each query goes to the live connection at
 * the moment it runs, so a handle obtained before a restore keeps working after
 * it, and a restore can wait for queries already running to finish.
 */
const handle = new Proxy({} as Database, {
  get(_target, prop) {
    if (typeof prop === 'string' && QUERY_METHODS.has(prop)) {
      return async (...args: unknown[]) => {
        for (;;) {
          const conn = await connection();
          if (state.swapGate) continue; // a swap started while we waited: wait for it
          state.inFlight++;
          try {
            return await (conn as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[prop](...args);
          } finally {
            state.inFlight--;
          }
        }
      };
    }
    // Not a thenable, and no other members are part of the supported surface.
    return undefined;
  },
});

export async function getDb(): Promise<Database> {
  await connection(); // surface initialization/migration errors to the caller
  return handle;
}

async function initializeDb(): Promise<Database> {
  backupDatabase();
  if (!state.backupIntervalScheduled) {
    setInterval(() => void checkpointedBackup(), 12 * 60 * 60 * 1000).unref?.();
    state.backupIntervalScheduled = true;
  }

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec('PRAGMA journal_mode=WAL;');
  await db.exec('PRAGMA busy_timeout=5000;');

  // Table rebuilds in migrations must not fire ON DELETE CASCADE: with
  // foreign keys on, `DROP TABLE employees` deletes every leave record.
  await db.exec('PRAGMA foreign_keys=OFF;');
  try {
    await runMigrations(db);
  } finally {
    await db.exec('PRAGMA foreign_keys=ON;');
  }
  return db;
}

// ─── Write serialization ─────────────────────────────────────────────────────
// Every request shares ONE SQLite connection, and SQLite transactions belong to
// the connection, not the request. Without serialization, request B's BEGIN
// fails inside request A's open transaction and B's error handler ROLLBACKs
// A's work. All writes therefore go through this FIFO lock.
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const next = new Promise<void>((resolve) => (release = resolve));
  const previous = state.lockTail;
  state.lockTail = previous.then(() => next);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

/** An expected, user-facing failure. Its message is safe to show; it rolls the transaction back. */
export class ActionError extends Error {
  /** Optional machine-readable reason the UI can react to (e.g. 'SECRET_REQUIRED'). */
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

/**
 * Runs `fn` inside `BEGIN IMMEDIATE … COMMIT`, serialized with every other
 * write. Throwing (including an ActionError) rolls back. Do not call
 * withTransaction from inside `fn` — pass the `db` handle down instead.
 */
export async function withTransaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const db = await getDb();
  return withLock(async () => {
    await db.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(db);
      await db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        await db.exec('ROLLBACK');
      } catch {
        // No transaction left to roll back (e.g. SQLite already aborted it).
      }
      throw err;
    }
  });
}

/** Exclusive access without a transaction — for connection close/restore and WAL checkpoints. */
export async function withExclusiveAccess<T>(fn: () => Promise<T>): Promise<T> {
  return withLock(fn);
}

/** Closes the connection. Call only inside withExclusiveAccess, or at shutdown. */
export async function closeDbUnlocked(): Promise<void> {
  if (!state.dbPromise) return;
  const pending = state.dbPromise;
  state.dbPromise = null;
  try {
    await (await pending).close();
  } catch {
    // Initialization never succeeded, so there is nothing to close.
  }
}

/**
 * Replaces the live database file. Waits for in-flight writes and queries,
 * closes the connection, holds every new query until `swap` finishes, then the
 * next query reopens (and migrates) the new file.
 */
export async function swapDatabaseFile(swap: (paths: { DB_PATH: string }) => void | Promise<void>): Promise<void> {
  await withLock(async () => {
    let open!: () => void;
    state.swapGate = new Promise<void>((resolve) => (open = resolve));
    try {
      const deadline = Date.now() + 10_000;
      while (state.inFlight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
      await closeDbUnlocked();
      for (const suffix of ['-wal', '-shm']) {
        // Antivirus or backup tools can hold a handle briefly on Windows; retry.
        fs.rmSync(DB_PATH + suffix, { force: true, maxRetries: 10, retryDelay: 100 });
      }
      await swap({ DB_PATH });
    } finally {
      state.swapGate = null;
      open();
    }
  });
}

// ─── Backups ─────────────────────────────────────────────────────────────────
export function listBackupFiles(): { name: string; size: number; mtime: Date }[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.db'))
    .map((name) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: stat.size, mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

function rotateBackups() {
  try {
    for (const file of listBackupFiles().slice(MAX_BACKUPS)) {
      for (const suffix of ['', '-wal', '-shm']) {
        const p = path.join(BACKUP_DIR, file.name + suffix);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }
  } catch (err) {
    console.error('Failed to rotate backups:', err);
  }
}

function copyWithSidecars(sourceDb: string, targetDb: string) {
  fs.copyFileSync(sourceDb, targetDb);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(sourceDb + suffix)) fs.copyFileSync(sourceDb + suffix, targetDb + suffix);
  }
}

/** Copies the database into backups/ with a timestamped name. Returns the file name, or null. */
export function backupDatabase(label = ''): string | null {
  try {
    if (!fs.existsSync(DB_PATH)) return null;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${BACKUP_PREFIX}${label ? `${label}_` : ''}${timestamp}.db`;
    copyWithSidecars(DB_PATH, path.join(BACKUP_DIR, name));
    rotateBackups();
    return name;
  } catch (err) {
    console.error('Database backup failed:', err);
    return null;
  }
}

/**
 * Backup taken while the connection is live: checkpoint the WAL into the main
 * file under the write lock so the copy is a consistent snapshot.
 */
export async function checkpointedBackup(label = ''): Promise<string | null> {
  return withLock(async () => {
    if (state.dbPromise) {
      try {
        const db = await state.dbPromise;
        await db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch (err) {
        console.error('Pre-backup WAL checkpoint failed, backing up as-is:', err);
      }
    }
    return backupDatabase(label);
  });
}

export type BackupKind = 'automatic' | 'manual' | 'before-restore' | 'before-year-close';

export function backupKind(name: string): BackupKind {
  const rest = name.slice(BACKUP_PREFIX.length);
  if (rest.startsWith('prerestore')) return 'before-restore';
  if (rest.startsWith('manual')) return 'manual';
  if (rest.startsWith('yearclose')) return 'before-year-close';
  return 'automatic';
}

export { BACKUP_PREFIX, copyWithSidecars };
