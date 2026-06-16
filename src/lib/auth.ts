import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from './db';

const COOKIE_NAME = 'chuti_session';

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME);
  
  if (!session) return false;

  try {
    const db = await getDb();
    const adminPasswordHash = await db.get('SELECT value FROM system_settings WHERE key = ?', 'admin_password_hash');
    
    if (!adminPasswordHash) return false;

    // Retrieve or initialize session secret
    const secretSetting = await db.get("SELECT value FROM system_settings WHERE key = 'session_secret'");
    let secret = secretSetting?.value;
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex');
      await db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('session_secret', ?)", secret);
    }
    
    const expectedToken = crypto.createHash('sha256').update(adminPasswordHash.value + secret).digest('hex');
    
    // Guard length to prevent timingSafeEqual buffer length mismatch exceptions
    if (session.value.length !== expectedToken.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(Buffer.from(session.value), Buffer.from(expectedToken));
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

  // Retrieve or initialize session secret
  const secretSetting = await db.get("SELECT value FROM system_settings WHERE key = 'session_secret'");
  let secret = secretSetting?.value;
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    await db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('session_secret', ?)", secret);
  }

  const sessionValue = crypto.createHash('sha256').update(adminPasswordHash.value + secret).digest('hex');
  
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
  cookieStore.delete(COOKIE_NAME);
}
