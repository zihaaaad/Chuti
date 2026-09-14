import 'server-only';
import { z } from 'zod';
import { verifySession } from './auth';
import { ActionError } from './db';

export type ActionFailure = { success: false; error: string; fieldErrors?: Record<string, string>; code?: string };
export type ActionResult<T = void> = { success: true; data: T } | ActionFailure;

interface Options {
  /** Allowed while the admin still has to replace the default password. */
  allowPasswordChange?: boolean;
}

/**
 * Wraps a Server Action body: requires a session, runs `fn`, and turns
 * failures into a result the UI can show. ActionError and validation messages
 * are shown as-is; anything else is logged and replaced with `fallback`, so raw
 * SQLite errors never reach the browser.
 */
export async function adminAction<T>(fallback: string, fn: () => Promise<T>, options: Options = {}): Promise<ActionResult<T>> {
  const session = await verifySession();
  if (!session) return { success: false, error: 'Your session has expired. Sign in again.' };
  if (session.mustChangePassword && !options.allowPasswordChange) {
    return { success: false, error: 'Set a new admin password before making changes.' };
  }

  try {
    const data = await fn();
    return { success: true, data };
  } catch (err) {
    return toFailure(err, fallback);
  }
}

export function toFailure(err: unknown, fallback: string): ActionFailure {
  if (err instanceof ValidationError) return { success: false, error: err.message, fieldErrors: err.fieldErrors };
  if (err instanceof ActionError) return { success: false, error: err.message, ...(err.code ? { code: err.code } : {}) };
  const message = err instanceof Error ? err.message : String(err);
  if (/UNIQUE constraint failed: employees\.employee_id/.test(message)) return { success: false, error: 'That employee ID is already in use.' };
  if (/UNIQUE constraint failed: employees\.email/.test(message)) return { success: false, error: 'That email address belongs to another employee.' };
  if (/SQLITE_BUSY|database is locked/.test(message)) return { success: false, error: 'The database is busy. Wait a moment and try again.' };
  console.error(`[action] ${fallback}`, err);
  return { success: false, error: fallback };
}

export class ValidationError extends Error {
  constructor(message: string, public fieldErrors: Record<string, string>) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Parses FormData (or a plain object) with a zod schema, throwing ValidationError on failure. */
export function parseInput<S extends z.ZodType>(schema: S, input: FormData | Record<string, unknown>): z.infer<S> {
  const raw = input instanceof FormData ? formDataToObject(input) : input;
  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_form';
    fieldErrors[key] ??= issue.message;
  }
  throw new ValidationError(result.error.issues[0]?.message ?? 'Check the highlighted fields.', fieldErrors);
}

function formDataToObject(fd: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of fd.entries()) {
    obj[key] = value;
  }
  return obj;
}
