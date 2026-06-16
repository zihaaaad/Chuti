'use client';

import { useState } from 'react';
import { Printer, Download, Calendar, Users, FileText } from 'lucide-react';

interface EmployeeItem {
  id: number;
  name: string;
  employee_id: string;
  department: string;
}

interface DepartmentItem {
  id: number;
  name: string;
}

interface LeaveRecord {
  id: number;
  employee_id: number;
  name: string;
  emp_code: string;
  department: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  actual_days: number;
  reason: string;
  remarks: string | null;
  recorded_at: string;
}

interface LateRecord {
  id: number;
  employee_id: number;
  name: string;
  emp_code: string;
  department: string;
  month_year: string;
  late_count: number;
  deducted_cl: number;
}

interface ReportsClientProps {
  employees: EmployeeItem[];
  departments: DepartmentItem[];
  leaveRecords: LeaveRecord[];
  lateRecords: LateRecord[];
  instituteName: string;
}

export default function ReportsClient({ 
  employees, 
  departments, 
  leaveRecords, 
  lateRecords,
  instituteName 
}: ReportsClientProps) {
  const [activeTab, setActiveTab] = useState<'logs' | 'payroll'>('logs');
  
  // Filter States
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().substring(0, 7)); // Default: current month
  const [filterDept, setFilterDept] = useState('');
  const [filterEmpId, setFilterEmpId] = useState('');
  const [filterLeaveType, setFilterLeaveType] = useState('');

  // 1. Filtered Leave Records for Log View
  const filteredLeaves = leaveRecords.filter(rec => {
    const matchesMonth = filterMonth === '' || rec.start_date.substring(0, 7) === filterMonth || rec.end_date.substring(0, 7) === filterMonth;
    const matchesDept = filterDept === '' || rec.department === filterDept;
    const matchesEmp = filterEmpId === '' || String(rec.employee_id) === filterEmpId;
    const matchesType = filterLeaveType === '' || rec.leave_type.startsWith(filterLeaveType);
    return matchesMonth && matchesDept && matchesEmp && matchesType;
  });

  // 2. Filtered Late Records for Payroll calculation
  const filteredLates = lateRecords.filter(lat => {
    const matchesMonth = filterMonth === '' || lat.month_year === filterMonth;
    const matchesDept = filterDept === '' || lat.department === filterDept;
    const matchesEmp = filterEmpId === '' || String(lat.employee_id) === filterEmpId;
    return matchesMonth && matchesDept && matchesEmp;
  });

  // 3. Compile Payroll Summary (Collated by employee)
  // For the selected month and department, show a table of all employees and their leaves
  const compiledPayroll = employees
    .filter(emp => filterDept === '' || emp.department === filterDept)
    .filter(emp => filterEmpId === '' || String(emp.id) === filterEmpId)
    .map(emp => {
      // Find leaves taken by this employee in the filtered list
      const empLeaves = filteredLeaves.filter(rec => rec.employee_id === emp.id);
      
      const clCount = empLeaves.filter(l => l.leave_type === 'Casual').reduce((sum, l) => sum + l.actual_days, 0);
      const slCount = empLeaves.filter(l => l.leave_type === 'Sick').reduce((sum, l) => sum + l.actual_days, 0);
      const elCount = empLeaves.filter(l => l.leave_type === 'Earned').reduce((sum, l) => sum + l.actual_days, 0);
      const mlCount = empLeaves.filter(l => l.leave_type === 'Maternity').reduce((sum, l) => sum + l.actual_days, 0);
      const lwpCount = empLeaves.filter(l => l.leave_type === 'LWP').reduce((sum, l) => sum + l.actual_days, 0);
      const totalLeaves = clCount + slCount + elCount + mlCount + lwpCount;

      // Find lates for this month
      const empLates = filteredLates.filter(lat => lat.employee_id === emp.id);
      const lateCount = empLates.reduce((sum, l) => sum + l.late_count, 0);
      const deductedCL = empLates.reduce((sum, l) => sum + l.deducted_cl, 0);

      // In Bangladesh, LWP directly reduces payable days. 
      // Monthly calendar days: e.g., 30 days. Net paid days = calendar days - LWP
      // Let's determine number of days in the filtered month. Default to 30.
      let totalMonthDays = 30;
      if (filterMonth) {
        const [year, month] = filterMonth.split('-').map(Number);
        totalMonthDays = new Date(year, month, 0).getDate();
      }
      const netPaidDays = Math.max(0, totalMonthDays - lwpCount);

      return {
        id: emp.id,
        code: emp.employee_id,
        name: emp.name,
        department: emp.department,
        clCount,
        slCount,
        elCount,
        lwpCount,
        totalLeaves,
        lateCount,
        deductedCL,
        netPaidDays,
        totalMonthDays
      };
    })
    .filter(row => row.totalLeaves > 0 || row.lateCount > 0 || filterEmpId !== ''); // Only show active items unless specifically searched

  // 4. Export CSV Handler
  const exportToCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,';
    
    if (activeTab === 'logs') {
      csvContent += 'Employee ID,Name,Department,Leave Type,Start Date,End Date,Actual Days,Reason,Remarks,Recorded At\n';
      filteredLeaves.forEach(rec => {
        csvContent += `"${rec.emp_code}","${rec.name}","${rec.department}","${rec.leave_type}","${rec.start_date}","${rec.end_date}",${rec.actual_days},"${rec.reason.replace(/"/g, '""')}","${(rec.remarks || '').replace(/"/g, '""')}","${rec.recorded_at}"\n`;
      });
    } else {
      csvContent += 'Employee ID,Name,Department,Casual Leave,Sick Leave,Earned Leave,LWP (Unpaid),Total Leaves,Late Count,Deducted CL,Net Paid Days/Payable Days\n';
      compiledPayroll.forEach(row => {
        csvContent += `"${row.code}","${row.name}","${row.department}",${row.clCount},${row.slCount},${row.elCount},${row.lwpCount},${row.totalLeaves},${row.lateCount},${row.deductedCL},${row.netPaidDays}/${row.totalMonthDays}\n`;
      });
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const filename = activeTab === 'logs' ? `Leave_Ledger_${filterMonth || 'All'}.csv` : `Payroll_Summary_${filterMonth || 'All'}.csv`;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  // Human-readable filter status
  const filterDesc = `${filterMonth ? `Month: ${filterMonth}` : 'All Months'}${filterDept ? `, Department: ${filterDept}` : ''}${filterLeaveType ? `, Type: ${filterLeaveType}` : ''}`;

  return (
    <div>
      {/* Printable Document Header (Hidden on Web screen, visible in print) */}
      <div className="print-header">
        <h1 style={{ fontSize: '1.75rem', color: '#1b3a24', margin: '0 0 4px 0' }}>{instituteName}</h1>
        <h2 style={{ fontSize: '1.25rem', color: '#536359', margin: '0 0 10px 0' }}>
          {activeTab === 'logs' ? 'Leave Ledger Record Log' : 'Monthly Payroll Attendance Summary'}
        </h2>
        <p style={{ fontSize: '0.875rem', color: '#536359', margin: 0 }}>Filter Conditions: {filterDesc}</p>
        <p style={{ fontSize: '0.75rem', color: '#8c9c92', marginTop: '4px' }}>Generated on: {new Date().toLocaleString()}</p>
      </div>

      {/* Filter Toolbar (Hidden in print) */}
      <div className="card no-print" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
        <h3 style={{ fontSize: '0.875rem', marginBottom: '1rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Users size={16} />
          Report Filters
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
          {/* Month Filter */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Month</label>
            <input 
              className="form-control" 
              type="month" 
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
            />
          </div>

          {/* Department Filter */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Department</label>
            <select 
              className="form-control form-select"
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
            >
              <option value="">All Departments</option>
              {departments.map(dept => (
                <option key={dept.id} value={dept.name}>{dept.name}</option>
              ))}
            </select>
          </div>

          {/* Employee Filter */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Employee</label>
            <select 
              className="form-control form-select"
              value={filterEmpId}
              onChange={(e) => setFilterEmpId(e.target.value)}
            >
              <option value="">All Staff</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_id})</option>
              ))}
            </select>
          </div>

          {/* Leave Type Filter */}
          {activeTab === 'logs' && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Leave Type</label>
              <select 
                className="form-control form-select"
                value={filterLeaveType}
                onChange={(e) => setFilterLeaveType(e.target.value)}
              >
                <option value="">All Types</option>
                <option value="Casual">Casual</option>
                <option value="Sick">Sick</option>
                <option value="Earned">Earned</option>
                <option value="Maternity">Maternity</option>
                <option value="LWP">LWP (Unpaid)</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Tabs and Export Action Bar (Hidden in print) */}
      <div className="no-print" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid var(--border)',
        marginBottom: '1.5rem',
        paddingBottom: '0.5rem',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        
        {/* Tabs switcher */}
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            onClick={() => setActiveTab('logs')}
            className="tab-btn"
            style={{
              borderBottom: activeTab === 'logs' ? '2px solid var(--primary)' : 'none',
              color: activeTab === 'logs' ? 'var(--primary)' : 'var(--foreground-muted)'
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
              <FileText size={16} />
              Leave Ledger Log
            </span>
          </button>

          <button 
            onClick={() => setActiveTab('payroll')}
            className="tab-btn"
            style={{
              borderBottom: activeTab === 'payroll' ? '2px solid var(--primary)' : 'none',
              color: activeTab === 'payroll' ? 'var(--primary)' : 'var(--foreground-muted)'
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
              <Calendar size={16} />
              Payroll Attendance Summary
            </span>
          </button>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={handlePrint}>
            <Printer size={16} />
            Print Report
          </button>

          <button className="btn btn-primary" onClick={exportToCSV}>
            <Download size={16} />
            Export to CSV
          </button>
        </div>

      </div>

      {/* Tab Contents: Logs View */}
      {activeTab === 'logs' && (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Employee Name</th>
                <th>Department</th>
                <th>Type</th>
                <th>Date Range</th>
                <th>Days</th>
                <th>Reason</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeaves.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--foreground-muted)', padding: '2rem' }}>
                    No matching leave records registered for this selection.
                  </td>
                </tr>
              ) : (
                filteredLeaves.map(rec => (
                  <tr key={rec.id}>
                    <td style={{ fontWeight: 600 }}>{rec.emp_code}</td>
                    <td style={{ fontWeight: 600 }}>{rec.name}</td>
                    <td>{rec.department}</td>
                    <td>
                      <span className={`badge ${
                        rec.leave_type.startsWith('Casual') ? 'badge-success' : 
                        rec.leave_type.startsWith('Sick') ? 'badge-info' : 
                        rec.leave_type.startsWith('LWP') ? 'badge-danger' : 'badge-warning'
                      }`}>
                        {rec.leave_type}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8125rem' }}>
                      {rec.start_date === rec.end_date ? (
                        rec.start_date
                      ) : (
                        `${rec.start_date} to ${rec.end_date}`
                      )}
                    </td>
                    <td style={{ fontWeight: 600 }}>{rec.actual_days} days</td>
                    <td>{rec.reason}</td>
                    <td>{rec.remarks || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab Contents: Payroll View */}
      {activeTab === 'payroll' && (
        <div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Employee Name</th>
                  <th>Department</th>
                  <th>Casual (CL)</th>
                  <th>Sick (SL)</th>
                  <th>Earned (EL)</th>
                  <th>LWP (Unpaid)</th>
                  <th>Total Leaves</th>
                  <th>Late Count</th>
                  <th>Deducted CL</th>
                  <th>Net Paid Days</th>
                </tr>
              </thead>
              <tbody>
                {compiledPayroll.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', color: 'var(--foreground-muted)', padding: '2rem' }}>
                      No active records for this selection. All employees have 100% attendance.
                    </td>
                  </tr>
                ) : (
                  compiledPayroll.map(row => (
                    <tr key={row.id}>
                      <td style={{ fontWeight: 600 }}>{row.code}</td>
                      <td style={{ fontWeight: 600 }}>{row.name}</td>
                      <td>{row.department}</td>
                      <td style={{ fontWeight: row.clCount > 0 ? 600 : 400 }}>{row.clCount} days</td>
                      <td style={{ fontWeight: row.slCount > 0 ? 600 : 400 }}>{row.slCount} days</td>
                      <td style={{ fontWeight: row.elCount > 0 ? 600 : 400 }}>{row.elCount} days</td>
                      <td style={{ 
                        fontWeight: row.lwpCount > 0 ? 600 : 400,
                        color: row.lwpCount > 0 ? 'var(--error)' : 'inherit'
                      }}>{row.lwpCount} days</td>
                      <td style={{ fontWeight: 600 }}>{row.totalLeaves} days</td>
                      <td style={{ fontWeight: row.lateCount > 0 ? 600 : 400 }}>{row.lateCount}</td>
                      <td style={{ 
                        fontWeight: row.deductedCL > 0 ? 600 : 400,
                        color: row.deductedCL > 0 ? 'var(--warning)' : 'inherit'
                      }}>{row.deductedCL} days</td>
                      <td style={{ 
                        fontWeight: 700,
                        backgroundColor: 'var(--primary-light)',
                        color: 'var(--primary)'
                      }}>
                        {row.netPaidDays} / {row.totalMonthDays} Days
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          <div className="no-print" style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', fontSize: '0.8125rem', color: 'var(--foreground-muted)' }}>
            * Note: &quot;Net Paid Days&quot; represents the payable days for the selected month (Calendar days in month minus LWP days).
          </div>
        </div>
      )}
    </div>
  );
}
