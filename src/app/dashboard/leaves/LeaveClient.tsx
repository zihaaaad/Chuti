'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CalendarPlus, Coins, Download, Edit2, Eye, FileText, Lock, Paperclip, Search, Trash2 } from 'lucide-react';
import { addLeaveRecord, deleteLeaveRecord, logLeaveEncashment, previewLeave, updateLeaveRecord, type LeavePreview } from '@/app/actions/leaves';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import Modal from '@/components/Modal';
import EmployeePicker, { type PickerEmployee } from '@/components/EmployeePicker';
import { Alert, DialogHeader, EmptyState, Field, fieldAria, formatDays } from '@/components/ui';
import LeaveTypeBadge from '@/components/LeaveTypeBadge';
import { CASUAL, EARNED, ENCASHMENT_TYPE } from '@/lib/domain/leave-types';
import { useActiveLeaveTypes, useLeaveTypes } from '@/context/LeaveTypesContext';
import { formatDisplayDate, formatDisplayRange, todayLocal } from '@/lib/domain/dates';
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_MB, isPreviewablePath } from '@/lib/constants';

export interface LeaveRow {
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

interface Props {
  records: LeaveRow[];
  employees: PickerEmployee[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  type: string;
  leaveYearStart: string;
  openNew: boolean;
}

interface LeaveForm {
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  is_half_day: boolean;
  reason: string;
  remarks: string;
}

const emptyForm = (): LeaveForm => ({ employee_id: '', leave_type: CASUAL, start_date: todayLocal(), end_date: todayLocal(), is_half_day: false, reason: '', remarks: '' });

export default function LeaveClient({ records, employees, total, page, pageSize, query, type, leaveYearStart, openNew }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const allTypes = useLeaveTypes();
  const activeTypes = useActiveLeaveTypes();
  const leaveTitle = useId();
  const encashTitle = useId();
  const previewTitle = useId();
  const [isPending, startTransition] = useTransition();

  // ── Filters live in the URL so they survive refresh and can be bookmarked.
  const [search, setSearch] = useState(query);
  useEffect(() => {
    if (search === query) return;
    const t = setTimeout(() => navigate({ q: search, page: '1' }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function navigate(changes: Record<string, string>) {
    const params = new URLSearchParams();
    const next = { q: query, type, page: String(page), ...changes };
    Object.entries(next).forEach(([k, v]) => {
      if (v && !(k === 'page' && v === '1')) params.set(k, v);
    });
    router.replace(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false });
  }

  // ── Leave form
  const [leaveOpen, setLeaveOpen] = useState(openNew);
  const [editing, setEditing] = useState<LeaveRow | null>(null);
  const [form, setForm] = useState<LeaveForm>(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<LeavePreview | null>(null);

  useEffect(() => {
    if (openNew) router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openLeave = (rec: LeaveRow | null) => {
    setEditing(rec);
    setForm(
      rec
        ? { employee_id: String(rec.employee_id), leave_type: rec.leave_type, start_date: rec.start_date, end_date: rec.end_date, is_half_day: rec.actual_days === 0.5 && rec.start_date === rec.end_date, reason: rec.reason, remarks: rec.remarks ?? '' }
        : emptyForm(),
    );
    setFile(null);
    setRemoveAttachment(false);
    setErrors({});
    setFormError(null);
    setPreview(null);
    setLeaveOpen(true);
  };

  // Live preview of days charged and the balance afterwards.
  useEffect(() => {
    if (!leaveOpen) return;
    const end = form.is_half_day ? form.start_date : form.end_date;
    if (!form.start_date || !end || end < form.start_date) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await previewLeave({
        employee_id: form.employee_id ? Number(form.employee_id) : undefined,
        leave_type: form.leave_type,
        start_date: form.start_date,
        end_date: end,
        is_half_day: form.is_half_day,
        ignore_record_id: editing?.id,
      });
      if (!cancelled) setPreview(res.success ? res.data : null);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [leaveOpen, form.employee_id, form.leave_type, form.start_date, form.end_date, form.is_half_day, editing?.id]);

  const update = <K extends keyof LeaveForm>(key: K, value: LeaveForm[K]) =>
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === 'start_date' && next.end_date < (value as string)) next.end_date = value as string;
      return next;
    });

  const submitLeave = (e: React.FormEvent) => {
    e.preventDefault();
    if (file && file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
      setErrors({ attachment: `The file is larger than ${MAX_ATTACHMENT_MB} MB.` });
      return;
    }
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.set(k, String(v)));
    if (form.is_half_day) fd.set('end_date', form.start_date);
    if (file) fd.set('attachment', file);
    if (editing) {
      fd.set('id', String(editing.id));
      fd.set('delete_attachment', String(removeAttachment));
    }
    startTransition(async () => {
      const res = editing ? await updateLeaveRecord(fd) : await addLeaveRecord(fd);
      if (res.success) {
        const name = employees.find((x) => String(x.id) === form.employee_id)?.name ?? editing?.name ?? 'Leave';
        showToast(editing ? `Updated leave for ${name}.` : `Recorded ${preview ? formatDays(preview.days) : 'leave'} for ${name}.`, 'success');
        setLeaveOpen(false);
      } else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.fieldErrors ? null : res.error);
      }
    });
  };

  // ── Encashment
  const [encashOpen, setEncashOpen] = useState(false);
  const [encash, setEncash] = useState({ employee_id: '', encash_days: '1', remarks: '' });
  const [encashError, setEncashError] = useState<string | null>(null);
  const encashEmployee = employees.find((x) => String(x.id) === encash.employee_id);

  const submitEncash = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    Object.entries(encash).forEach(([k, v]) => fd.set(k, v));
    startTransition(async () => {
      const res = await logLeaveEncashment(fd);
      if (res.success) {
        showToast(`Encashed ${formatDays(Number(encash.encash_days))} of Earned Leave for ${encashEmployee?.name}.`, 'success');
        setEncashOpen(false);
      } else {
        setEncashError(res.error);
      }
    });
  };

  // ── Delete
  const onDelete = async (rec: LeaveRow) => {
    const isEncash = rec.leave_type === ENCASHMENT_TYPE;
    const ok = await confirm({
      title: isEncash ? 'Delete this encashment?' : 'Delete this leave record?',
      message: `${rec.name}: ${formatDays(rec.actual_days)} of ${isEncash ? 'encashed Earned Leave' : rec.leave_type}, ${formatDisplayRange(rec.start_date, rec.end_date)}. The ${formatDays(rec.actual_days)} go back to their balance${rec.attachment_path ? ' and the attachment is deleted' : ''}.`,
      confirmText: `Delete and refund ${formatDays(rec.actual_days)}`,
      isDanger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteLeaveRecord(rec.id);
      showToast(res.success ? `Deleted. ${formatDays(res.data.refunded)} refunded to ${rec.name}.` : res.error, res.success ? 'success' : 'error');
    });
  };

  // ── Attachment preview
  const [viewing, setViewing] = useState<LeaveRow | null>(null);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const selectedEmployee = employees.find((x) => String(x.id) === form.employee_id);
  const inactiveEditing = editing && !selectedEmployee;

  return (
    <>
      <div className="toolbar no-print">
        <div className="group">
          <div className="input-with-icon" style={{ width: 'min(320px, 100%)' }}>
            <Search size={16} aria-hidden />
            <input className="input" type="search" placeholder="Search name, ID, reason…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search leave records" />
          </div>
          <select className="select" style={{ width: 'auto' }} value={type} onChange={(e) => navigate({ type: e.target.value, page: '1' })} aria-label="Filter by leave type">
            <option value="">All types</option>
            {allTypes.map((t) => <option key={t.code} value={t.code}>{t.label}{t.active ? '' : ' (switched off)'}</option>)}
            <option value={ENCASHMENT_TYPE}>EL encashments</option>
          </select>
        </div>
        <div className="group">
          <button type="button" className="btn btn-secondary" onClick={() => { setEncash({ employee_id: '', encash_days: '1', remarks: '' }); setEncashError(null); setEncashOpen(true); }}>
            <Coins size={16} aria-hidden /> Encash EL
          </button>
          <button type="button" className="btn btn-primary" onClick={() => openLeave(null)}>
            <CalendarPlus size={16} aria-hidden /> Record leave
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Type</th>
              <th>Period</th>
              <th className="num">Days</th>
              <th>Reason</th>
              <th className="right"><span className="sr-only">Attachment and actions</span></th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  {query || type ? (
                    <EmptyState icon={<Search size={28} aria-hidden />} title="No records match">Clear the search or type filter to see everything.</EmptyState>
                  ) : (
                    <EmptyState icon={<FileText size={28} aria-hidden />} title="No leave recorded yet">Use Record leave to add the first one.</EmptyState>
                  )}
                </td>
              </tr>
            ) : (
              records.map((rec) => {
                const locked = rec.start_date < leaveYearStart;
                const isEncash = rec.leave_type === ENCASHMENT_TYPE;
                return (
                  <tr key={rec.id} className={locked ? 'locked' : undefined}>
                    <td className="primary-cell">
                      <Link href={`/dashboard/employees/${rec.employee_id}`}>{rec.name}</Link>
                      <span className="sub">{rec.emp_code}</span>
                    </td>
                    <td><LeaveTypeBadge type={rec.leave_type} /></td>
                    <td className="nowrap">{isEncash ? formatDisplayDate(rec.start_date) : formatDisplayRange(rec.start_date, rec.end_date)}</td>
                    <td className="num">{rec.actual_days}</td>
                    <td style={{ maxWidth: 360 }}>
                      {rec.reason}
                      {rec.remarks && <span className="sub">{rec.remarks}</span>}
                    </td>
                    <td className="right nowrap">
                      {rec.attachment_path && (
                        isPreviewablePath(rec.attachment_path) ? (
                          <button type="button" className="icon-btn" onClick={() => setViewing(rec)} aria-label={`View attachment for ${rec.name}`} title="View attachment">
                            <Eye size={16} aria-hidden />
                          </button>
                        ) : (
                          <a className="icon-btn" href={`${rec.attachment_path}?download=1`} aria-label={`Download attachment for ${rec.name}`} title="Download attachment">
                            <Paperclip size={16} aria-hidden />
                          </a>
                        )
                      )}
                      {locked ? (
                        <span className="icon-btn" title="Closed leave year: read-only" aria-label="Closed leave year, read-only"><Lock size={15} aria-hidden /></span>
                      ) : (
                        <span className="no-print">
                          {!isEncash && (
                            <button type="button" className="icon-btn" onClick={() => openLeave(rec)} aria-label={`Edit leave for ${rec.name}`} title="Edit">
                              <Edit2 size={16} aria-hidden />
                            </button>
                          )}
                          <button type="button" className="icon-btn danger" onClick={() => onDelete(rec)} disabled={isPending} aria-label={`Delete leave for ${rec.name}`} title="Delete and refund">
                            <Trash2 size={16} aria-hidden />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <nav className="pagination no-print" aria-label="Pagination">
        <span>
          {total === 0 ? 'No records' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </span>
        {pages > 1 && (
          <span className="group" style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => navigate({ page: String(page - 1) })}>Previous</button>
            <span style={{ alignSelf: 'center' }}>Page {page} of {pages}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => navigate({ page: String(page + 1) })}>Next</button>
          </span>
        )}
      </nav>

      {/* ── Record / edit leave ─────────────────────────────────────────── */}
      <Modal isOpen={leaveOpen} onClose={() => setLeaveOpen(false)} labelledBy={leaveTitle} maxWidth="600px" locked={isPending}>
        <form onSubmit={submitLeave} noValidate>
          <DialogHeader id={leaveTitle} title={editing ? 'Edit leave record' : 'Record leave'} onClose={() => setLeaveOpen(false)} />
          <div className="form-grid">
            {formError && <Alert tone="danger" live>{formError}</Alert>}
            {inactiveEditing && <Alert tone="warning">{editing?.name} is not active, so this record can only be deleted.</Alert>}

            <Field label="Employee" htmlFor="leave-emp" required error={errors.employee_id}>
              <EmployeePicker id="leave-emp" employees={employees} value={form.employee_id} onChange={(v) => update('employee_id', v)} disabled={isPending} invalid={!!errors.employee_id} describedBy={errors.employee_id ? 'leave-emp-error' : undefined} />
            </Field>

            <div className="form-grid cols-2">
              <Field label="Leave type" htmlFor="leave-type" required error={errors.leave_type}>
                <select className="select" value={form.leave_type} onChange={(e) => update('leave_type', e.target.value)} disabled={isPending} {...fieldAria('leave-type', errors.leave_type)}>
                  {activeTypes.map((t) => <option key={t.code} value={t.code}>{t.label} ({t.short})</option>)}
                  {/* Editing an old record whose type has since been switched off keeps it selectable. */}
                  {form.leave_type && !activeTypes.some((t) => t.code === form.leave_type) && (
                    <option value={form.leave_type}>{allTypes.find((t) => t.code === form.leave_type)?.label ?? form.leave_type} (switched off)</option>
                  )}
                </select>
              </Field>
              <div className="field" style={{ justifyContent: 'flex-end' }}>
                <label className="check" style={{ minHeight: 38 }}>
                  <input type="checkbox" checked={form.is_half_day} onChange={(e) => update('is_half_day', e.target.checked)} disabled={isPending} />
                  Half day
                </label>
              </div>
              <Field label={form.is_half_day ? 'Date' : 'Start date'} htmlFor="leave-start" required error={errors.start_date}>
                <input className="input" type="date" value={form.start_date} min={leaveYearStart === '0001-01-01' ? undefined : leaveYearStart} onChange={(e) => update('start_date', e.target.value)} disabled={isPending} {...fieldAria('leave-start', errors.start_date)} />
              </Field>
              {!form.is_half_day && (
                <Field label="End date" htmlFor="leave-end" required error={errors.end_date}>
                  <input className="input" type="date" value={form.end_date} min={form.start_date} onChange={(e) => update('end_date', e.target.value)} disabled={isPending} {...fieldAria('leave-end', errors.end_date)} />
                </Field>
              )}
            </div>

            <div className="preview" aria-live="polite">
              {!preview ? (
                <span className="subtle">Choose dates to see how many days will be charged.</span>
              ) : preview.closedYear ? (
                <span className="after-negative">These dates are in a closed leave year and can&apos;t be recorded.</span>
              ) : (
                <>
                  <span className="charge">Charges {formatDays(preview.days)}</span>
                  <span className="subtle num">
                    {preview.calendarDays} calendar day{preview.calendarDays === 1 ? '' : 's'}: {preview.workingDays} working
                    {preview.weekendDays > 0 && `, ${preview.weekendDays} weekend`}
                    {preview.holidayDays > 0 && `, ${preview.holidayDays} holiday`}
                    {preview.sandwichedDays > 0 && ` (${preview.sandwichedDays} off-day${preview.sandwichedDays === 1 ? '' : 's'} counted by the sandwich rule)`}
                  </span>
                  {preview.balanceBefore !== null && (
                    <span className="num">
                      {form.leave_type} balance: {preview.balanceBefore} → <span className={preview.balanceAfter! < 0 ? 'after-negative' : undefined}>{preview.balanceAfter}</span>
                      {preview.balanceAfter! < 0 && ' — not enough balance. Use Leave Without Pay for the extra days.'}
                    </span>
                  )}
                  {preview.overlap && <span className="after-negative">Clashes with leave already recorded for this employee.</span>}
                  {preview.days === 0 && <span className="after-negative">Every day in this range is a weekend or holiday.</span>}
                </>
              )}
            </div>

            <Field label="Reason" htmlFor="leave-reason" required error={errors.reason}>
              <input className="input" value={form.reason} onChange={(e) => update('reason', e.target.value)} placeholder="e.g. Fever, family event" disabled={isPending} {...fieldAria('leave-reason', errors.reason)} />
            </Field>

            <Field label="Supporting document" htmlFor="leave-file" error={errors.attachment} hint={`PDF, image or Word file up to ${MAX_ATTACHMENT_MB} MB.`}>
              {editing?.attachment_path && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <span className={removeAttachment ? 'field-error' : 'subtle'}>
                    {removeAttachment ? 'The current file will be removed when you save.' : `Current: ${editing.attachment_path.split('/').pop()?.replace(/^\d+_[a-f0-9]{8}_/, '')}`}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoveAttachment((r) => !r)}>{removeAttachment ? 'Keep file' : 'Remove file'}</button>
                </div>
              )}
              <input className="input" type="file" accept={ATTACHMENT_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={isPending} {...fieldAria('leave-file', errors.attachment, true)} />
            </Field>

            <Field label="Remarks" htmlFor="leave-remarks" error={errors.remarks}>
              <textarea className="textarea" rows={2} value={form.remarks} onChange={(e) => update('remarks', e.target.value)} disabled={isPending} {...fieldAria('leave-remarks', errors.remarks)} />
            </Field>
          </div>
          <div className="form-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setLeaveOpen(false)} disabled={isPending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || !!inactiveEditing}>
              {isPending ? 'Saving…' : editing ? 'Save changes' : preview && preview.days > 0 ? `Record ${formatDays(preview.days)}` : 'Record leave'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Encashment ──────────────────────────────────────────────────── */}
      <Modal isOpen={encashOpen} onClose={() => setEncashOpen(false)} labelledBy={encashTitle} maxWidth="480px" locked={isPending}>
        <form onSubmit={submitEncash} noValidate>
          <DialogHeader id={encashTitle} title="Encash Earned Leave" description="Pays out unused EL. The days are taken from the EL balance and logged today." onClose={() => setEncashOpen(false)} />
          <div className="form-grid">
            {encashError && <Alert tone="danger" live>{encashError}</Alert>}
            <Field label="Employee" htmlFor="encash-emp" required hint={encashEmployee ? `${formatDays(encashEmployee.balances?.[EARNED] ?? 0)} of EL available` : undefined}>
              <EmployeePicker id="encash-emp" employees={employees} value={encash.employee_id} onChange={(v) => setEncash((s) => ({ ...s, employee_id: v }))} disabled={isPending} describedBy="encash-emp-hint" />
            </Field>
            <Field label="Days to encash" htmlFor="encash-days" required>
              <input id="encash-days" className="input num" type="number" min={0.5} step={0.5} max={encashEmployee?.balances?.[EARNED] ?? undefined} value={encash.encash_days} onChange={(e) => setEncash((s) => ({ ...s, encash_days: e.target.value }))} disabled={isPending} />
            </Field>
            <Field label="Remarks" htmlFor="encash-remarks">
              <textarea id="encash-remarks" className="textarea" rows={2} placeholder="e.g. Paid with September 2026 salary" value={encash.remarks} onChange={(e) => setEncash((s) => ({ ...s, remarks: e.target.value }))} disabled={isPending} />
            </Field>
          </div>
          <div className="form-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setEncashOpen(false)} disabled={isPending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || !encash.employee_id}>{isPending ? 'Saving…' : 'Encash'}</button>
          </div>
        </form>
      </Modal>

      {/* ── Attachment viewer ───────────────────────────────────────────── */}
      <Modal isOpen={!!viewing} onClose={() => setViewing(null)} labelledBy={previewTitle} maxWidth="860px" zIndex={200}>
        {viewing?.attachment_path && (
          <>
            <DialogHeader id={previewTitle} title={`Attachment · ${viewing.name}`} description={formatDisplayRange(viewing.start_date, viewing.end_date)} onClose={() => setViewing(null)} />
            <div style={{ background: 'var(--surface-muted)', borderRadius: 'var(--radius-md)', padding: '0.75rem', display: 'grid', placeItems: 'center' }}>
              {viewing.attachment_path.toLowerCase().endsWith('.pdf') ? (
                <iframe title="Attachment preview" src={viewing.attachment_path} style={{ width: '100%', height: '65vh', border: 'none' }} />
              ) : (
                <img src={viewing.attachment_path} alt={`Attachment for ${viewing.name}`} style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' }} />
              )}
            </div>
            <div className="form-footer">
              <a className="btn btn-secondary" href={`${viewing.attachment_path}?download=1`}><Download size={16} aria-hidden /> Download</a>
              <button type="button" className="btn btn-primary" onClick={() => setViewing(null)}>Close</button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
