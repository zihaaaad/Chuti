import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { backupKind, getDb, listBackupFiles } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { todayLocal } from '@/lib/domain/dates';
import { PageHeader } from '@/components/ui';
import SettingsClient from './SettingsClient';
import type { BackupFileInfo } from '@/app/actions/maintenance';
import { backupCopyHealth, listBackupCopies, readBackupCopyConfig } from '@/lib/backup-copies';
import { readEncryptionState } from '@/lib/backup-keys';
import type { BackupCopiesView } from './BackupCopiesCard';
import type { CloudBackupView } from './CloudBackupCard';
import { cloudBackupHealth, readCloudConfig } from '@/lib/cloud-backup';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await requireAdmin();
  const db = await getDb();
  // getSettings() returns only UI-safe keys — never the password hash.
  const settings = await getSettings();

  const [holidays, departments, closings, usageRows] = await Promise.all([
    db.all<{ id: number; title: string; start_date: string; end_date: string }[]>(
      'SELECT id, title, start_date, end_date FROM holidays ORDER BY start_date DESC',
    ),
    db.all<{ id: number; name: string; employees: number }[]>(
      'SELECT d.id, d.name, COUNT(e.id) AS employees FROM departments d LEFT JOIN employees e ON e.department_id = d.id GROUP BY d.id ORDER BY d.name',
    ),
    db.all<{ id: number; closed_at: string; previous_start: string; new_start: string; el_carry_cap: number }[]>(
      'SELECT id, closed_at, previous_start, new_start, el_carry_cap FROM leave_year_closings ORDER BY id DESC LIMIT 5',
    ),
    db.all<{ leave_type: string; n: number }[]>('SELECT leave_type, COUNT(*) AS n FROM leave_records GROUP BY leave_type'),
  ]);
  const leaveTypeUsage = Object.fromEntries(usageRows.map((r) => [r.leave_type, r.n]));

  const backups: BackupFileInfo[] = listBackupFiles().map((f) => ({ name: f.name, size: f.size, mtime: f.mtime.toISOString(), kind: backupKind(f.name) }));
  const copyConfig = await readBackupCopyConfig(db);
  const encryption = await readEncryptionState(db);
  const backupCopies: BackupCopiesView = {
    ...copyConfig,
    health: backupCopyHealth(copyConfig),
    copies: listBackupCopies(copyConfig),
    // Only the mode and lock state reach the browser — never the key ring.
    encryption: { mode: encryption.mode, unlocked: encryption.unlocked, envManaged: encryption.envManaged },
  };
  const cloudConfig = await readCloudConfig(db);
  const cloudBackup: CloudBackupView = {
    provider: cloudConfig.provider,
    account: cloudConfig.account,
    enabled: cloudConfig.enabled,
    hour: cloudConfig.hour,
    keep: cloudConfig.keep,
    lastSuccessAt: cloudConfig.lastSuccessAt,
    lastSize: cloudConfig.lastSize,
    lastErrorAt: cloudConfig.lastErrorAt,
    lastError: cloudConfig.lastError,
    health: cloudBackupHealth(cloudConfig),
    encryption: backupCopies.encryption,
    folderChosen: !!copyConfig.folder,
  };

  return (
    <>
      <PageHeader title="Settings" description="Leave policy, leave types, holidays, departments, security and data safety." />
      <SettingsClient
        settings={settings}
        holidays={holidays}
        departments={departments}
        backups={backups}
        backupCopies={backupCopies}
        cloudBackup={cloudBackup}
        closings={closings}
        leaveTypeUsage={leaveTypeUsage}
        today={todayLocal()}
      />
    </>
  );
}
