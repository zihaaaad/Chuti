import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import { getDb } from '@/lib/db';
import LogoutButton from './LogoutButton';
import SidebarNav from './SidebarNav';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAuthenticated())) {
    redirect('/');
  }

  let instituteName = 'Chuti Leave Management';
  try {
    const db = await getDb();
    const setting = await db.get('SELECT value FROM system_settings WHERE key = ?', 'institute_name');
    if (setting) instituteName = setting.value;
  } catch (err) {
    console.error('Failed to load settings in layout:', err);
  }

  return (
    <div className="app-container" style={{ backgroundColor: 'var(--surface)' }}>
      {/* Sidebar - Clean White with Forest Accents */}
      <aside className="no-print" style={{
        width: 'var(--sidebar-width)',
        backgroundColor: '#ffffff',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0,
        bottom: 0,
        left: 0,
        zIndex: 10
      }}>
        {/* Logo / Brand Header */}
        <div style={{
          padding: '1.5rem 1.25rem',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem'
        }}>
          <h2 style={{
            fontSize: '1.5rem',
            fontWeight: '800',
            letterSpacing: '-0.03em',
            color: 'var(--primary)'
          }}>
            Chuti
          </h2>
          <p style={{
            fontSize: '0.75rem',
            color: 'var(--foreground-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }} title={instituteName}>
            {instituteName}
          </p>
        </div>

        {/* Navigation Links */}
        <SidebarNav />

        {/* Footer Area with Logout */}
        <div style={{
          padding: '1rem 0.75rem',
          borderTop: '1px solid var(--border)'
        }}>
          <LogoutButton />
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="main-content">
        {/* Simple Header */}
        <header className="no-print" style={{
          height: '60px',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '0 2rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem' }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: 'var(--success)'
            }}></span>
            <span style={{ color: 'var(--foreground-muted)', fontWeight: 500 }}>Admin Console (Active)</span>
          </div>
        </header>

        {/* Page Content */}
        <main style={{ padding: '2rem', flex: 1 }}>
          {children}
        </main>
      </div>

      {/* Styles for active link highlighting */}
      <style dangerouslySetInnerHTML={{__html: `
        .nav-link:hover {
          background-color: var(--primary-light) !important;
          color: var(--primary-accent) !important;
        }
      `}} />
    </div>
  );
}
