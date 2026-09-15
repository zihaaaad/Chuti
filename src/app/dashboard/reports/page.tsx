import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { getLeaveTypes } from '@/lib/leave-type-store';
import { parseReportParams, reportColumns } from '@/lib/report-params';
import { buildMonthlyReport } from '@/lib/reports';
import { PageHeader } from '@/components/ui';
import ReportsClient from './ReportsClient';

export const metadata: Metadata = { title: 'Reports' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const leaveTypes = await getLeaveTypes();
  const params = parseReportParams((k) => (typeof sp[k] === 'string' ? (sp[k] as string) : ''), leaveTypes);

  const db = await getDb();
  const [settings, departments, employees, report] = await Promise.all([
    getSettings(),
    db.all<{ id: number; name: string }[]>('SELECT id, name FROM departments ORDER BY name'),
    db.all<{ id: number; name: string; employee_id: string }[]>('SELECT id, name, employee_id FROM employees ORDER BY name COLLATE NOCASE'),
    buildMonthlyReport(
      db,
      params,
      leaveTypes.map((t) => t.code),
      leaveTypes.filter((t) => !t.isPaid).map((t) => t.code),
    ),
  ]);

  return (
    <>
      <PageHeader title="Reports" description="Monthly leave ledger and payroll attendance summary. Print as A4 landscape or export to Excel." />
      <ReportsClient
        instituteName={settings.instituteName}
        month={params.month}
        tab={params.tab}
        departmentId={params.departmentId}
        employeeId={params.employeeId}
        leaveType={params.leaveType}
        departments={departments}
        employees={employees}
        ledger={report.ledger}
        payroll={report.payroll}
        columns={reportColumns(leaveTypes, report.payroll)}
      />
    </>
  );
}
