'use client';

import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDanger?: boolean;
  confirmInputText?: string;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isDanger = false,
  confirmInputText
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState('');

  if (!isOpen) return null;

  const isConfirmDisabled = confirmInputText ? inputValue !== confirmInputText : false;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(9, 9, 11, 0.4)', // neutral dark overlay
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100000,
      backdropFilter: 'blur(4px)',
      animation: 'fade-in 0.05s ease-out'
    }}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: 'var(--radius-lg)',
        padding: '1.5rem',
        width: '90%',
        maxWidth: '400px',
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--border)',
        animation: 'popup-scale-in 0.05s ease-out'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '2.5rem',
            height: '2.5rem',
            borderRadius: '50%',
            backgroundColor: isDanger ? 'var(--error-bg)' : 'var(--success-bg)',
            color: isDanger ? 'var(--error)' : 'var(--success)'
          }}>
            <AlertTriangle size={20} />
          </div>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--primary)', flex: 1 }}>{title}</h3>
          <button 
            onClick={onCancel}
            className="btn-close"
            style={{ padding: '0.25rem' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Message */}
        <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', marginBottom: '1.25rem', lineHeight: '1.5' }}>
          {message}
        </p>

        {/* Optional Input Confirmation */}
        {confirmInputText && (
          <div style={{ marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--foreground-muted)', marginBottom: '0.5rem' }}>
              Please type <strong style={{ color: 'var(--error)' }}>{confirmInputText}</strong> to confirm:
            </p>
            <input
              type="text"
              className="form-control"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={confirmInputText}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                fontSize: '0.875rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                outline: 'none'
              }}
            />
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button 
            onClick={onCancel}
            className="btn btn-secondary"
            style={{ padding: '0.5rem 1rem' }}
          >
            {cancelText}
          </button>
          <button 
            onClick={onConfirm}
            disabled={isConfirmDisabled}
            className={isDanger ? 'btn btn-danger' : 'btn btn-primary'}
            style={{ 
              padding: '0.5rem 1rem',
              opacity: isConfirmDisabled ? 0.5 : 1,
              cursor: isConfirmDisabled ? 'not-allowed' : 'pointer'
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
