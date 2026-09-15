'use client';

import { useId, useState, useTransition } from 'react';
import { KeyRound, Lock, LockOpen, ShieldAlert, ShieldCheck } from 'lucide-react';
import Modal from '@/components/Modal';
import { Alert, DialogHeader, Field } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';

export interface EncryptionView {
  mode: 'unset' | 'on' | 'off';
  unlocked: boolean;
  envManaged: boolean;
}

interface Bridge {
  enableBackupEncryption?: (password: string) => Promise<{ ok: boolean; error?: string; recoveryCode?: string; remembered?: boolean }>;
  changeBackupPassword?: (current: string, password: string) => Promise<{ ok: boolean; error?: string; remembered?: boolean }>;
  unlockBackupEncryption?: (secret: string) => Promise<{ ok: boolean; error?: string; remembered?: boolean }>;
  disableBackupEncryption?: () => Promise<{ ok: boolean; error?: string }>;
}

function bridge(): Bridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as { chuti?: Bridge }).chuti;
}

const MIN = 12;

export default function BackupProtection({
  encryption,
  folderSync,
  isDesktop,
  onChanged,
  allowUnencrypted = true,
}: {
  encryption: EncryptionView;
  folderSync: string | null;
  isDesktop: boolean;
  onChanged: () => void;
  /** False where encryption is mandatory (cloud backup): hides the no-password options. */
  allowUnencrypted?: boolean;
}) {
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [dialog, setDialog] = useState<'set' | 'change' | 'unlock' | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const saveWithoutPassword = async () => {
    const ok = await confirm({
      title: 'Save copies without a password?',
      message: folderSync
        ? `Your backup folder syncs to ${folderSync}. Without a password, anyone who gets into that ${folderSync} account, or receives a share link, can open every copy: staff details, leave reasons and medical attachments.`
        : 'Anyone who gets hold of a copy (for example the USB drive) can open it and read all staff data and attachments.',
      confirmText: 'Save without a password',
      confirmInputText: folderSync ? 'NO PASSWORD' : undefined,
      isDanger: true,
    });
    if (!ok) return;
    const res = await bridge()?.disableBackupEncryption?.();
    if (res?.ok) {
      showToast('Backup copies will be saved without encryption.', 'warning');
      onChanged();
    } else {
      showToast(res?.error ?? 'Could not change protection.', 'error');
    }
  };

  const status = (() => {
    if (encryption.mode === 'on' && encryption.unlocked) {
      return <Alert tone="success"><strong>Protected.</strong> Copies are encrypted (AES-256) and open only with your backup password or recovery code.</Alert>;
    }
    if (encryption.mode === 'on') {
      return <Alert tone="warning"><strong>Locked.</strong> Copies are protected, but the backup password hasn&apos;t been entered since Chuti started, so no new copies can be saved.</Alert>;
    }
    if (encryption.mode === 'off') {
      return (
        <Alert tone={folderSync ? 'danger' : 'warning'}>
          <strong>Not encrypted.</strong>{' '}
          {folderSync
            ? `Copies go to ${folderSync} unencrypted. Anyone with access to that account or a share link can read all staff data and attachments.`
            : 'Anyone who gets hold of a copy can read all staff data and attachments.'}
        </Alert>
      );
    }
    return (
      <Alert tone="warning">
        <strong>Choose how copies are protected.</strong> Chuti won&apos;t save any copies until you do.
        {folderSync && ` This folder syncs to ${folderSync}, so copies will leave this computer.`}
      </Alert>
    );
  })();

  return (
    <div className="fieldset form-grid" aria-labelledby="protection-title">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        {encryption.mode === 'on' ? <ShieldCheck size={16} aria-hidden /> : <ShieldAlert size={16} aria-hidden />}
        <strong id="protection-title">Protection</strong>
      </div>
      {status}

      {encryption.envManaged ? (
        <p className="subtle">Protection is managed with the CHUTI_BACKUP_PASSWORD / CHUTI_BACKUP_ENCRYPTION environment variables.</p>
      ) : !isDesktop ? (
        <p className="subtle">Backup protection can only be changed in the Chuti app on the host computer.</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {encryption.mode !== 'on' && (
            <button type="button" className="btn btn-primary" onClick={() => setDialog('set')}>
              <Lock size={16} aria-hidden /> Set a backup password
            </button>
          )}
          {encryption.mode === 'unset' && allowUnencrypted && (
            <button type="button" className="btn btn-ghost" onClick={saveWithoutPassword}>Save without a password</button>
          )}
          {encryption.mode === 'on' && !encryption.unlocked && (
            <button type="button" className="btn btn-primary" onClick={() => setDialog('unlock')}>
              <LockOpen size={16} aria-hidden /> Unlock with password
            </button>
          )}
          {encryption.mode === 'on' && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setDialog('change')}>
                <KeyRound size={16} aria-hidden /> Change password
              </button>
              {allowUnencrypted && <button type="button" className="btn btn-ghost" onClick={saveWithoutPassword}>Turn off protection</button>}
            </>
          )}
        </div>
      )}

      {dialog === 'set' && (
        <PasswordDialog
          mode="set"
          onClose={() => setDialog(null)}
          onDone={(code) => {
            setDialog(null);
            if (code) setRecoveryCode(code);
            onChanged();
          }}
        />
      )}
      {dialog === 'change' && (
        <PasswordDialog
          mode="change"
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            showToast('Backup password changed. Older copies still open with the old password or the recovery code.', 'success');
            onChanged();
          }}
        />
      )}
      {dialog === 'unlock' && (
        <UnlockDialog
          onClose={() => setDialog(null)}
          onDone={(remembered) => {
            setDialog(null);
            showToast(remembered ? 'Unlocked. Chuti will stay unlocked on this computer after restarts.' : 'Unlocked until Chuti is closed.', 'success');
            onChanged();
          }}
        />
      )}
      {recoveryCode && <RecoveryCodeDialog code={recoveryCode} onClose={() => setRecoveryCode(null)} />}
    </div>
  );
}

function PasswordDialog({ mode, onClose, onDone }: { mode: 'set' | 'change'; onClose: () => void; onDone: (recoveryCode?: string) => void }) {
  const titleId = useId();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const tooShort = password.length > 0 && password.length < MIN;
  const mismatch = repeat.length > 0 && repeat !== password;
  const canSubmit = password.length >= MIN && repeat === password && (mode === 'set' || current.length > 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const res: { ok: boolean; error?: string; recoveryCode?: string } | undefined =
        mode === 'set' ? await bridge()?.enableBackupEncryption?.(password) : await bridge()?.changeBackupPassword?.(current, password);
      if (res?.ok) onDone(res.recoveryCode);
      else setError(res?.error ?? 'Could not save the backup password.');
    });
  };

  return (
    <Modal isOpen onClose={onClose} labelledBy={titleId} maxWidth="500px" locked={isPending}>
      <form onSubmit={submit} noValidate>
        <DialogHeader
          id={titleId}
          title={mode === 'set' ? 'Set a backup password' : 'Change the backup password'}
          description={mode === 'set' ? 'Every backup copy will be encrypted. You will need this password, or the recovery code shown next, to restore a copy on another computer.' : 'New copies use the new password. Copies made earlier still open with the old password or the recovery code.'}
          onClose={onClose}
        />
        <div className="form-grid">
          {error && <Alert tone="danger" live>{error}</Alert>}
          {mode === 'change' && (
            <Field label="Current password or recovery code" htmlFor="bp-current" required>
              <input id="bp-current" className="input" type="password" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={isPending} data-autofocus />
            </Field>
          )}
          <Field label="New backup password" htmlFor="bp-new" required error={tooShort ? `Use at least ${MIN} characters.` : undefined} hint="A short sentence works well, e.g. “green kettle in staff room 7”. Don't reuse the admin password.">
            <input id="bp-new" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={isPending} aria-describedby="bp-new-hint" data-autofocus={mode === 'set' ? true : undefined} />
          </Field>
          <Field label="Repeat the password" htmlFor="bp-repeat" required error={mismatch ? 'The passwords do not match.' : undefined}>
            <input id="bp-repeat" className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} disabled={isPending} />
          </Field>
          <p className="subtle">Chuti cannot recover a lost password. Without it or the recovery code, encrypted copies cannot be opened by anyone, including you.</p>
        </div>
        <div className="form-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={isPending || !canSubmit}>
            {isPending ? 'Securing… (this takes a moment)' : mode === 'set' ? 'Set password' : 'Change password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UnlockDialog({ onClose, onDone }: { onClose: () => void; onDone: (remembered: boolean) => void }) {
  const titleId = useId();
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await bridge()?.unlockBackupEncryption?.(secret);
      if (res?.ok) onDone(!!res.remembered);
      else setError(res?.error ?? 'Could not unlock.');
    });
  };

  return (
    <Modal isOpen onClose={onClose} labelledBy={titleId} maxWidth="460px" locked={isPending}>
      <form onSubmit={submit} noValidate>
        <DialogHeader id={titleId} title="Unlock backup copies" description="Enter the backup password or the recovery code." onClose={onClose} />
        <div className="form-grid">
          {error && <Alert tone="danger" live>{error}</Alert>}
          <Field label="Backup password or recovery code" htmlFor="bp-unlock" required>
            <input id="bp-unlock" className="input" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} disabled={isPending} data-autofocus />
          </Field>
        </div>
        <div className="form-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={isPending || !secret}>{isPending ? 'Checking…' : 'Unlock'}</button>
        </div>
      </form>
    </Modal>
  );
}

function RecoveryCodeDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const titleId = useId();
  const [saved, setSaved] = useState(false);
  const { showToast } = useToast();

  const download = () => {
    const text = `Chuti backup recovery code\n\n${code}\n\nThis code opens every encrypted Chuti backup copy if the backup password is lost.\nKeep it offline and away from the backup folder. Created ${new Date().toLocaleString('en-GB')}.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Chuti-backup-recovery-code.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Modal isOpen onClose={() => saved && onClose()} labelledBy={titleId} maxWidth="560px" locked={!saved}>
      <DialogHeader id={titleId} title="Save your recovery code" description="It is shown only once. It opens every encrypted copy if the backup password is forgotten." onClose={() => saved && onClose()} />
      <div className="form-grid">
        <div
          style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '1.15rem', letterSpacing: '0.04em', textAlign: 'center', padding: '1rem', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-md)', background: 'var(--surface-muted)', userSelect: 'all', wordBreak: 'break-word' }}
          aria-label="Recovery code"
        >
          {code}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(code).then(() => showToast('Recovery code copied.', 'success'))}>Copy</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={download}>Save as text file</button>
        </div>
        <Alert tone="warning">
          Write it down or print it and keep it with other important papers. Do <strong>not</strong> store it in the backup folder or the same cloud account, or anyone who gets the copies gets the key too.
        </Alert>
        <label className="check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I have stored the recovery code somewhere safe
        </label>
      </div>
      <div className="form-footer">
        <button type="button" className="btn btn-primary" disabled={!saved} onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
