'use client';

import { useState, useTransition } from 'react';
import { updateSystemSettings, addHoliday, deleteHoliday, addDepartment, deleteDepartment } from '@/app/actions';
import { Settings, Lock, Check, PlusCircle, Trash2, Calendar, Briefcase, FileText, X, Plus } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';

interface Holiday {
  id: number;
  title: string;
  start_date: string;
  end_date: string;
}

interface Department {
  id: number;
  name: string;
}

interface SettingsClientProps {
  initialSettings: Record<string, string>;
  initialHolidays: Holiday[];
  initialDepartments: Department[];
}

export default function SettingsClient({ 
  initialSettings, 
  initialHolidays, 
  initialDepartments 
}: SettingsClientProps) {
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [settings, setSettings] = useState(initialSettings);
  const [holidays, setHolidays] = useState(initialHolidays);
  const [departments, setDepartments] = useState(initialDepartments);

  // System Settings Form States
  const [instituteName, setInstituteName] = useState(settings['institute_name'] || '');
  const [sandwichRule, setSandwichRule] = useState(settings['sandwich_rule'] || 'true');
  const [lateThreshold, setLateThreshold] = useState(settings['late_cl_threshold'] || '3');
  const [newPassword, setNewPassword] = useState('');
  
  // Weekends
  const initialWeekends = (settings['weekend_days'] || '').split(',').map(s => s.trim().toLowerCase());
  const [weekends, setWeekends] = useState<string[]>(initialWeekends);

  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  const handleWeekendChange = (day: string, checked: boolean) => {
    if (checked) {
      setWeekends([...weekends, day]);
    } else {
      setWeekends(weekends.filter(d => d !== day));
    }
  };

  // Holiday Form States
  const [holidayTitle, setHolidayTitle] = useState('');
  const [holidayStart, setHolidayStart] = useState('');
  const [holidayEnd, setHolidayEnd] = useState('');

  // Department Form States
  const [deptName, setDeptName] = useState('');

  const [isPending, startTransition] = useTransition();

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('institute_name', instituteName);
    formData.append('sandwich_rule', sandwichRule);
    formData.append('late_cl_threshold', lateThreshold);
    formData.append('weekend_days', weekends.join(','));
    formData.append('new_password', newPassword);

    startTransition(async () => {
      const res = await updateSystemSettings(formData);
      if (res.success) {
        showToast('System settings updated successfully.', 'success');
        setNewPassword('');
      } else {
        showToast(res.error || 'Failed to update settings.', 'error');
      }
    });
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('title', holidayTitle);
    formData.append('start_date', holidayStart);
    formData.append('end_date', holidayEnd);

    startTransition(async () => {
      const res = await addHoliday(formData);
      if (res.success) {
        setHolidayTitle('');
        setHolidayStart('');
        setHolidayEnd('');
        showToast('Holiday added successfully.', 'success');
      } else {
        showToast(res.error || 'Failed to add holiday.', 'error');
      }
    });
  };

  const handleDeleteHoliday = async (id: number, title: string) => {
    const ok = await confirm({
      title: 'Delete Holiday',
      message: `Are you sure you want to delete the holiday "${title}"?`,
      confirmText: 'Delete',
      isDanger: true
    });
    if (ok) {
      startTransition(async () => {
        const res = await deleteHoliday(id);
        if (res.success) {
          showToast(`Holiday "${title}" deleted successfully.`, 'success');
        } else {
          showToast(res.error || 'Failed to delete holiday.', 'error');
        }
      });
    }
  };

  const handleAddDept = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('name', deptName);

    startTransition(async () => {
      const res = await addDepartment(formData);
      if (res.success) {
        setDeptName('');
        showToast('Department added successfully.', 'success');
      } else {
        showToast(res.error || 'Failed to add department.', 'error');
      }
    });
  };

  const handleDeleteDept = async (id: number, name: string) => {
    const ok = await confirm({
      title: 'Delete Department',
      message: `Are you sure you want to delete the department "${name}"? Employees belonging to this department won't be deleted, but it won't appear in dropdowns.`,
      confirmText: 'Delete',
      isDanger: true
    });
    if (ok) {
      startTransition(async () => {
        const res = await deleteDepartment(id);
        if (res.success) {
          showToast(`Department "${name}" deleted successfully.`, 'success');
        } else {
          showToast(res.error || 'Failed to delete department.', 'error');
        }
      });
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.5rem' }}>
      
      {/* Left Column: System settings form */}
      <div>
        <div className="card" style={{ backgroundColor: '#ffffff' }}>
          <h3 style={{ fontSize: '1.125rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Settings size={20} />
            General Configurations
          </h3>



          <form onSubmit={handleSaveSettings}>
            <div className="form-group">
              <label className="form-label" htmlFor="inst-name">Institute / Company Name *</label>
              <input 
                className="form-control" 
                type="text" 
                id="inst-name" 
                value={instituteName}
                onChange={(e) => setInstituteName(e.target.value)}
                disabled={isPending}
                required
              />
            </div>

            <div className="grid-2col">
              <div className="form-group">
                <label className="form-label" htmlFor="sandwich-toggle">Sandwich Rule</label>
                <select 
                  className="form-control form-select" 
                  id="sandwich-toggle"
                  value={sandwichRule}
                  onChange={(e) => setSandwichRule(e.target.value)}
                  disabled={isPending}
                >
                  <option value="true">Enabled (Weekends/Holidays Counted)</option>
                  <option value="false">Disabled (Weekends/Holidays Excluded)</option>
                </select>
                <span style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)', display: 'block', marginTop: '0.25rem' }}>
                  If Enabled, weekends falling within a leave range will count as taken leaves.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="late-threshold-input">Late Attendance Deduction</label>
                <select 
                  className="form-control form-select" 
                  id="late-threshold-input"
                  value={lateThreshold}
                  onChange={(e) => setLateThreshold(e.target.value)}
                  disabled={isPending}
                >
                  <option value="3">3 Late Arrivals = 1 CL Day Cut</option>
                  <option value="4">4 Late Arrivals = 1 CL Day Cut</option>
                  <option value="5">5 Late Arrivals = 1 CL Day Cut</option>
                  <option value="999">No Late CL Deduction</option>
                </select>
                <span style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)', display: 'block', marginTop: '0.25rem' }}>
                  Specifies how many recorded late arrivals trigger a 1-day Casual Leave deduction.
                </span>
              </div>
            </div>

            {/* Weekend Configuration */}
            <div className="form-group" style={{ margin: '1.5rem 0', padding: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              <label className="form-label" style={{ marginBottom: '0.75rem' }}>Weekend Days</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                {daysOfWeek.map(day => (
                  <label key={day} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', textTransform: 'capitalize', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={weekends.includes(day)}
                      onChange={(e) => handleWeekendChange(day, e.target.checked)}
                      disabled={isPending}
                      style={{ width: '15px', height: '15px', accentColor: 'var(--primary)' }}
                    />
                    {day.substring(0, 3)}
                  </label>
                ))}
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--foreground-muted)', display: 'block', marginTop: '0.5rem' }}>
                Selected days will be excluded from leave counts (if Sandwich rule is disabled).
              </span>
            </div>

            {/* Change Admin Password */}
            <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem', marginTop: '1.5rem' }}>
              <label className="form-label" htmlFor="new-pw" style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <Lock size={14} />
                Change Admin Password
              </label>
              <input 
                className="form-control" 
                type="password" 
                id="new-pw" 
                placeholder="Enter new admin password (leave empty to keep current)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isPending}
              />
            </div>

            <button 
              className="btn btn-primary" 
              type="submit" 
              disabled={isPending}
              style={{ width: '100%', marginTop: '1rem' }}
            >
              <Check size={16} />
              {isPending ? 'Saving...' : 'Save Configuration'}
            </button>
          </form>
        </div>
      </div>

      {/* Right Column: Holidays and Departments */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        {/* Department Manager */}
        <div className="card" style={{ backgroundColor: '#ffffff' }}>
          <h3 style={{ fontSize: '1.125rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Briefcase size={20} />
            Manage Departments
          </h3>

          {/* List of departments */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {departments.map(dept => (
              <span 
                key={dept.id} 
                className="badge badge-success"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.375rem 0.625rem', fontSize: '0.8125rem' }}
              >
                {dept.name}
                <button 
                  onClick={() => handleDeleteDept(dept.id, dept.name)}
                  disabled={isPending}
                  className="btn-badge-remove"
                  title="Remove Department"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>

          {/* Add Department Inline Form */}
          <form onSubmit={handleAddDept} style={{ display: 'flex', gap: '0.5rem' }}>
            <input 
              className="form-control" 
              type="text" 
              placeholder="e.g. Science, Sales..."
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              disabled={isPending}
              required
            />
            <button className="btn btn-primary" type="submit" disabled={isPending} style={{ padding: '0.625rem 1rem' }}>
              <Plus size={16} />
            </button>
          </form>
        </div>

        {/* Holiday Manager */}
        <div className="card" style={{ backgroundColor: '#ffffff' }}>
          <h3 style={{ fontSize: '1.125rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Calendar size={20} />
            Holiday Calendar
          </h3>

          {/* Add Holiday Form */}
          <form onSubmit={handleAddHoliday} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1.25rem', marginBottom: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="hol-title">Holiday Title *</label>
              <input 
                className="form-control" 
                type="text" 
                id="hol-title" 
                placeholder="e.g. Eid-ul-Fitr, Independence Day"
                value={holidayTitle}
                onChange={(e) => setHolidayTitle(e.target.value)}
                disabled={isPending}
                required
              />
            </div>
            
            <div className="grid-2col" style={{ marginBottom: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="hol-start">Start Date *</label>
                <input 
                  className="form-control" 
                  type="date" 
                  id="hol-start" 
                  value={holidayStart}
                  onChange={(e) => setHolidayStart(e.target.value)}
                  disabled={isPending}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="hol-end">End Date *</label>
                <input 
                  className="form-control" 
                  type="date" 
                  id="hol-end" 
                  value={holidayEnd}
                  onChange={(e) => setHolidayEnd(e.target.value)}
                  disabled={isPending}
                  required
                />
              </div>
            </div>

            <button className="btn btn-primary" type="submit" disabled={isPending} style={{ width: '100%' }}>
              <Plus size={16} />
              Add Holiday Range
            </button>
          </form>

          {/* Holiday List */}
          <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '0.8125rem' }}>
              <thead>
                <tr>
                  <th>Holiday</th>
                  <th>Dates</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {holidays.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', color: 'var(--foreground-muted)' }}>No holidays added yet.</td>
                  </tr>
                ) : (
                  holidays.map(hol => (
                    <tr key={hol.id}>
                      <td style={{ fontWeight: 600 }}>{hol.title}</td>
                      <td>
                        {hol.start_date === hol.end_date ? (
                          hol.start_date
                        ) : (
                          `${hol.start_date} to ${hol.end_date}`
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button 
                          type="button" 
                          onClick={() => handleDeleteHoliday(hol.id, hol.title)}
                          disabled={isPending}
                          className="btn-danger-text"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

    </div>
  );
}
