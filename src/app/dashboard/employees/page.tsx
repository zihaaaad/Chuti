import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { remainingSql } from '@/lib/domain/balance';
import { PageHeader } from '@/components/ui';
import EmployeeClient, { type EmployeeRow } from './EmployeeClient';

export const metadata: Metadata = { title: 'Employees' };

/** Next code after the highest existing EMP-### (so deleted numbers are never reused). */
function suggestNextCode(codes: string[]): string {
  let max = 0;
  let width = 3;
  let prefix = 'EMP-';
  for (const code of codes) {
    const m = /^(.*?)(\d+)$/.exec(code);
    if (!m) continue;
    const n = parseInt(m[2], 10);
    if (n >= max) {
      max = n;
      prefix = m[1];
      width = Math.max(3, m[2].length);
    }
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

export default async function EmployeesPage() {
  await requireAdmin();
  const db = await getDb();

  const [departments, rows, balances] = await Promise.all([
    db.all<{ id: number; name: string }[]>('SELECT id, name FROM departments ORDER BY name'),
    db.all<Omit<EmployeeRow, 'balances'>[]>(
      `SELECT e.id, e.employee_id, e.name, e.designation, d.name AS department, e.join_date AS joining_date, e.phone, e.email, e.status
       FROM employees e LEFT JOIN departments d ON e.department_id = d.id
       ORDER BY e.name COLLATE NOCASE`,
    ),
    db.all<{ employee_id: number; leave_type: string; allocated_days: number; remaining: number }[]>(
      `SELECT b.employee_id, b.leave_type, b.allocated_days, ${remainingSql('b')} AS remaining FROM leave_balances b`,
    ),
  ]);

  const byEmployee = new Map<number, EmployeeRow['balances']>();
  for (const b of balances) {
    const list = byEmployee.get(b.employee_id) ?? {};
    list[b.leave_type] = { allocated: b.allocated_days, remaining: b.remaining };
    byEmployee.set(b.employee_id, list);
  }
  const employees: EmployeeRow[] = rows.map((r) => ({ ...r, department: r.department ?? '—', balances: byEmployee.get(r.id) ?? {} }));

  return (
    <>
      <PageHeader title="Employees" description="Staff profiles, departments and yearly leave quotas." />
      <EmployeeClient employees={employees} departments={departments} nextCode={suggestNextCode(rows.map((r) => r.employee_id))} />
    </>
  );
}
