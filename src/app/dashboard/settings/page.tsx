import { getDb } from '@/lib/db';
import { listBackups } from '@/app/actions';
import SettingsClient from './SettingsClient';

export default async function SettingsPage() {
  const db = await getDb();

  // 1. Fetch system settings
  const settingsRaw = await db.all("SELECT * FROM system_settings");
  const settings = settingsRaw.reduce((acc: any, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});

  // 2. Fetch official holidays
  const holidays = await db.all("SELECT * FROM holidays ORDER BY start_date ASC");

  // 3. Fetch departments
  const departments = await db.all("SELECT * FROM departments ORDER BY name ASC");

  // 4. Fetch available backups (for restore)
  const backupsResult = await listBackups();

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--primary)' }}>System Settings</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)' }}>Configure Bangladeshi leave policies, customize weekends, add official holidays, and manage departments.</p>
      </div>

      <SettingsClient
        initialSettings={settings}
        initialHolidays={holidays}
        initialDepartments={departments}
        initialBackups={backupsResult.backups}
      />
    </div>
  );
}
