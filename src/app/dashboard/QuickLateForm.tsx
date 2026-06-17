'use client';

import { useState, useTransition } from 'react';
import { recordLateAttendance } from '../actions';
import { useToast } from '@/context/ToastContext';

interface EmployeeItem {
  id: number;
  name: string;
  employee_id: string;
  cl_left?: number;
}

interface QuickLateFormProps {
  employees: EmployeeItem[];
  currentMonth: string;
}

export default function QuickLateForm({ employees, currentMonth }: QuickLateFormProps) {
  const { showToast } = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [monthYear, setMonthYear] = useState(currentMonth);
  const [lateCount, setLateCount] = useState('0');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!employeeId) {
      showToast('Please select an employee.', 'error');
      return;
    }

    const lates = parseInt(lateCount);
    if (isNaN(lates) || lates < 0) {
      showToast('Late count must be a non-negative number.', 'error');
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.append('employee_id', employeeId);
      formData.append('month_year', monthYear);
      formData.append('late_count', lateCount);

      const res = await recordLateAttendance(formData);
      if (res.success) {
        showToast('Late attendance recorded successfully!', 'success');
        setLateCount('0');
        setEmployeeId('');
      } else {
        showToast(res.error || 'Failed to record late attendance.', 'error');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit}>


      <div className="form-group">
        <label className="form-label" htmlFor="quick-emp">Select Employee *</label>
        <select 
          className="form-control form-select" 
          id="quick-emp"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          disabled={isPending}
        >
          <option value="">-- Choose Employee --</option>
          {employees.map(emp => (
            <option key={emp.id} value={emp.id}>
              {emp.name} ({emp.employee_id}) {emp.cl_left !== undefined ? `— CL Balance: ${emp.cl_left}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="grid-2col">
        <div className="form-group">
          <label className="form-label" htmlFor="quick-month">Month *</label>
          <input 
            className="form-control" 
            type="month" 
            id="quick-month"
            value={monthYear}
            onChange={(e) => setMonthYear(e.target.value)}
            disabled={isPending}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="quick-lates">No. of Lates *</label>
          <input 
            className="form-control" 
            type="number" 
            id="quick-lates"
            min="0"
            value={lateCount}
            onChange={(e) => setLateCount(e.target.value)}
            disabled={isPending}
          />
        </div>
      </div>

      <button 
        className="btn btn-primary" 
        type="submit" 
        disabled={isPending}
        style={{ width: '100%', marginTop: '0.5rem' }}
      >
        {isPending ? 'Saving...' : 'Record Attendance'}
      </button>
    </form>
  );
}
