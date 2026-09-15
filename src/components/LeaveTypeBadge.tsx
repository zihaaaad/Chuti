'use client';

import { useLeaveTypes } from '@/context/LeaveTypesContext';
import { ENCASHMENT_TYPE, leaveTypeInfo } from '@/lib/domain/leave-types';

export default function LeaveTypeBadge({ type, short = false }: { type: string; short?: boolean }) {
  const info = leaveTypeInfo(useLeaveTypes(), type);
  return (
    <span className={`badge tone-${info.tone}`} title={info.label}>
      {short ? info.short : type === ENCASHMENT_TYPE ? 'EL encashed' : info.label}
    </span>
  );
}
