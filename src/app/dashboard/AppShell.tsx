'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, BookOpen, CalendarRange, FileText, History, LayoutDashboard, LogOut, Menu, Settings, Users, X } from 'lucide-react';
import { handleLogout } from '@/app/actions/auth';
import { useConfirm } from '@/context/ConfirmContext';
import { LeaveTypesProvider } from '@/context/LeaveTypesContext';
import type { LeaveTypeDef } from '@/lib/domain/leave-types';

const LINKS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/employees', label: 'Employees', icon: Users },
  { href: '/dashboard/leaves', label: 'Leave records', icon: FileText },
  { href: '/dashboard/calendar', label: 'Team calendar', icon: CalendarRange },
  { href: '/dashboard/reports', label: 'Reports', icon: BarChart3 },
  { href: '/dashboard/activity', label: 'Activity log', icon: History },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  { href: '/dashboard/guide', label: 'User guide', icon: BookOpen },
];

export default function AppShell({ instituteName, leaveTypes, children }: { instituteName: string; leaveTypes: LeaveTypeDef[]; children: ReactNode }) {
  const pathname = usePathname();
  const { confirm } = useConfirm();
  const [open, setOpen] = useState(false);

  // Close the drawer after navigating.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  const current = LINKS.find((l) => (l.href === '/dashboard' ? pathname === l.href : pathname.startsWith(l.href)));

  const onLogout = async () => {
    const ok = await confirm({ title: 'Sign out?', message: 'You will need the admin password to sign back in.', confirmText: 'Sign out' });
    if (ok) await handleLogout();
  };

  return (
    <div className="app-shell">
      <a href="#main" className="sr-only">Skip to content</a>
      <aside className="sidebar" data-open={open} aria-label="Main navigation">
        <div className="sidebar-brand">
          <span className="wordmark">Chuti</span>
          <span className="org" title={instituteName}>{instituteName}</span>
        </div>
        <nav className="sidebar-nav">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="nav-link" aria-current={current?.href === href ? 'page' : undefined}>
              <Icon size={18} aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button type="button" className="nav-link btn-block" style={{ border: 'none', background: 'none', cursor: 'pointer', font: 'inherit' }} onClick={onLogout}>
            <LogOut size={18} aria-hidden />
            Sign out
          </button>
        </div>
      </aside>
      <div className="backdrop" data-open={open} onClick={() => setOpen(false)} aria-hidden />

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button type="button" className="icon-btn menu-btn" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
              {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
            </button>
            <span className="subtle">{current?.label ?? 'Chuti'}</span>
          </div>
          <span className="badge badge-success">Signed in as admin</span>
        </header>
        <main id="main" className="page">
          <LeaveTypesProvider types={leaveTypes}>{children}</LeaveTypesProvider>
        </main>
      </div>
    </div>
  );
}
