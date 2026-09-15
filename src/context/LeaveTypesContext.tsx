'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { BUILTIN_LEAVE_TYPES, type LeaveTypeDef } from '@/lib/domain/leave-types';

const LeaveTypesContext = createContext<readonly LeaveTypeDef[]>(BUILTIN_LEAVE_TYPES);

/** Provides the configured leave types (loaded once per request in the dashboard layout). */
export function LeaveTypesProvider({ types, children }: { types: LeaveTypeDef[]; children: ReactNode }) {
  return <LeaveTypesContext.Provider value={types}>{children}</LeaveTypesContext.Provider>;
}

/** All leave types, including switched-off ones (needed to label history). */
export function useLeaveTypes(): readonly LeaveTypeDef[] {
  return useContext(LeaveTypesContext);
}

/** Leave types that can be chosen for new records. */
export function useActiveLeaveTypes(): LeaveTypeDef[] {
  return useLeaveTypes().filter((t) => t.active);
}
