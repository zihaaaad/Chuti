'use client';

import { useEffect, useRef } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  labelledBy?: string;
  zIndex?: number;
  className?: string;
  dialogStyle?: React.CSSProperties;
  overlayClassName?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Shared overlay + focus-management shell for every modal in the app: traps Tab within the
// dialog, restores focus to whatever triggered it on close, and closes on Escape or a
// backdrop click. Individual modals just supply their header/form/footer as children.
export default function Modal({
  isOpen,
  onClose,
  children,
  maxWidth = '550px',
  labelledBy,
  zIndex = 100,
  className = 'card',
  dialogStyle,
  overlayClassName
}: ModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      const container = containerRef.current;
      const initialFocusTarget = container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      initialFocusTarget?.focus();

      return () => {
        previouslyFocused.current?.focus();
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const container = containerRef.current;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab' && container) {
        const focusableEls = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
          (el) => el.offsetParent !== null
        );
        if (focusableEls.length === 0) return;

        const first = focusableEls[0];
        const last = focusableEls[focusableEls.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={overlayClassName}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex,
        backdropFilter: 'blur(2px)',
        padding: '1rem',
        animation: 'fade-in 0.15s ease-out'
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={className}
        style={{
          width: '100%',
          maxWidth,
          maxHeight: '90vh',
          overflowY: 'auto',
          position: 'relative',
          backgroundColor: '#ffffff',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border)',
          animation: 'popup-scale-in 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
          ...dialogStyle
        }}
      >
        {children}
      </div>
    </div>
  );
}
