import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/auth';
import LoginForm from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  const session = await verifySession();
  if (session) redirect(session.mustChangePassword ? '/setup' : '/dashboard');

  // The organisation name is deliberately not shown here: this page is
  // reachable by anyone on the LAN before signing in.
  return (
    <main className="auth-screen">
      <div className="auth-panel">
        <div className="auth-brand">
          <span className="auth-mark" aria-hidden>C</span>
          <div>
            <div className="wordmark">Chuti</div>
            <p className="subtle">Leave management</p>
          </div>
        </div>

        <div className="card" style={{ padding: '1.5rem' }}>
          <h1 style={{ fontSize: '1.2rem' }}>Sign in as administrator</h1>
          <p style={{ margin: '0.25rem 0 1.25rem', fontSize: '0.9rem' }}>Enter the admin password to open the console.</p>
          <LoginForm />
        </div>

        <p className="auth-foot">Your data stays on this computer.</p>
      </div>
    </main>
  );
}
