import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Lock } from 'lucide-react';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { remainingDays } from '@/lib/domain/balance';
import { ENCASHMENT_TYPE, LEAVE_TYPES, leaveTypeInfo } from '@/lib/domain/leave-types';
import { formatDisplayDate, formatDisplayRange } from '@/lib/domain/dates';
import { EmptyState, LeaveTypeBadge, PageHeader, StatusBadge, formatDays } from '@/components/ui';
import PrintButton from '@/components/PrintButton';

export const metadata: Metadata = { title: 'Employee ledger' };

type Params = Promise<{ id: string }>;

interface LedgerEntry {
  key: string;
  date: string;
  kind: string;
  period: string;
  days: number | null;
  note: string;
  locked: boolean;
}

export default async function EmployeeLedgerPage({ params }: { params: Params }) {
  await requireAdmin();
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const db = await getDb();
  const settings = await getSettings();
  const employee = await db.get<{ id: number; employee_id: string; name: string; designation: string; department: string | null; join_date: string; phone: string | null; email: string | null; status: string }>(
    `SELECT e.id, e.employee_id, e.name, e.designation, d.name AS department, e.join_date, e.phone, e.email, e.status
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.id = ?`,
    id,
  );
  if (!employee) notFound();

  const [balances, records, lates] = await Promise.all([
    db.all<{ leave_type: string; allocated_days: number; used_days: number; encashed_days: number; carried_forward: number }[]>(
      'SELECT leave_type, allocated_days, used_days, COALESCE(encashed_days,0) AS encashed_days, COALESCE(carried_forward,0) AS carried_forward FROM leave_balances WHERE employee_id = ?',
      id,
    ),
    db.all<{ id: number; leave_type: string; start_date: string; end_date: string; actual_days: number; reason: string; remarks: string | null }[]>(
      'SELECT id, leave_type, start_date, end_date, actual_days, reason, remarks FROM leave_records WHERE employee_id = ? ORDER BY start_date DESC',
      id,
    ),
    db.all<{ id: number; month_year: string; late_count: number; deducted_cl: number }[]>(
      'SELECT id, month_year, late_count, deducted_cl FROM late_deductions WHERE employee_id = ? ORDER BY month_year DESC',
      id,
    ),
  ]);

  const ledger: LedgerEntry[] = [
    ...records.map((r) => ({
      key: `r${r.id}`,
      date: r.start_date,
      kind: r.leave_type,
      period: formatDisplayRange(r.start_date, r.end_date),
      days: r.actual_days,
      note: [r.reason, r.remarks].filter(Boolean).join(' — '),
      locked: r.start_date < settings.leaveYearStart,
    })),
    ...lates.map((l) => ({
      key: `l${l.id}`,
      date: `${l.month_year}-01`,
      kind: 'late',
      period: new Date(`${l.month_year}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      days: l.deducted_cl,
      note: `${l.late_count} late arrivals`,
      locked: `${l.month_year}-01` < settings.leaveYearStart,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  const yearLabel = settings.leaveYearStart === '0001-01-01' ? 'since records began' : `since ${formatDisplayDate(settings.leaveYearStart)}`;

  return (
    <>
      <div className="no-print" style={{ marginBottom: '0.75rem' }}>
        <Link href="/dashboard/employees" className="btn btn-ghost btn-sm"><ArrowLeft size={14} aria-hidden /> All employees</Link>
      </div>

      <div className="print-only print-header">
        <h1>{settings.instituteName}</h1>
        <p>Leave statement for {employee.name} ({employee.employee_id}) · printed {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <PageHeader
        title={employee.name}
        description={<>{employee.designation}{employee.department ? ` · ${employee.department}` : ''} · <StatusBadge status={employee.status} /></>}
        actions={<PrintButton label="Print statement" />}
      />

      <div className="grid-main-aside" style={{ marginBottom: '1.25rem' }}>
        <section className="card" aria-labelledby="bal-title">
          <div className="card-head">
            <div>
              <h2 id="bal-title">Balances</h2>
              <p>Current leave year, {yearLabel}.</p>
            </div>
          </div>
          <div className="balance-cards">
            {LEAVE_TYPES.filter((t) => t.code !== 'LWP').map((t) => {
              const b = balances.find((x) => x.leave_type === t.code);
              if (!b) return null;
              const total = b.allocated_days + b.carried_forward;
              const left = remainingDays(b);
              const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
              return (
                <div key={t.code} className="balance-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <LeaveTypeBadge type={t.code} short />
                    <span className="subtle">{t.label}</span>
                  </div>
                  <div className="big">{left}<span className="subtle"> / {total}</span></div>
                  <div className="meter" aria-hidden><span className={pct === 0 ? 'empty' : pct < 25 ? 'low' : ''} style={{ width: `${pct}%` }} /></div>
                  <div className="subtle num">
                    Used {b.used_days}
                    {b.carried_forward > 0 && ` · carried ${b.carried_forward}`}
                    {b.encashed_days > 0 && ` · encashed ${b.encashed_days}`}
                  </div>
                </div>
              );
            })}
            {(() => {
              const lwp = balances.find((x) => x.leave_type === 'LWP');
              return lwp ? (
                <div className="balance-card">
                  <LeaveTypeBadge type="LWP" short />
                  <div className="big">{lwp.used_days}</div>
                  <div className="subtle">unpaid days taken</div>
                </div>
              ) : null;
            })()}
          </div>
        </section>

        <section className="card" aria-labelledby="profile-title">
          <div className="card-head"><h2 id="profile-title">Profile</h2></div>
          <dl className="dl">
            <dt>Employee ID</dt><dd>{employee.employee_id}</dd>
            <dt>Joined</dt><dd>{formatDisplayDate(employee.join_date)}</dd>
            <dt>Phone</dt><dd>{employee.phone || '—'}</dd>
            <dt>Email</dt><dd>{employee.email || '—'}</dd>
          </dl>
        </section>
      </div>

      <section className="card" aria-labelledby="ledger-title">
        <div className="card-head">
          <div>
            <h2 id="ledger-title">Ledger</h2>
            <p>Every leave, encashment and late-arrival cut, newest first.</p>
          </div>
        </div>
        {ledger.length === 0 ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Entry</th><th>Period</th><th className="num">Days</th><th>Details</th></tr></thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.key} className={e.locked ? 'locked' : undefined}>
                    <td className="nowrap">
                      {e.kind === 'late' ? <span className="badge badge-warning">Late cut (CL)</span> : <LeaveTypeBadge type={e.kind} />}
                      {e.locked && <Lock size={12} aria-label="Closed leave year" style={{ marginLeft: 6, verticalAlign: 'middle' }} />}
                    </td>
                    <td className="nowrap">{e.period}</td>
                    <td className="num">{e.days ?? '—'}</td>
                    <td>{e.note}{e.kind === ENCASHMENT_TYPE && ` (${leaveTypeInfo(e.kind).label})`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="subtle" style={{ marginTop: '0.5rem' }}>
          Total leave on record: {formatDays(records.filter((r) => r.leave_type !== ENCASHMENT_TYPE).reduce((s, r) => s + r.actual_days, 0))}.
          Rows with a lock belong to a closed leave year.
        </p>
      </section>

      <div className="print-only print-footer">
        <div className="signatures"><div>Employee</div><div>HR / Admin</div><div>Authorised signatory</div></div>
      </div>
    </>
  );
}
