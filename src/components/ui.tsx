import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { leaveTypeInfo } from '@/lib/domain/leave-types';

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="actions no-print">{actions}</div>}
    </header>
  );
}

const ALERT_ICONS = { danger: AlertCircle, warning: AlertTriangle, info: Info, success: CheckCircle2 };

export function Alert({ tone = 'info', children, live = false }: { tone?: keyof typeof ALERT_ICONS; children: ReactNode; live?: boolean }) {
  const Icon = ALERT_ICONS[tone];
  return (
    <div className={`alert alert-${tone}`} role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}>
      <Icon size={16} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required && <span className="req" aria-hidden>*</span>}
      </label>
      {children}
      {error ? (
        <span className="field-error" id={`${htmlFor}-error`} role="alert">{error}</span>
      ) : (
        hint && <span className="field-hint" id={`${htmlFor}-hint`}>{hint}</span>
      )}
    </div>
  );
}

/** aria props for an input rendered inside <Field>. */
export function fieldAria(id: string, error?: string, hasHint = false) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hasHint ? `${id}-hint` : undefined,
  } as const;
}

export function LeaveTypeBadge({ type, short = false }: { type: string; short?: boolean }) {
  const info = leaveTypeInfo(type);
  return (
    <span className={`badge lt-${info.tone}`} title={info.label}>
      {short ? info.short : type === 'Earned (Encashed)' ? 'EL encashed' : info.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === 'Active' ? 'badge-success' : status === 'Resigned' ? 'badge-warning' : 'badge-danger';
  return <span className={`badge ${tone}`}>{status}</span>;
}

export function DialogHeader({ id, title, description, onClose }: { id: string; title: string; description?: ReactNode; onClose: () => void }) {
  return (
    <div className="dialog-head">
      <div>
        <h2 id={id}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
        <X size={18} aria-hidden />
      </button>
    </div>
  );
}

export function formatDays(n: number | null | undefined): string {
  const v = n ?? 0;
  return `${Number.isInteger(v) ? v : v.toFixed(1).replace(/\.0$/, '')} ${v === 1 ? 'day' : 'days'}`;
}
