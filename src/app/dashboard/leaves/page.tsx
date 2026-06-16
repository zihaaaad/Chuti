import { getDb } from '@/lib/db';
import LeaveClient from './LeaveClient';

export default async function LeavesPage() {
  const db = await getDb();

  // 1. Fetch active employees with their remaining balances
  const employees = await db.all(`
    SELECT 
      e.id, 
      e.name, 
      e.employee_id,
      MAX(CASE WHEN b.leave_type = 'Casual' THEN (b.allocated_days - b.used_days) END) as cl_left,
      MAX(CASE WHEN b.leave_type = 'Sick' THEN (b.allocated_days - b.used_days) END) as sl_left,
      MAX(CASE WHEN b.leave_type = 'Earned' THEN (b.allocated_days - b.used_days - b.encashed_days) END) as el_left
    FROM employees e
    LEFT JOIN leave_balances b ON e.id = b.employee_id
    WHERE e.status = 'Active'
    GROUP BY e.id
    ORDER BY e.name ASC
  `);

  // 2. Fetch all leave records
  const leaveRecords = await db.all(`
    SELECT r.id, r.employee_id, e.name, e.employee_id as emp_code, r.leave_type, r.start_date, r.end_date, r.actual_days, r.reason, r.attachment_path, r.remarks, r.recorded_at
    FROM leave_records r
    JOIN employees e ON r.employee_id = e.id
    ORDER BY r.recorded_at DESC
  `);

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--primary)' }}>Leave Records</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)' }}>Register new leave applications, manage local files, and review historical logs.</p>
      </div>

      <LeaveClient initialRecords={leaveRecords} employees={employees} />
    </div>
  );
}
