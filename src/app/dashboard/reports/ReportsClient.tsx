'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { CalendarRange, Download, FileText, Printer } from 'lucide-react';
import { EmptyState, LeaveTypeBadge } from '@/components/ui';
import { LEAVE_TYPES } from '@/lib/domain/leave-types';
import { formatDisplayRange } from '@/lib/domain/dates';
import { downloadCsv } from '@/lib/download';

export interface LedgerRow {
  id: number;
  employeeId: number;
  code: string;
  name: string;
  department: string;
  leaveType: string;
  start: string;
  end: string;
  totalDays: number;
  daysInMonth: number;
  reason: string;
  remarks: string;
}

export interface PayrollRow {
  employeeId: number;
  code: string;
  name: string;
  department: string;
  Casual: number;
  Sick: number;
  Earned: number;
  Maternity: number;
  LWP: number;
  lates: number;
  lateCut: number;
  paidDays: number;
  monthDays: number;
}

interface Props {
  instituteName: string;
  month: string;
  tab: 'ledger' | 'payroll';
  departmentId: number | null;
  employeeId: number | null;
  leaveType: string;
  departments: { id: number; name: string }[];
  employees: { id: number; name: string; employee_id: string }[];
  ledger: LedgerRow[];
  payroll: PayrollRow[];
}

export default function ReportsClient(props: Props) {
  const { instituteName, month, tab, departmentId, employeeId, leaveType, departments, employees, ledger, payroll } = props;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const setParam = (changes: Record<string, string>) => {
    const next = { month, tab, dept: departmentId ? String(departmentId) : '', emp: employeeId ? String(employeeId) : '', type: leaveType, ...changes };
    const params = new URLSearchParams(Object.entries(next).filter(([, v]) => v));
    startTransition(() => router.replace(`${pathname}?${params}`, { scroll: false }));
  };

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const deptName = departments.find((d) => d.id === departmentId)?.name;
  const empName = employees.find((e) => e.id === employeeId)?.name;
  const filterSummary = [monthLabel, deptName && `Department: ${deptName}`, empName && `Employee: ${empName}`, tab === 'ledger' && leaveType && `Type: ${leaveType}`].filter(Boolean).join(' · ');

  const quotaTypes = LEAVE_TYPES.map((t) => t.code);
  const totalOf = (r: PayrollRow) => quotaTypes.reduce((s, t) => s + r[t], 0);

  const exportCsv = () => {
    if (tab === 'ledger') {
      downloadCsv(`Leave_Ledger_${month}.csv`, [
        ['Employee ID', 'Name', 'Department', 'Leave type', 'Start', 'End', 'Days in month', 'Total days', 'Reason', 'Remarks'],
        ...ledger.map((r) => [r.code, r.name, r.department, r.leaveType, r.start, r.end, r.daysInMonth, r.totalDays, r.reason, r.remarks]),
      ]);
    } else {
      downloadCsv(`Payroll_Summary_${month}.csv`, [
        ['Employee ID', 'Name', 'Department', 'CL', 'SL', 'EL', 'ML', 'LWP', 'Total leave', 'Late arrivals', 'CL cut for lates', 'Paid days', 'Days in month'],
        ...payroll.map((r) => [r.code, r.name, r.department, r.Casual, r.Sick, r.Earned, r.Maternity, r.LWP, totalOf(r), r.lates, r.lateCut, r.paidDays, r.monthDays]),
      ]);
    }
  };

  return (
    <div aria-busy={isPending}>
      <div className="print-only print-header">
        <h1>{instituteName}</h1>
        <h2>{tab === 'ledger' ? 'Leave ledger' : 'Payroll attendance summary'}</h2>
        <p>{filterSummary} · printed {new Date().toLocaleString('en-GB')}</p>
      </div>

      <div className="card no-print" style={{ marginBottom: '1rem' }}>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div className="field">
            <label className="field-label" htmlFor="rep-month">Month</label>
            <input id="rep-month" className="input" type="month" value={month} onChange={(e) => e.target.value && setParam({ month: e.target.value })} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rep-dept">Department</label>
            <select id="rep-dept" className="select" value={departmentId ?? ''} onChange={(e) => setParam({ dept: e.target.value })}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rep-emp">Employee</label>
            <select id="rep-emp" className="select" value={employeeId ?? ''} onChange={(e) => setParam({ emp: e.target.value })}>
              <option value="">All employees</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.employee_id})</option>)}
            </select>
          </div>
          {tab === 'ledger' && (
            <div className="field">
              <label className="field-label" htmlFor="rep-type">Leave type</label>
              <select id="rep-type" className="select" value={leaveType} onChange={(e) => setParam({ type: e.target.value })}>
                <option value="">All types</option>
                {LEAVE_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar no-print" style={{ marginBottom: 0 }}>
        <div className="tabs" role="tablist" style={{ marginBottom: 0, border: 'none' }}>
          <button type="button" role="tab" className="tab" aria-selected={tab === 'ledger'} onClick={() => setParam({ tab: 'ledger' })}>
            <FileText size={16} aria-hidden /> Leave ledger
          </button>
          <button type="button" role="tab" className="tab" aria-selected={tab === 'payroll'} onClick={() => setParam({ tab: 'payroll' })}>
            <CalendarRange size={16} aria-hidden /> Payroll summary
          </button>
        </div>
        <div className="group">
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}><Printer size={16} aria-hidden /> Print</button>
          <button type="button" className="btn btn-primary" onClick={exportCsv}><Download size={16} aria-hidden /> Export CSV</button>
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: '1rem' }} className="no-print" />

      {tab === 'ledger' ? (
        <div className="table-wrap" role="tabpanel">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th><th>Department</th><th>Type</th><th>Period</th>
                <th className="num" title="Days of this leave that fall in the selected month">Days in {monthLabel.split(' ')[0]}</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr><td colSpan={6}><EmptyState title={`No leave recorded in ${monthLabel}`} /></td></tr>
              ) : (
                ledger.map((r) => (
                  <tr key={r.id}>
                    <td className="primary-cell">{r.name}<span className="sub">{r.code}</span></td>
                    <td>{r.department}</td>
                    <td><LeaveTypeBadge type={r.leaveType} /></td>
                    <td className="nowrap">{formatDisplayRange(r.start, r.end)}</td>
                    <td className="num">
                      {r.daysInMonth}
                      {r.daysInMonth !== r.totalDays && <span className="sub">of {r.totalDays}</span>}
                    </td>
                    <td>{r.reason}{r.remarks && <span className="sub">{r.remarks}</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="tabpanel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th><th>Department</th>
                  {LEAVE_TYPES.map((t) => <th key={t.code} className="num" title={t.label}>{t.short}</th>)}
                  <th className="num">Total</th><th className="num">Lates</th><th className="num">CL cut</th><th className="num">Paid days</th>
                </tr>
              </thead>
              <tbody>
                {payroll.length === 0 ? (
                  <tr><td colSpan={11}><EmptyState title={`No leave or late arrivals recorded in ${monthLabel}`}>Everyone is paid for the full month.</EmptyState></td></tr>
                ) : (
                  payroll.map((r) => (
                    <tr key={r.employeeId}>
                      <td className="primary-cell">{r.name}<span className="sub">{r.code}</span></td>
                      <td>{r.department}</td>
                      {LEAVE_TYPES.map((t) => (
                        <td key={t.code} className="num" style={t.code === 'LWP' && r.LWP > 0 ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>
                          {r[t.code] || <span className="subtle">0</span>}
                        </td>
                      ))}
                      <td className="num"><strong>{totalOf(r)}</strong></td>
                      <td className="num">{r.lates}</td>
                      <td className="num" style={r.lateCut > 0 ? { color: 'var(--warning)', fontWeight: 700 } : undefined}>{r.lateCut}</td>
                      <td className="num cell-highlight">{r.paidDays} / {r.monthDays}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="subtle" style={{ marginTop: '0.5rem' }}>
            Paid days = calendar days in the month minus unpaid leave (LWP) in that month. Leave that spans two months is split between them.
          </p>
        </div>
      )}

      <div className="print-only print-footer">
        <div className="signatures"><div>Prepared by (HR)</div><div>Checked by (Accounts)</div><div>Approved by</div></div>
      </div>
    </div>
  );
}
