import { getDb } from '@/lib/db';
import ReportsClient from './ReportsClient';

export default async function ReportsPage() {
  const db = await getDb();

  // 1. Fetch active employees
  const employees = await db.all(`
    SELECT e.id, e.name, e.employee_id, d.name as department 
    FROM employees e 
    LEFT JOIN departments d ON e.department_id = d.id 
    ORDER BY e.name ASC
  `);

  // 2. Fetch departments
  const departments = await db.all("SELECT id, name FROM departments ORDER BY name ASC");

  // 3. Fetch all leave records
  const leaveRecords = await db.all(`
    SELECT r.id, r.employee_id, e.name, e.employee_id as emp_code, d.name as department, r.leave_type, r.start_date, r.end_date, r.actual_days, r.reason, r.remarks, r.recorded_at
    FROM leave_records r
    JOIN employees e ON r.employee_id = e.id
    LEFT JOIN departments d ON e.department_id = d.id
    ORDER BY r.start_date DESC
  `);

  // 4. Fetch all late attendance records
  const lateRecords = await db.all(`
    SELECT d.id, d.employee_id, e.name, e.employee_id as emp_code, dept.name as department, d.month_year, d.late_count, d.deducted_cl
    FROM late_deductions d
    JOIN employees e ON d.employee_id = e.id
    LEFT JOIN departments dept ON e.department_id = dept.id
    ORDER BY d.month_year DESC
  `);

  // 5. Fetch institute name setting
  let instituteName = 'Chuti Leave Management';
  try {
    const setting = await db.get('SELECT value FROM system_settings WHERE key = ?', 'institute_name');
    if (setting) instituteName = setting.value;
  } catch (err) {
    console.error('Failed to load institute name:', err);
  }

  return (
    <div>
      {/* Page Title (Hidden in print) */}
      <div className="no-print" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--primary)' }}>Reports Center</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)' }}>Generate customized leave logs, view payroll summary sheets, print PDFs, or export to CSV.</p>
      </div>

      <ReportsClient 
        employees={employees} 
        departments={departments} 
        leaveRecords={leaveRecords}
        lateRecords={lateRecords}
        instituteName={instituteName}
      />
    </div>
  );
}
