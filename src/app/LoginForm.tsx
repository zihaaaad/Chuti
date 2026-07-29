'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { handleLogin } from './actions';
import { Lock, ArrowRight, AlertCircle } from 'lucide-react';

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
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {error && (
        <div className="popup-scale-in" style={{
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          color: '#ef4444',
          padding: '0.875rem 1rem',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.875rem',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontWeight: '500'
        }}>
          <AlertCircle size={18} />
          {error}
        </div>
      )}
      
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" htmlFor="username" style={{ fontWeight: '600', color: '#374151' }}>Username</label>
        <div style={{ position: 'relative' }}>
          <input 
            className="form-control" 
            type="text" 
            id="username" 
            value="admin" 
            disabled 
            style={{ 
              backgroundColor: '#f3f4f6', 
              color: '#9ca3af', 
              cursor: 'not-allowed',
              paddingLeft: '1rem',
              fontWeight: '500',
              border: '1px solid #e5e7eb'
            }}
          />
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" htmlFor="password" style={{ fontWeight: '600', color: '#374151' }}>Password</label>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', display: 'flex' }}>
            <Lock size={18} />
          </div>
          <input 
            className="form-control" 
            type="password" 
            id="password" 
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isPending}
            autoFocus
            style={{ 
              paddingLeft: '2.75rem',
              fontWeight: '500',
              transition: 'all 0.2s',
              border: '1px solid #d1d5db',
              boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
            }}
          />
        </div>
      </div>

      <button 
        className="btn btn-primary" 
        type="submit" 
        disabled={isPending}
        style={{ 
          width: '100%', 
          padding: '0.875rem', 
          marginTop: '0.5rem',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '0.5rem',
          fontWeight: '600',
          fontSize: '0.9375rem',
          boxShadow: '0 4px 6px -1px rgba(46, 139, 87, 0.2), 0 2px 4px -1px rgba(46, 139, 87, 0.1)'
        }}
      >
        {isPending ? 'Authenticating...' : 'Sign In to Console'}
        {!isPending && <ArrowRight size={18} />}
      </button>
    </form>
  );
}
