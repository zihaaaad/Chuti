'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { CalendarRange, Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import LeaveTypeBadge from '@/components/LeaveTypeBadge';
import { useLeaveTypes } from '@/context/LeaveTypesContext';
import type { LedgerRow, PayrollRow } from '@/lib/reports';
import type { ReportColumn } from '@/lib/report-params';
import { formatDisplayRange } from '@/lib/domain/dates';
import { downloadCsv } from '@/lib/download';

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
  columns: ReportColumn[];
}

export default function ReportsClient(props: Props) {
  const { instituteName, month, tab, departmentId, employeeId, leaveType, departments, employees, ledger, payroll, columns } = props;
  const allTypes = useLeaveTypes();
  const typeLabel = (code: string) => allTypes.find((t) => t.code === code)?.label ?? code;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const queryFor = (changes: Record<string, string> = {}) => {
    const next = { month, tab, dept: departmentId ? String(departmentId) : '', emp: employeeId ? String(employeeId) : '', type: leaveType, ...changes };
    return new URLSearchParams(Object.entries(next).filter(([, v]) => v)).toString();
  };
  const setParam = (changes: Record<string, string>) => {
    startTransition(() => router.replace(`${pathname}?${queryFor(changes)}`, { scroll: false }));
  };

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const deptName = departments.find((d) => d.id === departmentId)?.name;
  const empName = employees.find((e) => e.id === employeeId)?.name;
  const filterSummary = [monthLabel, deptName && `Department: ${deptName}`, empName && `Employee: ${empName}`, tab === 'ledger' && leaveType && `Type: ${typeLabel(leaveType)}`].filter(Boolean).join(' · ');


  const exportCsv = () => {
    if (tab === 'ledger') {
      downloadCsv(`Leave_Ledger_${month}.csv`, [
        ['Employee ID', 'Name', 'Department', 'Leave type', 'Start', 'End', 'Days in month', 'Total days', 'Reason', 'Remarks'],
        ...ledger.map((r) => [r.code, r.name, r.department, r.leaveType, r.start, r.end, r.daysInMonth, r.totalDays, r.reason, r.remarks]),
      ]);
    } else {
      downloadCsv(`Payroll_Summary_${month}.csv`, [
        ['Employee ID', 'Name', 'Department', ...columns.map((c) => c.short), 'Total leave', 'Unpaid days', 'Late arrivals', 'CL cut for lates', 'Paid days', 'Days in month'],
        ...payroll.map((r) => [r.code, r.name, r.department, ...columns.map((c) => r.days[c.code] ?? 0), r.totalLeave, r.unpaidDays, r.lates, r.lateCut, r.paidDays, r.monthDays]),
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
                {allTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
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
          <button type="button" className="btn btn-secondary" onClick={exportCsv}><Download size={16} aria-hidden /> CSV</button>
          {/* A plain link: the browser downloads the file with the session cookie. */}
          <a className="btn btn-primary" href={`/api/export/report?${queryFor()}`} download>
            <FileSpreadsheet size={16} aria-hidden /> Export Excel
          </a>
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
                  {columns.map((c) => <th key={c.code} className="num" title={c.label}>{c.short}</th>)}
                  <th className="num">Total</th><th className="num">Lates</th><th className="num">CL cut</th><th className="num">Paid days</th>
                </tr>
              </thead>
              <tbody>
                {payroll.length === 0 ? (
                  <tr><td colSpan={6 + columns.length}><EmptyState title={`No leave or late arrivals recorded in ${monthLabel}`}>Everyone is paid for the full month.</EmptyState></td></tr>
                ) : (
                  payroll.map((r) => (
                    <tr key={r.employeeId}>
                      <td className="primary-cell">{r.name}<span className="sub">{r.code}</span></td>
                      <td>{r.department}</td>
                      {columns.map((c) => {
                        const d = r.days[c.code] ?? 0;
                        return (
                          <td key={c.code} className="num" style={!c.isPaid && d > 0 ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>
                            {d || <span className="subtle">0</span>}
                          </td>
                        );
                      })}
                      <td className="num"><strong>{r.totalLeave}</strong></td>
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
            Paid days = calendar days in the month minus unpaid leave ({columns.filter((c) => !c.isPaid).map((c) => c.short).join(', ') || 'none'}) in that month. Leave that spans two months is split between them.
          </p>
        </div>
      )}

      <div className="print-only print-footer">
        <div className="signatures"><div>Prepared by (HR)</div><div>Checked by (Accounts)</div><div>Approved by</div></div>
      </div>
    </div>
  );
}
