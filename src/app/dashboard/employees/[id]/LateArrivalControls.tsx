'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { clearUndatedLates, deleteLateArrival } from '@/app/actions/attendance';
import { useConfirm } from '@/context/ConfirmContext';
import { useToast } from '@/context/ToastContext';
import { formatDisplayDate } from '@/lib/domain/dates';

export function LateArrivalRemoveButton({ id, date }: { id: number; date: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="icon-btn danger"
      disabled={isPending}
      aria-label={`Remove late arrival on ${formatDisplayDate(date)}`}
      onClick={() =>
        startTransition(async () => {
          const res = await deleteLateArrival(id);
          showToast(res.success ? `Removed. CL cut for the month is now ${res.data.deducted} day(s).` : res.error, res.success ? 'success' : 'error');
          router.refresh();
        })
      }
    >
      <Trash2 size={15} aria-hidden />
    </button>
  );
}

export function ClearUndatedButton({ employeeId, month, label }: { employeeId: number; month: string; label: string }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
      <span className="subtle">{label}</span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={isPending}
        onClick={async () => {
          const ok = await confirm({
            title: 'Clear this monthly total?',
            message: 'The late arrivals entered as a monthly total (without dates) are removed and the Casual Leave cut is recalculated from the dated entries.',
            confirmText: 'Clear total',
            isDanger: true,
          });
          if (!ok) return;
          startTransition(async () => {
            const res = await clearUndatedLates(employeeId, month);
            showToast(res.success ? 'Monthly total cleared.' : res.error, res.success ? 'success' : 'error');
            router.refresh();
          });
        }}
      >
        Clear total
      </button>
    </div>
  );
}
