import { getDb } from '@/lib/db';
import EmployeeClient from './EmployeeClient';

export default async function EmployeesPage() {
  const db = await getDb();

  // 1. Fetch departments for dropdowns
  const departments = await db.all("SELECT id, name FROM departments ORDER BY name ASC");

  // 2. Fetch all employees
  const employeesRaw = await db.all(`
    SELECT e.id, e.employee_id, e.name, e.designation, d.name as department, e.join_date as joining_date, e.phone, e.status
    FROM employees e
    LEFT JOIN departments d ON e.department_id = d.id
    ORDER BY e.employee_id ASC
  `);

  // 3. Fetch all leave balances
  const balancesRaw = await db.all(`
    SELECT employee_id, leave_type, allocated_days, used_days, encashed_days
    FROM leave_balances
  `);

  // Group balances by employee_id
  const balancesMap: Record<number, any[]> = {};
  balancesRaw.forEach(bal => {
    if (!balancesMap[bal.employee_id]) {
      balancesMap[bal.employee_id] = [];
    }
    balancesMap[bal.employee_id].push({
      type: bal.leave_type,
      allocated: bal.allocated_days,
      used: bal.used_days,
      encashed: bal.encashed_days,
      remaining: bal.allocated_days - bal.used_days - bal.encashed_days
    });
  });

  // Combine employee and balance info
  const employees = employeesRaw.map(emp => ({
    ...emp,
    balances: balancesMap[emp.id] || []
  }));

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--primary)' }}>Employee Directory</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)' }}>Manage institute staff profiles, job designations, and adjust leave allocations.</p>
      </div>

      <EmployeeClient initialEmployees={employees} departments={departments} />
    </div>
  );
}
