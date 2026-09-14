import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getSettings, readPolicy } from '@/lib/settings';
import { currentMonthLocal, isValidMonthString, monthBounds } from '@/lib/domain/dates';
import { chargedDaysWithin } from '@/lib/domain/leave-days';
import { ENCASHMENT_TYPE, isLeaveType } from '@/lib/domain/leave-types';
import { PageHeader } from '@/components/ui';
import ReportsClient, { type LedgerRow, type PayrollRow } from './ReportsClient';

export const metadata: Metadata = { title: 'Reports' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const month = isValidMonthString(str('month')) ? str('month') : currentMonthLocal();
  const departmentId = Number(str('dept')) || null;
  const employeeId = Number(str('emp')) || null;
  const leaveType = isLeaveType(str('type')) ? str('type') : '';
  const tab = str('tab') === 'payroll' ? 'payroll' : 'ledger';

  const db = await getDb();
  const settings = await getSettings();
  const { start, end } = monthBounds(month);
  const policy = await readPolicy(db, { start, end });

  const filters: string[] = [];
  const args: (string | number)[] = [];
  if (departmentId) { filters.push('e.department_id = ?'); args.push(departmentId); }
  if (employeeId) { filters.push('e.id = ?'); args.push(employeeId); }
  const employeeFilter = filters.length ? ` AND ${filters.join(' AND ')}` : '';

  const [departments, employees, records, lates] = await Promise.all([
    db.all<{ id: number; name: string }[]>('SELECT id, name FROM departments ORDER BY name'),
    db.all<{ id: number; name: string; employee_id: string; department: string | null; status: string }[]>(
      `SELECT e.id, e.name, e.employee_id, d.name AS department, e.status FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id ORDER BY e.name COLLATE NOCASE`,
    ),
    db.all<{ id: number; employee_pk: number; name: string; emp_code: string; department: string | null; leave_type: string; start_date: string; end_date: string; actual_days: number; reason: string; remarks: string | null }[]>(
      `SELECT r.id, e.id AS employee_pk, e.name, e.employee_id AS emp_code, d.name AS department, r.leave_type, r.start_date, r.end_date, r.actual_days, r.reason, r.remarks
       FROM leave_records r JOIN employees e ON e.id = r.employee_id LEFT JOIN departments d ON d.id = e.department_id
       WHERE r.start_date <= ? AND r.end_date >= ?${employeeFilter}
       ORDER BY r.start_date, e.name`,
      end, start, ...args,
    ),
    db.all<{ employee_pk: number; late_count: number; deducted_cl: number }[]>(
      `SELECT e.id AS employee_pk, l.late_count, l.deducted_cl FROM late_deductions l JOIN employees e ON e.id = l.employee_id
       WHERE l.month_year = ?${employeeFilter}`,
      month, ...args,
    ),
  ]);

  const ledger: LedgerRow[] = records
    .filter((r) => !leaveType || r.leave_type === leaveType)
    .map((r) => ({
      id: r.id,
      employeeId: r.employee_pk,
      code: r.emp_code,
      name: r.name,
      department: r.department ?? '—',
      leaveType: r.leave_type,
      start: r.start_date,
      end: r.end_date,
      totalDays: r.actual_days,
      daysInMonth: r.leave_type === ENCASHMENT_TYPE ? r.actual_days : chargedDaysWithin(r, start, end, policy),
      reason: r.reason,
      remarks: r.remarks ?? '',
    }));

  const daysInMonth = Number(end.slice(8, 10));
  const byEmployee = new Map<number, PayrollRow>();
  const rowFor = (id: number) => {
    let row = byEmployee.get(id);
    if (!row) {
      const emp = employees.find((e) => e.id === id)!;
      row = { employeeId: id, code: emp.employee_id, name: emp.name, department: emp.department ?? '—', Casual: 0, Sick: 0, Earned: 0, Maternity: 0, LWP: 0, lates: 0, lateCut: 0, paidDays: daysInMonth, monthDays: daysInMonth };
      byEmployee.set(id, row);
    }
    return row;
  };
  for (const r of records) {
    if (r.leave_type === ENCASHMENT_TYPE || !isLeaveType(r.leave_type)) continue;
    const row = rowFor(r.employee_pk);
    row[r.leave_type] += chargedDaysWithin(r, start, end, policy);
  }
  for (const l of lates) {
    const row = rowFor(l.employee_pk);
    row.lates += l.late_count;
    row.lateCut += l.deducted_cl;
  }
  // With a specific employee selected, show them even with a clean month.
  if (employeeId && employees.some((e) => e.id === employeeId)) rowFor(employeeId);
  const payroll = [...byEmployee.values()]
    .map((r) => ({ ...r, paidDays: Math.max(0, r.monthDays - r.LWP) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="Reports" description="Monthly leave ledger and payroll attendance summary. Print as A4 landscape or export to Excel." />
      <ReportsClient
        instituteName={settings.instituteName}
        month={month}
        tab={tab}
        departmentId={departmentId}
        employeeId={employeeId}
        leaveType={leaveType}
        departments={departments}
        employees={employees.map((e) => ({ id: e.id, name: e.name, employee_id: e.employee_id }))}
        ledger={ledger}
        payroll={payroll}
      />
    </>
  );
}
