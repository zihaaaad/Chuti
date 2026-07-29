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
      backgroundImage: 'radial-gradient(circle at top right, #e8f4ec 0%, transparent 40%), radial-gradient(circle at bottom left, #e8f4ec 0%, transparent 40%)',
      padding: '1.5rem',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div 
        className="fade-in popup-scale-in"
        style={{
          width: '100%',
          maxWidth: '420px',
          textAlign: 'center',
          position: 'relative',
          zIndex: 10
        }}
      >
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ 
            width: '64px', 
            height: '64px', 
            background: 'linear-gradient(135deg, var(--primary) 0%, #1a5634 100%)', 
            borderRadius: '16px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            margin: '0 auto 1.25rem',
            boxShadow: '0 8px 24px rgba(46, 139, 87, 0.3)',
            transform: 'rotate(-5deg)'
          }}>
            <span style={{ color: 'white', fontSize: '2rem', fontWeight: '800', fontStyle: 'italic', letterSpacing: '-0.05em', transform: 'rotate(5deg)' }}>C</span>
          </div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: '800', letterSpacing: '-0.05em', color: '#111827', marginBottom: '0.25rem' }}>
            Chuti
          </h1>
          <p style={{ fontSize: '0.9375rem', color: '#6b7280', fontWeight: '500' }}>{instituteName}</p>
        </div>

        <div className="card" style={{ 
          textAlign: 'left', 
          padding: '2.5rem 2rem', 
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)',
          border: '1px solid rgba(0,0,0,0.05)'
        }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', fontWeight: '700', color: '#111827' }}>Welcome back</h2>
          <p style={{ fontSize: '0.875rem', marginBottom: '2rem', color: '#6b7280' }}>Enter your administrator password to securely access the console.</p>
          
          <LoginForm />
        </div>
        
        <footer style={{ marginTop: '2.5rem', fontSize: '0.8125rem', color: '#9ca3af', fontWeight: '500' }}>
          &copy; {new Date().getFullYear()} Chuti Leave System • Open Source
        </footer>
      </div>
    </main>
  );
}
