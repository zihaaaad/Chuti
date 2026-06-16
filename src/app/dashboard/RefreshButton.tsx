'use client';

import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useTransition } from 'react';
import { useToast } from '@/context/ToastContext';

export default function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
    // Delay toast slightly to align with transition refresh
    setTimeout(() => {
      showToast('Dashboard data synchronized!', 'success');
    }, 200);
  };

  return (
    <button 
      className="btn btn-secondary" 
      onClick={handleRefresh}
      disabled={isPending}
      title="Sync/Refresh Console Data"
      style={{ padding: '0.5rem 0.75rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '38px', minWidth: '38px' }}
    >
      <RefreshCw size={16} className={isPending ? 'animate-spin' : ''} />
    </button>
  );
}
