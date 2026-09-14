import 'server-only';
import { cache } from 'react';
import type { Database } from 'sqlite';
import { getDb } from './db';
import type { LeavePolicy, Holiday } from './domain/leave-days';
import { WEEKDAYS, type Weekday } from './domain/dates';

/** Settings safe to hand to the UI. The password hash is deliberately absent. */
export interface AppSettings {
  instituteName: string;
  weekendDays: Weekday[];
  sandwichRule: boolean;
  lateThreshold: number;
  leaveYearStart: string;
  elCarryCap: number;
}

const PUBLIC_KEYS = ['institute_name', 'weekend_days', 'sandwich_rule', 'late_cl_threshold', 'leave_year_start', 'el_carry_cap'] as const;

export async function readSettings(db: Database): Promise<AppSettings> {
  const rows = await db.all<{ key: string; value: string }[]>(
    `SELECT key, value FROM system_settings WHERE key IN (${PUBLIC_KEYS.map(() => '?').join(',')})`,
    ...PUBLIC_KEYS,
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    instituteName: map.institute_name || 'Chuti Leave Management',
    weekendDays: (map.weekend_days || '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d)),
    sandwichRule: map.sandwich_rule === 'true',
    lateThreshold: Math.max(1, parseInt(map.late_cl_threshold || '3', 10) || 3),
    leaveYearStart: map.leave_year_start || '0001-01-01',
    elCarryCap: Math.max(0, parseFloat(map.el_carry_cap || '30') || 0),
  };
}

/** Per-request cached settings for Server Components. */
export const getSettings = cache(async (): Promise<AppSettings> => readSettings(await getDb()));

export async function readPolicy(db: Database, range?: { start: string; end: string }): Promise<LeavePolicy> {
  const settings = await readSettings(db);
  const holidays = range
    ? await db.all<Holiday[]>('SELECT start_date, end_date FROM holidays WHERE start_date <= ? AND end_date >= ?', range.end, range.start)
    : await db.all<Holiday[]>('SELECT start_date, end_date FROM holidays');
  return { sandwichRule: settings.sandwichRule, weekendDays: settings.weekendDays, holidays };
}

export async function setSetting(db: Database, key: string, value: string) {
  await db.run(
    'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}
