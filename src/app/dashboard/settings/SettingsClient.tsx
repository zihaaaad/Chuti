'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Briefcase, CalendarDays, CalendarX2, Database, HardDriveDownload, Lock, Plus, RotateCcw, Scale, Settings2, Trash2, X } from 'lucide-react';
import { addDepartment, addHoliday, deleteDepartment, deleteHoliday, updateSystemSettings } from '@/app/actions/settings';
import { checkBalances, closeLeaveYear, createBackupNow, previewLeaveYearClose, restoreBackup, type BackupFileInfo, type YearClosePreview } from '@/app/actions/maintenance';
import type { BalanceDrift } from '@/lib/ledger';
import type { AppSettings } from '@/lib/settings';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import Modal from '@/components/Modal';
import { Alert, DialogHeader, EmptyState, Field, fieldAria, formatDays } from '@/components/ui';
import { WEEKDAYS, formatDisplayDate, formatDisplayRange } from '@/lib/domain/dates';
import PasswordChangeForm from './PasswordChangeForm';
import BackupCopiesCard, { type BackupCopiesView } from './BackupCopiesCard';

interface Props {
  settings: AppSettings;
  holidays: { id: number; title: string; start_date: string; end_date: string }[];
  departments: { id: number; name: string; employees: number }[];
  backups: BackupFileInfo[];
  backupCopies: BackupCopiesView;
  closings: { id: number; closed_at: string; previous_start: string; new_start: string; el_carry_cap: number }[];
  today: string;
}

const BACKUP_KIND_LABEL: Record<BackupFileInfo['kind'], string> = {
  automatic: 'Automatic',
  manual: 'Manual',
  'before-restore': 'Before a restore',
  'before-year-close': 'Before year close',
};

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function SettingsClient({ settings, holidays, departments, backups, backupCopies, closings, today }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [isPending, startTransition] = useTransition();

  // ── Policy
  const [policy, setPolicy] = useState({
    institute_name: settings.instituteName,
    weekend_days: settings.weekendDays as string[],
    sandwich_rule: settings.sandwichRule,
    late_cl_threshold: String(settings.lateThreshold),
    el_carry_cap: String(settings.elCarryCap),
  });
  const [policyErrors, setPolicyErrors] = useState<Record<string, string>>({});

  const savePolicy = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set('institute_name', policy.institute_name);
    fd.set('weekend_days', policy.weekend_days.join(','));
    fd.set('sandwich_rule', String(policy.sandwich_rule));
    fd.set('late_cl_threshold', policy.late_cl_threshold);
    fd.set('el_carry_cap', policy.el_carry_cap);
    startTransition(async () => {
      const res = await updateSystemSettings(fd);
      if (res.success) {
        setPolicyErrors({});
        showToast('Settings saved. They apply to leave recorded from now on.', 'success');
      } else {
        setPolicyErrors(res.fieldErrors ?? {});
        if (!res.fieldErrors) showToast(res.error, 'error');
      }
    });
  };

  // ── Departments & holidays
  const [deptName, setDeptName] = useState('');
  const [holiday, setHoliday] = useState({ title: '', start_date: '', end_date: '' });

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, ok: string, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (res.success) {
        showToast(ok, 'success');
        after?.();
      } else {
        showToast(res.error ?? 'Something went wrong.', 'error');
      }
    });

  const submitDept = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set('name', deptName);
    run(() => addDepartment(fd), `Added department "${deptName.trim()}".`, () => setDeptName(''));
  };

  const submitHoliday = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    Object.entries({ ...holiday, end_date: holiday.end_date || holiday.start_date }).forEach(([k, v]) => fd.set(k, v));
    run(() => addHoliday(fd), `Added holiday "${holiday.title.trim()}".`, () => setHoliday({ title: '', start_date: '', end_date: '' }));
  };

  // ── Backups
  const onRestore = async (b: BackupFileInfo) => {
    const ok = await confirm({
      title: 'Restore this backup?',
      message: `All data will be replaced with the backup from ${new Date(b.mtime).toLocaleString('en-GB')}. Anything recorded after that is lost. A copy of the current data is saved first, so this can be undone by restoring that copy.`,
      confirmText: 'Restore backup',
      confirmInputText: 'RESTORE',
      isDanger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await restoreBackup(b.name);
      if (res.success) {
        showToast('Backup restored.', 'success');
        router.refresh();
      } else {
        showToast(res.error, 'error');
      }
    });
  };

  // ── Balance check
  const [drift, setDrift] = useState<BalanceDrift[] | null>(null);
  const runCheck = (apply: boolean) =>
    startTransition(async () => {
      const res = await checkBalances(apply);
      if (!res.success) return showToast(res.error, 'error');
      if (apply) {
        showToast(`Corrected ${res.data.length} balance value${res.data.length === 1 ? '' : 's'}.`, 'success');
        setDrift([]);
      } else {
        setDrift(res.data);
      }
    });

  // ── Leave year close
  const yearTitle = useId();
  const [yearOpen, setYearOpen] = useState(false);
  const [yearForm, setYearForm] = useState({ new_year_start: '', el_carry_cap: String(settings.elCarryCap), confirm: '' });
  const [yearPreview, setYearPreview] = useState<YearClosePreview | null>(null);
  const [yearError, setYearError] = useState<string | null>(null);

  const openYear = () => {
    const nextJan = `${Number(today.slice(0, 4)) + (today.slice(5, 7) === '01' ? 0 : 1)}-01-01`;
    setYearForm({ new_year_start: nextJan, el_carry_cap: String(settings.elCarryCap), confirm: '' });
    setYearError(null);
    setYearPreview(null);
    setYearOpen(true);
    loadYearPreview(settings.elCarryCap);
  };
  const loadYearPreview = (cap: number) =>
    startTransition(async () => {
      const res = await previewLeaveYearClose(cap);
      setYearPreview(res.success ? res.data : null);
    });
  const submitYear = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    Object.entries(yearForm).forEach(([k, v]) => fd.set(k, v));
    startTransition(async () => {
      const res = await closeLeaveYear(fd);
      if (res.success) {
        showToast(`Leave year closed. ${formatDays(res.data.carriedTotal)} of EL carried forward in total.`, 'success');
        setYearOpen(false);
      } else {
        setYearError(res.error);
      }
    });
  };

  const yearStarted = settings.leaveYearStart !== '0001-01-01';

  return (
    <div className="grid-halves">
      <div className="stack">
        {/* Policy */}
        <section className="card" aria-labelledby="policy-title">
          <div className="card-head"><h2 id="policy-title"><Settings2 size={18} aria-hidden /> Organisation &amp; leave policy</h2></div>
          <form onSubmit={savePolicy} className="form-grid" noValidate>
            <Field label="Organisation name" htmlFor="institute_name" required error={policyErrors.institute_name} hint="Shown in the sidebar and on printed reports.">
              <input className="input" value={policy.institute_name} onChange={(e) => setPolicy((p) => ({ ...p, institute_name: e.target.value }))} disabled={isPending} {...fieldAria('institute_name', policyErrors.institute_name, true)} />
            </Field>

            <fieldset className="fieldset">
              <legend>Weekly days off</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {WEEKDAYS.map((day) => (
                  <label key={day} className="chip-check">
                    <input
                      type="checkbox"
                      checked={policy.weekend_days.includes(day)}
                      onChange={(e) =>
                        setPolicy((p) => ({ ...p, weekend_days: e.target.checked ? [...p.weekend_days, day] : p.weekend_days.filter((d) => d !== day) }))
                      }
                      disabled={isPending}
                    />
                    <span style={{ textTransform: 'capitalize' }}>{day.slice(0, 3)}</span>
                  </label>
                ))}
              </div>
              {policyErrors.weekend_days && <p className="field-error" style={{ marginTop: '0.4rem' }}>{policyErrors.weekend_days}</p>}
            </fieldset>

            <label className="check" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={policy.sandwich_rule} onChange={(e) => setPolicy((p) => ({ ...p, sandwich_rule: e.target.checked }))} disabled={isPending} style={{ marginTop: 3 }} />
              <span>
                <strong>Sandwich rule</strong>
                <span className="field-hint" style={{ display: 'block' }}>
                  Count weekends and holidays that fall <em>between</em> two leave days. Example: leave on Thursday and Sunday with a Fri–Sat weekend charges 4 days instead of 2.
                </span>
              </span>
            </label>

            <div className="form-grid cols-2">
              <Field label="Late arrivals per CL day cut" htmlFor="late_cl_threshold" required error={policyErrors.late_cl_threshold} hint="e.g. 3 means every 3 late arrivals in a month cut 1 day of CL.">
                <input className="input num" type="number" min={1} max={999} value={policy.late_cl_threshold} onChange={(e) => setPolicy((p) => ({ ...p, late_cl_threshold: e.target.value }))} disabled={isPending} {...fieldAria('late_cl_threshold', policyErrors.late_cl_threshold, true)} />
              </Field>
              <Field label="EL carry-forward cap" htmlFor="el_carry_cap" required error={policyErrors.el_carry_cap} hint="Most unused EL days kept when a leave year closes.">
                <input className="input num" type="number" min={0} max={365} step={0.5} value={policy.el_carry_cap} onChange={(e) => setPolicy((p) => ({ ...p, el_carry_cap: e.target.value }))} disabled={isPending} {...fieldAria('el_carry_cap', policyErrors.el_carry_cap, true)} />
              </Field>
            </div>
            <div><button type="submit" className="btn btn-primary" disabled={isPending}>Save policy</button></div>
          </form>
        </section>

        {/* Leave year */}
        <section className="card" aria-labelledby="year-title">
          <div className="card-head">
            <div>
              <h2 id="year-title"><CalendarX2 size={18} aria-hidden /> Leave year</h2>
              <p>{yearStarted ? `The current leave year started ${formatDisplayDate(settings.leaveYearStart)}.` : 'No leave year has been closed yet. Balances cover all records.'}</p>
            </div>
          </div>
          <p style={{ marginBottom: '0.75rem' }}>
            Closing a year saves a backup, carries unused Earned Leave forward (up to the cap), lets unused CL, SL and ML lapse, and makes older records read-only.
          </p>
          <button type="button" className="btn btn-secondary" onClick={openYear} disabled={isPending}>Close leave year…</button>
          {closings.length > 0 && (
            <ul className="subtle" style={{ marginTop: '0.75rem', paddingLeft: '1rem' }}>
              {closings.map((c) => (
                <li key={c.id}>Closed on {new Date(c.closed_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-GB')}: new year from {formatDisplayDate(c.new_start)}, EL cap {c.el_carry_cap}</li>
              ))}
            </ul>
          )}
        </section>

        {/* Password */}
        <section className="card" aria-labelledby="pw-title">
          <div className="card-head">
            <div>
              <h2 id="pw-title"><Lock size={18} aria-hidden /> Admin password</h2>
              <p>Changing it signs out every other browser.</p>
            </div>
          </div>
          <PasswordChangeForm />
        </section>
      </div>

      <div className="stack">
        {/* Holidays */}
        <section className="card" id="holidays" aria-labelledby="hol-title">
          <div className="card-head">
            <div>
              <h2 id="hol-title"><CalendarDays size={18} aria-hidden /> Holidays</h2>
              <p>Holidays are never charged as leave. Changes don&apos;t alter leave already recorded.</p>
            </div>
          </div>
          <form onSubmit={submitHoliday} className="form-grid" style={{ marginBottom: '1rem' }}>
            <Field label="Holiday name" htmlFor="hol-name" required>
              <input id="hol-name" className="input" value={holiday.title} onChange={(e) => setHoliday((h) => ({ ...h, title: e.target.value }))} placeholder="e.g. Eid-ul-Fitr" disabled={isPending} required />
            </Field>
            <div className="form-grid cols-2">
              <Field label="From" htmlFor="hol-start" required>
                <input id="hol-start" className="input" type="date" value={holiday.start_date} onChange={(e) => setHoliday((h) => ({ ...h, start_date: e.target.value, end_date: h.end_date && h.end_date < e.target.value ? e.target.value : h.end_date }))} disabled={isPending} required />
              </Field>
              <Field label="To" htmlFor="hol-end" hint="Leave empty for one day.">
                <input id="hol-end" className="input" type="date" value={holiday.end_date} min={holiday.start_date} onChange={(e) => setHoliday((h) => ({ ...h, end_date: e.target.value }))} disabled={isPending} aria-describedby="hol-end-hint" />
              </Field>
            </div>
            <div><button type="submit" className="btn btn-secondary" disabled={isPending || !holiday.title || !holiday.start_date}><Plus size={16} aria-hidden /> Add holiday</button></div>
          </form>
          {holidays.length === 0 ? (
            <EmptyState title="No holidays yet">Add public holidays so they aren&apos;t charged as leave.</EmptyState>
          ) : (
            <div className="table-wrap table-scroll">
              <table className="table">
                <tbody>
                  {holidays.map((h) => (
                    <tr key={h.id} className={h.end_date < today ? 'locked' : undefined}>
                      <td className="primary-cell">{h.title}</td>
                      <td className="nowrap">{formatDisplayRange(h.start_date, h.end_date)}</td>
                      <td className="right">
                        <button
                          type="button"
                          className="icon-btn danger"
                          aria-label={`Delete holiday ${h.title}`}
                          disabled={isPending}
                          onClick={async () => {
                            if (await confirm({ title: `Delete "${h.title}"?`, message: 'Leave already recorded over these dates keeps its current day count.', confirmText: 'Delete holiday', isDanger: true })) {
                              run(() => deleteHoliday(h.id), `Deleted "${h.title}".`);
                            }
                          }}
                        >
                          <Trash2 size={15} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Departments */}
        <section className="card" aria-labelledby="dept-title">
          <div className="card-head"><h2 id="dept-title"><Briefcase size={18} aria-hidden /> Departments</h2></div>
          <ul style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.9rem' }}>
            {departments.map((d) => (
              <li key={d.id} className="badge" style={{ padding: '0.25rem 0.3rem 0.25rem 0.65rem', fontSize: '0.85rem' }}>
                {d.name} <span className="subtle num">({d.employees})</span>
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 22, height: 22 }}
                  aria-label={`Delete department ${d.name}`}
                  title={d.employees > 0 ? 'Move its employees to another department first' : 'Delete'}
                  disabled={isPending || d.employees > 0}
                  onClick={() => run(() => deleteDepartment(d.id), `Deleted "${d.name}".`)}
                >
                  <X size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={submitDept} style={{ display: 'flex', gap: '0.5rem' }}>
            <label htmlFor="dept-name" className="sr-only">New department name</label>
            <input id="dept-name" className="input" value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="New department, e.g. Science" disabled={isPending} />
            <button type="submit" className="btn btn-secondary" disabled={isPending || !deptName.trim()}><Plus size={16} aria-hidden /> Add</button>
          </form>
        </section>

        <BackupCopiesCard view={backupCopies} />

        {/* Backups */}
        <section className="card" aria-labelledby="backup-title">
          <div className="card-head">
            <div>
              <h2 id="backup-title"><Database size={18} aria-hidden /> Quick restore points</h2>
              <p>Database-only snapshots inside Chuti&apos;s data folder, saved on start-up and every 12 hours. The latest 30 are kept.</p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" disabled={isPending} onClick={() => run(() => createBackupNow(), 'Backup saved.', () => router.refresh())}>
              <HardDriveDownload size={14} aria-hidden /> Back up now
            </button>
          </div>
          {backups.length === 0 ? (
            <EmptyState title="No backups yet" />
          ) : (
            <div className="table-wrap table-scroll">
              <table className="table">
                <thead><tr><th>Saved</th><th>Kind</th><th className="num">Size</th><th className="right"><span className="sr-only">Restore</span></th></tr></thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.name}>
                      <td className="nowrap">{new Date(b.mtime).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td>{BACKUP_KIND_LABEL[b.kind]}</td>
                      <td className="num">{formatSize(b.size)}</td>
                      <td className="right">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRestore(b)} disabled={isPending}>
                          <RotateCcw size={14} aria-hidden /> Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Data health */}
        <section className="card" aria-labelledby="health-title">
          <div className="card-head">
            <div>
              <h2 id="health-title"><Scale size={18} aria-hidden /> Balance check</h2>
              <p>Recalculates every balance from the leave records and compares it with the stored total.</p>
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => runCheck(false)} disabled={isPending}>Check balances</button>
          {drift && (
            <div style={{ marginTop: '0.9rem' }} className="form-grid">
              {drift.length === 0 ? (
                <Alert tone="success" live>All balances match the leave records.</Alert>
              ) : (
                <>
                  <Alert tone="warning" live>{drift.length} stored value{drift.length === 1 ? '' : 's'} differ from the leave records.</Alert>
                  <div className="table-wrap table-scroll">
                    <table className="table">
                      <thead><tr><th>Employee</th><th>Type</th><th className="num">Stored</th><th className="num">From records</th></tr></thead>
                      <tbody>
                        {drift.map((d, i) => (
                          <tr key={i}>
                            <td>{d.employeeName}</td>
                            <td>{d.leaveType} {d.field === 'encashed_days' ? '(encashed)' : '(used)'}</td>
                            <td className="num">{d.stored}</td>
                            <td className="num"><strong>{d.expected}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div><button type="button" className="btn btn-primary" onClick={() => runCheck(true)} disabled={isPending}>Fix {drift.length} value{drift.length === 1 ? '' : 's'}</button></div>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      <Modal isOpen={yearOpen} onClose={() => setYearOpen(false)} labelledBy={yearTitle} maxWidth="620px" locked={isPending}>
        <form onSubmit={submitYear} noValidate>
          <DialogHeader id={yearTitle} title="Close the leave year" description="A backup is saved first. This cannot be undone except by restoring that backup." onClose={() => setYearOpen(false)} />
          <div className="form-grid">
            {yearError && <Alert tone="danger" live>{yearError}</Alert>}
            <div className="form-grid cols-2">
              <Field label="New leave year starts" htmlFor="new_year_start" required hint="Leave recorded from this date counts toward the new year.">
                <input id="new_year_start" className="input" type="date" value={yearForm.new_year_start} onChange={(e) => setYearForm((f) => ({ ...f, new_year_start: e.target.value }))} disabled={isPending} aria-describedby="new_year_start-hint" />
              </Field>
              <Field label="EL carry-forward cap" htmlFor="year_cap" required>
                <input
                  id="year_cap"
                  className="input num"
                  type="number"
                  min={0}
                  step={0.5}
                  value={yearForm.el_carry_cap}
                  onChange={(e) => setYearForm((f) => ({ ...f, el_carry_cap: e.target.value }))}
                  onBlur={() => loadYearPreview(Number(yearForm.el_carry_cap) || 0)}
                  disabled={isPending}
                />
              </Field>
            </div>
            {yearPreview && (
              <>
                <Alert tone="info">
                  {yearPreview.employees} active employee{yearPreview.employees === 1 ? '' : 's'} will carry {formatDays(yearPreview.carriedTotal)} of EL forward in total. Unused CL, SL and ML lapse.
                </Alert>
                <div className="table-wrap table-scroll">
                  <table className="table">
                    <thead><tr><th>Employee</th><th className="num">EL left now</th><th className="num">Carried</th></tr></thead>
                    <tbody>
                      {yearPreview.rows.map((r) => (
                        <tr key={r.employeeCode}><td>{r.name}<span className="sub">{r.employeeCode}</span></td><td className="num">{r.elRemaining}</td><td className="num"><strong>{r.carried}</strong></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <Field label={<>Type <code>CLOSE</code> to confirm</>} htmlFor="year_confirm" required>
              <input id="year_confirm" className="input" value={yearForm.confirm} onChange={(e) => setYearForm((f) => ({ ...f, confirm: e.target.value }))} autoComplete="off" disabled={isPending} />
            </Field>
          </div>
          <div className="form-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setYearOpen(false)} disabled={isPending}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={isPending || yearForm.confirm !== 'CLOSE' || !yearForm.new_year_start}>{isPending ? 'Working…' : 'Close leave year'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
