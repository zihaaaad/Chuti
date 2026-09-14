import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, CalendarDays, CalendarPlus, CheckCircle2, Circle, Clock, UserMinus, Users, Wallet } from 'lucide-react';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getSettings, readPolicy } from '@/lib/settings';
import { addDays, currentMonthLocal, formatDisplayRange, monthBounds, todayLocal } from '@/lib/domain/dates';
import { chargedDaysWithin } from '@/lib/domain/leave-days';
import { ENCASHMENT_TYPE } from '@/lib/domain/leave-types';
import { remainingSql } from '@/lib/domain/balance';
import { Alert, EmptyState, LeaveTypeBadge, PageHeader, formatDays } from '@/components/ui';
import { backupCopyHealth, readBackupCopyConfig } from '@/lib/backup-copies';
import QuickLateForm from './QuickLateForm';
import RefreshButton from './RefreshButton';

export const metadata: Metadata = { title: 'Overview' };

export default async function DashboardPage() {
  await requireAdmin();
  const db = await getDb();
  const settings = await getSettings();

  const today = todayLocal();
  const month = currentMonthLocal();
  const { start: monthStart, end: monthEnd } = monthBounds(month);
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long' });

  const [employeeCount, holidayCount, onLeaveToday, upcoming, lwpRecords, lateTotal, employees] = await Promise.all([
    db.get<{ count: number }>("SELECT COUNT(*) AS count FROM employees WHERE status = 'Active'"),
    db.get<{ count: number }>('SELECT COUNT(*) AS count FROM holidays WHERE end_date >= ?', today),
    db.all<{ id: number; employee_pk: number; name: string; designation: string; department: string | null; leave_type: string; start_date: string; end_date: string; actual_days: number }[]>(
      `SELECT r.id, e.id AS employee_pk, e.name, e.designation, d.name AS department, r.leave_type, r.start_date, r.end_date, r.actual_days
       FROM leave_records r JOIN employees e ON r.employee_id = e.id LEFT JOIN departments d ON e.department_id = d.id
       WHERE ? BETWEEN r.start_date AND r.end_date AND r.leave_type != ?
       ORDER BY e.name`,
      today, ENCASHMENT_TYPE,
    ),
    db.all<{ id: number; employee_pk: number; name: string; leave_type: string; start_date: string; end_date: string; actual_days: number }[]>(
      `SELECT r.id, e.id AS employee_pk, e.name, r.leave_type, r.start_date, r.end_date, r.actual_days
       FROM leave_records r JOIN employees e ON r.employee_id = e.id
       WHERE r.start_date > ? AND r.start_date <= ? AND r.leave_type != ?
       ORDER BY r.start_date LIMIT 8`,
      today, addDays(today, 14), ENCASHMENT_TYPE,
    ),
    db.all<{ start_date: string; end_date: string; actual_days: number }[]>(
      "SELECT start_date, end_date, actual_days FROM leave_records WHERE leave_type = 'LWP' AND start_date <= ? AND end_date >= ?",
      monthEnd, monthStart,
    ),
    db.get<{ total: number | null }>('SELECT SUM(late_count) AS total FROM late_deductions WHERE month_year = ?', month),
    db.all<{ id: number; name: string; employee_id: string; department: string | null; cl_left: number | null }[]>(
      `SELECT e.id, e.name, e.employee_id, d.name AS department, ${remainingSql('b')} AS cl_left
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN leave_balances b ON e.id = b.employee_id AND b.leave_type = 'Casual'
       WHERE e.status = 'Active' ORDER BY e.name`,
    ),
  ]);

  // LWP days that fall in this month only — a leave from 28 Aug to 3 Sep counts its September share.
  const policy = await readPolicy(db, { start: monthStart, end: monthEnd });
  const lwpThisMonth = lwpRecords.reduce((sum, r) => sum + chargedDaysWithin(r, monthStart, monthEnd, policy), 0);
  const activeEmployees = employeeCount?.count ?? 0;

  const copyConfig = await readBackupCopyConfig(db);
  const copyHealth = backupCopyHealth(copyConfig);

  const setupSteps = [
    { done: settings.instituteName !== 'Chuti Leave Management', label: 'Set your organisation name', href: '/dashboard/settings' },
    { done: (holidayCount?.count ?? 0) > 0, label: "Add this year's holidays", href: '/dashboard/settings#holidays' },
    { done: activeEmployees > 0, label: 'Add or import employees', href: '/dashboard/employees' },
    { done: copyHealth !== 'unset', label: 'Choose a folder for backup copies', href: '/dashboard/settings#backup-copies' },
  ];
  const setupIncomplete = setupSteps.some((s) => !s.done);

  return (
    <>
      <PageHeader
        title="Overview"
        description={new Date(`${today}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        actions={
          <>
            <RefreshButton />
            <Link href="/dashboard/leaves?new=1" className="btn btn-primary">
              <CalendarPlus size={16} aria-hidden />
              Record leave
            </Link>
          </>
        }
      />

      {(copyHealth === 'failing' || copyHealth === 'overdue') && (
        <div style={{ marginBottom: '1.25rem' }}>
          <Alert tone={copyHealth === 'failing' ? 'danger' : 'warning'}>
            {copyHealth === 'failing'
              ? `The last backup copy failed${copyConfig.lastError ? `: ${copyConfig.lastError}` : '.'} `
              : 'No backup copy has been saved in the last 48 hours. '}
            <Link href="/dashboard/settings#backup-copies">Check backup copies</Link>
          </Alert>
        </div>
      )}

      {setupIncomplete && (
        <section className="card" style={{ marginBottom: '1.25rem' }} aria-labelledby="setup-title">
          <div className="card-head">
            <h2 id="setup-title">Finish setting up Chuti</h2>
          </div>
          <ul style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.5rem' }}>
            {setupSteps.map((s) => (
              <li key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {s.done ? <CheckCircle2 size={16} color="var(--success)" aria-label="Done" /> : <Circle size={16} color="var(--fg-subtle)" aria-label="To do" />}
                {s.done ? <span className="muted">{s.label}</span> : <Link href={s.href}>{s.label}</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="stats">
        <div className="card stat">
          <span className="stat-icon"><Users size={20} aria-hidden /></span>
          <div><div className="stat-value">{activeEmployees}</div><div className="stat-label">Active employees</div></div>
        </div>
        <div className="card stat">
          <span className="stat-icon info"><UserMinus size={20} aria-hidden /></span>
          <div><div className="stat-value">{new Set(onLeaveToday.map((a) => a.employee_pk)).size}</div><div className="stat-label">On leave today</div></div>
        </div>
        <div className="card stat">
          <span className="stat-icon danger"><Wallet size={20} aria-hidden /></span>
          <div><div className="stat-value">{formatDays(lwpThisMonth)}</div><div className="stat-label">Unpaid leave in {monthName}</div></div>
        </div>
        <div className="card stat">
          <span className="stat-icon warning"><Clock size={20} aria-hidden /></span>
          <div><div className="stat-value">{lateTotal?.total ?? 0}</div><div className="stat-label">Late arrivals in {monthName}</div></div>
        </div>
      </div>

      <div className="grid-main-aside">
        <div className="stack">
          <section className="card" aria-labelledby="today-title">
            <div className="card-head"><h2 id="today-title"><CalendarDays size={18} aria-hidden /> On leave today</h2></div>
            {onLeaveToday.length === 0 ? (
              <EmptyState title="No leave recorded for today">Anyone absent without a leave record will not appear here.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Employee</th><th>Type</th><th>Period</th><th className="num">Days</th></tr></thead>
                  <tbody>
                    {onLeaveToday.map((a) => (
                      <tr key={a.id}>
                        <td className="primary-cell"><Link href={`/dashboard/employees/${a.employee_pk}`}>{a.name}</Link><span className="sub">{a.designation}{a.department ? ` · ${a.department}` : ''}</span></td>
                        <td><LeaveTypeBadge type={a.leave_type} /></td>
                        <td className="nowrap">{formatDisplayRange(a.start_date, a.end_date)}</td>
                        <td className="num">{a.actual_days}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="upcoming-title">
            <div className="card-head"><h2 id="upcoming-title"><CalendarClock size={18} aria-hidden /> Starting in the next 14 days</h2></div>
            {upcoming.length === 0 ? (
              <EmptyState title="No upcoming leave" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Employee</th><th>Type</th><th>Period</th><th className="num">Days</th></tr></thead>
                  <tbody>
                    {upcoming.map((u) => (
                      <tr key={u.id}>
                        <td className="primary-cell"><Link href={`/dashboard/employees/${u.employee_pk}`}>{u.name}</Link></td>
                        <td><LeaveTypeBadge type={u.leave_type} /></td>
                        <td className="nowrap">{formatDisplayRange(u.start_date, u.end_date)}</td>
                        <td className="num">{u.actual_days}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="stack">
          <section className="card" aria-labelledby="late-title">
            <div className="card-head">
              <div>
                <h2 id="late-title"><Clock size={18} aria-hidden /> Late arrivals</h2>
                <p>
                  Every {settings.lateThreshold} late arrivals in a month cut 1 day of Casual Leave.{' '}
                  <Link href="/dashboard/settings">Change</Link>
                </p>
              </div>
            </div>
            <QuickLateForm employees={employees} currentMonth={month} threshold={settings.lateThreshold} />
          </section>
        </aside>
      </div>
    </>
  );
}
