'use client';

import { useId, useState } from 'react';
import Modal from './Modal';
import { DialogHeader } from './ui';

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

// Mounted with a fresh `key` each time it opens (see ConfirmContext), so the
// typed-confirmation input always starts empty.
export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isDanger = false,
  confirmInputText,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const titleId = useId();
  const inputId = useId();
  const blocked = !!confirmInputText && typed.trim() !== confirmInputText;

  return (
    <Modal isOpen={isOpen} onClose={onCancel} maxWidth="440px" zIndex={1100} labelledBy={titleId}>
      <DialogHeader id={titleId} title={title} onClose={onCancel} />
      <p style={{ marginBottom: '1rem' }}>{message}</p>
      {confirmInputText && (
        <div className="field" style={{ marginBottom: '0.5rem' }}>
          <label className="field-label" htmlFor={inputId}>
            Type <strong>{confirmInputText}</strong> to confirm
          </label>
          <input
            id={inputId}
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            data-autofocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !blocked) onConfirm();
            }}
          />
        </div>
      )}
      <div className="form-footer">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {cancelText}
        </button>
        <button type="button" className={`btn ${isDanger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={blocked}>
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
