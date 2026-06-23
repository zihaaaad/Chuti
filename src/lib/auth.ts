import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from './db';

const COOKIE_NAME = 'chuti_session';

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME);
  
  if (!session || !session.value) return false;

  try {
    const db = await getDb();
    const result = await db.get('SELECT session_id FROM admin_sessions WHERE session_id = ?', session.value);
    
    return !!result;
  } catch (err) {
    console.error('Session verification error:', err);
    return false;
  }
}

export async function loginAdmin(password: string): Promise<boolean> {
  const db = await getDb();
  const adminPasswordHash = await db.get('SELECT value FROM system_settings WHERE key = ?', 'admin_password_hash');
  
  if (!adminPasswordHash) return false;
  
  const isValid = bcrypt.compareSync(password, adminPasswordHash.value);
  if (!isValid) return false;

  // Generate a unique secure session token
  const sessionValue = crypto.randomBytes(32).toString('hex');
  
  // Clean up expired sessions (older than 7 days) to prevent table bloat
  try {
    await db.run("DELETE FROM admin_sessions WHERE created_at < datetime('now', '-7 days')");
  } catch (err) {
    console.error('Failed to clean up expired sessions:', err);
  }

  // Store session in database
  await db.run('INSERT INTO admin_sessions (session_id) VALUES (?)', sessionValue);
  
  // Set secure cookie
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/'
  });

  return true;
}

export async function logoutAdmin(): Promise<void> {
  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME);
  
  if (session && session.value) {
    try {
      const db = await getDb();
      await db.run('DELETE FROM admin_sessions WHERE session_id = ?', session.value);
    } catch (err) {
      console.error('Error deleting session from db:', err);
    }
  }

  cookieStore.delete(COOKIE_NAME);
}
