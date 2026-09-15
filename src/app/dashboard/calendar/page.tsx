import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { getLeaveTypes } from '@/lib/leave-type-store';
import { addDays, currentMonthLocal, formatDisplayRange, isValidMonthString, monthBounds, todayLocal } from '@/lib/domain/dates';
import { ENCASHMENT_TYPE, leaveTypeInfo } from '@/lib/domain/leave-types';
import { calendarDays, dailyAbsence, placeLeaves, type CalendarLeave } from '@/lib/domain/team-calendar';
import { EmptyState, PageHeader } from '@/components/ui';
import PrintButton from '@/components/PrintButton';
import CalendarFilters from './CalendarFilters';

export const metadata: Metadata = { title: 'Team calendar' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const WEEKDAY_SHORT: Record<string, string> = { sunday: 'Su', monday: 'Mo', tuesday: 'Tu', wednesday: 'We', thursday: 'Th', friday: 'Fr', saturday: 'Sa' };

export default async function TeamCalendarPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const month = isValidMonthString(str('month')) ? str('month') : currentMonthLocal();
  const departmentId = Number.isInteger(Number(str('dept'))) && Number(str('dept')) > 0 ? Number(str('dept')) : null;
  const showAll = str('all') === '1';

  const db = await getDb();
  const [settings, leaveTypes] = await Promise.all([getSettings(), getLeaveTypes()]);
  const { start, end } = monthBounds(month);

  const [departments, employees, holidays, leaves] = await Promise.all([
    db.all<{ id: number; name: string }[]>('SELECT id, name FROM departments ORDER BY name'),
    db.all<{ id: number; name: string; employee_id: string; designation: string; department: string | null; status: string }[]>(
      `SELECT e.id, e.name, e.employee_id, e.designation, d.name AS department, e.status
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
       ${departmentId ? 'WHERE e.department_id = ?' : ''}
       ORDER BY d.name COLLATE NOCASE, e.name COLLATE NOCASE`,
      ...(departmentId ? [departmentId] : []),
    ),
    db.all<{ title: string; start_date: string; end_date: string }[]>(
      'SELECT title, start_date, end_date FROM holidays WHERE start_date <= ? AND end_date >= ? ORDER BY start_date',
      end, start,
    ),
    db.all<CalendarLeave[]>(
      `SELECT r.id, r.employee_id, r.leave_type, r.start_date, r.end_date, r.actual_days FROM leave_records r
       JOIN employees e ON e.id = r.employee_id
       WHERE r.start_date <= ? AND r.end_date >= ? AND r.leave_type != ?${departmentId ? ' AND e.department_id = ?' : ''}`,
      end, start, ENCASHMENT_TYPE, ...(departmentId ? [departmentId] : []),
    ),
  ]);

  // Holidays that start before the month still matter for sandwich charges near its edges.
  const policyHolidays = await db.all<{ start_date: string; end_date: string }[]>(
    'SELECT start_date, end_date FROM holidays WHERE start_date <= ? AND end_date >= ?',
    addDays(end, 60), addDays(start, -60),
  );
  const days = calendarDays(month, settings.weekendDays, holidays);
  const rows = placeLeaves(days, leaves, { sandwichRule: settings.sandwichRule, weekendDays: settings.weekendDays, holidays: policyHolidays });
  const totals = dailyAbsence(days, rows.values());

  const visible = employees.filter((e) => rows.has(e.id) || (showAll && e.status === 'Active'));
  const today = todayLocal();
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const shift = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    const params = new URLSearchParams({ month: d.toISOString().slice(0, 7) });
    if (departmentId) params.set('dept', String(departmentId));
    if (showAll) params.set('all', '1');
    return `/dashboard/calendar?${params}`;
  };
  const usedTypes = leaveTypes.filter((t) => leaves.some((l) => l.leave_type === t.code));
  const peak = Math.max(0, ...totals);

  return (
    <>
      <div className="print-only print-header">
        <h1>{settings.instituteName}</h1>
        <p>Team leave calendar · {monthLabel}{departmentId ? ` · ${departments.find((d) => d.id === departmentId)?.name ?? ''}` : ''}</p>
      </div>

      <PageHeader
        title="Team calendar"
        description="Who is on leave each day of the month."
        actions={<PrintButton label="Print" />}
      />

      <div className="toolbar no-print">
        <div className="group" style={{ alignItems: 'center' }}>
          <Link className="icon-btn" href={shift(-1)} aria-label="Previous month" title="Previous month"><ChevronLeft size={18} aria-hidden /></Link>
          <strong style={{ minWidth: '9.5rem', textAlign: 'center' }} aria-live="polite">{monthLabel}</strong>
          <Link className="icon-btn" href={shift(1)} aria-label="Next month" title="Next month"><ChevronRight size={18} aria-hidden /></Link>
          {month !== currentMonthLocal() && <Link className="btn btn-ghost btn-sm" href={`/dashboard/calendar${departmentId ? `?dept=${departmentId}` : ''}`}>This month</Link>}
        </div>
        <CalendarFilters month={month} departmentId={departmentId} showAll={showAll} departments={departments} />
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState title={`No leave recorded in ${monthLabel}`}>
            {employees.length === 0 ? 'No employees in this view.' : 'Tick “Show everyone” to see the whole team.'}
          </EmptyState>
        </div>
      ) : (
        <div className="table-wrap cal-wrap">
          <table className="cal">
            <caption className="sr-only">Leave by employee and day, {monthLabel}</caption>
            <thead>
              <tr>
                <th scope="col" className="cal-name">Employee</th>
                {days.map((d) => (
                  <th
                    key={d.date}
                    scope="col"
                    className={['cal-day', d.off ? `cal-off-${d.off}` : '', d.date === today ? 'cal-today' : ''].filter(Boolean).join(' ')}
                    title={d.holiday ?? (d.off === 'weekend' ? 'Weekend' : undefined)}
                  >
                    <span className="cal-wd">{WEEKDAY_SHORT[d.weekday]}</span>
                    <span>{d.day}</span>
                  </th>
                ))}
                <th scope="col" className="cal-total">Days</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const row = rows.get(e.id);
                let charged = 0;
                return (
                  <tr key={e.id}>
                    <th scope="row" className="cal-name">
                      <Link href={`/dashboard/employees/${e.id}`}>{e.name}</Link>
                      <span className="sub">{e.department ?? e.designation}</span>
                    </th>
                    {days.map((d, i) => {
                      const cell = row?.[i] ?? null;
                      const offClass = d.off ? `cal-off-${d.off}` : '';
                      if (!cell) return <td key={d.date} className={offClass || undefined} />;
                      if (cell.charged) charged += cell.half ? 0.5 : 1;
                      const info = leaveTypeInfo(leaveTypes, cell.type);
                      const label = `${e.name}: ${info.label}${cell.half ? ' (half day)' : ''}, ${formatDisplayRange(cell.range[0], cell.range[1])}${cell.charged ? '' : ` · ${d.holiday ?? 'weekend'}, not charged`}`;
                      return (
                        <td key={d.date} className={offClass || undefined}>
                          <span
                            className={['cal-leave', `tone-${info.tone}`, cell.half ? 'cal-half' : '', cell.charged ? '' : 'cal-uncharged'].filter(Boolean).join(' ')}
                            title={label}
                            aria-label={label}
                          >
                            {cell.start ? info.short : ''}
                          </span>
                        </td>
                      );
                    })}
                    <td className="cal-total">{charged || ''}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="cal-name">On leave</th>
                {totals.map((n, i) => (
                  <td key={days[i].date} className={['cal-count', days[i].off ? `cal-off-${days[i].off}` : '', n > 0 && n === peak ? 'cal-peak' : ''].filter(Boolean).join(' ')}>
                    {n || ''}
                  </td>
                ))}
                <td className="cal-total" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="cal-legend" aria-label="Legend">
        {usedTypes.map((t) => <span key={t.code} className={`badge tone-${t.tone}`}>{t.short} · {t.label}</span>)}
        <span className="badge cal-legend-off">Weekend</span>
        <span className="badge cal-legend-holiday">Holiday</span>
        <span className="subtle">Striped cells are weekends or holidays inside a leave that were not charged. Hover a cell for details.</span>
      </div>
      {holidays.length > 0 && (
        <p className="subtle" style={{ marginTop: '0.5rem' }}>
          Holidays: {holidays.map((h) => `${h.title} (${formatDisplayRange(h.start_date, h.end_date)})`).join(' · ')}
        </p>
      )}
    </>
  );
}
