'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';

interface Props {
  month: string;
  departmentId: number | null;
  showAll: boolean;
  departments: { id: number; name: string }[];
}

export default function CalendarFilters({ month, departmentId, showAll, departments }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const go = (changes: { dept?: string; all?: boolean }) => {
    const params = new URLSearchParams({ month });
    const dept = changes.dept ?? (departmentId ? String(departmentId) : '');
    if (dept) params.set('dept', dept);
    if (changes.all ?? showAll) params.set('all', '1');
    startTransition(() => router.replace(`${pathname}?${params}`, { scroll: false }));
  };

  return (
    <div className="group" aria-busy={isPending} style={{ alignItems: 'center' }}>
      <select className="select" style={{ width: 'auto' }} value={departmentId ?? ''} onChange={(e) => go({ dept: e.target.value })} aria-label="Filter by department">
        <option value="">All departments</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <label className="check">
        <input type="checkbox" checked={showAll} onChange={(e) => go({ all: e.target.checked })} />
        Show everyone
      </label>
    </div>
  );
}
