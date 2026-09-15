import 'server-only';
import type { Database } from 'sqlite';
import { readPolicy } from './settings';
import { monthBounds } from './domain/dates';
import { chargedDaysWithin } from './domain/leave-days';
import { ENCASHMENT_TYPE } from './domain/leave-types';

// Monthly report data shared by the Reports page and the Excel export, so the
// screen, the printout and the spreadsheet always show the same numbers.

export interface ReportFilters {
  month: string;
  departmentId: number | null;
  employeeId: number | null;
  leaveType: string;
}

export interface LedgerRow {
  id: number;
  employeeId: number;
  code: string;
  name: string;
  department: string;
  leaveType: string;
  start: string;
  end: string;
  totalDays: number;
  daysInMonth: number;
  reason: string;
  remarks: string;
}

export interface PayrollRow {
  employeeId: number;
  code: string;
  name: string;
  department: string;
  /** Days of each leave type falling inside the month, keyed by leave type code. */
  days: Record<string, number>;
  totalLeave: number;
  unpaidDays: number;
  lates: number;
  lateCut: number;
  paidDays: number;
  monthDays: number;
}

export interface MonthlyReport {
  ledger: LedgerRow[];
  payroll: PayrollRow[];
}

/**
 * @param leaveTypes codes of leave types that count as leave (in column order)
 * @param unpaidTypes codes that reduce paid days (e.g. LWP)
 */
export async function buildMonthlyReport(
  db: Database,
  filters: ReportFilters,
  leaveTypes: readonly string[],
  unpaidTypes: readonly string[],
): Promise<MonthlyReport> {
  const { month, departmentId, employeeId, leaveType } = filters;
  const { start, end } = monthBounds(month);
  const policy = await readPolicy(db, { start, end });

  const clauses: string[] = [];
  const args: (string | number)[] = [];
  if (departmentId) { clauses.push('e.department_id = ?'); args.push(departmentId); }
  if (employeeId) { clauses.push('e.id = ?'); args.push(employeeId); }
  const employeeFilter = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';

  const [employees, records, lates] = await Promise.all([
    db.all<{ id: number; name: string; employee_id: string; department: string | null }[]>(
      `SELECT e.id, e.name, e.employee_id, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id`,
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

  const monthDays = Number(end.slice(8, 10));
  const known = new Set(leaveTypes);
  const unpaid = new Set(unpaidTypes);
  const byEmployee = new Map<number, PayrollRow>();
  const rowFor = (id: number) => {
    let row = byEmployee.get(id);
    if (!row) {
      const emp = employees.find((e) => e.id === id)!;
      row = {
        employeeId: id, code: emp.employee_id, name: emp.name, department: emp.department ?? '—',
        days: Object.fromEntries(leaveTypes.map((t) => [t, 0])), totalLeave: 0, unpaidDays: 0,
        lates: 0, lateCut: 0, paidDays: monthDays, monthDays,
      };
      byEmployee.set(id, row);
    }
    return row;
  };
  for (const r of records) {
    if (r.leave_type === ENCASHMENT_TYPE || !known.has(r.leave_type)) continue;
    const row = rowFor(r.employee_pk);
    const inMonth = chargedDaysWithin(r, start, end, policy);
    row.days[r.leave_type] += inMonth;
    row.totalLeave += inMonth;
    if (unpaid.has(r.leave_type)) row.unpaidDays += inMonth;
  }
  for (const l of lates) {
    const row = rowFor(l.employee_pk);
    row.lates += l.late_count;
    row.lateCut += l.deducted_cl;
  }
  // With a specific employee selected, show them even with a clean month.
  if (employeeId && employees.some((e) => e.id === employeeId)) rowFor(employeeId);

  const payroll = [...byEmployee.values()]
    .map((r) => ({ ...r, paidDays: Math.max(0, r.monthDays - r.unpaidDays) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ledger, payroll };
}
