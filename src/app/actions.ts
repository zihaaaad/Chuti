'use server';

import fs from 'fs';
import path from 'path';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db';
import { loginAdmin, logoutAdmin, isAuthenticated } from '@/lib/auth';
import bcrypt from 'bcryptjs';

// ----------------------------------------------------
// HELPERS & SECURITY
// ----------------------------------------------------

// Global in-memory rate limiting for admin login
let globalFailedAttempts = 0;
let globalLockedUntil = 0;

function checkRateLimit(): { allowed: boolean; waitTimeSeconds: number } {
  const now = Date.now();
  if (globalLockedUntil > now) {
    return { allowed: false, waitTimeSeconds: Math.ceil((globalLockedUntil - now) / 1000) };
  }
  return { allowed: true, waitTimeSeconds: 0 };
}

function recordLoginAttempt(success: boolean) {
  const now = Date.now();
  if (success) {
    globalFailedAttempts = 0;
    globalLockedUntil = 0;
  } else {
    globalFailedAttempts += 1;
    if (globalFailedAttempts >= 10) {
      globalLockedUntil = now + 5 * 60 * 1000; // 5 minute global lock
      globalFailedAttempts = 0; // Reset attempts after locking
    }
  }
}

// Helper to sanitize raw database error messages
function sanitizeError(err: any, defaultMsg: string): string {
  const msg = err.message || '';
  if (msg.toLowerCase().includes('sqlite') || msg.toLowerCase().includes('database')) {
    return defaultMsg;
  }
  return msg || defaultMsg;
}

// Input length validation helper
function validateLength(val: any, max: number): boolean {
  if (val && typeof val === 'string' && val.length > max) {
    return false;
  }
  return true;
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
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    return { success: false, error: `Too many login failures. Locked out. Please try again in ${rateCheck.waitTimeSeconds} seconds.` };
  }

  const password = formData.get('password') as string;
  if (!password) {
    return { success: false, error: 'Password is required.' };
  }

  if (!validateLength(password, 100)) {
    return { success: false, error: 'Password is too long.' };
  }
  
  const ok = await loginAdmin(password);
  recordLoginAttempt(ok);

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

  const employee_id = formData.get('employee_id') as string;
  const name = formData.get('name') as string;
  const designation = formData.get('designation') as string;
  const department = formData.get('department') as string;
  const joining_date = formData.get('joining_date') as string;
  const phone = formData.get('phone') as string;
  
  // Custom leave allocations
  let cl_allocated = parseFloat(formData.get('cl_allocated') as string);
  if (isNaN(cl_allocated) || cl_allocated < 0) cl_allocated = 10;
  let sl_allocated = parseFloat(formData.get('sl_allocated') as string);
  if (isNaN(sl_allocated) || sl_allocated < 0) sl_allocated = 14;
  let el_allocated = parseFloat(formData.get('el_allocated') as string);
  if (isNaN(el_allocated) || el_allocated < 0) el_allocated = 15;
  let ml_allocated = parseFloat(formData.get('ml_allocated') as string);
  if (isNaN(ml_allocated) || ml_allocated < 0) ml_allocated = 0;

  if (!employee_id || !name || !designation || !department || !joining_date) {
    return { success: false, error: 'Please fill all required fields.' };
  }

  if (!validateLength(employee_id, 50) ||
      !validateLength(name, 100) ||
      !validateLength(designation, 100) ||
      !validateLength(department, 100) ||
      !validateLength(phone, 20)) {
    return { success: false, error: 'Input fields exceed length limits.' };
  }

  if (!isValidDateString(joining_date)) {
    return { success: false, error: 'Invalid joining date format or value. Please use YYYY-MM-DD.' };
  }

  try {
    const db = await getDb();
    
    // Check duplicate employee_id
    const existing = await db.get('SELECT id FROM employees WHERE employee_id = ?', employee_id);
    if (existing) {
      return { success: false, error: 'Employee ID already exists.' };
    }

    await db.run('BEGIN IMMEDIATE');

    let dept = await db.get('SELECT id FROM departments WHERE name = ?', department);
    if (!dept) {
      const res = await db.run('INSERT INTO departments (name) VALUES (?)', department);
      dept = { id: res.lastID };
    }

    // Insert employee
    const result = await db.run(
      `INSERT INTO employees (employee_id, name, designation, department_id, join_date, phone)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [employee_id, name, designation, dept.id, joining_date, phone]
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
  const employee_id = formData.get('employee_id') as string;
  const name = formData.get('name') as string;
  const designation = formData.get('designation') as string;
  const department = formData.get('department') as string;
  const joining_date = formData.get('joining_date') as string;
  const phone = formData.get('phone') as string;
  const status = formData.get('status') as string;

  let cl_allocated = parseFloat(formData.get('cl_allocated') as string);
  if (isNaN(cl_allocated) || cl_allocated < 0) cl_allocated = 10;
  let sl_allocated = parseFloat(formData.get('sl_allocated') as string);
  if (isNaN(sl_allocated) || sl_allocated < 0) sl_allocated = 14;
  let el_allocated = parseFloat(formData.get('el_allocated') as string);
  if (isNaN(el_allocated) || el_allocated < 0) el_allocated = 15;
  let ml_allocated = parseFloat(formData.get('ml_allocated') as string);
  if (isNaN(ml_allocated) || ml_allocated < 0) ml_allocated = 0;

  if (!id || !employee_id || !name || !designation || !department || !joining_date) {
    return { success: false, error: 'Please fill all required fields.' };
  }

  if (!validateLength(employee_id, 50) ||
      !validateLength(name, 100) ||
      !validateLength(designation, 100) ||
      !validateLength(department, 100) ||
      !validateLength(phone, 20) ||
      !validateLength(status, 20)) {
    return { success: false, error: 'Input fields exceed length limits.' };
  }

  if (!isValidDateString(joining_date)) {
    return { success: false, error: 'Invalid joining date format or value. Please use YYYY-MM-DD.' };
  }

  try {
    const db = await getDb();

    // Check duplicate employee_id on other employees
    const existing = await db.get('SELECT id FROM employees WHERE employee_id = ? AND id != ?', [employee_id, id]);
    if (existing) {
      return { success: false, error: 'Employee ID already exists for another employee.' };
    }

    await db.run('BEGIN IMMEDIATE');

    let dept = await db.get('SELECT id FROM departments WHERE name = ?', department);
    if (!dept) {
      const res = await db.run('INSERT INTO departments (name) VALUES (?)', department);
      dept = { id: res.lastID };
    }

    await db.run(
      `UPDATE employees 
       SET employee_id = ?, name = ?, designation = ?, department_id = ?, join_date = ?, phone = ?, status = ?
       WHERE id = ?`,
      [employee_id, name, designation, dept.id, joining_date, phone, status, id]
    );

    // Update allocations
    await db.run('UPDATE leave_balances SET allocated_days = ? WHERE employee_id = ? AND leave_type = ?', [cl_allocated, id, 'Casual']);
    await db.run('UPDATE leave_balances SET allocated_days = ? WHERE employee_id = ? AND leave_type = ?', [sl_allocated, id, 'Sick']);
    await db.run('UPDATE leave_balances SET allocated_days = ? WHERE employee_id = ? AND leave_type = ?', [el_allocated, id, 'Earned']);
    await db.run('UPDATE leave_balances SET allocated_days = ? WHERE employee_id = ? AND leave_type = ?', [ml_allocated, id, 'Maternity']);

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

  if (file && file.size > 10 * 1024 * 1024) {
    return { success: false, error: 'File upload size exceeds the 10MB limit.' };
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
    newSavedFile = await saveFile(file);

    await db.run('BEGIN IMMEDIATE');

    // Check if employee already has overlapping leave records (inside transaction to prevent race conditions)
    const overlappingRecords = await db.all(
      `SELECT id, start_date, end_date, actual_days FROM leave_records 
       WHERE employee_id = ? 
         AND start_date <= ? 
         AND end_date >= ?`,
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

  if (file && file.size > 10 * 1024 * 1024) {
    return { success: false, error: 'File upload size exceeds the 10MB limit.' };
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

    // 2. Check overlap (excluding this leave record itself)
    const overlappingRecords = await db.all(
      `SELECT id, start_date, end_date, actual_days FROM leave_records 
       WHERE employee_id = ? 
         AND start_date <= ? 
         AND end_date >= ?`,
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
      // Replaced old file
      if (oldRecord.attachment_path) {
        filesToDelete.push(oldRecord.attachment_path);
      }
      // Save new file
      newSavedFile = await saveFile(file);
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

  if (!employee_id || !month_year || isNaN(late_count)) {
    return { success: false, error: 'Employee and Month are required.' };
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
    return { success: false, error: err.message || 'Failed to record late attendance.' };
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
    return { success: false, error: err.message || 'Failed to log leave encashment.' };
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
  
  const new_password = formData.get('new_password') as string;

  if (!institute_name || !weekend_days || !sandwich_rule || !late_cl_threshold) {
    return { success: false, error: 'All configurations must be filled.' };
  }

  if (!validateLength(institute_name, 200) ||
      !validateLength(weekend_days, 200) ||
      !validateLength(sandwich_rule, 10) ||
      !validateLength(late_cl_threshold, 10) ||
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
        return { success: false, error: 'Password must be at least 6 characters long.' };
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
    return { success: false, error: err.message || 'Failed to update settings.' };
  }
}

// ----------------------------------------------------
// 7. HOLIDAY ACTIONS
// ----------------------------------------------------
export async function addHoliday(formData: FormData) {
  if (!(await isAuthenticated())) {
    return { success: false, error: 'Unauthorized' };
  }

  const title = formData.get('title') as string;
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

  try {
    const db = await getDb();
    await db.run(
      'INSERT INTO holidays (title, start_date, end_date) VALUES (?, ?, ?)',
      [title, start_date, end_date]
    );
    revalidatePath('/dashboard/settings');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to add holiday.' };
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
    return { success: false, error: err.message || 'Failed to delete holiday.' };
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
    await db.run('INSERT INTO departments (name) VALUES (?)', name.trim());
    revalidatePath('/dashboard/settings');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to add department.' };
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
    return { success: false, error: err.message || 'Failed to delete department.' };
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

  try {
    const text = await file.text();
    const db = await getDb();
    
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) {
      return { success: false, error: 'CSV file is empty.' };
    }

    await db.run('BEGIN IMMEDIATE');
    let importedCount = 0;
    const skippedDuplicates: string[] = [];

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

      if (!employee_id || !name || !designation || !department) continue;

      if (!validateLength(employee_id, 50) ||
          !validateLength(name, 100) ||
          !validateLength(designation, 100) ||
          !validateLength(department, 100) ||
          !validateLength(phone, 20)) {
        continue;
      }

      if (!isValidDateString(joining_date)) {
        joining_date = getLocalTodayStr();
      }

      // Ensure department exists in departments table
      await db.run('INSERT OR IGNORE INTO departments (name) VALUES (?)', department.trim());
      const dept = await db.get('SELECT id FROM departments WHERE name = ?', department.trim());
      const deptId = dept ? dept.id : null;

      const existing = await db.get('SELECT id FROM employees WHERE employee_id = ?', employee_id);
      if (existing) {
        skippedDuplicates.push(`${name} (${employee_id})`);
        continue;
      }

      const result = await db.run(
        `INSERT INTO employees (employee_id, name, designation, department_id, join_date, phone)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [employee_id, name, designation, deptId, joining_date, phone]
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
    }

    await db.run('COMMIT');
    revalidatePath('/dashboard/employees');
    return { success: true, count: importedCount, skipped: skippedDuplicates };
  } catch (err: any) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK');
    } catch {}
    return { success: false, error: err.message || 'CSV Import failed.' };
  }
}
