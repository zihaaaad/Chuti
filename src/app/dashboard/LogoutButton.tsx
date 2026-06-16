'use client';

import { handleLogout } from '../actions';
import { LogOut } from 'lucide-react';
import { useConfirm } from '@/context/ConfirmContext';

export default function LogoutButton() {
  const { confirm } = useConfirm();

  const onLogout = async () => {
    const ok = await confirm({
      title: 'Confirm Logout',
      message: 'Are you sure you want to log out of the admin panel?',
      confirmText: 'Logout',
      isDanger: true
    });
    if (ok) {
      await handleLogout();
    }
  };

  return (
    <button 
      onClick={onLogout}
      className="btn-logout"
    >
      <LogOut size={18} />
      Logout
    </button>
  );
}
