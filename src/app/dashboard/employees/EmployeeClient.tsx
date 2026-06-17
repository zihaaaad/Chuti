'use client';

import { useState, useTransition } from 'react';
import { addEmployee, updateEmployee, deleteEmployee, importEmployeesFromCSV } from '@/app/actions';
import { Edit2, Trash2, UserPlus, X, Search, Check, FileSpreadsheet, Download } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';

interface Balance {
  type: string;
  allocated: number;
  used: number;
  encashed: number;
  remaining: number;
}

interface Employee {
  id: number;
  employee_id: string;
  name: string;
  designation: string;
  department: string;
  joining_date: string;
  phone: string;
  status: string;
  balances: Balance[];
}

interface Department {
  id: number;
  name: string;
}

interface EmployeeClientProps {
  initialEmployees: Employee[];
  departments: Department[];
}

export default function EmployeeClient({ initialEmployees, departments }: EmployeeClientProps) {
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [employees, setEmployees] = useState(initialEmployees);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  
  // CSV Import States
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);

  // Form States
  const [empCode, setEmpCode] = useState('');
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [department, setDepartment] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState('Active');
  
  // Allocation adjustments
  const [clAllocated, setClAllocated] = useState('10');
  const [slAllocated, setSlAllocated] = useState('14');
  const [elAllocated, setElAllocated] = useState('15');
  const [mlAllocated, setMlAllocated] = useState('0');

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Filter employees
  const filteredEmployees = initialEmployees.filter(emp => {
    const q = searchQuery.toLowerCase();
    return (
      emp.name.toLowerCase().includes(q) ||
      emp.employee_id.toLowerCase().includes(q) ||
      emp.designation.toLowerCase().includes(q) ||
      emp.department.toLowerCase().includes(q)
    );
  });

  const openAddModal = () => {
    setEditingEmployee(null);
    setEmpCode(`EMP-${String(initialEmployees.length + 1).padStart(3, '0')}`);
    setName('');
    setDesignation('');
    setDepartment(departments[0]?.name || 'Administration');
    setJoiningDate(new Date().toISOString().split('T')[0]);
    setPhone('');
    setStatus('Active');
    setClAllocated('10');
    setSlAllocated('14');
    setElAllocated('15');
    setMlAllocated('0');
    setError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (emp: Employee) => {
    setEditingEmployee(emp);
    setEmpCode(emp.employee_id);
    setName(emp.name);
    setDesignation(emp.designation);
    setDepartment(emp.department);
    setJoiningDate(emp.joining_date);
    setPhone(emp.phone || '');
    setStatus(emp.status);
    
    const cl = emp.balances.find(b => b.type === 'Casual')?.allocated || 10;
    const sl = emp.balances.find(b => b.type === 'Sick')?.allocated || 14;
    const el = emp.balances.find(b => b.type === 'Earned')?.allocated || 15;
    const ml = emp.balances.find(b => b.type === 'Maternity')?.allocated || 0;
    
    setClAllocated(String(cl));
    setSlAllocated(String(sl));
    setElAllocated(String(el));
    setMlAllocated(String(ml));
    
    setError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingEmployee(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.append('employee_id', empCode);
    formData.append('name', name);
    formData.append('designation', designation);
    formData.append('department', department);
    formData.append('joining_date', joiningDate);
    formData.append('phone', phone);
    formData.append('status', status);
    formData.append('cl_allocated', clAllocated);
    formData.append('sl_allocated', slAllocated);
    formData.append('el_allocated', elAllocated);
    formData.append('ml_allocated', mlAllocated);

    startTransition(async () => {
      let res;
      if (editingEmployee) {
        formData.append('id', String(editingEmployee.id));
        res = await updateEmployee(formData);
      } else {
        res = await addEmployee(formData);
      }

      if (res.success) {
        showToast(
          editingEmployee ? 'Employee profile updated successfully!' : 'New employee registered successfully!',
          'success'
        );
        closeModal();
      } else {
        setError(res.error || 'Operation failed.');
        showToast(res.error || 'Operation failed.', 'error');
      }
    });
  };

  const handleCsvImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!csvFile) {
      setError('Please select a CSV file.');
      return;
    }

    if (csvFile.size > 10 * 1024 * 1024) {
      setError('CSV file size exceeds the 10MB limit.');
      showToast('CSV file size exceeds the 10MB limit.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('file', csvFile);

    startTransition(async () => {
      const res = await importEmployeesFromCSV(formData);
      if (res.success) {
        showToast(`Successfully imported ${res.count} employees!`, 'success');
        if (res.skipped && res.skipped.length > 0) {
          showToast(`Skipped ${res.skipped.length} duplicate ID codes: ${res.skipped.join(', ')}`, 'warning', 7000);
        }
        setCsvFile(null);
        setIsCsvImportOpen(false);
      } else {
        showToast(res.error || 'CSV Import failed.', 'error');
      }
    });
  };

  const handleDelete = async (id: number, empName: string) => {
    const ok = await confirm({
      title: 'Delete Employee',
      message: `Are you sure you want to delete ${empName}? This will permanently delete all their leave records.`,
      confirmText: 'Delete',
      isDanger: true
    });
    if (ok) {
      startTransition(async () => {
        const res = await deleteEmployee(id);
        if (res.success) {
          showToast(`Successfully deleted employee "${empName}".`, 'success');
        } else {
          showToast(res.error || 'Failed to delete employee.', 'error');
        }
      });
    }
  };

  return (
    <div>
      {/* Search & Actions Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '1rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap'
      }} className="no-print">
        
        {/* Search Bar */}
        <div style={{ position: 'relative', width: '100%', maxWidth: '350px' }}>
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
            placeholder="Search by name, ID or department..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => { setIsCsvImportOpen(!isCsvImportOpen); setError(null); }}>
            <FileSpreadsheet size={16} />
            Bulk CSV Import
          </button>
          <button className="btn btn-primary" onClick={openAddModal}>
            <UserPlus size={16} />
            Add Employee
          </button>
        </div>
      </div>

      {/* CSV Import Collapsible Form */}
      {isCsvImportOpen && (
        <div className="card" style={{ marginBottom: '1.5rem', border: '1px solid var(--primary-accent)', backgroundColor: '#f9fbf9' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--primary-accent)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileSpreadsheet size={18} />
            Upload Employees from CSV
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)', marginBottom: '1rem' }}>
            Ensure your CSV file contains columns in this order: <br />
            <strong>EmployeeID, Name, Designation, Department, Phone, JoiningDate (YYYY-MM-DD)</strong>
            <br />
            <em>Example: EMP-001, Kamal Hossain, Lecturer, Administration, 01711000000, 2026-01-01</em>
          </p>

          <div style={{ marginBottom: '1.25rem' }}>
            <a 
              href="/employees_template.csv" 
              download 
              className="btn btn-secondary" 
              style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
            >
              <Download size={14} />
              Download Template CSV
            </a>
          </div>

          <form onSubmit={handleCsvImport} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '240px' }}>
              <label className="form-label">Select CSV File</label>
              <input 
                type="file" 
                className="form-control" 
                accept=".csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                disabled={isPending}
                required
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={isPending}>
              {isPending ? 'Importing...' : 'Upload'}
            </button>
          </form>
        </div>
      )}

      {/* Employees Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>ID Code</th>
              <th>Name</th>
              <th>Designation</th>
              <th>Department</th>
              <th>Status</th>
              <th>Remaining Leaves (Allocated)</th>
              <th className="no-print" style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--foreground-muted)', padding: '2rem' }}>
                  No employees found.
                </td>
              </tr>
            ) : (
              filteredEmployees.map(emp => {
                const cl = emp.balances.find(b => b.type === 'Casual');
                const sl = emp.balances.find(b => b.type === 'Sick');
                const el = emp.balances.find(b => b.type === 'Earned');
                const ml = emp.balances.find(b => b.type === 'Maternity');
                
                return (
                  <tr key={emp.id}>
                    <td style={{ fontWeight: '600', color: 'var(--primary)' }}>{emp.employee_id}</td>
                    <td>
                      <div style={{ fontWeight: '600' }}>{emp.name}</div>
                      {emp.phone && <div style={{ fontSize: '0.75rem', color: 'var(--foreground-muted)' }}>{emp.phone}</div>}
                    </td>
                    <td>{emp.designation}</td>
                    <td>{emp.department}</td>
                    <td>
                      <span className={`badge ${emp.status === 'Active' ? 'badge-success' : 'badge-danger'}`}>
                        {emp.status}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8125rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem', maxWidth: '300px' }}>
                        <div>CL: <span style={{ fontWeight: 600 }}>{cl ? cl.remaining : 0}</span> ({cl ? cl.allocated : 10})</div>
                        <div>SL: <span style={{ fontWeight: 600 }}>{sl ? sl.remaining : 0}</span> ({sl ? sl.allocated : 14})</div>
                        <div>EL: <span style={{ fontWeight: 600 }}>{el ? el.remaining : 0}</span> ({el ? el.allocated : 15})</div>
                        {ml && ml.allocated > 0 && (
                          <div>ML: <span style={{ fontWeight: 600 }}>{ml.remaining}</span> ({ml.allocated})</div>
                        )}
                      </div>
                    </td>
                    <td className="no-print" style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.25rem' }}>
                        <button 
                          className="btn btn-secondary" 
                          style={{ padding: '0.375rem', border: 'none' }}
                          onClick={() => openEditModal(emp)}
                          title="Edit Profile"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button 
                          className="btn btn-danger-outline" 
                          style={{ padding: '0.375rem', border: 'none' }}
                          onClick={() => handleDelete(emp.id, emp.name)}
                          title="Delete Employee"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Modal Drawer */}
      {isModalOpen && (
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
            maxWidth: '550px',
            maxHeight: '90vh',
            overflowY: 'auto',
            position: 'relative',
            backgroundColor: '#ffffff',
            boxShadow: 'var(--shadow-lg)',
            border: '1px solid var(--border)'
          }}>
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--border)',
              paddingBottom: '1rem',
              marginBottom: '1.5rem'
            }}>
              <h3 style={{ fontSize: '1.25rem' }}>
                {editingEmployee ? `Edit Profile: ${editingEmployee.name}` : 'Add New Employee'}
              </h3>
              <button 
                onClick={closeModal}
                className="btn-close"
              >
                <X size={20} />
              </button>
            </div>

            {/* Error Message */}
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
            <form onSubmit={handleSubmit}>
              <div className="grid-2col">
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-code">Employee ID Code *</label>
                  <input 
                    className="form-control" 
                    type="text" 
                    id="emp-code" 
                    value={empCode}
                    onChange={(e) => setEmpCode(e.target.value)}
                    disabled={isPending}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="emp-name">Full Name *</label>
                  <input 
                    className="form-control" 
                    type="text" 
                    id="emp-name" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isPending}
                    required
                  />
                </div>
              </div>

              <div className="grid-2col">
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-designation">Designation *</label>
                  <input 
                    className="form-control" 
                    type="text" 
                    id="emp-designation" 
                    placeholder="Lecturer, Senior Manager, etc."
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    disabled={isPending}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="emp-dept">Department *</label>
                  <select 
                    className="form-control form-select" 
                    id="emp-dept"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    disabled={isPending}
                    required
                  >
                    {departments.map(dept => (
                      <option key={dept.id} value={dept.name}>{dept.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid-2col">
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-joining">Joining Date *</label>
                  <input 
                    className="form-control" 
                    type="date" 
                    id="emp-joining" 
                    value={joiningDate}
                    onChange={(e) => setJoiningDate(e.target.value)}
                    disabled={isPending}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="emp-phone">Phone Number</label>
                  <input 
                    className="form-control" 
                    type="tel" 
                    id="emp-phone" 
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={isPending}
                  />
                </div>
              </div>

              {editingEmployee && (
                <div className="form-group">
                  <label className="form-label" htmlFor="emp-status">Employment Status</label>
                  <select 
                    className="form-control form-select" 
                    id="emp-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    disabled={isPending}
                  >
                    <option value="Active">Active</option>
                    <option value="Resigned">Resigned</option>
                    <option value="Terminated">Terminated</option>
                  </select>
                </div>
              )}

              {/* Leave Balance Quotas */}
              <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
                <h4 style={{ fontSize: '0.875rem', color: 'var(--primary)', marginBottom: '1rem', fontWeight: 600 }}>
                  Yearly Leave Quotas (Allowed Days)
                </h4>
                
                <div className="grid-4col">
                  <div className="form-group">
                    <label className="form-label" htmlFor="cl-alloc">Casual (CL)</label>
                    <input 
                      className="form-control" 
                      type="number" 
                      min="0"
                      step="0.5"
                      id="cl-alloc" 
                      value={clAllocated}
                      onChange={(e) => setClAllocated(e.target.value)}
                      disabled={isPending}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="sl-alloc">Sick (SL)</label>
                    <input 
                      className="form-control" 
                      type="number" 
                      min="0"
                      step="0.5"
                      id="sl-alloc" 
                      value={slAllocated}
                      onChange={(e) => setSlAllocated(e.target.value)}
                      disabled={isPending}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="el-alloc">Earned (EL)</label>
                    <input 
                      className="form-control" 
                      type="number" 
                      min="0"
                      step="0.5"
                      id="el-alloc" 
                      value={elAllocated}
                      onChange={(e) => setElAllocated(e.target.value)}
                      disabled={isPending}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="ml-alloc">Maternity</label>
                    <input 
                      className="form-control" 
                      type="number" 
                      min="0"
                      id="ml-alloc" 
                      value={mlAllocated}
                      onChange={(e) => setMlAllocated(e.target.value)}
                      disabled={isPending}
                    />
                  </div>
                </div>
              </div>

              {/* Modal Footer Actions */}
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
                borderTop: '1px solid var(--border)',
                paddingTop: '1.25rem',
                marginTop: '1.5rem'
              }}>
                <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={isPending}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isPending}>
                  <Check size={16} />
                  {isPending ? 'Saving...' : 'Save Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
