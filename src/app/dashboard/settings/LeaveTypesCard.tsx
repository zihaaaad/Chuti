'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Edit2, Plus, Tags, Trash2 } from 'lucide-react';
import { addLeaveType, editLeaveType, removeLeaveType } from '@/app/actions/leave-types';
import { useLeaveTypes } from '@/context/LeaveTypesContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import Modal from '@/components/Modal';
import { Alert, DialogHeader, Field, fieldAria } from '@/components/ui';
import { PROTECTED_CODES, TONES, type LeaveTypeDef, type Tone } from '@/lib/domain/leave-types';

interface FormState {
  label: string;
  short: string;
  default_allocation: string;
  has_quota: boolean;
  is_paid: boolean;
  tone: Tone;
  active: boolean;
}

const blank = (): FormState => ({ label: '', short: '', default_allocation: '5', has_quota: true, is_paid: true, tone: 'teal', active: true });

/** Leave records per type code, to tell used types (switch off only) from unused ones (deletable). */
export default function LeaveTypesCard({ usage }: { usage: Record<string, number> }) {
  const types = useLeaveTypes();
  const router = useRouter();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const titleId = useId();
  const [editing, setEditing] = useState<LeaveTypeDef | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const openForm = (t: LeaveTypeDef | null) => {
    setEditing(t);
    setErrors({});
    setFormError(null);
    setForm(t ? {
      label: t.label,
      short: t.short,
      default_allocation: String(t.defaultAllocation),
      has_quota: t.hasQuota,
      is_paid: t.isPaid,
      tone: t.tone,
      active: t.active,
    } : blank());
    setOpen(true);
  };

  // Quota and pay rules are fixed once a type is built in or has been used.
  const rulesLocked = !!editing && (editing.builtin || (usage[editing.code] ?? 0) > 0);
  const canSwitchOff = !editing || !PROTECTED_CODES.includes(editing.code);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set('label', form.label);
    fd.set('short', form.short);
    fd.set('default_allocation', form.has_quota ? form.default_allocation : '0');
    fd.set('has_quota', String(form.has_quota));
    fd.set('is_paid', String(form.is_paid));
    fd.set('tone', form.tone);
    fd.set('active', String(form.active));
    startTransition(async () => {
      const res = editing ? await editLeaveType(editing.code, fd) : await addLeaveType(fd);
      if (res.success) {
        showToast(editing ? `Saved ${form.label}.` : `Added ${form.label}. Every employee now has a balance for it.`, 'success');
        setOpen(false);
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.fieldErrors ? null : res.error);
      }
    });
  };

  const onDelete = async (t: LeaveTypeDef) => {
    const ok = await confirm({
      title: `Delete ${t.label}?`,
      message: 'No leave has been recorded with this type, so nothing else changes. Employee balances for it are removed.',
      confirmText: 'Delete leave type',
      isDanger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await removeLeaveType(t.code);
      if (res.success) {
        showToast(`Deleted ${t.label}.`, 'success');
        router.refresh();
      } else {
        showToast(res.error, 'error');
      }
    });
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <section className="card" id="leave-types" aria-labelledby="lt-title">
      <div className="card-head">
        <div>
          <h2 id="lt-title"><Tags size={18} aria-hidden /> Leave types</h2>
          <p>Add types such as Study Leave or Duty Leave. Types already used can be switched off but not deleted.</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openForm(null)} disabled={isPending}>
          <Plus size={14} aria-hidden /> Add type
        </button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Type</th><th className="num">Yearly quota</th><th>Pay</th><th className="num">Records</th><th className="right"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {types.map((t) => {
              const used = usage[t.code] ?? 0;
              return (
                <tr key={t.code} className={t.active ? undefined : 'locked'}>
                  <td className="primary-cell">
                    <span className={`badge tone-${t.tone}`} style={{ marginRight: 8 }}>{t.short}</span>
                    {t.label}
                    {!t.active && <span className="sub">Switched off</span>}
                    {t.builtin && t.active && <span className="sub">Built in</span>}
                  </td>
                  <td className="num">{t.hasQuota ? t.defaultAllocation : <span className="subtle">No limit</span>}</td>
                  <td>{t.isPaid ? 'Paid' : <span className="badge badge-danger">Unpaid</span>}</td>
                  <td className="num">{used}</td>
                  <td className="right nowrap">
                    <button type="button" className="icon-btn" onClick={() => openForm(t)} disabled={isPending} aria-label={`Edit ${t.label}`} title="Edit">
                      <Edit2 size={15} aria-hidden />
                    </button>
                    {!t.builtin && used === 0 && (
                      <button type="button" className="icon-btn danger" onClick={() => onDelete(t)} disabled={isPending} aria-label={`Delete ${t.label}`} title="Delete">
                        <Trash2 size={15} aria-hidden />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="subtle" style={{ marginTop: '0.5rem' }}>
        Changing a default quota applies to employees added later. Adjust existing employees&apos; quotas on the Employees page.
      </p>

      <Modal isOpen={open} onClose={() => setOpen(false)} labelledBy={titleId} maxWidth="520px" locked={isPending}>
        <form onSubmit={submit} noValidate>
          <DialogHeader id={titleId} title={editing ? `Edit ${editing.label}` : 'Add leave type'} onClose={() => setOpen(false)} />
          <div className="form-grid">
            {formError && <Alert tone="danger" live>{formError}</Alert>}
            <div className="form-grid cols-2">
              <Field label="Name" htmlFor="lt-label" required error={errors.label}>
                <input className="input" value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="e.g. Study Leave" disabled={isPending} data-autofocus {...fieldAria('lt-label', errors.label)} />
              </Field>
              <Field label="Short name" htmlFor="lt-short" required error={errors.short} hint="Shown in tables, up to 6 letters.">
                <input className="input" value={form.short} maxLength={6} onChange={(e) => set('short', e.target.value.toUpperCase())} placeholder="e.g. STL" disabled={isPending} {...fieldAria('lt-short', errors.short, true)} />
              </Field>
            </div>

            {rulesLocked && (
              <Alert tone="info">
                {editing?.builtin ? 'Quota and pay rules of built-in types are fixed.' : 'This type has leave recorded, so its quota and pay rules are fixed.'}
              </Alert>
            )}
            <div className="form-grid cols-2">
              <label className="check">
                <input type="checkbox" checked={form.has_quota} onChange={(e) => set('has_quota', e.target.checked)} disabled={isPending || rulesLocked} />
                Has a yearly quota
              </label>
              <label className="check">
                <input type="checkbox" checked={form.is_paid} onChange={(e) => set('is_paid', e.target.checked)} disabled={isPending || rulesLocked} />
                Paid leave
              </label>
            </div>
            {form.has_quota && (
              <Field label="Default yearly quota (days)" htmlFor="lt-alloc" error={errors.default_allocation}>
                <input className="input num" type="number" min={0} max={365} step={0.5} value={form.default_allocation} onChange={(e) => set('default_allocation', e.target.value)} disabled={isPending} {...fieldAria('lt-alloc', errors.default_allocation)} />
              </Field>
            )}
            {!form.is_paid && <p className="subtle">Unpaid days are subtracted from paid days in the payroll summary.</p>}

            <fieldset className="fieldset">
              <legend>Colour</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {TONES.map((tone) => (
                  <label key={tone} className="check" style={{ gap: '0.3rem' }}>
                    <input type="radio" name="lt-tone" value={tone} checked={form.tone === tone} onChange={() => set('tone', tone)} disabled={isPending} />
                    <span className={`badge tone-${tone}`}>{form.short || 'ABC'}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {editing && (
              <label className="check">
                <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} disabled={isPending || !canSwitchOff} />
                In use {canSwitchOff ? '(untick to hide it when recording new leave; history is kept)' : '(required by Chuti)'}
              </label>
            )}
          </div>
          <div className="form-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={isPending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>{isPending ? 'Saving…' : editing ? 'Save changes' : 'Add leave type'}</button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
