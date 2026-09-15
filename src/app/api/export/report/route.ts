import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { readLeaveTypes } from '@/lib/leave-type-store';
import { parseReportParams, reportColumns } from '@/lib/report-params';
import { buildMonthlyReport } from '@/lib/reports';
import { buildXlsx, type Sheet } from '@/lib/xlsx';

// Monthly report as an Excel workbook: one sheet for the payroll summary and
// one for the leave ledger, built from the same data as the Reports page.
export async function GET(request: NextRequest) {
  if (!(await verifySession())) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const db = await getDb();
  const [settings, leaveTypes] = await Promise.all([getSettings(), readLeaveTypes(db)]);
  const params = parseReportParams((k) => request.nextUrl.searchParams.get(k) ?? '', leaveTypes);
  const report = await buildMonthlyReport(
    db,
    params,
    leaveTypes.map((t) => t.code),
    leaveTypes.filter((t) => !t.isPaid).map((t) => t.code),
  );
  const columns = reportColumns(leaveTypes, report.payroll);
  const label = (code: string) => leaveTypes.find((t) => t.code === code)?.label ?? code;

  const monthLabel = new Date(`${params.month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const filterLines: string[] = [];
  if (params.departmentId) {
    const d = await db.get<{ name: string }>('SELECT name FROM departments WHERE id = ?', params.departmentId);
    if (d) filterLines.push(`Department: ${d.name}`);
  }
  if (params.employeeId) {
    const e = await db.get<{ name: string; employee_id: string }>('SELECT name, employee_id FROM employees WHERE id = ?', params.employeeId);
    if (e) filterLines.push(`Employee: ${e.name} (${e.employee_id})`);
  }
  const generated = `Generated ${new Date().toLocaleString('en-GB')}`;

  const payrollSheet: Sheet = {
    name: 'Payroll summary',
    title: [settings.instituteName, `Payroll attendance summary · ${monthLabel}`, [...filterLines, generated].join(' · ')],
    columns: [
      { header: 'Employee ID', width: 14, type: 'text' },
      { header: 'Name', width: 26 },
      { header: 'Department', width: 20 },
      ...columns.map((c) => ({ header: `${c.label} (${c.short})`, width: 12, type: 'number' as const })),
      { header: 'Total leave', width: 12, type: 'number' },
      { header: 'Unpaid days', width: 12, type: 'number' },
      { header: 'Late arrivals', width: 12, type: 'number' },
      { header: 'CL cut for lates', width: 14, type: 'number' },
      { header: 'Paid days', width: 11, type: 'number' },
      { header: 'Days in month', width: 13, type: 'number' },
    ],
    rows: report.payroll.map((r) => [
      r.code, r.name, r.department,
      ...columns.map((c) => r.days[c.code] ?? 0),
      r.totalLeave, r.unpaidDays, r.lates, r.lateCut, r.paidDays, r.monthDays,
    ]),
  };

  const ledgerSheet: Sheet = {
    name: 'Leave ledger',
    title: [
      settings.instituteName,
      `Leave ledger · ${monthLabel}`,
      [...filterLines, params.leaveType ? `Type: ${label(params.leaveType)}` : '', generated].filter(Boolean).join(' · '),
    ],
    columns: [
      { header: 'Employee ID', width: 14, type: 'text' },
      { header: 'Name', width: 26 },
      { header: 'Department', width: 20 },
      { header: 'Leave type', width: 18 },
      { header: 'Start', width: 12, type: 'text' },
      { header: 'End', width: 12, type: 'text' },
      { header: 'Days in month', width: 13, type: 'number' },
      { header: 'Total days', width: 11, type: 'number' },
      { header: 'Reason', width: 36 },
      { header: 'Remarks', width: 30 },
    ],
    rows: report.ledger.map((r) => [r.code, r.name, r.department, label(r.leaveType), r.start, r.end, r.daysInMonth, r.totalDays, r.reason, r.remarks]),
  };

  const sheets = params.tab === 'payroll' ? [payrollSheet, ledgerSheet] : [ledgerSheet, payrollSheet];
  const buffer = await buildXlsx(sheets);
  const filename = `Chuti_${params.tab === 'payroll' ? 'Payroll' : 'Leave'}_Report_${params.month}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
