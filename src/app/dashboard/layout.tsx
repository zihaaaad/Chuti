import { requireAdmin } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import AppShell from './AppShell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Layouts don't re-render on client navigation, so every page also calls
  // requireAdmin(); this check only guards the shell itself.
  await requireAdmin();
  const settings = await getSettings();

  return <AppShell instituteName={settings.instituteName}>{children}</AppShell>;
}
