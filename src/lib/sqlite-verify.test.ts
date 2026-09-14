import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { runMigrations } from './migrations';
import { verifyChutiDatabase } from './sqlite-verify';

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function file(name: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'chuti-verify-'));
  temps.push(d);
  return path.join(d, name);
}

describe('verifyChutiDatabase', () => {
  it('accepts a healthy Chuti database and reports its schema version', async () => {
    const f = file('good.db');
    const db = await open({ filename: f, driver: sqlite3.Database });
    await db.exec('PRAGMA foreign_keys=OFF');
    await runMigrations(db);
    await db.close();
    const result = await verifyChutiDatabase(f);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.schemaVersion).toBeGreaterThanOrEqual(2);
  });

  it('rejects a SQLite database that is not Chuti', async () => {
    const f = file('other.db');
    const db = await open({ filename: f, driver: sqlite3.Database });
    await db.exec('CREATE TABLE notes (id INTEGER)');
    await db.close();
    expect(await verifyChutiDatabase(f)).toEqual({ ok: false, problem: 'That file is not a Chuti database.' });
  });

  it('rejects a file that is not a database', async () => {
    const f = file('junk.db');
    fs.writeFileSync(f, 'definitely not sqlite');
    expect((await verifyChutiDatabase(f)).ok).toBe(false);
  });
});
