'use client';

import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useTransition } from 'react';

// Re-fetches server data, e.g. to see leave another LAN user just recorded.
// The spinning icon tracks the real refresh instead of a timed toast.
export default function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      aria-label="Refresh data"
      title="Refresh data"
    >
      <RefreshCw size={16} className={isPending ? 'spin' : undefined} aria-hidden />
      <span aria-live="polite">{isPending ? 'Refreshing…' : 'Refresh'}</span>
    </button>
  );
}
