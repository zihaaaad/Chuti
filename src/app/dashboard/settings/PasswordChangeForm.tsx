'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { changeAdminPassword } from '@/app/actions/auth';
import { Alert, Field, fieldAria } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { MIN_PASSWORD_LENGTH_CLIENT } from '@/lib/constants';

export default function PasswordChangeForm({ redirectTo, submitLabel = 'Change password' }: { redirectTo?: string; submitLabel?: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await changeAdminPassword(fd);
      if (res.success) {
        setErrors({});
        setFormError(null);
        formRef.current?.reset();
        showToast('Password changed. Other signed-in browsers were signed out.', 'success');
        if (redirectTo) router.replace(redirectTo);
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.fieldErrors ? null : res.error);
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="form-grid" noValidate>
      {formError && <Alert tone="danger" live>{formError}</Alert>}
      <Field label="Current password" htmlFor="current_password" required error={errors.current_password}>
        <input className="input" type="password" name="current_password" autoComplete="current-password" disabled={isPending} {...fieldAria('current_password', errors.current_password)} />
      </Field>
      <Field label="New password" htmlFor="new_password" required error={errors.new_password} hint={`At least ${MIN_PASSWORD_LENGTH_CLIENT} characters.`}>
        <input className="input" type="password" name="new_password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH_CLIENT} disabled={isPending} {...fieldAria('new_password', errors.new_password, true)} />
      </Field>
      <Field label="Repeat new password" htmlFor="confirm_password" required error={errors.confirm_password}>
        <input className="input" type="password" name="confirm_password" autoComplete="new-password" disabled={isPending} {...fieldAria('confirm_password', errors.confirm_password)} />
      </Field>
      <div>
        <button type="submit" className="btn btn-primary" disabled={isPending}>
          {isPending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
