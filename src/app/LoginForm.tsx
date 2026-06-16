'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { handleLogin } from './actions';

export default function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError('Please enter your password.');
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.append('password', password);
      
      const res = await handleLogin(null, formData);
      if (res.success) {
        router.push('/dashboard');
        router.refresh();
      } else {
        setError(res.error || 'Login failed.');
      }
    });
  };

  return (
    <form onSubmit={onSubmit}>
      {error && (
        <div style={{
          backgroundColor: 'var(--error-bg)',
          color: 'var(--error)',
          padding: '0.75rem',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.8125rem',
          marginBottom: '1rem',
          border: '1px solid rgba(154, 32, 32, 0.1)'
        }}>
          {error}
        </div>
      )}
      
      <div className="form-group">
        <label className="form-label" htmlFor="username">Username</label>
        <input 
          className="form-control" 
          type="text" 
          id="username" 
          value="admin" 
          disabled 
          style={{ backgroundColor: '#f9fafb', color: '#9ca3af', cursor: 'not-allowed' }}
        />
      </div>

      <div className="form-group" style={{ marginBottom: '1.5rem' }}>
        <label className="form-label" htmlFor="password">Password</label>
        <input 
          className="form-control" 
          type="password" 
          id="password" 
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isPending}
          autoFocus
        />
      </div>

      <button 
        className="btn btn-primary" 
        type="submit" 
        disabled={isPending}
        style={{ width: '100%', padding: '0.75rem' }}
      >
        {isPending ? 'Logging in...' : 'Sign In'}
      </button>
    </form>
  );
}
