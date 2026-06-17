import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import { getDb } from '@/lib/db';
import LoginForm from './LoginForm';

export default async function LoginPage() {
  // If already logged in, go straight to dashboard
  if (await isAuthenticated()) {
    redirect('/dashboard');
  }

  // Fetch institute name for the title
  let instituteName = 'Chuti Leave Management';
  try {
    const db = await getDb();
    const setting = await db.get('SELECT value FROM system_settings WHERE key = ?', 'institute_name');
    if (setting) instituteName = setting.value;
  } catch (err) {
    console.error('Failed to fetch settings:', err);
  }

  return (
    <main style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#f5f8f6',
      padding: '1.5rem'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        textAlign: 'center'
      }}>
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2.5rem', fontWeight: '800', letterSpacing: '-0.05em', color: 'var(--primary)' }}>
            Chuti
          </h1>
          <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>{instituteName}</p>
        </div>

        <div className="card" style={{ textAlign: 'left', padding: '2rem' }}>
          <h2 className="card-title" style={{ fontSize: '1.25rem', marginBottom: '0.5rem', fontWeight: '600' }}>Admin Login</h2>
          <p style={{ fontSize: '0.8125rem', marginBottom: '1.5rem' }}>Enter password to access the leave management console.</p>
          
          <LoginForm />
        </div>
        
        <footer style={{ marginTop: '3rem', fontSize: '0.75rem', color: '#8c9c92' }}>
          Chuti Leave Management System • Open Source
        </footer>
      </div>
    </main>
  );
}
