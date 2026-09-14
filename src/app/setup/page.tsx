import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import PasswordChangeForm from '@/app/dashboard/settings/PasswordChangeForm';
import { Alert } from '@/components/ui';

export const metadata: Metadata = { title: 'Set a new password' };

export default async function SetupPage() {
  const session = await requireAdmin({ allowPasswordChange: true });
  if (!session.mustChangePassword) redirect('/dashboard');

  return (
    <main className="auth-screen">
      <div className="auth-panel" style={{ maxWidth: 460 }}>
        <div className="auth-brand">
          <span className="auth-mark" aria-hidden>C</span>
          <div className="wordmark">Chuti</div>
        </div>
        <div className="card" style={{ padding: '1.5rem' }}>
          <h1 style={{ fontSize: '1.2rem' }}>Replace the default password</h1>
          <p style={{ margin: '0.25rem 0 1rem', fontSize: '0.9rem' }}>
            Chuti is still using the password published in its README. Anyone on your network could sign in with it, so set your own before continuing.
          </p>
          <div style={{ marginBottom: '1rem' }}>
            <Alert tone="warning">The current password is <code>admin123</code>.</Alert>
          </div>
          <PasswordChangeForm redirectTo="/dashboard" submitLabel="Save password and continue" />
        </div>
      </div>
    </main>
  );
}
