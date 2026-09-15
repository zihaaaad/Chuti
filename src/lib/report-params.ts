import { currentMonthLocal, isValidMonthString } from './domain/dates';
import type { LeaveTypeDef } from './domain/leave-types';
import type { PayrollRow, ReportFilters } from './reports';

export type ReportTab = 'ledger' | 'payroll';

export interface ReportParams extends ReportFilters {
  tab: ReportTab;
}

/** Reads report filters from a query string, discarding anything invalid. */
export function parseReportParams(get: (key: string) => string, leaveTypes: readonly LeaveTypeDef[]): ReportParams {
  const id = (key: string) => {
    const n = Number(get(key));
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const type = get('type');
  return {
    month: isValidMonthString(get('month')) ? get('month') : currentMonthLocal(),
    departmentId: id('dept'),
    employeeId: id('emp'),
    leaveType: leaveTypes.some((t) => t.code === type) ? type : '',
    tab: get('tab') === 'payroll' ? 'payroll' : 'ledger',
  };
}

export interface ReportColumn {
  code: string;
  label: string;
  short: string;
  isPaid: boolean;
}

/**
 * Payroll columns: every active leave type, plus switched-off types that still
 * have days in this month so historical reports stay complete.
 */
export function reportColumns(leaveTypes: readonly LeaveTypeDef[], payroll: readonly PayrollRow[]): ReportColumn[] {
  return leaveTypes
    .filter((t) => t.active || payroll.some((r) => (r.days[t.code] ?? 0) > 0))
    .map((t) => ({ code: t.code, label: t.label, short: t.short, isPaid: t.isPaid }));
}
