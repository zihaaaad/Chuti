'use server';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { Database } from 'sqlite';
import { getDb, getPaths, closeDb } from '@/lib/db';
import { loginAdmin, logoutAdmin, isAuthenticated } from '@/lib/auth';
import bcrypt from 'bcryptjs';

// ----------------------------------------------------
// HELPERS & SECURITY
// ----------------------------------------------------

// Per-device in-memory rate limiting for admin login.
//
// This app is single-admin and explicitly designed to be shared over a LAN
// (see README) — every coworker on the office Wi-Fi can reach the login
// page. A single GLOBAL failure counter would let anyone on that network
// lock out the real administrator just by typing the wrong password 10
// times. Instead we key the lockout to an anonymous, non-authenticating
// "client id" cookie issued to each browser, so one misbehaving device only
// locks itself out. This isn't bulletproof (clearing cookies resets it,
// there's no real cross-network-hop IP available on a plain `next start`
// server), but it closes the trivial one-click DoS the global counter had.
const CLIENT_ID_COOKIE = 'chuti_client_id';

interface RateLimitEntry {
  failedAttempts: number;
  lockedUntil: number;
  lastAttempt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_ENTRY_TTL_MS = 24 * 60 * 60 * 1000; // forget a device after 24h of inactivity
const RATE_LIMIT_MAX_ENTRIES = 1000; // hard cap so the map can't grow unbounded

// Periodically drop stale entries so long-running processes don't leak memory.
function pruneRateLimitMap() {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.lastAttempt > RATE_LIMIT_ENTRY_TTL_MS) {
      rateLimitMap.delete(key);
    }
  }
  while (rateLimitMap.size > RATE_LIMIT_MAX_ENTRIES) {
    const oldestKey = rateLimitMap.keys().next().value;
    if (!oldestKey) break;
    rateLimitMap.delete(oldestKey);
  }
}

async function getOrCreateClientId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(CLIENT_ID_COOKIE)?.value;
  if (existing) return existing;

  const id = crypto.randomBytes(16).toString('hex');
  cookieStore.set(CLIENT_ID_COOKIE, id, {
    httpOnly: true,
    secure: process.env.APP_FORCE_HTTPS === 'true',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/'
  });
  return id;
}

function checkRateLimit(clientId: string): { allowed: boolean; waitTimeSeconds: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(clientId);
  if (entry && entry.lockedUntil > now) {
    return { allowed: false, waitTimeSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  return { allowed: true, waitTimeSeconds: 0 };
}

function recordLoginAttempt(clientId: string, success: boolean) {
  const now = Date.now();
  pruneRateLimitMap();

  const entry = rateLimitMap.get(clientId) || { failedAttempts: 0, lockedUntil: 0, lastAttempt: now };
  entry.lastAttempt = now;

  if (success) {
    entry.failedAttempts = 0;
    entry.lockedUntil = 0;
  } else {
    entry.failedAttempts += 1;
    if (entry.failedAttempts >= 10) {
      entry.lockedUntil = now + 5 * 60 * 1000; // 5 minute lock for this device
      entry.failedAttempts = 0; // Reset attempts after locking
    }
  }

  rateLimitMap.set(clientId, entry);
}

// Helper to sanitize raw database error messages
function sanitizeError(err: any, defaultMsg: string): string {
  const msg = err.message || '';
  if (msg.toLowerCase().includes('sqlite') || msg.toLowerCase().includes('database')) {
    return defaultMsg;
  }
  return msg || defaultMsg;
}

// Leave/holiday date ranges are walked day-by-day (calculateLeaveDays,
// hasOverlapConflict). Without an upper bound, a mistyped year (e.g.
// 2026-01-01 to 2126-01-01) turns a simple form submit into a
// multi-million-iteration loop on every future overlap check for that
// employee. Cap ranges to something no real leave request would ever need.
const MAX_LEAVE_SPAN_DAYS = 366;

function exceedsMaxSpan(startDateStr: string, endDateStr: string): boolean {
  const start = parseUTCDate(startDateStr);
  const end = parseUTCDate(endDateStr);
  const spanDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1;
  return spanDays > MAX_LEAVE_SPAN_DAYS;
}

// Input length validation helper
function validateLength(val: any, max: number): boolean {
  if (val && typeof val === 'string' && val.length > max) {
    return false;
  }
  return true;
}

// Parse a leave allocation input, falling back to a default and capping at a sane ceiling
// so a stray value (e.g. copy-paste error, 1e20) can't silently corrupt balance math downstream.
function parseAllocation(raw: FormDataEntryValue | null, fallback: number, max = 365): number {
  const val = parseFloat(raw as string);
  if (isNaN(val) || val < 0) return fallback;
  return Math.min(val, max);
}

// Find a department by case-insensitive name match, creating it if it doesn't exist.
// Prevents "IT" and "it" from silently becoming two different departments.
async function findOrCreateDepartment(db: Database, rawName: string): Promise<number> {
  const name = rawName.trim();
  const existing = await db.get('SELECT id FROM departments WHERE name = ? COLLATE NOCASE', name);
  if (existing) return existing.id;
  const res = await db.run('INSERT INTO departments (name) VALUES (?)', name);
  return res.lastID!;
}

// Allowed file extensions for leave attachments — matches what the uploads route
// declares it knows how to serve (src/app/api/uploads/[filename]/route.ts).
const ALLOWED_ATTACHMENT_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx'];

function isAllowedAttachment(file: File): boolean {
  const ext = path.extname(file.name).toLowerCase();
  return ALLOWED_ATTACHMENT_EXTENSIONS.includes(ext);
}

// Date validation helper (expects YYYY-MM-DD format and valid calendar date)
function isValidDateString(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  
  if (month < 1 || month > 12) return false;
  
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return false;
  
  return true;
}

// Basic, permissive email format check (email is an optional contact field,
// not used for auth, so we don't need RFC-5322-grade strictness here).
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Helper to get local date in YYYY-MM-DD format
function getLocalTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Helper to parse a YYYY-MM-DD date string as a pure UTC Date
function parseUTCDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

// Helper to check for overlap conflicts including half-day checks
function hasOverlapConflict(
  startDateStr: string,
  endDateStr: string,
  newIsHalfDay: boolean,
  records: { id: number; start_date: string; end_date: string; actual_days: number }[],
  ignoreRecordId?: number
): boolean {
  const start = parseUTCDate(startDateStr);
  const end = parseUTCDate(endDateStr);
  
  const activeRecords = ignoreRecordId 
    ? records.filter(r => r.id !== ignoreRecordId)
    : records;
    
  const current = new Date(start);
  while (current <= end) {
    const currentStr = current.toISOString().split('T')[0];
    
    let existingLeaveOnDate = 0;
    for (const r of activeRecords) {
      if (currentStr >= r.start_date && currentStr <= r.end_date) {
        const dayWeight = r.actual_days === 0.5 ? 0.5 : 1.0;
        existingLeaveOnDate += dayWeight;
      }
    }
    
    const newDayWeight = newIsHalfDay ? 0.5 : 1.0;
    if (existingLeaveOnDate + newDayWeight > 1.0) {
      return true; // Overlap conflict found
    }
    
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return false;
}

// Asynchronous file unlinking helper to avoid blocking the event loop
async function deleteFile(filePath: string) {
  if (!filePath) return;
  const filename = path.basename(filePath.replace('/uploads/', '').replace('/api/uploads/', ''));
  const dataDir = process.env.APP_DATA_DIR || process.cwd();
  const uploadsDir = path.join(dataDir, process.env.APP_DATA_DIR ? 'uploads' : 'public/uploads');
  const fullPath = path.join(uploadsDir, filename);
  try {
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  } catch (err) {
    console.error(`Failed to delete file: ${fullPath}`, err);
  }
}

// Helper to save uploaded files asynchronously to public/uploads
async function saveFile(file: File | null): Promise<string | null> {
  if (!file || file.size === 0 || !(file instanceof File)) return null;
  if (!isAllowedAttachment(file)) return null;

  try {
    const dataDir = process.env.APP_DATA_DIR || process.cwd();
    const uploadsDir = path.join(dataDir, process.env.APP_DATA_DIR ? 'uploads' : 'public/uploads');
    if (!fs.existsSync(uploadsDir)) {
      await fs.promises.mkdir(uploadsDir, { recursive: true });
    }
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `${timestamp}_${safeName}`;
    const filePath = path.join(uploadsDir, filename);
    
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await fs.promises.writeFile(filePath, buffer);
    return `/uploads/${filename}`;
  } catch (err) {
    console.error('File saving failed:', err);
    return null;
  }
}

// ----------------------------------------------------
// 1. AUTHENTICATION ACTIONS
// ----------------------------------------------------
export async function handleLogin(prevState: any, formData: FormData) {
  const clientId = await getOrCreateClientId();

  const rateCheck = checkRateLimit(clientId);
  if (!rateCheck.allowed) {
    return { success: false, error: `Too many login failures from this device. Locked out. Please try again in ${rateCheck.waitTimeSeconds} seconds.` };
  }

  const password = formData.get('password') as string;
  if (!password) {
    return { success: false, error: 'Password is required.' };
  }

  if (!validateLength(password, 100)) {
    return { success: false, error: 'Password is too long.' };
  }

  const ok = await loginAdmin(password);
  recordLoginAttempt(clientId, ok);

  if (ok) {
    return { success: true };
  } else {
    return { success: false, error: 'Invalid admin password.' };
  }
}

export async function handleLogout() {
  await logoutAdmin();
  revalidatePath('/');
}

// ----------------------------------------------------
// 2. EMPLOYEE ACTIONS
// ----------------------------------------------------
export async function addEmployee(formData: FormData) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  // Trim free-text fields so whitespace-only differences can't create
  // visually-duplicate employees/departments or dodge exact-match checks.
  const employee_id = (formData.get('employee_id') as string || '').trim();
  const name = (formData.get('name') as string || '').trim();
  const designation = (formData.get('designation') as string || '').trim();
  const department = (formData.get('department') as string || '').trim();
  const joining_date = formData.get('joining_date') as string;
  const phone = (formData.get('phone') as string || '').trim();
  const email = (formData.get('email') as string || '').trim() || null;

  // Custom leave allocations (capped at 365 days to prevent bogus values corrupting balance math)
  const cl_allocated = parseAllocation(formData.get('cl_allocated'), 10);
  const sl_allocated = parseAllocation(formData.get('sl_allocated'), 14);
  const el_allocated = parseAllocation(formData.get('el_allocated'), 15);
  const ml_allocated = parseAllocation(formData.get('ml_allocated'), 0);

  if (!employee_id || !name || !designation || !department || !joining_date) {
    return { success: false, error: 'Please fill all required fields.' };
  }

  if (!validateLength(employee_id, 50) ||
      !validateLength(name, 100) ||
      !validateLength(designation, 100) ||
      !validateLength(department, 100) ||
      !validateLength(phone, 20) ||
      !validateLength(email, 254)) {
    return { success: false, error: 'Input fields exceed length limits.' };
  }

  if (!isValidDateString(joining_date)) {
    return { success: false, error: 'Invalid joining date format or value. Please use YYYY-MM-DD.' };
  }

  if (email && !isValidEmail(email)) {
    return { success: false, error: 'Please enter a valid email address, or leave it blank.' };
  }

  try {
    const db = await getDb();

    // Check duplicate employee_id
    const existing = await db.get('SELECT id FROM employees WHERE employee_id = ?', employee_id);
    if (existing) {
      return { success: false, error: 'Employee ID already exists.' };
    }

    // Check duplicate email (NULLs are exempt — many employees can have no email on file)
    if (email) {
      const existingEmail = await db.get('SELECT id FROM employees WHERE email = ?', email);
      if (existingEmail) {
        return { success: false, error: 'This email address is already in use by another employee.' };
      }
    }

    await db.run('BEGIN IMMEDIATE');

    const deptId = await findOrCreateDepartment(db, department);

    // Insert employee
    const result = await db.run(
      `INSERT INTO employees (employee_id, name, designation, department_id, join_date, phone, email)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [employee_id, name, designation, deptId, joining_date, phone, email]
    );

    const empId = result.lastID;

    if (empId) {
      // Seed default balances
      await db.run('INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?)', [empId, 'Casual', cl_allocated]);
      await db.run('INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?)', [empId, 'Sick', sl_allocated]);
      await db.run('INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?)', [empId, 'Earned', el_allocated]);
      await db.run('INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?)', [empId, 'Maternity', ml_allocated]);
      await db.run('INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?)', [empId, 'LWP', 9999.0]); // Leave Without Pay is effectively unlimited
    }

    await db.run('COMMIT');
    revalidatePath('/dashboard/employees');
    return { success: true };
  } catch (err: any) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch {}
    return { success: false, error: sanitizeError(err, 'Database error occurred.') };
  }
}

export async function updateEmployee(formData: FormData) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  const id = parseInt(formData.get('id') as string);
  const employee_id = (formData.get('employee_id') as string || '').trim();
  const name = (formData.get('name') as string || '').trim();
  const designation = (formData.get('designation') as string || '').trim();
  const department = (formData.get('department') as string || '').trim();
  const joining_date = formData.get('joining_date') as string;
  const phone = (formData.get('phone') as string || '').trim();
  const status = formData.get('status') as string;
  const email = (formData.get('email') as string || '').trim() || null;

  const cl_allocated = parseAllocation(formData.get('cl_allocated'), 10);
  const sl_allocated = parseAllocation(formData.get('sl_allocated'), 14);
  const el_allocated = parseAllocation(formData.get('el_allocated'), 15);
  const ml_allocated = parseAllocation(formData.get('ml_allocated'), 0);

  if (!id || !employee_id || !name || !designation || !department || !joining_date) {
    return { success: false, error: 'Please fill all required fields.' };
  }

  if (!validateLength(employee_id, 50) ||
      !validateLength(name, 100) ||
      !validateLength(designation, 100) ||
      !validateLength(department, 100) ||
      !validateLength(phone, 20) ||
      !validateLength(status, 20) ||
      !validateLength(email, 254)) {
    return { success: false, error: 'Input fields exceed length limits.' };
  }

  if (!isValidDateString(joining_date)) {
    return { success: false, error: 'Invalid joining date format or value. Please use YYYY-MM-DD.' };
  }

  if (email && !isValidEmail(email)) {
    return { success: false, error: 'Please enter a valid email address, or leave it blank.' };
  }

  try {
    const db = await getDb();

    // Check duplicate employee_id on other employees
    const existing = await db.get('SELECT id FROM employees WHERE employee_id = ? AND id != ?', [employee_id, id]);
    if (existing) {
      return { success: false, error: 'Employee ID already exists for another employee.' };
    }

    // Check duplicate email on other employees
    if (email) {
      const existingEmail = await db.get('SELECT id FROM employees WHERE email = ? AND id != ?', [email, id]);
      if (existingEmail) {
        return { success: false, error: 'This email address is already in use by another employee.' };
      }
    }

    await db.run('BEGIN IMMEDIATE');

    const deptId = await findOrCreateDepartment(db, department);

    await db.run(
      `UPDATE employees
       SET employee_id = ?, name = ?, designation = ?, department_id = ?, join_date = ?, phone = ?, status = ?, email = ?
       WHERE id = ?`,
      [employee_id, name, designation, deptId, joining_date, phone, status, email, id]
    );

    // Update allocations. Uses INSERT ... ON CONFLICT instead of a plain
    // UPDATE so that a missing balance row (e.g. an employee created before
    // a leave type existed, or restored from a partial import) gets created
    // rather than the update silently affecting 0 rows and the quota never
    // being set.
    const upsertBalance = `
      INSERT INTO leave_balances (employee_id, leave_type, allocated_days)
      VALUES (?, ?, ?)
      ON CONFLICT(employee_id, leave_type) DO UPDATE SET allocated_days = excluded.allocated_days`;
    await db.run(upsertBalance, [id, 'Casual', cl_allocated]);
    await db.run(upsertBalance, [id, 'Sick', sl_allocated]);
    await db.run(upsertBalance, [id, 'Earned', el_allocated]);
    await db.run(upsertBalance, [id, 'Maternity', ml_allocated]);
    // Ensure LWP balance also exists for employees created before this row was seeded.
    await db.run(
      `INSERT INTO leave_balances (employee_id, leave_type, allocated_days)
       VALUES (?, 'LWP', 9999.0)
       ON CONFLICT(employee_id, leave_type) DO NOTHING`,
      [id]
    );

    await db.run('COMMIT');
    revalidatePath('/dashboard/employees');
    return { success: true };
  } catch (err: any) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch {}
    return { success: false, error: sanitizeError(err, 'Database error occurred.') };
  }
}

export async function deleteEmployee(id: number) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const db = await getDb();
    
    // Fetch all attachment paths for this employee's leave records
    const records = await db.all('SELECT attachment_path FROM leave_records WHERE employee_id = ?', id);

    await db.run('BEGIN IMMEDIATE');

    // Delete employee (cascades database delete to leave_records)
    await db.run('DELETE FROM employees WHERE id = ?', id);

    await db.run('COMMIT');

    // Unlink physical attachment files from local disk (asynchronously after successful commit)
    for (const rec of records) {
      if (rec.attachment_path) {
        await deleteFile(rec.attachment_path);
      }
    }

    revalidatePath('/dashboard/employees');
    return { success: true };
  } catch (err: any) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch {}
    return { success: false, error: sanitizeError(err, 'Database error occurred.') };
  }
}

// ----------------------------------------------------
// 3. LEAVE CALCULATIONS & MANAGEMENT
// ----------------------------------------------------

// Helper: Calculate leaves days excluding weekends/holidays (or simple calendar days if sandwich applies)
export async function calculateLeaveDays(
  startDateStr: string,
  endDateStr: string,
  leaveType: string,
  isHalfDay: boolean
): Promise<number> {
  const start = parseUTCDate(startDateStr);
  const end = parseUTCDate(endDateStr);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return 0;
  }

  // Defensive guard: callers should already reject overly large ranges
  // (see exceedsMaxSpan), but never day-by-day-loop over an unbounded range.
  if (exceedsMaxSpan(startDateStr, endDateStr)) {
    return 0;
  }

  const db = await getDb();
  
  // Load settings
  const settings = await db.all('SELECT * FROM system_settings');
  const config = settings.reduce((acc: any, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});

  const sandwichRule = config['sandwich_rule'] === 'true';
  const weekendDays = (config['weekend_days'] || '').toLowerCase().split(',').map((d: string) => d.trim());

  // If sandwich rule is ON, it's just raw calendar days
  if (sandwichRule) {
    if (isHalfDay) return 0.5;
    const timeDiff = end.getTime() - start.getTime();
    return Math.floor(timeDiff / (1000 * 3600 * 24)) + 1;
  }

  // If sandwich rule is OFF, we manually exclude weekends and official holidays
  const holidays = await db.all(
    'SELECT start_date, end_date FROM holidays WHERE start_date <= ? AND end_date >= ?',
    [endDateStr, startDateStr]
  );

  const isHoliday = (date: Date): boolean => {
    const dateStr = date.toISOString().split('T')[0];
    return holidays.some(h => dateStr >= h.start_date && dateStr <= h.end_date);
  };

  const dayOfWeekMap: Record<number, string> = {
    0: 'sunday',
    1: 'monday',
    2: 'tuesday',
    3: 'wednesday',
    4: 'thursday',
    5: 'friday',
    6: 'saturday'
  };

  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const dayName = dayOfWeekMap[current.getUTCDay()];
    const isWeekend = weekendDays.includes(dayName);
    
    if (!isWeekend && !isHoliday(current)) {
      count++;
    }
    
    current.setUTCDate(current.getUTCDate() + 1);
  }

  if (isHalfDay) {
    return count > 0 ? 0.5 : 0;
  }

  return count;
}

export async function addLeaveRecord(formData: FormData) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  const employee_id = parseInt(formData.get('employee_id') as string);
  const leave_type = formData.get('leave_type') as string;
  const start_date = formData.get('start_date') as string;
  const end_date_raw = formData.get('end_date') as string;
  const reason = formData.get('reason') as string;
  const remarks = formData.get('remarks') as string;
  const is_half_day = formData.get('is_half_day') === 'true';
  const file = formData.get('attachment') as File | null;

  // Enforce server-side that end_date matches start_date if half-day
  const end_date = is_half_day ? start_date : end_date_raw;

  if (!employee_id || !leave_type || !start_date || !end_date || !reason) {
    return { success: false, error: 'All fields marked with * are required.' };
  }

  if (!validateLength(leave_type, 50) ||
      !validateLength(reason, 2000) ||
      !validateLength(remarks, 2000)) {
    return { success: false, error: 'Input fields exceed length limits.' };
  }

  if (!isValidDateString(start_date) || !isValidDateString(end_date)) {
    return { success: false, error: 'Invalid start or end date format. Please use YYYY-MM-DD.' };
  }

  if (parseUTCDate(start_date) > parseUTCDate(end_date)) {
    return { success: false, error: 'Start date cannot be after end date.' };
  }

  if (exceedsMaxSpan(start_date, end_date)) {
    return { success: false, error: `Leave date range is too large. Please limit requests to ${MAX_LEAVE_SPAN_DAYS} days or fewer.` };
  }

  if (file && file.size > 10 * 1024 * 1024) {
    return { success: false, error: 'File upload size exceeds the 10MB limit.' };
  }

  if (file && file.size > 0 && !isAllowedAttachment(file)) {
    return { success: false, error: 'Unsupported file type. Allowed: JPG, PNG, GIF, WEBP, PDF, DOC, DOCX.' };
  }

  let newSavedFile: string | null = null;

  try {
    const db = await getDb();

    // Check if employee exists and is active
    const employee = await db.get('SELECT name, status FROM employees WHERE id = ?', employee_id);
    if (!employee) {
      return { success: false, error: 'Employee not found.' };
    }
    if (employee.status !== 'Active') {
      return { success: false, error: 'Cannot record leave for inactive employee.' };
    }

    // Calculate actual leave days
    const actualDays = await calculateLeaveDays(start_date, end_date, leave_type, is_half_day);
    if (actualDays <= 0) {
      return { success: false, error: 'Calculated leave duration is 0 days. Check holiday/weekend settings.' };
    }

    // Save attachment (do this outside of the transaction since filesystem operations are slow)
    if (file && file.size > 0) {
      newSavedFile = await saveFile(file);
      if (!newSavedFile) {
        return { success: false, error: 'Failed to save attachment to server disk.' };
      }
    }

    await db.run('BEGIN IMMEDIATE');

    // Check if employee already has overlapping leave records (inside transaction to prevent race conditions)
    // Encashment log entries ('Earned (Encashed)') are bookkeeping rows, not
    // actual absences, so they must never block a real leave from being
    // recorded on the same date.
    const overlappingRecords = await db.all(
      `SELECT id, start_date, end_date, actual_days FROM leave_records
       WHERE employee_id = ?
         AND start_date <= ?
         AND end_date >= ?
         AND leave_type != 'Earned (Encashed)'`,
      [employee_id, end_date, start_date]
    );

    if (hasOverlapConflict(start_date, end_date, is_half_day, overlappingRecords)) {
      await db.run('ROLLBACK');
      if (newSavedFile) await deleteFile(newSavedFile);
      return { 
        success: false, 
        error: `Leave request overlaps with existing leave records in the selected range.` 
      };
    }

    // Check leave balance (except for LWP)
    if (leave_type !== 'LWP') {
      const balance = await db.get(
        'SELECT allocated_days, used_days, encashed_days FROM leave_balances WHERE employee_id = ? AND leave_type = ?',
        [employee_id, leave_type]
      );
      
      const currentBalance = balance ? (balance.allocated_days - balance.used_days - (balance.encashed_days || 0)) : 0;
      if (actualDays > currentBalance) {
        await db.run('ROLLBACK');
        if (newSavedFile) await deleteFile(newSavedFile);
        return { 
          success: false, 
          error: `Insufficient leave balance. Remaining ${leave_type} balance is ${currentBalance} days, but requested ${actualDays} days.` 
        };
      }
    }

    // Record leave
    await db.run(
      `INSERT INTO leave_records (employee_id, leave_type, start_date, end_date, actual_days, reason, attachment_path, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [employee_id, leave_type, start_date, end_date, actualDays, reason, newSavedFile, remarks]
    );

    // Deduct leave balance
    await db.run(
      'UPDATE leave_balances SET used_days = used_days + ? WHERE employee_id = ? AND leave_type = ?',
      [actualDays, employee_id, leave_type]
    );

    await db.run('COMMIT');

    revalidatePath('/dashboard/leaves');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (err: any) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch {}

    // Cleanup newly saved file if transaction failed to prevent disk pollution
    if (newSavedFile) {
      await deleteFile(newSavedFile);
    }

    return { success: false, error: sanitizeError(err, 'Failed to record leave.') };
  }
}

export async function deleteLeaveRecord(id: number) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const db = await getDb();
    
    // Get record to restore balance
    const record = await db.get('SELECT employee_id, leave_type, actual_days, attachment_path FROM leave_records WHERE id = ?', id);
    if (!record) {
      return { success: false, error: 'Record not found.' };
    }

    // Start transaction
    await db.run('BEGIN IMMEDIATE');

    // Restore balance correctly mapping encashments to el_encashed
    if (record.leave_type === 'Earned (Encashed)') {
      await db.run(
        'UPDATE leave_balances SET encashed_days = MAX(0, encashed_days - ?) WHERE employee_id = ? AND leave_type = ?',
        [record.actual_days, record.employee_id, 'Earned']
      );
    } else {
      await db.run(
        'UPDATE leave_balances SET used_days = MAX(0, used_days - ?) WHERE employee_id = ? AND leave_type = ?',
        [record.actual_days, record.employee_id, record.leave_type]
      );
    }

    // Delete record
    await db.run('DELETE FROM leave_records WHERE id = ?', id);

    await db.run('COMMIT');

    // Delete local attachment file asynchronously after transaction commits successfully
    if (record.attachment_path) {
      await deleteFile(record.attachment_path);
    }

    revalidatePath('/dashboard/leaves');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (err: any) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch {}
    return { success: false, error: sanitizeError(err, 'Database error occurred.') };
  }
}

export async function updateLeaveRecord(formData: FormData) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  const id = parseInt(formData.get('id') as string);
  const employee_id = parseInt(formData.get('employee_id') as string);
  const leave_type = formData.get('leave_type') as string;
  const start_date = formData.get('start_date') as string;
  const end_date_raw = formData.get('end_date') as string;
  const reason = formData.get('reason') as string;
  const remarks = formData.get('remarks') as string;
  const is_half_day = formData.get('is_half_day') === 'true';
  const file = formData.get('attachment') as File | null;
  const delete_attachment = formData.get('delete_attachment') === 'true';

  // Enforce server-side that end_date matches start_date if half-day
  const end_date = is_half_day ? start_date : end_date_raw;

  if (!id || !employee_id || !leave_type || !start_date || !end_date || !reason) {
    return { success: false, error: 'All fields marked with * are required.' };
  }

  if (!validateLength(leave_type, 50) ||
      !validateLength(reason, 2000) ||
      !validateLength(remarks, 2000)) {
    return { success: false, error: 'Input fields exceed length limits.' };
  }

  if (!isValidDateString(start_date) || !isValidDateString(end_date)) {
    return { success: false, error: 'Invalid start or end date format. Please use YYYY-MM-DD.' };
  }

  if (parseUTCDate(start_date) > parseUTCDate(end_date)) {
    return { success: false, error: 'Start date cannot be after end date.' };
  }

  if (exceedsMaxSpan(start_date, end_date)) {
    return { success: false, error: `Leave date range is too large. Please limit requests to ${MAX_LEAVE_SPAN_DAYS} days or fewer.` };
  }

  if (file && file.size > 10 * 1024 * 1024) {
    return { success: false, error: 'File upload size exceeds the 10MB limit.' };
  }

  if (file && file.size > 0 && !isAllowedAttachment(file)) {
    return { success: false, error: 'Unsupported file type. Allowed: JPG, PNG, GIF, WEBP, PDF, DOC, DOCX.' };
  }

  let newSavedFile: string | null = null;
  const filesToDelete: string[] = [];

  try {
    const db = await getDb();
    
    // Get old record
    const oldRecord = await db.get(
      'SELECT employee_id, leave_type, actual_days, attachment_path FROM leave_records WHERE id = ?',
      id
    );
    if (!oldRecord) {
      return { success: false, error: 'Leave record not found.' };
    }

    if (oldRecord.leave_type === 'Earned (Encashed)' || leave_type === 'Earned (Encashed)') {
      return { success: false, error: 'Encashment records cannot be edited. Please delete and recreate.' };
    }

    // Check if employee exists and is active
    const employee = await db.get('SELECT status FROM employees WHERE id = ?', employee_id);
    if (!employee) {
      return { success: false, error: 'Employee not found.' };
    }
    if (employee.status !== 'Active') {
      return { success: false, error: 'Cannot update leave for inactive employee.' };
    }

    // Calculate actual leave days
    const actualDays = await calculateLeaveDays(start_date, end_date, leave_type, is_half_day);
    if (actualDays <= 0) {
      return { success: false, error: 'Calculated leave duration is 0 days. Check holiday/weekend settings.' };
    }

    await db.run('BEGIN IMMEDIATE');

    // 1. Temporarily restore old balance correctly mapping encashments
    if (oldRecord.leave_type === 'Earned (Encashed)') {
      await db.run(
        'UPDATE leave_balances SET encashed_days = MAX(0, encashed_days - ?) WHERE employee_id = ? AND leave_type = ?',
        [oldRecord.actual_days, oldRecord.employee_id, 'Earned']
      );
    } else {
      await db.run(
        'UPDATE leave_balances SET used_days = MAX(0, used_days - ?) WHERE employee_id = ? AND leave_type = ?',
        [oldRecord.actual_days, oldRecord.employee_id, oldRecord.leave_type]
      );
    }

    // 2. Check overlap (excluding this leave record itself, and excluding
    // encashment bookkeeping rows — see note in addLeaveRecord above)
    const overlappingRecords = await db.all(
      `SELECT id, start_date, end_date, actual_days FROM leave_records
       WHERE employee_id = ?
         AND start_date <= ?
         AND end_date >= ?
         AND leave_type != 'Earned (Encashed)'`,
      [employee_id, end_date, start_date]
    );

    if (hasOverlapConflict(start_date, end_date, is_half_day, overlappingRecords, id)) {
      await db.run('ROLLBACK');
      return { 
        success: false, 
        error: `Leave request overlaps with existing leave records in the selected range.` 
      };
    }

    // 3. Check new balance limits (except for LWP)
    if (leave_type !== 'LWP') {
      const targetLeaveType = leave_type === 'Earned (Encashed)' ? 'Earned' : leave_type;
      const balance = await db.get(
        'SELECT allocated_days, used_days, encashed_days FROM leave_balances WHERE employee_id = ? AND leave_type = ?',
        [employee_id, targetLeaveType]
      );
      
      const currentBalance = balance ? (balance.allocated_days - balance.used_days - (balance.encashed_days || 0)) : 0;
      if (actualDays > currentBalance) {
        await db.run('ROLLBACK');
        return { 
          success: false, 
          error: `Insufficient leave balance. Remaining ${leave_type} balance is ${currentBalance} days, but requested ${actualDays} days.` 
        };
      }
    }

    // 4. Handle attachment replacements
    let attachmentPath = oldRecord.attachment_path;
    
    if (delete_attachment) {
      if (oldRecord.attachment_path) {
        filesToDelete.push(oldRecord.attachment_path);
      }
      attachmentPath = null;
    }

    if (file && file.size > 0) {
      // Save new file first
      newSavedFile = await saveFile(file);
      if (!newSavedFile) {
        return { success: false, error: 'Failed to save new attachment to server disk.' };
      }
      // Only mark old file for deletion if new file saved successfully
      if (oldRecord.attachment_path) {
        filesToDelete.push(oldRecord.attachment_path);
      }
      attachmentPath = newSavedFile;
    }

    // 5. Update leave record
    await db.run(
      `UPDATE leave_records 
       SET employee_id = ?, leave_type = ?, start_date = ?, end_date = ?, actual_days = ?, reason = ?, attachment_path = ?, remarks = ?, modified_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [employee_id, leave_type, start_date, end_date, actualDays, reason, attachmentPath, remarks, id]
    );

    // 6. Deduct new balance correctly mapping encashments
    if (leave_type === 'Earned (Encashed)') {
      await db.run(
        'UPDATE leave_balances SET encashed_days = encashed_days + ? WHERE employee_id = ? AND leave_type = ?',
        [actualDays, employee_id, 'Earned']
      );
    } else {
      await db.run(
        'UPDATE leave_balances SET used_days = used_days + ? WHERE employee_id = ? AND leave_type = ?',
        [actualDays, employee_id, leave_type]
      );
    }

    await db.run('COMMIT');

    // Async delete of old physical files after commit succeeds
    for (const filePath of filesToDelete) {
      await deleteFile(filePath);
    }

    revalidatePath('/dashboard/leaves');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (err: any) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch {}

    // Cleanup newly saved file if transaction fails
    if (newSavedFile) {
      await deleteFile(newSavedFile);
    }

    return { success: false, error: sanitizeError(err, 'Failed to update leave record.') };
  }
}

// ----------------------------------------------------
// 4. LATE ATTENDANCE & CL DEDUCTIONS
// ----------------------------------------------------
export async function recordLateAttendance(formData: FormData) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  const employee_id = parseInt(formData.get('employee_id') as string);
  const month_year = formData.get('month_year') as string; // Format: YYYY-MM
  const late_count = parseInt(formData.get('late_count') as string || '0');

  if (!employee_id || !month_year || isNaN(late_count) || late_count < 0) {
    return { success: false, error: 'Employee and Month are required, and late count cannot be negative.' };
  }

  if (!validateLength(month_year, 10)) {
    return { success: false, error: 'Month field exceeds length limits.' };
  }

  try {
    const db = await getDb();
    
    // Fetch threshold from settings
    const thresholdSetting = await db.get('SELECT value FROM system_settings WHERE key = ?', 'late_cl_threshold');
    const threshold = Math.max(1, parseInt(thresholdSetting?.value || '3'));

    // Calculate how many CL days to deduct (e.g. 3 lates = 1 CL day)
    const deductedCL = Math.floor(late_count / threshold);

    // Check if we already have a record for this month
    const existing = await db.get('SELECT id, deducted_cl FROM late_deductions WHERE employee_id = ? AND month_year = ?', [employee_id, month_year]);

    await db.run('BEGIN IMMEDIATE');

    if (existing) {
      // Revert previous CL deduction
      await db.run(
        'UPDATE leave_balances SET used_days = MAX(0, used_days - ?) WHERE employee_id = ? AND leave_type = ?',
        [existing.deducted_cl, employee_id, 'Casual']
      );

      // Update record
      await db.run(
        'UPDATE late_deductions SET late_count = ?, deducted_cl = ? WHERE id = ?',
        [late_count, deductedCL, existing.id]
      );
    } else {
      // Insert new record
      await db.run(
        'INSERT INTO late_deductions (employee_id, month_year, late_count, deducted_cl) VALUES (?, ?, ?, ?)',
        [employee_id, month_year, late_count, deductedCL]
      );
    }

    // Apply new CL deduction
    await db.run(
      'UPDATE leave_balances SET used_days = used_days + ? WHERE employee_id = ? AND leave_type = ?',
      [deductedCL, employee_id, 'Casual']
    );

    await db.run('COMMIT');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (err: any) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch {}
    return { success: false, error: sanitizeError(err, 'Failed to record late attendance.') };
  }
}

// ----------------------------------------------------
// 5. LEAVE ENCASHMENT ACTIONS
// ----------------------------------------------------
export async function logLeaveEncashment(formData: FormData) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  const employee_id = parseInt(formData.get('employee_id') as string);
  const encash_days = parseFloat(formData.get('encash_days') as string);
  const remarks = formData.get('remarks') as string;

  if (!employee_id || isNaN(encash_days) || encash_days <= 0) {
    return { success: false, error: 'Employee and valid days are required.' };
  }

  if (!validateLength(remarks, 2000)) {
    return { success: false, error: 'Remarks exceed length limits.' };
  }

  try {
    const db = await getDb();

    // Check Earned Leave balance
    const balance = await db.get(
      'SELECT allocated_days, used_days, encashed_days FROM leave_balances WHERE employee_id = ? AND leave_type = ?',
      [employee_id, 'Earned']
    );

    if (!balance) {
      return { success: false, error: 'Earned Leave balance not found for employee.' };
    }

    const available = balance.allocated_days - balance.used_days - balance.encashed_days;
    if (encash_days > available) {
      return { success: false, error: `Insufficient Earned Leave. Available to encash: ${available} days, but requested ${encash_days} days.` };
    }

    await db.run('BEGIN IMMEDIATE');

    // Update encashment balance
    await db.run(
      'UPDATE leave_balances SET encashed_days = encashed_days + ? WHERE employee_id = ? AND leave_type = ?',
      [encash_days, employee_id, 'Earned']
    );

    // Save as a leave record with encashment status or remarks (using local today string)
    const today = getLocalTodayStr();
    await db.run(
      `INSERT INTO leave_records (employee_id, leave_type, start_date, end_date, actual_days, reason, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [employee_id, 'Earned (Encashed)', today, today, encash_days, 'Earned Leave Encashment', remarks]
    );

    await db.run('COMMIT');
    revalidatePath('/dashboard/leaves');
    return { success: true };
  } catch (err: any) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch {}
    return { success: false, error: sanitizeError(err, 'Failed to log leave encashment.') };
  }
}

// ----------------------------------------------------
// 6. SYSTEM SETTINGS ACTIONS
// ----------------------------------------------------
export async function updateSystemSettings(formData: FormData) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  const institute_name = formData.get('institute_name') as string;
  const weekend_days = formData.get('weekend_days') as string; // Comma separated days
  const sandwich_rule = formData.get('sandwich_rule') as string; // 'true' / 'false'
  const late_cl_threshold = formData.get('late_cl_threshold') as string;
  
  const current_password = formData.get('current_password') as string;
  const new_password = formData.get('new_password') as string;

  // Note: weekend_days is intentionally allowed to be an empty string — an
  // organisation may legitimately run a 7-day work week with no fixed
  // weekly off-day. We only require the field to have been submitted at
  // all (i.e. not missing from the form), not that it be non-empty.
  if (!institute_name || typeof weekend_days !== 'string' || !sandwich_rule || !late_cl_threshold) {
    return { success: false, error: 'All configurations must be filled.' };
  }

  if (!validateLength(institute_name, 200) ||
      !validateLength(weekend_days, 200) ||
      !validateLength(sandwich_rule, 10) ||
      !validateLength(late_cl_threshold, 10) ||
      !validateLength(current_password, 100) ||
      !validateLength(new_password, 100)) {
    return { success: false, error: 'Input fields exceed length limits.' };
  }

  // Validate weekend_days names
  const validDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const inputDays = weekend_days.toLowerCase().split(',').map(d => d.trim());
  const invalidDays = inputDays.filter(d => d && !validDays.includes(d));
  if (invalidDays.length > 0) {
    return { 
      success: false, 
      error: `Invalid weekend day(s): ${invalidDays.join(', ')}. Please use full weekday names (e.g. friday, saturday).` 
    };
  }

  // Validate late_cl_threshold value
  const thresholdVal = parseInt(late_cl_threshold);
  if (isNaN(thresholdVal) || thresholdVal <= 0) {
    return { success: false, error: 'Late CL Threshold must be a positive integer.' };
  }

  try {
    const db = await getDb();
    
    await db.run('BEGIN IMMEDIATE');

    await db.run('UPDATE system_settings SET value = ? WHERE key = ?', [institute_name, 'institute_name']);
    await db.run('UPDATE system_settings SET value = ? WHERE key = ?', [weekend_days.toLowerCase(), 'weekend_days']);
    await db.run('UPDATE system_settings SET value = ? WHERE key = ?', [sandwich_rule, 'sandwich_rule']);
    await db.run('UPDATE system_settings SET value = ? WHERE key = ?', [late_cl_threshold, 'late_cl_threshold']);

    if (new_password && new_password.trim().length > 0) {
      if (new_password.length < 6) {
        await db.run('ROLLBACK');
        return { success: false, error: 'New password must be at least 6 characters long.' };
      }

      if (!current_password) {
        await db.run('ROLLBACK');
        return { success: false, error: 'Enter your current password to set a new one.' };
      }

      const existingHash = await db.get('SELECT value FROM system_settings WHERE key = ?', 'admin_password_hash');
      const isCurrentPasswordValid = existingHash && bcrypt.compareSync(current_password, existingHash.value);
      if (!isCurrentPasswordValid) {
        await db.run('ROLLBACK');
        return { success: false, error: 'Current password is incorrect.' };
      }

      const newHash = bcrypt.hashSync(new_password, 10);
      await db.run('UPDATE system_settings SET value = ? WHERE key = ?', [newHash, 'admin_password_hash']);
    }

    await db.run('COMMIT');
    revalidatePath('/dashboard/settings');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (err: any) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch {}
    return { success: false, error: sanitizeError(err, 'Failed to update settings.') };
  }
}

// ----------------------------------------------------
// 7. HOLIDAY ACTIONS
// ----------------------------------------------------
export async function addHoliday(formData: FormData) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  const title = (formData.get('title') as string || '').trim();
  const start_date = formData.get('start_date') as string;
  const end_date = formData.get('end_date') as string;

  if (!title || !start_date || !end_date) {
    return { success: false, error: 'Title, Start Date, and End Date are required.' };
  }

  if (!validateLength(title, 100)) {
    return { success: false, error: 'Holiday title exceeds length limits.' };
  }

  if (!isValidDateString(start_date) || !isValidDateString(end_date)) {
    return { success: false, error: 'Invalid start or end date format. Please use YYYY-MM-DD.' };
  }

  if (parseUTCDate(start_date) > parseUTCDate(end_date)) {
    return { success: false, error: 'Start date cannot be after end date.' };
  }

  try {
    const db = await getDb();
    await db.run(
      'INSERT INTO holidays (title, start_date, end_date) VALUES (?, ?, ?)',
      [title, start_date, end_date]
    );
    revalidatePath('/dashboard/settings');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: sanitizeError(err, 'Failed to add holiday.') };
  }
}

export async function deleteHoliday(id: number) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const db = await getDb();
    await db.run('DELETE FROM holidays WHERE id = ?', id);
    revalidatePath('/dashboard/settings');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: sanitizeError(err, 'Failed to delete holiday.') };
  }
}

// ----------------------------------------------------
// 8. DEPARTMENT ACTIONS
// ----------------------------------------------------
export async function addDepartment(formData: FormData) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  const name = formData.get('name') as string;
  if (!name || name.trim().length === 0) {
    return { success: false, error: 'Department name is required.' };
  }

  if (!validateLength(name, 100)) {
    return { success: false, error: 'Department name exceeds length limits.' };
  }

  try {
    const db = await getDb();

    const existing = await db.get('SELECT name FROM departments WHERE name = ? COLLATE NOCASE', name.trim());
    if (existing) {
      return { success: false, error: `Department "${existing.name}" already exists.` };
    }

    await db.run('INSERT INTO departments (name) VALUES (?)', name.trim());
    revalidatePath('/dashboard/settings');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: sanitizeError(err, 'Failed to add department.') };
  }
}

export async function deleteDepartment(id: number) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const db = await getDb();
    
    // Get department name
    const dept = await db.get('SELECT name FROM departments WHERE id = ?', id);
    if (!dept) {
      return { success: false, error: 'Department not found.' };
    }

    // Check if any employee is in this department
    const employee = await db.get('SELECT id FROM employees WHERE department_id = ?', id);
    if (employee) {
      return { 
        success: false, 
        error: `Cannot delete department. Employees are still assigned to the "${dept.name}" department.` 
      };
    }

    await db.run('DELETE FROM departments WHERE id = ?', id);
    revalidatePath('/dashboard/settings');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: sanitizeError(err, 'Failed to delete department.') };
  }
}

// ----------------------------------------------------
// 9. BULK CSV IMPORT
// ----------------------------------------------------
export async function importEmployeesFromCSV(formData: FormData) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) {
    return { success: false, error: 'No file uploaded.' };
  }

  const MAX_ROWS = 2000;
  const BATCH_SIZE = 200; // rows per transaction, so one huge import doesn't hold the write lock for the whole file

  try {
    const text = await file.text();
    const db = await getDb();

    const lines = text.split(/\r?\n/);
    if (lines.length < 2) {
      return { success: false, error: 'CSV file is empty.' };
    }

    if (lines.length - 1 > MAX_ROWS) {
      return { success: false, error: `CSV has too many rows. Please import at most ${MAX_ROWS} employees at a time.` };
    }

    let importedCount = 0;
    const skippedDuplicates: string[] = [];
    let rowsInCurrentBatch = 0;
    let transactionOpen = false;

    await db.run('BEGIN IMMEDIATE');
    transactionOpen = true;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const columns = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
      if (columns.length < 4) continue;

      const employee_id = columns[0];
      const name = columns[1];
      const designation = columns[2];
      const department = columns[3];
      const phone = columns[4] || '';
      let joining_date = columns[5];
      // Email is an optional 7th column, added after the original template
      // shipped — old 6-column CSV files remain fully compatible.
      let email: string | null = (columns[6] || '').trim() || null;

      if (!employee_id || !name || !designation || !department) continue;

      if (!validateLength(employee_id, 50) ||
          !validateLength(name, 100) ||
          !validateLength(designation, 100) ||
          !validateLength(department, 100) ||
          !validateLength(phone, 20) ||
          !validateLength(email, 254)) {
        continue;
      }

      if (!isValidDateString(joining_date)) {
        joining_date = getLocalTodayStr();
      }

      // Don't fail the whole row over a bad/duplicate email — just drop it,
      // consistent with how an invalid joining date falls back to today
      // instead of rejecting the row.
      if (email) {
        if (!isValidEmail(email)) {
          email = null;
        } else {
          const existingEmail = await db.get('SELECT id FROM employees WHERE email = ?', email);
          if (existingEmail) email = null;
        }
      }

      const deptId = await findOrCreateDepartment(db, department);

      const existing = await db.get('SELECT id FROM employees WHERE employee_id = ?', employee_id);
      if (existing) {
        skippedDuplicates.push(`${name} (${employee_id})`);
        continue;
      }

      const result = await db.run(
        `INSERT INTO employees (employee_id, name, designation, department_id, join_date, phone, email)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [employee_id, name, designation, deptId, joining_date, phone, email]
      );

      const empId = result.lastID;
      if (empId) {
        await db.run('INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?)', [empId, 'Casual', 10]);
        await db.run('INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?)', [empId, 'Sick', 14]);
        await db.run('INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?)', [empId, 'Earned', 15]);
        await db.run('INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?)', [empId, 'Maternity', 0]);
        await db.run('INSERT INTO leave_balances (employee_id, leave_type, allocated_days) VALUES (?, ?, ?)', [empId, 'LWP', 9999.0]);
      }
      importedCount++;
      rowsInCurrentBatch++;

      // Commit periodically so a large import doesn't hold the write lock (and block the
      // dashboard/leave pages) for the entire file. Already-committed batches are safe to
      // keep even if a later batch fails — re-running the import skips existing employee_ids.
      if (rowsInCurrentBatch >= BATCH_SIZE) {
        await db.run('COMMIT');
        transactionOpen = false;
        await db.run('BEGIN IMMEDIATE');
        transactionOpen = true;
        rowsInCurrentBatch = 0;
      }
    }

    if (transactionOpen) {
      await db.run('COMMIT');
    }
    revalidatePath('/dashboard/employees');
    return { success: true, count: importedCount, skipped: skippedDuplicates };
  } catch (err: any) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch {}
    return { success: false, error: sanitizeError(err, 'CSV Import failed.') };
  }
}

// ----------------------------------------------------
// 10. BACKUP / RESTORE
// ----------------------------------------------------
export interface BackupFileInfo {
  name: string;
  size: number;
  mtime: string;
}

export async function listBackups(): Promise<{ success: boolean; error?: string; backups: BackupFileInfo[] }> {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized', backups: [] };
  }

  try {
    const { BACKUP_DIR } = getPaths();
    if (!fs.existsSync(BACKUP_DIR)) {
      return { success: true, backups: [] };
    }

    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('database_backup_') && f.endsWith('.db'))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));

    return { success: true, backups };
  } catch (err: any) {
    return { success: false, error: sanitizeError(err, 'Failed to list backups.'), backups: [] };
  }
}

export async function restoreBackup(filename: string) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  // Only accept our own generated backup filenames — blocks path traversal and restoring
  // an arbitrary file that happens to be sitting in the backups folder.
  const safeName = path.basename(filename);
  if (
    !safeName ||
    safeName !== filename ||
    !safeName.startsWith('database_backup_') ||
    !safeName.endsWith('.db')
  ) {
    return { success: false, error: 'Invalid backup file.' };
  }

  try {
    const { DB_PATH, BACKUP_DIR } = getPaths();
    const backupPath = path.join(BACKUP_DIR, safeName);

    if (!fs.existsSync(backupPath)) {
      return { success: false, error: 'Backup file not found.' };
    }

    // Safety net: snapshot the current live database before overwriting it, in case the
    // chosen backup turns out to be the wrong one.
    if (fs.existsSync(DB_PATH)) {
      const preRestoreName = `database_backup_prerestore_${Date.now()}`;
      fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, preRestoreName + '.db'));
      if (fs.existsSync(DB_PATH + '-wal')) fs.copyFileSync(DB_PATH + '-wal', path.join(BACKUP_DIR, preRestoreName + '.db-wal'));
      if (fs.existsSync(DB_PATH + '-shm')) fs.copyFileSync(DB_PATH + '-shm', path.join(BACKUP_DIR, preRestoreName + '.db-shm'));
    }

    // Close the live connection so nothing races the file swap, then clear the *current*
    // database's WAL/SHM sidecar files — otherwise SQLite would replay them on top of the
    // restored file the next time it's opened, reintroducing the state being restored away from.
    await closeDb();
    for (const ext of ['-wal', '-shm']) {
      const sidecar = DB_PATH + ext;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }

    fs.copyFileSync(backupPath, DB_PATH);

    const backupWal = backupPath + '-wal';
    const backupShm = backupPath + '-shm';
    if (fs.existsSync(backupWal)) fs.copyFileSync(backupWal, DB_PATH + '-wal');
    if (fs.existsSync(backupShm)) fs.copyFileSync(backupShm, DB_PATH + '-shm');

    // Re-open immediately so the very next request already sees the restored data.
    await getDb();

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/employees');
    revalidatePath('/dashboard/leaves');
    revalidatePath('/dashboard/settings');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: sanitizeError(err, 'Failed to restore backup.') };
  }
}
