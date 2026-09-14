'use client';

import { Printer } from 'lucide-react';

export default function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
      <Printer size={16} aria-hidden /> {label}
    </button>
  );
}
