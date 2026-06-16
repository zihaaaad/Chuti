'use client';

import { useState, useTransition } from 'react';
import { addLeaveRecord, deleteLeaveRecord, logLeaveEncashment, updateLeaveRecord } from '@/app/actions';
import { CalendarRange, X, Check, FileDown, PlusCircle, Trash2, Search, DollarSign, Edit2, Eye } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';

interface LeaveRecord {
  id: number;
  employee_id: number;
  name: string;
  emp_code: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  actual_days: number;
  reason: string;
  attachment_path: string | null;
  remarks: string | null;
  recorded_at: string;
}

interface EmployeeItem {
  id: number;
  name: string;
  employee_id: string;
  cl_left?: number;
  sl_left?: number;
  el_left?: number;
}

interface LeaveClientProps {
  initialRecords: LeaveRecord[];
  employees: EmployeeItem[];
}

export default function LeaveClient({ initialRecords, employees }: LeaveClientProps) {
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');
  
  // Modal States
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [isEncashModalOpen, setIsEncashModalOpen] = useState(false);
  
  // Leave Form States
  const [employeeId, setEmployeeId] = useState('');
  const [leaveType, setLeaveType] = useState('Casual');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [file, setFile] = useState<File | null>(null);

  // Editing state
  const [editingRecord, setEditingRecord] = useState<LeaveRecord | null>(null);
  const [deleteAttachment, setDeleteAttachment] = useState(false);

  // File Preview Modal State
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');

  // Encashment Form States
  const [encashEmployeeId, setEncashEmployeeId] = useState('');
  const [encashDays, setEncashDays] = useState('1');
  const [encashRemarks, setEncashRemarks] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Filters
  const filteredRecords = initialRecords.filter(rec => {
    const q = searchQuery.toLowerCase();
    const matchesQuery = 
      rec.name.toLowerCase().includes(q) ||
      rec.emp_code.toLowerCase().includes(q) ||
      rec.reason.toLowerCase().includes(q) ||
      (rec.remarks && rec.remarks.toLowerCase().includes(q));
    
    const matchesType = filterType === '' || rec.leave_type.startsWith(filterType);

    return matchesQuery && matchesType;
  });

  const openLeaveModal = () => {
    setEditingRecord(null);
    setDeleteAttachment(false);
    setEmployeeId(employees[0]?.id ? String(employees[0].id) : '');
    setLeaveType('Casual');
    setStartDate(new Date().toISOString().split('T')[0]);
    setEndDate(new Date().toISOString().split('T')[0]);
    setIsHalfDay(false);
    setReason('');
    setRemarks('');
    setFile(null);
    setError(null);
    setIsLeaveModalOpen(true);
  };

  const openEditLeaveModal = (record: LeaveRecord) => {
    setEditingRecord(record);
    setDeleteAttachment(false);
    setEmployeeId(String(record.employee_id));
    setLeaveType(record.leave_type);
    setStartDate(record.start_date);
    setEndDate(record.end_date);
    setIsHalfDay(record.actual_days === 0.5);
    setReason(record.reason);
    setRemarks(record.remarks || '');
    setFile(null);
    setError(null);
    setIsLeaveModalOpen(true);
  };

  const openEncashModal = () => {
    setEncashEmployeeId(employees[0]?.id ? String(employees[0].id) : '');
    setEncashDays('1');
    setEncashRemarks('');
    setError(null);
    setIsEncashModalOpen(true);
  };

  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!employeeId) {
      setError('Please select an employee.');
      return;
    }

    if (!isHalfDay && new Date(startDate) > new Date(endDate)) {
      setError('Start date cannot be after end date.');
      showToast('Start date cannot be after end date.', 'error');
      return;
    }

    if (file && file.size > 10 * 1024 * 1024) {
      setError('File upload size exceeds the 10MB limit.');
      showToast('File upload size exceeds the 10MB limit.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('employee_id', employeeId);
    formData.append('leave_type', leaveType);
    formData.append('start_date', startDate);
    formData.append('end_date', isHalfDay ? startDate : endDate);
    formData.append('is_half_day', String(isHalfDay));
    formData.append('reason', reason);
    formData.append('remarks', remarks);
    if (file) {
      formData.append('attachment', file);
    }
    if (editingRecord) {
      formData.append('id', String(editingRecord.id));
      formData.append('delete_attachment', String(deleteAttachment));
    }

    startTransition(async () => {
      const res = editingRecord
        ? await updateLeaveRecord(formData)
        : await addLeaveRecord(formData);
      if (res.success) {
        showToast(
          editingRecord 
            ? 'Leave record updated successfully!' 
            : 'Leave application recorded successfully!', 
          'success'
        );
        setIsLeaveModalOpen(false);
        setEditingRecord(null);
        setDeleteAttachment(false);
      } else {
        setError(res.error || 'Failed to save leave record.');
        showToast(res.error || 'Failed to save leave record.', 'error');
      }
    });
  };

  const handleEncashSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!encashEmployeeId) {
      setError('Please select an employee.');
      return;
    }

    const days = parseFloat(encashDays);
    if (isNaN(days) || days <= 0) {
      setError('Encashed days must be a positive number.');
      return;
    }

    const formData = new FormData();
    formData.append('employee_id', encashEmployeeId);
    formData.append('encash_days', encashDays);
    formData.append('remarks', encashRemarks);

    startTransition(async () => {
      const res = await logLeaveEncashment(formData);
      if (res.success) {
        showToast('Leave encashment logged successfully!', 'success');
        setIsEncashModalOpen(false);
      } else {
        setError(res.error || 'Failed to record encashment.');
        showToast(res.error || 'Failed to record encashment.', 'error');
      }
    });
  };

  const handleCancelLeave = async (id: number, employeeName: string, days: number, type: string) => {
    const ok = await confirm({
      title: 'Cancel Leave Record',
      message: `Are you sure you want to cancel this ${days}-day ${type} leave for ${employeeName}? This will refund the days back to their balance.`,
      confirmText: 'Cancel Leave',
      isDanger: true
    });
    if (ok) {
      startTransition(async () => {
        const res = await deleteLeaveRecord(id);
        if (res.success) {
          showToast(`Successfully cancelled leave and refunded ${days} days to ${employeeName}.`, 'success');
        } else {
          showToast(res.error || 'Failed to cancel leave record.', 'error');
        }
      });
    }
  };

  return (
    <div>
      {/* Search and Filters Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '1rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap'
      }} className="no-print">
        
        {/* Left: Filters */}
        <div style={{ display: 'flex', gap: '0.75rem', flex: 1, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', minWidth: '240px' }}>
            <Search size={18} style={{
              position: 'absolute',
              left: '0.75rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--foreground-muted)'
            }} />
            <input 
              className="form-control" 
              type="text" 
              placeholder="Search by name, reason..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '2.5rem' }}
            />
          </div>

          <select 
            className="form-control form-select" 
            style={{ width: '150px' }}
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">All Types</option>
            <option value="Casual">Casual</option>
            <option value="Sick">Sick</option>
            <option value="Earned">Earned</option>
            <option value="Maternity">Maternity</option>
            <option value="LWP">LWP</option>
          </select>
        </div>

        {/* Right: Actions */}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={openEncashModal}>
            <DollarSign size={16} />
            Log Encashment
          </button>
          
          <button className="btn btn-primary" onClick={openLeaveModal}>
            <CalendarRange size={16} />
            Record Leave
          </button>
        </div>
      </div>

      {/* Leave Logs Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Type</th>
              <th>Period</th>
              <th>Days</th>
              <th>Reason & Remarks</th>
              <th>Attachment</th>
              <th className="no-print" style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--foreground-muted)', padding: '2rem' }}>
                  No leave records found.
                </td>
              </tr>
            ) : (
              filteredRecords.map(rec => (
                <tr key={rec.id}>
                  <td>
                    <div style={{ fontWeight: '600' }}>{rec.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>{rec.emp_code}</div>
                  </td>
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
                  <td>
                    <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{rec.reason}</div>
                    {rec.remarks && <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', marginTop: '0.125rem' }}>Remarks: {rec.remarks}</div>}
                  </td>
                  <td>
                    {rec.attachment_path ? (
                      <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'inline-flex', gap: '0.25rem', height: '28px', minWidth: 'auto' }}
                          onClick={() => {
                            setPreviewPath(rec.attachment_path);
                            setPreviewTitle(`${rec.name} - Attachment`);
                          }}
                          title="Preview Document"
                        >
                          <Eye size={14} />
                          Preview
                        </button>
                        <a 
                          href={rec.attachment_path} 
                          download
                          className="btn btn-secondary" 
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'inline-flex', gap: '0.25rem', height: '28px', minWidth: 'auto' }}
                          title="Download Document"
                        >
                          <FileDown size={14} />
                        </a>
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>None</span>
                    )}
                  </td>
                  <td className="no-print" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button 
                      className="btn btn-secondary"
                      style={{ padding: '0.375rem', marginRight: '0.5rem', minWidth: 'auto', border: 'none' }}
                      onClick={() => openEditLeaveModal(rec)}
                      title="Edit Leave Record"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button 
                      className="btn btn-danger-outline"
                      style={{ padding: '0.375rem', minWidth: 'auto' }}
                      onClick={() => handleCancelLeave(rec.id, rec.name, rec.actual_days, rec.leave_type)}
                      title="Cancel Leave (Refund Balance)"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Log Leave Modal */}
      {isLeaveModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 100,
          backdropFilter: 'blur(2px)'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '500px',
            maxHeight: '90vh',
            overflowY: 'auto',
            position: 'relative',
            backgroundColor: '#ffffff'
          }}>
            {/* Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--border)',
              paddingBottom: '1rem',
              marginBottom: '1.5rem'
            }}>
              <h3 style={{ fontSize: '1.25rem' }}>{editingRecord ? 'Edit Leave Record' : 'Record Leave Application'}</h3>
              <button onClick={() => setIsLeaveModalOpen(false)} className="btn-close">
                <X size={20} />
              </button>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                backgroundColor: 'var(--error-bg)',
                color: 'var(--error)',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.8125rem',
                marginBottom: '1.25rem',
                border: '1px solid rgba(154, 32, 32, 0.1)'
              }}>
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleLeaveSubmit} encType="multipart/form-data">
              <div className="form-group">
                <label className="form-label" htmlFor="leave-emp">Employee *</label>
                <select 
                  className="form-control form-select" 
                  id="leave-emp"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  disabled={isPending}
                  required
                >
                  <option value="">-- Select Employee --</option>
                  {employees.map(emp => {
                    const cl = emp.cl_left ?? 0;
                    const sl = emp.sl_left ?? 0;
                    const el = emp.el_left ?? 0;
                    return (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.employee_id}) — CL: {cl}, SL: {sl}, EL: {el} Left
                      </option>
                    );
                  })}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="leave-type">Leave Type *</label>
                  <select 
                    className="form-control form-select" 
                    id="leave-type"
                    value={leaveType}
                    onChange={(e) => setLeaveType(e.target.value)}
                    disabled={isPending}
                    required
                  >
                    <option value="Casual">Casual Leave (CL)</option>
                    <option value="Sick">Sick Leave (SL)</option>
                    <option value="Earned">Earned Leave (EL)</option>
                    <option value="Maternity">Maternity Leave (ML)</option>
                    <option value="LWP">Leave Without Pay (LWP)</option>
                    {editingRecord && editingRecord.leave_type === 'Earned (Encashed)' && (
                      <option value="Earned (Encashed)">Earned Leave (Encashed)</option>
                    )}
                  </select>
                </div>

                <div className="form-group" style={{ display: 'flex', alignItems: 'center', height: '100%', paddingTop: '1.75rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={isHalfDay} 
                      onChange={(e) => setIsHalfDay(e.target.checked)}
                      disabled={isPending}
                      style={{ width: '16px', height: '16px', accentColor: 'var(--primary)' }}
                    />
                    Half Day (0.5)
                  </label>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="leave-start">Start Date *</label>
                  <input 
                    className="form-control" 
                    type="date" 
                    id="leave-start" 
                    value={startDate}
                    onChange={(e) => {
                      const newStart = e.target.value;
                      setStartDate(newStart);
                      if (new Date(endDate) < new Date(newStart)) {
                        setEndDate(newStart);
                      }
                    }}
                    disabled={isPending}
                    required
                  />
                </div>

                {!isHalfDay && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="leave-end">End Date *</label>
                    <input 
                      className="form-control" 
                      type="date" 
                      id="leave-end" 
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      disabled={isPending}
                      min={startDate}
                      required
                    />
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="leave-reason">Reason *</label>
                <input 
                  className="form-control" 
                  type="text" 
                  id="leave-reason" 
                  placeholder="Medical checkup, personal work, etc."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={isPending}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="leave-file">
                  {editingRecord?.attachment_path ? 'Replace Supporting Document' : 'Supporting Document (Scanned PDF/Image)'}
                </label>
                
                {editingRecord?.attachment_path && (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    padding: '0.625rem 0.75rem', 
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: '0.75rem'
                  }}>
                    {!deleteAttachment ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.8125rem', fontWeight: '500', color: 'var(--foreground)' }}>
                            Current File: {editingRecord.attachment_path.split('/').pop()}
                          </span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'inline-flex', gap: '0.25rem', height: '24px', minWidth: 'auto' }}
                            onClick={() => {
                              setPreviewPath(editingRecord.attachment_path);
                              setPreviewTitle(`${editingRecord.name} - Attachment`);
                            }}
                          >
                            <Eye size={12} />
                            Preview
                          </button>
                        </div>
                        <button
                          type="button"
                          className="btn btn-danger-outline"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', height: '24px', minWidth: 'auto' }}
                          onClick={() => setDeleteAttachment(true)}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--error)', fontWeight: '500' }}>
                          Attachment will be deleted on save
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', height: '24px', minWidth: 'auto' }}
                          onClick={() => setDeleteAttachment(false)}
                        >
                          Undo
                        </button>
                      </>
                    )}
                  </div>
                )}

                <input 
                  className="form-control" 
                  type="file" 
                  id="leave-file" 
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  disabled={isPending}
                  accept=".pdf,.jpg,.jpeg,.png"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="leave-remarks">Remarks</label>
                <textarea 
                  className="form-control" 
                  id="leave-remarks" 
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  disabled={isPending}
                />
              </div>

              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
                borderTop: '1px solid var(--border)',
                paddingTop: '1.25rem',
                marginTop: '1.5rem'
              }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsLeaveModalOpen(false)} disabled={isPending}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isPending}>
                  <Check size={16} />
                  {isPending ? 'Saving...' : editingRecord ? 'Update Leave Record' : 'Save Leave Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log Encashment Modal */}
      {isEncashModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 100,
          backdropFilter: 'blur(2px)'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '450px',
            backgroundColor: '#ffffff'
          }}>
            {/* Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--border)',
              paddingBottom: '1rem',
              marginBottom: '1.5rem'
            }}>
              <h3 style={{ fontSize: '1.25rem' }}>Log Earned Leave Encashment</h3>
              <button onClick={() => setIsEncashModalOpen(false)} className="btn-close">
                <X size={20} />
              </button>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                backgroundColor: 'var(--error-bg)',
                color: 'var(--error)',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.8125rem',
                marginBottom: '1.25rem',
                border: '1px solid rgba(154, 32, 32, 0.1)'
              }}>
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleEncashSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="encash-emp">Employee *</label>
                <select 
                  className="form-control form-select" 
                  id="encash-emp"
                  value={encashEmployeeId}
                  onChange={(e) => setEncashEmployeeId(e.target.value)}
                  disabled={isPending}
                  required
                >
                  <option value="">-- Select Employee --</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_id})</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="encash-days">Number of Days to Encash *</label>
                <input 
                  className="form-control" 
                  type="number" 
                  min="0.5"
                  step="0.5"
                  id="encash-days" 
                  value={encashDays}
                  onChange={(e) => setEncashDays(e.target.value)}
                  disabled={isPending}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="encash-remarks">Remarks (e.g. Payment details)</label>
                <textarea 
                  className="form-control" 
                  id="encash-remarks" 
                  rows={2}
                  placeholder="Encashed for June 2026 payroll..."
                  value={encashRemarks}
                  onChange={(e) => setEncashRemarks(e.target.value)}
                  disabled={isPending}
                />
              </div>

              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
                borderTop: '1px solid var(--border)',
                paddingTop: '1.25rem',
                marginTop: '1.5rem'
              }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsEncashModalOpen(false)} disabled={isPending}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isPending}>
                  <Check size={16} />
                  {isPending ? 'Logging...' : 'Confirm Encashment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {previewPath && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 200,
          backdropFilter: 'blur(4px)',
          padding: '1.5rem'
        }} className="no-print">
          <div className="card animate-scale-in" style={{
            width: '100%',
            maxWidth: '800px',
            maxHeight: '90vh',
            backgroundColor: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            padding: '1.5rem',
            animation: 'popup-scale-in 0.15s ease-out'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--border)',
              paddingBottom: '1rem',
              marginBottom: '1rem'
            }}>
              <h3 style={{ fontSize: '1.25rem' }}>{previewTitle}</h3>
              <button onClick={() => setPreviewPath(null)} className="btn-close">
                <X size={20} />
              </button>
            </div>
            
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
              {previewPath.toLowerCase().endsWith('.pdf') ? (
                <iframe 
                  src={previewPath} 
                  style={{ width: '100%', height: '60vh', border: 'none', borderRadius: 'var(--radius-sm)' }} 
                />
              ) : (
                <img 
                  src={previewPath} 
                  alt="Attachment Preview" 
                  style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 'var(--radius-sm)' }} 
                />
              )}
            </div>
            
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              marginTop: '1rem',
              borderTop: '1px solid var(--border)',
              paddingTop: '1rem'
            }}>
              <a 
                href={previewPath} 
                download
                className="btn btn-secondary"
                style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}
              >
                <FileDown size={16} />
                Download
              </a>
              <button className="btn btn-primary" onClick={() => setPreviewPath(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
