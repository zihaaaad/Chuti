'use client';

import { useEffect, useState, useTransition } from 'react';
import { getLateCount, recordLateAttendance } from '@/app/actions/leaves';
import { useToast } from '@/context/ToastContext';
import EmployeePicker, { type PickerEmployee } from '@/components/EmployeePicker';
import { Field, formatDays } from '@/components/ui';

interface Props {
  employees: PickerEmployee[];
  currentMonth: string;
  threshold: number;
}

export default function QuickLateForm({ employees, currentMonth, threshold }: Props) {
  const { showToast } = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [month, setMonth] = useState(currentMonth);
  const [count, setCount] = useState('');
  const [saved, setSaved] = useState<{ lateCount: number; deducted: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Show what is already on file: the number entered REPLACES the month's total.
  useEffect(() => {
    if (!employeeId || !month) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getLateCount(Number(employeeId), month).then((res) => {
      if (cancelled) return;
      setLoading(false);
      const value = res.success ? res.data : null;
      setSaved(value);
      setCount(value ? String(value.lateCount) : '');
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId, month]);

  const parsed = count === '' ? NaN : Number(count);
  const preview = Number.isInteger(parsed) && parsed >= 0 ? Math.floor(parsed / Math.max(1, threshold)) : null;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) return showToast('Choose an employee first.', 'error');
    const fd = new FormData();
    fd.set('employee_id', employeeId);
    fd.set('month_year', month);
    fd.set('late_count', count);
    startTransition(async () => {
      const res = await recordLateAttendance(fd);
      if (res.success) {
        const name = employees.find((x) => String(x.id) === employeeId)?.name ?? 'Employee';
        showToast(
          res.data.capped
            ? `${name}: saved. Only ${formatDays(res.data.deducted)} of CL could be cut because their CL is used up.`
            : `${name}: ${count} late arrivals saved, ${formatDays(res.data.deducted)} of CL cut.`,
          res.data.capped ? 'warning' : 'success',
        );
        setSaved({ lateCount: Number(count), deducted: res.data.deducted });
      } else {
        showToast(res.error, 'error');
      }
    });
  };

  const selected = employees.find((x) => String(x.id) === employeeId);

  return (
    <form onSubmit={onSubmit} className="form-grid">
      <Field label="Employee" htmlFor="late-emp" required hint={selected?.cl_left != null ? `${formatDays(selected.cl_left)} of CL left` : undefined}>
        <EmployeePicker id="late-emp" employees={employees} value={employeeId} onChange={setEmployeeId} disabled={isPending} showBalances={false} describedBy="late-emp-hint" />
      </Field>
      <div className="form-grid cols-2">
        <Field label="Month" htmlFor="late-month" required>
          <input id="late-month" className="input" type="month" value={month} max={currentMonth} onChange={(e) => setMonth(e.target.value)} disabled={isPending} required />
        </Field>
        <Field label="Total late arrivals" htmlFor="late-count" required>
          <input id="late-count" className="input num" type="number" min={0} max={31} step={1} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} disabled={isPending || loading} required />
        </Field>
      </div>
      {employeeId && (
        <p className="subtle" aria-live="polite">
          {loading
            ? 'Checking saved lates…'
            : saved
              ? `On file for this month: ${saved.lateCount} late arrivals, ${formatDays(saved.deducted)} CL cut. Saving replaces this total.`
              : 'Nothing recorded for this month yet.'}
          {preview !== null && !loading && ` This entry cuts ${formatDays(preview)} of CL.`}
        </p>
      )}
      <button className="btn btn-primary btn-block" type="submit" disabled={isPending || !employeeId || count === ''}>
        {isPending ? 'Saving…' : 'Save late arrivals'}
      </button>
    </form>
  );
}
