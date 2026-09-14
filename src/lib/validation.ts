import { z } from 'zod';
import { isValidDateString, isValidMonthString, WEEKDAYS } from './domain/dates';
import { ENCASHMENT_TYPE, isLeaveType } from './domain/leave-types';
import { MIN_PASSWORD_LENGTH_CLIENT } from './constants';

// Form schemas shared by Server Actions. Messages are written for the admin
// reading them next to the field, so they say what to enter, not what failed.

const text = (label: string, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .optional()
    .transform((v) => v ?? '');

const isoDate = (label: string) =>
  z.string({ error: `${label} is required.` }).refine(isValidDateString, `${label} must be a real date (YYYY-MM-DD).`);

const id = (label: string) => z.coerce.number({ error: `Choose ${label}.` }).int().positive(`Choose ${label}.`);

const bool = z
  .union([z.literal('true'), z.literal('false'), z.literal('on'), z.boolean()])
  .optional()
  .transform((v) => v === true || v === 'true' || v === 'on');

const allocation = (fallback: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return fallback;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 365) {
        ctx.addIssue({ code: 'custom', message: 'Quotas must be between 0 and 365 days.' });
        return z.NEVER;
      }
      return Math.round(n * 2) / 2;
    });

export const employeeSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  employee_id: text('Employee ID', 50),
  name: text('Full name', 100),
  designation: text('Designation', 100),
  department: text('Department', 100),
  joining_date: isoDate('Joining date'),
  phone: optionalText('Phone number', 20),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address, or leave it blank.'),
  status: z.enum(['Active', 'Resigned', 'Terminated']).optional().default('Active'),
  cl_allocated: allocation(10),
  sl_allocated: allocation(14),
  el_allocated: allocation(15),
  ml_allocated: allocation(0),
});

export const leaveSchema = z
  .object({
    id: z.coerce.number().int().positive().optional(),
    employee_id: id('an employee'),
    leave_type: z.string().refine(isLeaveType, 'Choose a leave type.'),
    start_date: isoDate('Start date'),
    end_date: z.string().optional(),
    is_half_day: bool,
    reason: text('Reason', 2000),
    remarks: optionalText('Remarks', 2000),
    delete_attachment: bool,
  })
  .transform((v) => ({ ...v, end_date: v.is_half_day ? v.start_date : (v.end_date ?? '') }))
  .superRefine((v, ctx) => {
    if (!isValidDateString(v.end_date)) {
      ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'End date must be a real date (YYYY-MM-DD).' });
    } else if (v.end_date < v.start_date) {
      ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'End date cannot be before the start date.' });
    }
  });

export const leavePreviewSchema = z.object({
  employee_id: z.coerce.number().int().positive().optional(),
  leave_type: z.string().refine((v) => isLeaveType(v) || v === ENCASHMENT_TYPE),
  start_date: isoDate('Start date'),
  end_date: isoDate('End date'),
  is_half_day: z.boolean(),
  ignore_record_id: z.number().int().positive().optional(),
});

export const encashmentSchema = z.object({
  employee_id: id('an employee'),
  encash_days: z.coerce
    .number({ error: 'Enter the number of days.' })
    .positive('Enter at least 0.5 days.')
    .max(365, 'Encashment cannot exceed 365 days.')
    .refine((n) => Number.isInteger(n * 2), 'Days must be in steps of 0.5.'),
  remarks: optionalText('Remarks', 2000),
});

export const lateSchema = z.object({
  employee_id: id('an employee'),
  month_year: z.string().refine(isValidMonthString, 'Choose a month.'),
  late_count: z.coerce.number({ error: 'Enter the number of late arrivals.' }).int('Use a whole number.').min(0, 'Late arrivals cannot be negative.').max(31, 'A month has at most 31 working days.'),
});

export const settingsSchema = z.object({
  institute_name: text('Organisation name', 200),
  weekend_days: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    )
    .refine((days) => days.every((d) => (WEEKDAYS as readonly string[]).includes(d)), 'Weekend days must be full weekday names.')
    .refine((days) => days.length < 7, 'At least one day of the week must be a working day.'),
  sandwich_rule: bool,
  late_cl_threshold: z.coerce.number().int('Use a whole number.').min(1, 'Use at least 1 late arrival.').max(999),
  el_carry_cap: z.coerce.number().min(0, 'Carry-forward cap cannot be negative.').max(365),
});

export const passwordChangeSchema = z
  .object({
    current_password: z.string().min(1, 'Enter your current password.').max(100),
    new_password: z
      .string()
      .min(MIN_PASSWORD_LENGTH_CLIENT, `Use at least ${MIN_PASSWORD_LENGTH_CLIENT} characters.`)
      .max(100, 'Use 100 characters or fewer.'),
    confirm_password: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.new_password !== v.confirm_password) {
      ctx.addIssue({ code: 'custom', path: ['confirm_password'], message: 'The two new passwords do not match.' });
    }
    if (v.new_password === v.current_password) {
      ctx.addIssue({ code: 'custom', path: ['new_password'], message: 'Choose a password different from the current one.' });
    }
    if (v.new_password.toLowerCase() === 'admin123') {
      ctx.addIssue({ code: 'custom', path: ['new_password'], message: 'That is the published default password. Choose another.' });
    }
  });

export const holidaySchema = z
  .object({
    title: text('Holiday name', 100),
    start_date: isoDate('Start date'),
    end_date: isoDate('End date'),
  })
  .refine((v) => v.end_date >= v.start_date, { path: ['end_date'], message: 'End date cannot be before the start date.' });

export const departmentSchema = z.object({ name: text('Department name', 100) });

export const backupCopyScheduleSchema = z.object({
  enabled: bool,
  hour: z.coerce.number().int().min(0, 'Choose a time.').max(23, 'Choose a time.'),
  keep: z.coerce.number({ error: 'Enter how many copies to keep.' }).int('Use a whole number.').min(1, 'Keep at least 1 copy.').max(365, 'Keep at most 365 copies.'),
});

export const closeYearSchema = z.object({
  new_year_start: isoDate('New leave year start'),
  el_carry_cap: z.coerce.number().min(0, 'Carry-forward cap cannot be negative.').max(365),
  confirm: z.literal('CLOSE', { error: 'Type CLOSE to confirm.' }),
});
