'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { addLateArrival, deleteLateArrival, getLateMonth, type LateArrivalEntry } from '@/app/actions/attendance';
import { useToast } from '@/context/ToastContext';
import EmployeePicker, { type PickerEmployee } from '@/components/EmployeePicker';
import { Field, formatDays } from '@/components/ui';
import { formatDisplayDate } from '@/lib/domain/dates';

interface Props {
  employees: PickerEmployee[];
  today: string;
  threshold: number;
}

export default function QuickLateForm({ employees, today, threshold }: Props) {
  const { showToast } = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(today);
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [month, setMonth] = useState<{ entries: LateArrivalEntry[]; undatedCount: number; deducted: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  const monthKey = date.slice(0, 7);
  const load = useCallback(async () => {
    if (!employeeId) return setMonth(null);
    const res = await getLateMonth(Number(employeeId), monthKey);
    setMonth(res.success ? res.data : null);
  }, [employeeId, monthKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const selected = employees.find((x) => String(x.id) === employeeId);
  const count = month ? month.entries.length + month.undatedCount : 0;
  const untilNextCut = threshold - (count % threshold);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) return showToast('Choose an employee first.', 'error');
    const fd = new FormData();
    fd.set('employee_id', employeeId);
    fd.set('date', date);
    fd.set('minutes_late', minutes);
    fd.set('note', note);
    startTransition(async () => {
      const res = await addLateArrival(fd);
      if (res.success) {
        const s = res.data;
        showToast(
          `${selected?.name ?? 'Employee'}: late on ${formatDisplayDate(date)}. ${s.lateCount} this month, ${formatDays(s.deducted)} of CL cut${s.capped ? ' (CL used up)' : ''}.`,
          s.capped ? 'warning' : 'success',
        );
        setMinutes('');
        setNote('');
        await load();
      } else {
        showToast(res.error, 'error');
      }
    });
  };

  const remove = (entry: LateArrivalEntry) =>
    startTransition(async () => {
      const res = await deleteLateArrival(entry.id);
      showToast(res.success ? `Removed late arrival on ${formatDisplayDate(entry.date)}.` : res.error, res.success ? 'success' : 'error');
      await load();
    });

  return (
    <form onSubmit={onSubmit} className="form-grid">
      <Field label="Employee" htmlFor="late-emp" required hint={selected?.cl_left != null ? `${formatDays(selected.cl_left)} of CL left` : undefined}>
        <EmployeePicker id="late-emp" employees={employees} value={employeeId} onChange={setEmployeeId} disabled={isPending} showBalances={false} describedBy="late-emp-hint" />
      </Field>
      <div className="form-grid cols-2">
        <Field label="Date" htmlFor="late-date" required>
          <input id="late-date" className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} disabled={isPending} required />
        </Field>
        <Field label="Minutes late" htmlFor="late-minutes">
          <input id="late-minutes" className="input num" type="number" min={1} max={600} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Optional" disabled={isPending} />
        </Field>
      </div>
      <Field label="Note" htmlFor="late-note">
        <input id="late-note" className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. traffic" disabled={isPending} />
      </Field>
      <button className="btn btn-primary btn-block" type="submit" disabled={isPending || !employeeId || !date}>
        {isPending ? 'Saving…' : 'Record late arrival'}
      </button>

      {employeeId && month && (
        <div aria-live="polite">
          <p className="subtle" style={{ marginBottom: '0.4rem' }}>
            {new Date(`${monthKey}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}: {count} late arrival{count === 1 ? '' : 's'}, {formatDays(month.deducted)} of CL cut.
            {count > 0 && ` ${untilNextCut} more before the next cut.`}
          </p>
          {month.entries.length > 0 && (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: 180, overflowY: 'auto' }}>
              {month.entries.map((entry) => (
                <li key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                  <span>
                    {formatDisplayDate(entry.date)}
                    {entry.minutesLate ? <span className="subtle"> · {entry.minutesLate} min</span> : null}
                    {entry.note ? <span className="subtle"> · {entry.note}</span> : null}
                  </span>
                  <button type="button" className="icon-btn danger" style={{ width: 28, height: 28 }} onClick={() => remove(entry)} disabled={isPending} aria-label={`Remove late arrival on ${formatDisplayDate(entry.date)}`}>
                    <Trash2 size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {month.undatedCount > 0 && <p className="subtle">Includes {month.undatedCount} recorded earlier as a monthly total (no dates).</p>}
        </div>
      )}
    </form>
  );
}
