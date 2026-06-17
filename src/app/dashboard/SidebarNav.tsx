'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, FileText, BarChart3, Settings, BookOpen } from 'lucide-react';

export default function SidebarNav() {
  const pathname = usePathname();

  const links = [
    { href: '/dashboard', name: 'Dashboard', icon: LayoutDashboard },
    { href: '/dashboard/employees', name: 'Employees', icon: Users },
    { href: '/dashboard/leaves', name: 'Leave Records', icon: FileText },
    { href: '/dashboard/reports', name: 'Reports Center', icon: BarChart3 },
    { href: '/dashboard/settings', name: 'Settings', icon: Settings },
    { href: '/dashboard/guide', name: 'User Guide', icon: BookOpen },
  ];

  return (
    <nav style={{ padding: '1.25rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {links.map((link) => {
        const Icon = link.icon;
        // Exact match for dashboard, startswith match for sub-routes (e.g. /dashboard/employees)
        const isActive = link.href === '/dashboard' 
          ? pathname === '/dashboard'
          : pathname.startsWith(link.href);

        return (
          <Link 
            key={link.href}
            href={link.href} 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.625rem 0.75rem',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.875rem',
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'var(--primary)' : 'var(--foreground-muted)',
              backgroundColor: isActive ? 'var(--primary-light)' : 'transparent',
              borderLeft: isActive ? '3px solid var(--primary-accent)' : '3px solid transparent',
              paddingLeft: isActive ? 'calc(0.75rem - 3px)' : '0.75rem', // Offset padding to align content
              transition: 'all 0.05s ease'
            }} 
            className="nav-link"
          >
            <Icon size={18} style={{ color: isActive ? 'var(--primary-accent)' : 'inherit' }} />
            {link.name}
          </Link>
        );
      })}
    </nav>
  );
}
