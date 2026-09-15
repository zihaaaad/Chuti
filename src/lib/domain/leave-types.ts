// Leave types.
//
// Leave types are stored in the `leave_types` table and can be added by the
// admin. A few built-in types carry special rules and must always exist:
//   Casual → late arrivals cut Casual Leave
//   Earned → can be encashed and carried into the next leave year
//   LWP    → unpaid, no quota
// Codes are permanent (they are stored on every leave record and balance);
// labels, short names, colours and default quotas can be edited.

export const CASUAL = 'Casual';
export const EARNED = 'Earned';
export const LWP = 'LWP';

/** Encashment is stored as a leave_records row so it appears in the ledger, but it is not an absence. */
export const ENCASHMENT_TYPE = 'Earned (Encashed)';

/** Types without a quota get this sentinel allocation so balance maths stays uniform. */
export const UNLIMITED_ALLOCATION = 9999;

export const TONES = ['green', 'purple', 'blue', 'pink', 'red', 'amber', 'teal', 'slate'] as const;
export type Tone = (typeof TONES)[number];

export interface LeaveTypeDef {
  code: string;
  label: string;
  short: string;
  defaultAllocation: number;
  hasQuota: boolean;
  isPaid: boolean;
  tone: Tone;
  sortOrder: number;
  active: boolean;
  builtin: boolean;
}

/** Built-in types, used to seed the table and as a fallback before it exists. */
export const BUILTIN_LEAVE_TYPES: readonly LeaveTypeDef[] = [
  { code: CASUAL, label: 'Casual Leave', short: 'CL', defaultAllocation: 10, hasQuota: true, isPaid: true, tone: 'green', sortOrder: 10, active: true, builtin: true },
  { code: 'Sick', label: 'Sick Leave', short: 'SL', defaultAllocation: 14, hasQuota: true, isPaid: true, tone: 'purple', sortOrder: 20, active: true, builtin: true },
  { code: EARNED, label: 'Earned Leave', short: 'EL', defaultAllocation: 15, hasQuota: true, isPaid: true, tone: 'blue', sortOrder: 30, active: true, builtin: true },
  { code: 'Maternity', label: 'Maternity Leave', short: 'ML', defaultAllocation: 0, hasQuota: true, isPaid: true, tone: 'pink', sortOrder: 40, active: true, builtin: true },
  { code: LWP, label: 'Leave Without Pay', short: 'LWP', defaultAllocation: 0, hasQuota: false, isPaid: false, tone: 'red', sortOrder: 90, active: true, builtin: true },
];

/** Types whose rules the app depends on: they can be renamed but never removed or deactivated. */
export const PROTECTED_CODES: readonly string[] = [CASUAL, EARNED, LWP];

const ENCASHMENT_INFO: LeaveTypeDef = {
  code: ENCASHMENT_TYPE, label: 'Earned Leave Encashed', short: 'EL$', defaultAllocation: 0,
  hasQuota: false, isPaid: true, tone: 'amber', sortOrder: 999, active: false, builtin: true,
};

/** Display info for any code, including encashment entries and types that no longer exist. */
export function leaveTypeInfo(types: readonly LeaveTypeDef[], code: string): LeaveTypeDef {
  if (code === ENCASHMENT_TYPE) return ENCASHMENT_INFO;
  return (
    types.find((t) => t.code === code) ??
    BUILTIN_LEAVE_TYPES.find((t) => t.code === code) ?? {
      code, label: code, short: code.slice(0, 4).toUpperCase(), defaultAllocation: 0,
      hasQuota: false, isPaid: true, tone: 'slate', sortOrder: 999, active: false, builtin: false,
    }
  );
}

/** Turns a label into a permanent code: letters, digits and spaces only, max 40 characters. */
export function codeFromLabel(label: string): string {
  return label
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}
