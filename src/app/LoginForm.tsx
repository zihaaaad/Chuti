'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { handleLogin } from './actions/auth';
import { Alert } from '@/components/ui';

export default function LoginForm() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(handleLogin, null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="form-grid">
      {state && !state.success && (
        <Alert tone="danger" live>
          {state.error}
        </Alert>
      )}

      <div className="field">
        <label className="field-label" htmlFor="password">Password</label>
        <div className="input-with-icon" style={{ position: 'relative' }}>
          <Lock size={16} aria-hidden />
          <input
            className="input"
            type={show ? 'text' : 'password'}
            id="password"
            name="password"
            autoComplete="current-password"
            required
            autoFocus
            disabled={isPending}
            aria-invalid={state && !state.success ? true : undefined}
            style={{ paddingRight: '2.5rem' }}
          />
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            style={{ position: 'absolute', right: 3, top: 3, width: 32, height: 32 }}
          >
            {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          </button>
        </div>
      </div>

      <button className="btn btn-primary btn-block" type="submit" disabled={isPending}>
        {isPending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
