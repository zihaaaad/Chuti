'use client';

import { useId, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Download, Edit2, FileSpreadsheet, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { addEmployee, deleteEmployee, importEmployeesFromCSV, updateEmployee, type ImportSummary } from '@/app/actions/employees';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import Modal from '@/components/Modal';
import { Alert, DialogHeader, EmptyState, Field, StatusBadge, fieldAria } from '@/components/ui';
import { useLeaveTypes } from '@/context/LeaveTypesContext';
import { todayLocal } from '@/lib/domain/dates';

export interface EmployeeRow {
  id: number;
  employee_id: string;
  name: string;
  designation: string;
  department: string;
  joining_date: string;
  phone: string | null;
  email: string | null;
  status: string;
  balances: Record<string, { allocated: number; remaining: number }>;
}

interface Props {
  employees: EmployeeRow[];
  departments: { id: number; name: string }[];
  nextCode: string;
}

type FormState = {
  employee_id: string;
  name: string;
  designation: string;
  department: string;
  joining_date: string;
  phone: string;
  email: string;
  status: string;
  /** Yearly quota per leave type code, as typed. */
  alloc: Record<string, string>;
};

/** Leave type codes may contain spaces; element ids may not. */
const allocId = (code: string) => `alloc-${code.replace(/[^A-Za-z0-9]+/g, '-')}`;

export default function EmployeeClient({ employees, departments, nextCode }: Props) {
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const allTypes = useLeaveTypes();
  // Switched-off types keep their column only while someone still has a balance in them.
  const quotaTypes = useMemo(
    () => allTypes.filter((t) => t.hasQuota && (t.active || employees.some((e) => (e.balances[t.code]?.allocated ?? 0) > 0))),
    [allTypes, employees],
  );
  const editableQuotaTypes = quotaTypes.filter((t) => t.active);
  const titleId = useId();
  const importTitleId = useId();

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Active' | 'all' | 'inactive'>('Active');
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter((e) => {
      if (statusFilter === 'Active' && e.status !== 'Active') return false;
      if (statusFilter === 'inactive' && e.status === 'Active') return false;
      if (!q) return true;
      return [e.name, e.employee_id, e.designation, e.department, e.phone ?? '', e.email ?? ''].some((v) => v.toLowerCase().includes(q));
    });
  }, [employees, query, statusFilter]);

  const openForm = (emp: EmployeeRow | null) => {
    setEditing(emp);
    setErrors({});
    setFormError(null);
    // `??` not `||`: a quota of 0 is a real value and must not become the default.
    const alloc = Object.fromEntries(
      editableQuotaTypes.map((t) => [t.code, String(emp?.balances[t.code]?.allocated ?? t.defaultAllocation)]),
    );
    setForm({
      employee_id: emp?.employee_id ?? nextCode,
      name: emp?.name ?? '',
      designation: emp?.designation ?? '',
      department: emp?.department && emp.department !== '—' ? emp.department : departments[0]?.name ?? '',
      joining_date: emp?.joining_date ?? todayLocal(),
      phone: emp?.phone ?? '',
      email: emp?.email ?? '',
      status: emp?.status ?? 'Active',
      alloc,
    });
    setFormOpen(true);
  };

  const set = (key: Exclude<keyof FormState, 'alloc'>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [key]: e.target.value } : f));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => {
      if (typeof v === 'string') fd.set(k, v);
    });
    Object.entries(form.alloc).forEach(([code, v]) => fd.set(`alloc_${code}`, v));
    if (editing) fd.set('id', String(editing.id));
    startTransition(async () => {
      const res = editing ? await updateEmployee(fd) : await addEmployee(fd);
      if (res.success) {
        showToast(editing ? `Saved ${form.name}.` : `Added ${form.name}.`, 'success');
        setFormOpen(false);
      } else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.fieldErrors ? null : res.error);
      }
    });
  };

  const onDelete = async (emp: EmployeeRow) => {
    const ok = await confirm({
      title: `Delete ${emp.name}?`,
      message: `This permanently deletes ${emp.name} and every leave, late-arrival and encashment record they have, including past payroll history. If they have left, edit them and set the status to Resigned instead.`,
      confirmText: 'Delete permanently',
      confirmInputText: emp.employee_id,
      isDanger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteEmployee(emp.id);
      showToast(res.success ? `Deleted ${emp.name}.` : res.error, res.success ? 'success' : 'error');
    });
  };

  const onImport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvFile) return;
    const fd = new FormData();
    fd.set('file', csvFile);
    startTransition(async () => {
      const res = await importEmployeesFromCSV(fd);
      if (res.success) {
        setImportResult(res.data);
        showToast(`Imported ${res.data.imported} employee${res.data.imported === 1 ? '' : 's'}.`, res.data.skipped.length ? 'warning' : 'success');
      } else {
        showToast(res.error, 'error');
      }
    });
  };

  const inactiveCount = employees.filter((e) => e.status !== 'Active').length;

  return (
    <>
      <div className="toolbar no-print">
        <div className="group">
          <div className="input-with-icon" style={{ width: 'min(320px, 100%)' }}>
            <Search size={16} aria-hidden />
            <input className="input" type="search" placeholder="Search name, ID, department…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search employees" />
          </div>
          <select className="select" style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter by status">
            <option value="Active">Active staff</option>
            <option value="inactive">Resigned / terminated ({inactiveCount})</option>
            <option value="all">Everyone</option>
          </select>
        </div>
        <div className="group">
          <button type="button" className="btn btn-secondary" onClick={() => { setImportResult(null); setCsvFile(null); setImportOpen(true); }}>
            <FileSpreadsheet size={16} aria-hidden /> Import CSV
          </button>
          <button type="button" className="btn btn-primary" onClick={() => openForm(null)}>
            <UserPlus size={16} aria-hidden /> Add employee
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Designation</th>
              <th>Department</th>
              <th>Status</th>
              {quotaTypes.map((t) => (
                <th key={t.code} className="num" title={`${t.label}: remaining / yearly quota`}>{t.short} left</th>
              ))}
              <th className="right no-print"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5 + quotaTypes.length}>
                  {employees.length === 0 ? (
                    <EmptyState icon={<Users size={28} aria-hidden />} title="No employees yet">Add employees one at a time, or import a spreadsheet with Import CSV.</EmptyState>
                  ) : (
                    <EmptyState icon={<Search size={28} aria-hidden />} title="No employees match">Try a different search or status filter.</EmptyState>
                  )}
                </td>
              </tr>
            ) : (
              filtered.map((emp) => (
                <tr key={emp.id}>
                  <td className="primary-cell">
                    <Link href={`/dashboard/employees/${emp.id}`}>{emp.name}</Link>
                    <span className="sub">{emp.employee_id}{emp.phone ? ` · ${emp.phone}` : ''}</span>
                  </td>
                  <td>{emp.designation}</td>
                  <td>{emp.department}</td>
                  <td><StatusBadge status={emp.status} /></td>
                  {quotaTypes.map((t) => {
                    const b = emp.balances[t.code];
                    return (
                      <td key={t.code} className="num">
                        {b ? <><strong style={{ color: b.remaining <= 0 && b.allocated > 0 ? 'var(--danger)' : undefined }}>{b.remaining}</strong><span className="subtle"> / {b.allocated}</span></> : '—'}
                      </td>
                    );
                  })}
                  <td className="right no-print nowrap">
                    <button type="button" className="icon-btn" onClick={() => openForm(emp)} aria-label={`Edit ${emp.name}`} title="Edit">
                      <Edit2 size={16} aria-hidden />
                    </button>
                    <button type="button" className="icon-btn danger" onClick={() => onDelete(emp)} disabled={isPending} aria-label={`Delete ${emp.name}`} title="Delete">
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="subtle" style={{ marginTop: '0.5rem' }}>
        Showing {filtered.length} of {employees.length}. Balances are for the current leave year and include carried-forward days.
      </p>

      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} labelledBy={titleId} maxWidth="640px" locked={isPending}>
        {form && (
          <form onSubmit={onSubmit} noValidate>
            <DialogHeader id={titleId} title={editing ? `Edit ${editing.name}` : 'Add employee'} onClose={() => setFormOpen(false)} />
            <div className="form-grid">
              {formError && <Alert tone="danger" live>{formError}</Alert>}
              <div className="form-grid cols-2">
                <Field label="Employee ID" htmlFor="emp-code" required error={errors.employee_id}>
                  <input className="input" value={form.employee_id} onChange={set('employee_id')} disabled={isPending} data-autofocus={editing ? undefined : true} {...fieldAria('emp-code', errors.employee_id)} />
                </Field>
                <Field label="Full name" htmlFor="emp-name" required error={errors.name}>
                  <input className="input" value={form.name} onChange={set('name')} disabled={isPending} autoComplete="off" {...fieldAria('emp-name', errors.name)} />
                </Field>
                <Field label="Designation" htmlFor="emp-designation" required error={errors.designation}>
                  <input className="input" value={form.designation} onChange={set('designation')} placeholder="e.g. Lecturer" disabled={isPending} {...fieldAria('emp-designation', errors.designation)} />
                </Field>
                <Field label="Department" htmlFor="emp-dept" required error={errors.department} hint={departments.length === 0 ? 'Add departments in Settings.' : undefined}>
                  <select className="select" value={form.department} onChange={set('department')} disabled={isPending} {...fieldAria('emp-dept', errors.department)}>
                    {departments.length === 0 && <option value="">No departments</option>}
                    {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="Joining date" htmlFor="emp-joining" required error={errors.joining_date}>
                  <input className="input" type="date" value={form.joining_date} onChange={set('joining_date')} disabled={isPending} {...fieldAria('emp-joining', errors.joining_date)} />
                </Field>
                <Field label="Phone" htmlFor="emp-phone" error={errors.phone}>
                  <input className="input" type="tel" value={form.phone} onChange={set('phone')} disabled={isPending} {...fieldAria('emp-phone', errors.phone)} />
                </Field>
                <Field label="Email" htmlFor="emp-email" error={errors.email}>
                  <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="Optional" disabled={isPending} {...fieldAria('emp-email', errors.email)} />
                </Field>
                {editing && (
                  <Field label="Status" htmlFor="emp-status" hint="Resigned and terminated staff keep their history but can't take new leave.">
                    <select className="select" value={form.status} onChange={set('status')} disabled={isPending} {...fieldAria('emp-status', undefined, true)}>
                      <option value="Active">Active</option>
                      <option value="Resigned">Resigned</option>
                      <option value="Terminated">Terminated</option>
                    </select>
                  </Field>
                )}
              </div>

              <fieldset className="fieldset">
                <legend>Yearly leave quota (days)</legend>
                <div className="form-grid cols-4">
                  {editableQuotaTypes.map((t) => {
                    const key = `alloc_${t.code}`;
                    const id = allocId(t.code);
                    return (
                      <Field key={t.code} label={t.short} htmlFor={id} error={errors[key]}>
                        <input
                          className="input num"
                          type="number"
                          min={0}
                          max={365}
                          step={0.5}
                          value={form.alloc[t.code] ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            setForm((f) => (f ? { ...f, alloc: { ...f.alloc, [t.code]: value } } : f));
                          }}
                          disabled={isPending}
                          title={t.label}
                          {...fieldAria(id, errors[key])}
                        />
                      </Field>
                    );
                  })}
                </div>
              </fieldset>
            </div>
            <div className="form-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setFormOpen(false)} disabled={isPending}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={isPending}>{isPending ? 'Saving…' : editing ? 'Save changes' : 'Add employee'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={importOpen} onClose={() => setImportOpen(false)} labelledBy={importTitleId} maxWidth="600px" locked={isPending}>
        <DialogHeader id={importTitleId} title="Import employees from CSV" description="The whole file is imported in one go: if something goes wrong, nothing is added." onClose={() => setImportOpen(false)} />
        {importResult ? (
          <div className="form-grid">
            <Alert tone={importResult.skipped.length ? 'warning' : 'success'}>
              Imported {importResult.imported} employee{importResult.imported === 1 ? '' : 's'}.
              {importResult.skipped.length > 0 && ` ${importResult.skipped.length} row${importResult.skipped.length === 1 ? ' was' : 's were'} skipped.`}
            </Alert>
            {importResult.skipped.length > 0 && (
              <div className="table-wrap table-scroll">
                <table className="table">
                  <thead><tr><th className="num">Row</th><th>Reason</th></tr></thead>
                  <tbody>{importResult.skipped.map((s) => <tr key={s.row}><td className="num">{s.row}</td><td>{s.reason}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            <div className="form-footer"><button type="button" className="btn btn-primary" onClick={() => setImportOpen(false)}>Done</button></div>
          </div>
        ) : (
          <form onSubmit={onImport} className="form-grid">
            <p>Columns, in this order: <code>EmployeeID, Name, Designation, Department, Phone, JoiningDate, Email</code>. Phone, JoiningDate (YYYY-MM-DD) and Email are optional. New departments are created automatically, and default quotas are applied.</p>
            <a href="/employees_template.csv" download className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }}>
              <Download size={14} aria-hidden /> Download template
            </a>
            <Field label="CSV file" htmlFor="csv-file" required hint="Up to 2,000 rows. Save from Excel as “CSV UTF-8”.">
              <input id="csv-file" className="input" type="file" accept=".csv,text/csv" onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)} disabled={isPending} aria-describedby="csv-file-hint" />
            </Field>
            <div className="form-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(false)} disabled={isPending}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={isPending || !csvFile}>{isPending ? 'Importing…' : 'Import'}</button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
