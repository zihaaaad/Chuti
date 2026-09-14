import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// db.ts reads APP_DATA_DIR at import time, so point it at a temp folder first.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chuti-db-'));
process.env.APP_DATA_DIR = dataDir;

type DbModule = typeof import('./db');
let mod: DbModule;

beforeAll(async () => {
  mod = await import('./db');
  const db = await mod.getDb();
  await db.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
});

afterAll(async () => {
  await mod.withExclusiveAccess(() => mod.closeDbUnlocked());
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('withTransaction', () => {
  it('keeps concurrent successful writes when other transactions fail', async () => {
    // Before the write lock, B's BEGIN would fail inside A's open transaction
    // and B's ROLLBACK would silently discard A's writes.
    const jobs = Array.from({ length: 30 }, (_, i) =>
      mod
        .withTransaction(async (db) => {
          await db.run('INSERT INTO probe (label) VALUES (?)', `job-${i}`);
          await sleep(Math.random() * 5); // yield mid-transaction so jobs interleave
          if (i % 3 === 0) throw new mod.ActionError(`job ${i} rejected`);
          await db.run('INSERT INTO probe (label) VALUES (?)', `job-${i}-second`);
        })
        .then(() => 'ok' as const, () => 'failed' as const),
    );
    const outcomes = await Promise.all(jobs);

    const db = await mod.getDb();
    const rows = await db.all<{ label: string }[]>('SELECT label FROM probe');
    const labels = new Set(rows.map((r) => r.label));

    outcomes.forEach((outcome, i) => {
      if (i % 3 === 0) {
        expect(outcome).toBe('failed');
        expect(labels.has(`job-${i}`)).toBe(false);
      } else {
        expect(outcome).toBe('ok');
        expect(labels.has(`job-${i}`)).toBe(true);
        expect(labels.has(`job-${i}-second`)).toBe(true);
      }
    });
    expect(rows.length).toBe(20 * 2);
  });

  it('rolls back everything a failing transaction wrote', async () => {
    await expect(
      mod.withTransaction(async (db) => {
        await db.run("INSERT INTO probe (label) VALUES ('doomed')");
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const db = await mod.getDb();
    expect(await db.get("SELECT 1 FROM probe WHERE label = 'doomed'")).toBeUndefined();
  });

  it('makes requests wait while the database file is being swapped', async () => {
    const db = await mod.getDb();
    await mod.withTransaction((tx) => tx.run("INSERT INTO probe (label) VALUES ('before-swap')"));

    // Make a replacement file with different content.
    const replacement = path.join(dataDir, 'replacement.db');
    await db.run('VACUUM INTO ?', replacement);
    const sqlite3 = (await import('sqlite3')).default;
    const { open } = await import('sqlite');
    const other = await open({ filename: replacement, driver: sqlite3.Database });
    await other.run("INSERT INTO probe (label) VALUES ('from-replacement')");
    await other.close();

    // A request arriving mid-swap must not reopen the file (on Windows the open
    // handle made deleting the old WAL fail with EPERM). It has to wait.
    // A handle obtained before the swap (a request that was already running)
    // must keep working afterwards instead of failing with SQLITE_MISUSE.
    const staleHandle = await mod.getDb();
    const queryStartedBeforeSwap = staleHandle.all('SELECT label FROM probe');

    let midSwapResolved = false;
    let midSwapRequest: Promise<unknown> | null = null;
    let staleQueryMidSwap: Promise<unknown> | null = null;
    const swapping = mod.swapDatabaseFile(async ({ DB_PATH }) => {
      midSwapRequest = mod.getDb().then(() => {
        midSwapResolved = true;
      });
      staleQueryMidSwap = staleHandle.get("SELECT 1 AS found FROM probe WHERE label = 'from-replacement'");
      await sleep(50);
      expect(midSwapResolved).toBe(false);
      fs.copyFileSync(replacement, DB_PATH);
    });
    await expect(queryStartedBeforeSwap).resolves.toBeDefined();
    await swapping;
    await midSwapRequest;
    expect(midSwapResolved).toBe(true);
    // The query issued mid-swap ran against the NEW file.
    await expect(staleQueryMidSwap).resolves.toEqual({ found: 1 });

    const after = await mod.getDb();
    expect(await after.get("SELECT 1 FROM probe WHERE label = 'from-replacement'")).toBeTruthy();
  });

  it('creates a consistent checkpointed backup under the lock', async () => {
    const name = await mod.checkpointedBackup('manual');
    expect(name).toMatch(/^database_backup_manual_/);
    expect(mod.backupKind(name!)).toBe('manual');
    expect(mod.listBackupFiles().some((f) => f.name === name)).toBe(true);
  });
});
