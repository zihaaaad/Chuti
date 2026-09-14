import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export type VerifyResult = { ok: true; schemaVersion: number } | { ok: false; problem: string };

/** Opens a database file read-only and checks it is an undamaged Chuti database. */
export async function verifyChutiDatabase(file: string): Promise<VerifyResult> {
  let probe;
  try {
    probe = await open({ filename: file, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
  } catch {
    return { ok: false, problem: 'That file is not a database.' };
  }
  try {
    // The result column is named after the pragma ("quick_check"), so read it positionally.
    const rows = await probe.all<Record<string, string>[]>('PRAGMA quick_check');
    const messages = rows.map((r) => Object.values(r)[0]);
    if (messages.length !== 1 || messages[0] !== 'ok') {
      return { ok: false, problem: 'That backup is damaged and cannot be restored.' };
    }
    const hasEmployees = await probe.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'employees'");
    if (!hasEmployees) return { ok: false, problem: 'That file is not a Chuti database.' };
    const version = await probe.get<{ value: string }>("SELECT value FROM system_settings WHERE key = 'schema_version'");
    return { ok: true, schemaVersion: parseInt(version?.value ?? '0', 10) || 0 };
  } catch {
    return { ok: false, problem: 'That file is not a Chuti database.' };
  } finally {
    await probe.close();
  }
}
