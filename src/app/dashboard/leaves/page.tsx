import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { remainingSql } from '@/lib/domain/balance';
import { ENCASHMENT_TYPE } from '@/lib/domain/leave-types';
import { getLeaveTypes } from '@/lib/leave-type-store';
import type { PickerEmployee } from '@/components/EmployeePicker';
import { PageHeader } from '@/components/ui';
import LeaveClient, { type LeaveRow } from './LeaveClient';

export const metadata: Metadata = { title: 'Leave records' };

const PAGE_SIZE = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LeavesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 100) : '';
  const leaveTypes = await getLeaveTypes();
  const type = typeof sp.type === 'string' && (leaveTypes.some((t) => t.code === sp.type) || sp.type === ENCASHMENT_TYPE) ? sp.type : '';
  const page = Math.max(1, parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);

  const db = await getDb();
  const settings = await getSettings();

  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q) {
    // Treat % and _ typed by the user literally.
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const cols = ['e.name', 'e.employee_id', 'r.reason', 'r.remarks'];
    where.push(`(${cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    args.push(...cols.map(() => like));
  }
  if (type) {
    where.push('r.leave_type = ?');
    args.push(type);
  }
  const filterSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRow, records, employeeRows, balanceRows] = await Promise.all([
    db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM leave_records r JOIN employees e ON r.employee_id = e.id ${filterSql}`, ...args),
    db.all<LeaveRow[]>(
      `SELECT r.id, r.employee_id, e.name, e.employee_id AS emp_code, r.leave_type, r.start_date, r.end_date, r.actual_days, r.reason, r.attachment_path, r.remarks, r.recorded_at
       FROM leave_records r JOIN employees e ON r.employee_id = e.id
       ${filterSql}
       ORDER BY r.start_date DESC, r.id DESC
       LIMIT ? OFFSET ?`,
      ...args, PAGE_SIZE, (page - 1) * PAGE_SIZE,
    ),
    db.all<{ id: number; name: string; employee_id: string; department: string | null }[]>(
      `SELECT e.id, e.name, e.employee_id, d.name AS department
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.status = 'Active' ORDER BY e.name COLLATE NOCASE`,
    ),
    db.all<{ employee_id: number; leave_type: string; remaining: number }[]>(
      `SELECT b.employee_id, b.leave_type, ${remainingSql('b')} AS remaining
       FROM leave_balances b JOIN employees e ON e.id = b.employee_id WHERE e.status = 'Active'`,
    ),
  ]);

  const balancesByEmployee = new Map<number, Record<string, number>>();
  for (const b of balanceRows) {
    const entry = balancesByEmployee.get(b.employee_id) ?? {};
    entry[b.leave_type] = b.remaining;
    balancesByEmployee.set(b.employee_id, entry);
  }
  const employees: PickerEmployee[] = employeeRows.map((e) => ({ ...e, balances: balancesByEmployee.get(e.id) ?? {} }));

  const total = countRow?.count ?? 0;

  return (
    <>
      <PageHeader title="Leave records" description="Record leave, attach supporting documents, and correct past entries." />
      <LeaveClient
        records={records}
        employees={employees}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        query={q}
        type={type}
        leaveYearStart={settings.leaveYearStart}
        openNew={sp.new === '1'}
      />
    </>
  );
}
