import type { Metadata } from 'next';
import Link from 'next/link';
import { History } from 'lucide-react';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { EmptyState, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Activity log' };

const PAGE_SIZE = 100;
const ENTITIES: Record<string, string> = {
  leave: 'Leave',
  encashment: 'Encashment',
  late: 'Late arrivals',
  employee: 'Employee',
  import: 'Import',
  settings: 'Settings',
  holiday: 'Holiday',
  department: 'Department',
  backup: 'Backup',
  leave_year: 'Leave year',
  leave_type: 'Leave type',
  auth: 'Security',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const entity = typeof sp.entity === 'string' && sp.entity in ENTITIES ? sp.entity : '';
  const page = Math.max(1, parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);

  const db = await getDb();
  const where = entity ? 'WHERE entity = ?' : '';
  const args = entity ? [entity] : [];
  const [rows, count] = await Promise.all([
    db.all<{ id: number; at: string; action: string; entity: string; summary: string; client: string | null }[]>(
      `SELECT id, at, action, entity, summary, client FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      ...args, PAGE_SIZE, (page - 1) * PAGE_SIZE,
    ),
    db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM audit_log ${where}`, ...args),
  ]);
  const total = count?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (changes: Record<string, string | number>) => {
    const params = new URLSearchParams(Object.entries({ entity, page, ...changes }).filter(([k, v]) => v && !(k === 'page' && v === 1)).map(([k, v]) => [k, String(v)]));
    return `/dashboard/activity${params.size ? `?${params}` : ''}`;
  };

  return (
    <>
      <PageHeader title="Activity log" description="Every change made in Chuti, newest first. Entries cannot be edited or deleted." />
      <nav className="tabs no-print" aria-label="Filter by area">
        <Link href={href({ entity: '', page: 1 })} className="tab" aria-selected={!entity}>All</Link>
        {Object.entries(ENTITIES).map(([key, label]) => (
          <Link key={key} href={href({ entity: key, page: 1 })} className="tab" aria-selected={entity === key}>{label}</Link>
        ))}
      </nav>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>When</th><th>Area</th><th>What happened</th><th title="Anonymous id of the browser that made the change">Device</th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4}><EmptyState icon={<History size={28} aria-hidden />} title="Nothing logged yet">Changes appear here as soon as they are made.</EmptyState></td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap num">{new Date(r.at.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td><span className="badge">{ENTITIES[r.entity] ?? r.entity}</span></td>
                  <td>{r.summary}</td>
                  <td><code>{r.client ?? '—'}</code></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="pagination" aria-label="Pagination">
          <span>Page {page} of {pages} · {total} entries</span>
          <span style={{ display: 'flex', gap: '0.5rem' }}>
            {page > 1 ? <Link className="btn btn-secondary btn-sm" href={href({ page: page - 1 })}>Previous</Link> : <span className="btn btn-secondary btn-sm" aria-disabled="true">Previous</span>}
            {page < pages ? <Link className="btn btn-secondary btn-sm" href={href({ page: page + 1 })}>Next</Link> : <span className="btn btn-secondary btn-sm" aria-disabled="true">Next</span>}
          </span>
        </nav>
      )}
    </>
  );
}
