import { getDb } from '@/lib/db';
import Link from 'next/link';
import { Users, LogOut, Clock, CalendarDays, FileSpreadsheet } from 'lucide-react';
import QuickLateForm from './QuickLateForm';
import RefreshButton from './RefreshButton';

export default async function DashboardPage() {
  const db = await getDb();
  
  const todayStr = new Date().toISOString().split('T')[0];
  const currentMonthStr = todayStr.substring(0, 7); // YYYY-MM

  // 1. Fetch Stats
  const empStat = await db.get("SELECT COUNT(*) as count FROM employees WHERE status = 'Active'");
  const totalEmployees = empStat?.count || 0;

  const leaveStat = await db.get(
    `SELECT COUNT(DISTINCT employee_id) as count FROM leave_records 
     WHERE ? BETWEEN start_date AND end_date`,
    [todayStr]
  );
  const onLeaveToday = leaveStat?.count || 0;

  const lwpStat = await db.get(
    `SELECT SUM(actual_days) as total FROM leave_records 
     WHERE leave_type = 'LWP' AND (start_date LIKE ? OR end_date LIKE ?)`,
    [`${currentMonthStr}%`, `${currentMonthStr}%`]
  );
  const totalLWPThisMonth = lwpStat?.total || 0;

  const lateStat = await db.get(
    "SELECT SUM(late_count) as total FROM late_deductions WHERE month_year = ?",
    [currentMonthStr]
  );
  const totalLatesThisMonth = lateStat?.total || 0;

  // 2. Fetch Active Absences (Who is on leave today)
  const activeAbsences = await db.all(
    `SELECT e.name, e.designation, e.department, r.leave_type, r.start_date, r.end_date, r.actual_days 
     FROM leave_records r 
     JOIN employees e ON r.employee_id = e.id 
     WHERE ? BETWEEN r.start_date AND r.end_date
     ORDER BY r.recorded_at DESC`,
    [todayStr]
  );

  // 3. Fetch Recent Leaves (Last 5)
  const recentLeaves = await db.all(
    `SELECT r.id, e.name, e.employee_id as emp_code, r.leave_type, r.start_date, r.end_date, r.actual_days, r.recorded_at 
     FROM leave_records r 
     JOIN employees e ON r.employee_id = e.id 
     ORDER BY r.recorded_at DESC 
     LIMIT 5`
  );

  // 4. Fetch Employee List with CL Balance for Quick Form Selection
  const employeesList = await db.all(`
    SELECT 
      e.id, 
      e.name, 
      e.employee_id,
      (b.allocated_days - b.used_days) as cl_left
    FROM employees e
    LEFT JOIN leave_balances b ON e.id = b.employee_id AND b.leave_type = 'Casual'
    WHERE e.status = 'Active'
    ORDER BY e.name ASC
  `);

  return (
    <div>
      {/* Page Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--primary)' }}>Console Overview</h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)' }}>Quick statistics and daily tracking summary for {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }} className="no-print">
          <RefreshButton />
          <Link href="/dashboard/leaves" className="btn btn-primary">
            <CalendarDays size={16} />
            Record A Leave
          </Link>
        </div>
      </div>

      {/* Stats Cards Grid */}
      <div className="dashboard-grid">
        <div className="card stat-card">
          <div className="stat-icon">
            <Users size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{totalEmployees}</span>
            <span className="stat-label">Active Employees</span>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-icon" style={{ color: 'var(--success)', backgroundColor: 'var(--success-bg)' }}>
            <CalendarDays size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-value" style={{ color: 'var(--success)' }}>{onLeaveToday}</span>
            <span className="stat-label">On Leave Today</span>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-icon" style={{ color: 'var(--error)', backgroundColor: 'var(--error-bg)' }}>
            <LogOut size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-value" style={{ color: 'var(--error)' }}>{totalLWPThisMonth} Days</span>
            <span className="stat-label">LWP This Month</span>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-icon" style={{ color: 'var(--warning)', backgroundColor: 'var(--warning-bg)' }}>
            <Clock size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-value" style={{ color: 'var(--warning)' }}>{totalLatesThisMonth}</span>
            <span className="stat-label">Late Arrivals ({new Date().toLocaleString('en-US', { month: 'short' })})</span>
          </div>
        </div>
      </div>

      {/* Main Grid Content */}
      <div className="dashboard-layout-grid">
        
        {/* Left Side: Active Absences and Recent Leaves */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Active Absences (Today's Leaves) */}
          <div className="card">
            <h3 style={{ fontSize: '1.125rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)' }}></span>
              Absent Today
            </h3>
            
            {activeAbsences.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', padding: '1rem 0' }}>
                All employees are present today. No absences logged.
              </p>
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Designation</th>
                      <th>Leave Type</th>
                      <th>Duration</th>
                      <th>Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeAbsences.map((abs, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: '600' }}>{abs.name}</td>
                        <td>{abs.designation}</td>
                        <td>
                          <span className={`badge ${
                            abs.leave_type === 'Casual' ? 'badge-success' : 
                            abs.leave_type === 'Sick' ? 'badge-info' : 
                            abs.leave_type === 'LWP' ? 'badge-danger' : 'badge-warning'
                          }`}>
                            {abs.leave_type}
                          </span>
                        </td>
                        <td>{abs.actual_days} days</td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>
                          {abs.start_date} to {abs.end_date}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent Leaves Log */}
          <div className="card">
            <h3 style={{ fontSize: '1.125rem', marginBottom: '1rem' }}>Recently Logged Leaves</h3>
            {recentLeaves.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', padding: '1rem 0' }}>
                No leave records registered yet.
              </p>
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Type</th>
                      <th>Days</th>
                      <th>Period</th>
                      <th>Recorded At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentLeaves.map((record) => (
                      <tr key={record.id}>
                        <td>
                          <div style={{ fontWeight: '600' }}>{record.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>{record.emp_code}</div>
                        </td>
                        <td>
                          <span className={`badge ${
                            record.leave_type.startsWith('Casual') ? 'badge-success' : 
                            record.leave_type.startsWith('Sick') ? 'badge-info' : 
                            record.leave_type.startsWith('LWP') ? 'badge-danger' : 'badge-warning'
                          }`}>
                            {record.leave_type}
                          </span>
                        </td>
                        <td style={{ fontWeight: 500 }}>{record.actual_days} days</td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>
                          {record.start_date} to {record.end_date}
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>
                          {new Date(record.recorded_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>

        {/* Right Side: Quick Action Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Quick Late Attendance Logger */}
          <div className="card">
            <h3 style={{ fontSize: '1.125rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={18} />
              Quick Late Logger
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: '1.25rem' }}>
              Record late entries for CL deduction calculation.
            </p>
            <QuickLateForm employees={employeesList} currentMonth={currentMonthStr} />
          </div>

          {/* Quick Info Box */}
          <div className="card" style={{ backgroundColor: 'var(--primary-light)', borderColor: 'rgba(27, 58, 36, 0.1)' }}>
            <h4 style={{ fontSize: '0.875rem', color: 'var(--primary)', marginBottom: '0.5rem', fontWeight: 600 }}>Deduction Policy Reminder</h4>
            <p style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', lineHeight: '1.4' }}>
              According to current system configurations, Casual Leave (CL) is auto-deducted at the specified threshold (default: 3 late arrivals = 1 CL day deduction). Verify details or change settings in the Settings panel.
            </p>
          </div>

        </div>

      </div>
    </div>
  );
}
