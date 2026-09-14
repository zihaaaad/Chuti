import 'server-only';
import type { Database } from 'sqlite';
import { cookies } from 'next/headers';

export type AuditEntity = 'employee' | 'leave' | 'encashment' | 'late' | 'settings' | 'holiday' | 'department' | 'backup' | 'leave_year' | 'auth' | 'import';

/**
 * Appends an audit entry. Call inside the same transaction as the change so
 * the log and the data can never disagree. `client` is the anonymous per-browser
 * id, which tells apart changes made from different LAN machines.
 */
export async function logAudit(db: Database, action: string, entity: AuditEntity, entityId: string | number | null, summary: string) {
  let client: string | null = null;
  try {
    client = (await cookies()).get('chuti_client_id')?.value?.slice(0, 8) ?? null;
  } catch {
    // Outside a request (e.g. startup) there are no cookies.
  }
  await db.run(
    'INSERT INTO audit_log (action, entity, entity_id, summary, client) VALUES (?, ?, ?, ?, ?)',
    action,
    entity,
    entityId === null ? null : String(entityId),
    summary.slice(0, 500),
    client,
  );
}
