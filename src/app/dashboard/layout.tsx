import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { getLeaveTypes } from '@/lib/leave-type-store';
import AppShell from './AppShell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Layouts don't re-render on client navigation, so every page also calls
  // requireAdmin(); this check only guards the shell itself.
  await requireAdmin();
  const [settings, leaveTypes] = await Promise.all([getSettings(), getLeaveTypes()]);

  return (
    <AppShell instituteName={settings.instituteName} leaveTypes={leaveTypes}>
      {children}
    </AppShell>
  );
}
