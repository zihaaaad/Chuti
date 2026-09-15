'use server';

import fs from 'fs';
import path from 'path';
import { revalidatePath } from 'next/cache';
import { adminAction, parseInput, type ActionResult } from '@/lib/action';
import {
  ActionError,
  BACKUP_PREFIX,
  backupKind,
  type BackupKind,
  checkpointedBackup,
  getDb,
  getPaths,
  listBackupFiles,
  withTransaction,
} from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { replaceDatabase, restoreArchiveFile } from '@/lib/restore';
import { setCloudSchedule } from '@/lib/cloud-backup';
import { isArchiveName } from '@/lib/archive';
import {
  readBackupCopyConfig,
  runBackupCopy,
  setBackupCopyFolder,
  setBackupCopySchedule,
} from '@/lib/backup-copies';
import { reconcileBalances, type BalanceDrift } from '@/lib/ledger';
import { readSettings, setSetting } from '@/lib/settings';
import { backupCopyScheduleSchema, closeYearSchema } from '@/lib/validation';
import { carryForward, remainingDays } from '@/lib/domain/balance';
import { formatDisplayDate, todayLocal, addDays } from '@/lib/domain/dates';
import { ENCASHMENT_TYPE } from '@/lib/domain/leave-types';

export interface BackupFileInfo {
  name: string;
  size: number;
  mtime: string;
  kind: BackupKind;
}

export async function listBackups(): Promise<ActionResult<BackupFileInfo[]>> {
  return adminAction('Could not list backups.', async () =>
    listBackupFiles().map((f) => ({ name: f.name, size: f.size, mtime: f.mtime.toISOString(), kind: backupKind(f.name) })),
  );
}

export async function createBackupNow(): Promise<ActionResult<{ name: string }>> {
  return adminAction('Could not create a backup.', async () => {
    const name = await checkpointedBackup('manual');
    if (!name) throw new ActionError('The backup could not be written. Check that the data folder is not read-only or full.');
    await withTransaction((db) => logAudit(db, 'created', 'backup', name, `Manual backup ${name}`));
    revalidatePath('/dashboard/settings');
    return { name };
  });
}


export async function restoreBackup(filename: string): Promise<ActionResult> {
  return adminAction('Could not restore the backup.', async () => {
    const safeName = path.basename(filename);
    if (safeName !== filename || !safeName.startsWith(BACKUP_PREFIX) || !safeName.endsWith('.db')) {
      throw new ActionError('That is not a Chuti backup file.');
    }
    const backupPath = path.join(getPaths().BACKUP_DIR, safeName);
    if (!fs.existsSync(backupPath)) throw new ActionError('That backup file no longer exists.');

    await replaceDatabase(backupPath);
    await withTransaction((db) => logAudit(db, 'restored', 'backup', safeName, `Restored database from ${safeName}`));
    revalidatePath('/', 'layout');
  });
}

// ─── Backup copies (full archives in a folder the admin chose) ────────────────

export async function runBackupCopyNow(): Promise<ActionResult<{ name: string; attachments: number }>> {
  return adminAction('Could not save a backup copy.', async () => {
    const result = await runBackupCopy('manual');
    revalidatePath('/', 'layout');
    if (!result.ok) throw new ActionError(result.error ?? 'The backup copy failed.');
    return { name: result.name!, attachments: result.attachments ?? 0 };
  });
}

export async function updateBackupCopySchedule(formData: FormData): Promise<ActionResult> {
  return adminAction('Could not save the backup schedule.', async () => {
    const input = parseInput(backupCopyScheduleSchema, formData);
    await withTransaction(async (db) => {
      await setBackupCopySchedule(db, input);
      await logAudit(db, 'updated', 'backup', null,
        input.enabled ? `Daily backup copy at ${String(input.hour).padStart(2, '0')}:00, keeping the latest ${input.keep}` : 'Paused daily backup copies');
    });
    revalidatePath('/', 'layout');
  });
}

/** Stops saving copies to the current folder. Any admin may do this; choosing a new folder needs the desktop app. */
export async function stopBackupCopies(): Promise<ActionResult> {
  return adminAction('Could not stop backup copies.', async () => {
    if (process.env.CHUTI_BACKUP_DIR) {
      throw new ActionError('The backup folder is set by the CHUTI_BACKUP_DIR environment variable. Remove it and restart Chuti.');
    }
    const problem = await setBackupCopyFolder(null);
    if (problem) throw new ActionError(problem);
    revalidatePath('/', 'layout');
  });
}

export async function restoreBackupCopy(name: string, secret?: string): Promise<ActionResult<{ attachments: number }>> {
  return adminAction('Could not restore the backup copy.', async () => {
    const config = await readBackupCopyConfig(await getDb());
    if (!config.folder || !config.folderReachable) throw new ActionError('The backup folder is not available. Reconnect the drive and try again.');
    if (path.basename(name) !== name || !isArchiveName(name)) throw new ActionError('That is not a Chuti backup copy.');
    const archivePath = path.join(config.folder, name);
    if (!fs.existsSync(archivePath)) throw new ActionError('That backup copy no longer exists.');
    const result = await restoreArchiveFile(archivePath, name, secret, 'backup copy');
    revalidatePath('/', 'layout');
    return result;
  });
}

// ─── Cloud backup schedule (the connection itself is managed from the desktop app) ─

export async function updateCloudBackupSchedule(formData: FormData): Promise<ActionResult> {
  return adminAction('Could not save the cloud backup schedule.', async () => {
    const input = parseInput(backupCopyScheduleSchema, formData);
    await withTransaction(async (db) => {
      await setCloudSchedule(db, input);
      await logAudit(db, 'updated', 'backup', null,
        input.enabled ? `Daily cloud backup at ${String(input.hour).padStart(2, '0')}:00, keeping the latest ${input.keep}` : 'Paused daily cloud backups');
    });
    revalidatePath('/', 'layout');
  });
}

export async function checkBalances(apply: boolean): Promise<ActionResult<BalanceDrift[]>> {
  return adminAction('Could not check balances.', async () => {
    const drift = await withTransaction(async (db) => {
      const found = await reconcileBalances(db, apply);
      if (apply && found.length) {
        await logAudit(db, 'reconciled', 'settings', null, `Recalculated ${found.length} balance value${found.length === 1 ? '' : 's'} from the leave ledger`);
      }
      return found;
    });
    if (apply) revalidatePath('/', 'layout');
    return drift;
  });
}

export interface YearClosePreview {
  currentStart: string;
  employees: number;
  carriedTotal: number;
  rows: { name: string; employeeCode: string; elRemaining: number; carried: number }[];
}

export async function previewLeaveYearClose(elCarryCap: number): Promise<ActionResult<YearClosePreview>> {
  return adminAction('Could not preview the year close.', async () => {
    const cap = Number.isFinite(elCarryCap) ? Math.max(0, elCarryCap) : 0;
    const db = await getDb();
    const { leaveYearStart } = await readSettings(db);
    const rows = await db.all<{ name: string; employee_id: string; allocated_days: number; used_days: number; encashed_days: number; carried_forward: number }[]>(
      `SELECT e.name, e.employee_id, b.allocated_days, b.used_days, COALESCE(b.encashed_days,0) AS encashed_days, COALESCE(b.carried_forward,0) AS carried_forward
       FROM leave_balances b JOIN employees e ON e.id = b.employee_id
       WHERE b.leave_type = 'Earned' AND e.status = 'Active' ORDER BY e.name`,
    );
    const mapped = rows.map((r) => {
      const elRemaining = remainingDays(r);
      return { name: r.name, employeeCode: r.employee_id, elRemaining, carried: carryForward(elRemaining, cap) };
    });
    return {
      currentStart: leaveYearStart,
      employees: mapped.length,
      carriedTotal: mapped.reduce((s, r) => s + r.carried, 0),
      rows: mapped,
    };
  });
}

/**
 * Closes the current leave year:
 *  1. backs up the database,
 *  2. archives every balance row,
 *  3. carries unused Earned Leave forward (capped); CL/SL/ML lapse,
 *  4. resets used/encashed days, then re-applies any leave, late cuts and
 *     encashments already recorded on or after the new start date,
 *  5. makes records before the new start read-only.
 */
export async function closeLeaveYear(formData: FormData): Promise<ActionResult<{ carriedTotal: number }>> {
  return adminAction('Could not close the leave year.', async () => {
    const input = parseInput(closeYearSchema, formData);
    const backupName = await checkpointedBackup('yearclose');
    if (!backupName) throw new ActionError('A safety backup could not be written, so the year was not closed.');

    const carriedTotal = await withTransaction(async (db) => {
      const { leaveYearStart } = await readSettings(db);
      if (input.new_year_start <= leaveYearStart) {
        throw new ActionError(`The new leave year must start after ${formatDisplayDate(leaveYearStart)}.`);
      }
      if (input.new_year_start > addDays(todayLocal(), 62)) {
        throw new ActionError('The new leave year can start at most two months from today.');
      }

      const closing = await db.run(
        'INSERT INTO leave_year_closings (previous_start, new_start, el_carry_cap, backup_file) VALUES (?, ?, ?, ?)',
        leaveYearStart, input.new_year_start, input.el_carry_cap, backupName,
      );
      const closingId = closing.lastID!;
      await db.run(
        `INSERT INTO leave_balance_archive (closing_id, employee_id, leave_type, allocated_days, carried_forward, used_days, encashed_days)
         SELECT ?, employee_id, leave_type, allocated_days, COALESCE(carried_forward,0), used_days, COALESCE(encashed_days,0) FROM leave_balances`,
        closingId,
      );

      // Usage in the closing year = records that started before the new year start.
      const earned = await db.all<{ employee_id: number; allocated_days: number; carried_forward: number; used_before: number; encashed_before: number }[]>(
        `SELECT b.employee_id, b.allocated_days, COALESCE(b.carried_forward,0) AS carried_forward,
           COALESCE((SELECT SUM(actual_days) FROM leave_records r WHERE r.employee_id = b.employee_id AND r.leave_type = 'Earned' AND r.start_date >= ? AND r.start_date < ?), 0) AS used_before,
           COALESCE((SELECT SUM(actual_days) FROM leave_records r WHERE r.employee_id = b.employee_id AND r.leave_type = ? AND r.start_date >= ? AND r.start_date < ?), 0) AS encashed_before
         FROM leave_balances b WHERE b.leave_type = 'Earned'`,
        leaveYearStart, input.new_year_start, ENCASHMENT_TYPE, leaveYearStart, input.new_year_start,
      );

      let total = 0;
      await db.run('UPDATE leave_balances SET carried_forward = 0');
      for (const e of earned) {
        const remaining = remainingDays({ allocated_days: e.allocated_days, carried_forward: e.carried_forward, used_days: e.used_before, encashed_days: e.encashed_before });
        const carried = carryForward(remaining, input.el_carry_cap);
        total += carried;
        await db.run("UPDATE leave_balances SET carried_forward = ? WHERE employee_id = ? AND leave_type = 'Earned'", carried, e.employee_id);
      }

      await setSetting(db, 'leave_year_start', input.new_year_start);
      await setSetting(db, 'el_carry_cap', String(input.el_carry_cap));
      await db.run('UPDATE leave_balances SET used_days = 0, encashed_days = 0');
      // Re-apply usage already recorded in the new year.
      await reconcileBalances(db, true);

      await logAudit(db, 'closed', 'leave_year', closingId,
        `Closed leave year starting ${formatDisplayDate(leaveYearStart)}; new year starts ${formatDisplayDate(input.new_year_start)}; ${total} EL days carried (cap ${input.el_carry_cap}); backup ${backupName}`);
      return total;
    });

    revalidatePath('/', 'layout');
    return { carriedTotal };
  });
}
