// Single source of truth for leave types. Everything that used to spell out
// 'Casual' | 'Sick' | ... by hand (form options, badges, report columns,
// balance seeding) reads from here.

export const LEAVE_TYPES = [
  { code: 'Casual', short: 'CL', label: 'Casual Leave', defaultAllocation: 10, tone: 'casual' },
  { code: 'Sick', short: 'SL', label: 'Sick Leave', defaultAllocation: 14, tone: 'sick' },
  { code: 'Earned', short: 'EL', label: 'Earned Leave', defaultAllocation: 15, tone: 'earned' },
  { code: 'Maternity', short: 'ML', label: 'Maternity Leave', defaultAllocation: 0, tone: 'maternity' },
  { code: 'LWP', short: 'LWP', label: 'Leave Without Pay', defaultAllocation: 0, tone: 'lwp' },
] as const;

export type LeaveTypeCode = (typeof LEAVE_TYPES)[number]['code'];

/** Encashment is stored as a leave_records row so it appears in the ledger, but it is not an absence. */
export const ENCASHMENT_TYPE = 'Earned (Encashed)';
export type LedgerTypeCode = LeaveTypeCode | typeof ENCASHMENT_TYPE;

/** LWP has no quota; this sentinel allocation keeps balance maths uniform. */
export const UNLIMITED_ALLOCATION = 9999;

/** Types whose quota an admin sets per employee (everything except LWP). */
export const QUOTA_LEAVE_TYPES = LEAVE_TYPES.filter((t) => t.code !== 'LWP');

export function isLeaveType(value: unknown): value is LeaveTypeCode {
  return LEAVE_TYPES.some((t) => t.code === value);
}

export function leaveTypeInfo(code: string) {
  if (code === ENCASHMENT_TYPE) {
    return { code: ENCASHMENT_TYPE, short: 'EL$', label: 'Earned Leave Encashed', defaultAllocation: 0, tone: 'encashed' } as const;
  }
  return LEAVE_TYPES.find((t) => t.code === code) ?? LEAVE_TYPES[0];
}

export function hasQuota(code: string): boolean {
  return code !== 'LWP';
}
