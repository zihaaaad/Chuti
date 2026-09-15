'use client';

import { useCallback, useEffect, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Cloud, CloudUpload, KeyRound, LogOut, RefreshCw, RotateCcw } from 'lucide-react';
import { updateCloudBackupSchedule } from '@/app/actions/maintenance';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import Modal from '@/components/Modal';
import { Alert, DialogHeader, EmptyState, Field } from '@/components/ui';
import BackupProtection, { type EncryptionView } from './BackupProtection';

type Provider = 'google' | 'onedrive';

const LABEL: Record<Provider, string> = { google: 'Google Drive', onedrive: 'OneDrive' };

export interface CloudBackupView {
  provider: Provider | null;
  account: string | null;
  enabled: boolean;
  hour: number;
  keep: number;
  lastSuccessAt: string | null;
  lastSize: number | null;
  lastErrorAt: string | null;
  lastError: string | null;
  health: 'ok' | 'overdue' | 'failing' | 'off' | 'unset';
  encryption: EncryptionView;
  /** Backup copies to a folder are set up, so their card already offers encryption settings. */
  folderChosen: boolean;
}

interface RemoteBackup { id: string; name: string; size: number; createdAt?: string }
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

interface CloudBridge {
  cloudStatus?: () => Promise<Result<{ available: boolean; provider: Provider | null; account: string | null; busy: string | null; configured: Record<Provider, string | null> }>>;
  cloudConnect?: (provider: Provider) => Promise<Result<{ account: string }>>;
  cloudDisconnect?: () => Promise<Result>;
  cloudBackupNow?: () => Promise<Result<{ name: string; size: number; pruned: number }>>;
  cloudList?: () => Promise<Result<{ backups: RemoteBackup[] }>>;
  cloudRestore?: (id: string, name: string, secret?: string, staged?: boolean) => Promise<Result<{ attachments: number }>>;
  cloudSetClient?: (provider: Provider, input: { clientId: string; clientSecret?: string } | null) => Promise<Result>;
}

function bridge(): CloudBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as { chuti?: CloudBridge }).chuti;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** "Chuti-Backup_2026-09-15_190000.chuti" → local date, as a fallback when the provider gives none. */
function nameDate(name: string): string | null {
  const m = /^Chuti-Backup_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString() : null;
}

export default function CloudBackupCard({ view }: { view: CloudBackupView }) {
  const router = useRouter();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [desktop, setDesktop] = useState<{ available: boolean; configured: Record<Provider, string | null> } | null>(null);
  const [backups, setBackups] = useState<RemoteBackup[] | null>(null);
  const [setupFor, setSetupFor] = useState<Provider | null>(null);
  const [secretFor, setSecretFor] = useState<{ backup: RemoteBackup; message: string } | null>(null);
  const [schedule, setSchedule] = useState({ enabled: view.enabled, hour: String(view.hour), keep: String(view.keep) });

  const refreshStatus = useCallback(async () => {
    const res = await bridge()?.cloudStatus?.();
    if (res?.ok) setDesktop({ available: res.available, configured: res.configured });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshStatus();
  }, [refreshStatus]);

  const isDesktop = !!desktop;
  const protectedOk = view.encryption.mode === 'on' && view.encryption.unlocked;

  const connect = (provider: Provider) =>
    startTransition(async () => {
      showToast(`Sign in to ${LABEL[provider]} in your browser, then come back to Chuti.`, 'info');
      const res = await bridge()?.cloudConnect?.(provider);
      if (!res) return;
      if (res.ok) {
        showToast(`Connected ${LABEL[provider]} (${res.account}). Choose “Back up now” to upload the first backup.`, 'success');
        setBackups(null);
        router.refresh();
      } else {
        showToast(res.error, 'error');
      }
    });

  const disconnect = async () => {
    const ok = await confirm({
      title: `Disconnect ${view.provider ? LABEL[view.provider] : 'the cloud account'}?`,
      message: 'Chuti stops uploading backups and forgets the sign-in on this computer. Backups already in the account are kept.',
      confirmText: 'Disconnect',
      isDanger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await bridge()?.cloudDisconnect?.();
      showToast(res?.ok ? 'Cloud account disconnected.' : res?.error ?? 'Could not disconnect.', res?.ok ? 'success' : 'error');
      setBackups(null);
      router.refresh();
    });
  };

  const backUpNow = () =>
    startTransition(async () => {
      const res = await bridge()?.cloudBackupNow?.();
      if (!res) return;
      showToast(res.ok ? `Uploaded ${formatSize(res.size)} to ${view.provider ? LABEL[view.provider] : 'the cloud'}.` : res.error, res.ok ? 'success' : 'error');
      if (res.ok && backups) setBackups(null);
      router.refresh();
    });

  const loadBackups = () =>
    startTransition(async () => {
      const res = await bridge()?.cloudList?.();
      if (!res) return;
      if (res.ok) setBackups(res.backups);
      else showToast(res.error, 'error');
    });

  const doRestore = (backup: RemoteBackup, secret?: string, staged = false) =>
    startTransition(async () => {
      const res = await bridge()?.cloudRestore?.(backup.id, backup.name, secret, staged);
      if (!res) return;
      if (res.ok) {
        setSecretFor(null);
        showToast(`Restored from the cloud, including ${res.attachments} attachment${res.attachments === 1 ? '' : 's'}.`, 'success');
        router.refresh();
      } else if (res.code === 'SECRET_REQUIRED') {
        setSecretFor({ backup, message: res.error });
      } else {
        setSecretFor(null);
        showToast(res.error, 'error');
      }
    });

  const restore = async (backup: RemoteBackup) => {
    const made = backup.createdAt ?? nameDate(backup.name);
    const ok = await confirm({
      title: 'Restore this cloud backup?',
      message: `Chuti downloads the backup${made ? ` from ${when(made)}` : ''} and replaces all data and attachments with it. Anything recorded after that is lost. A copy of the current data is saved first.`,
      confirmText: 'Download and restore',
      confirmInputText: 'RESTORE',
      isDanger: true,
    });
    if (ok) doRestore(backup);
  };

  const saveSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set('enabled', String(schedule.enabled));
    fd.set('hour', schedule.hour);
    fd.set('keep', schedule.keep);
    startTransition(async () => {
      const res = await updateCloudBackupSchedule(fd);
      showToast(res.success ? 'Cloud backup schedule saved.' : res.error, res.success ? 'success' : 'error');
    });
  };

  const providerButtons = (Object.keys(LABEL) as Provider[]).map((p) => {
    const configured = desktop?.configured[p];
    return (
      <div key={p} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
        <button type="button" className="btn btn-secondary" onClick={() => connect(p)} disabled={isPending || !configured || !protectedOk || !desktop?.available}>
          <Cloud size={16} aria-hidden /> Connect {LABEL[p]}
        </button>
        {!configured && <span className="subtle">Not set up in this copy of Chuti.</span>}
        {configured !== 'environment' && configured !== 'bundled' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSetupFor(p)} disabled={isPending}>
            <KeyRound size={14} aria-hidden /> {configured === 'custom' ? 'Change app registration' : 'Use your own app registration'}
          </button>
        )}
      </div>
    );
  });

  return (
    <section className="card" id="cloud-backup" aria-labelledby="cloud-title">
      <div className="card-head">
        <div>
          <h2 id="cloud-title"><CloudUpload size={18} aria-hidden /> Cloud backup</h2>
          <p>Encrypted backups uploaded straight to your own Google Drive or OneDrive. Nothing passes through any other server.</p>
        </div>
      </div>

      <div className="form-grid">
        {view.encryption.mode !== 'on' && (
          <Alert tone="info">Cloud backups are always encrypted. Set a backup password first{view.folderChosen ? ' in Backup copies above' : ''}.</Alert>
        )}
        {view.encryption.mode === 'on' && !view.encryption.unlocked && view.folderChosen && (
          <Alert tone="warning">Backups are locked. Enter the backup password in Backup copies above so Chuti can encrypt new uploads.</Alert>
        )}
        {!view.folderChosen && !protectedOk && (
          <BackupProtection encryption={view.encryption} folderSync={null} isDesktop={isDesktop} onChanged={() => router.refresh()} allowUnencrypted={false} />
        )}

        {!view.provider ? (
          isDesktop ? (
            <>
              {desktop && !desktop.available && <Alert tone="danger">Windows cannot protect sign-in tokens for this user account, so cloud backup is unavailable here.</Alert>}
              <div className="form-grid">{providerButtons}</div>
              <p className="subtle">
                Chuti asks only for its own folder: Google Drive sees just the files Chuti creates (in “Chuti Backups”), and OneDrive only Apps/Chuti.
              </p>
            </>
          ) : (
            <p className="subtle">Open Chuti on the host computer to connect a cloud account.</p>
          )
        ) : (
          <>
            <dl className="dl">
              <dt>Account</dt>
              <dd>{LABEL[view.provider]}{view.account ? ` · ${view.account}` : ''}</dd>
              <dt>Last upload</dt>
              <dd>{view.lastSuccessAt ? `${when(view.lastSuccessAt)}${view.lastSize ? ` · ${formatSize(view.lastSize)}` : ''}` : 'None yet'}</dd>
            </dl>
            {view.health === 'failing' && view.lastError && (
              <Alert tone="danger">The last cloud backup failed{view.lastErrorAt ? ` on ${when(view.lastErrorAt)}` : ''}: {view.lastError}</Alert>
            )}
            {view.health === 'overdue' && <Alert tone="warning">No backup has been uploaded in the last 48 hours. The Chuti computer must be on and online at the scheduled time.</Alert>}

            {isDesktop ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                <button type="button" className="btn btn-primary" onClick={backUpNow} disabled={isPending || !protectedOk}>
                  <CloudUpload size={16} aria-hidden /> {isPending ? 'Working…' : 'Back up now'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={loadBackups} disabled={isPending}>
                  <RefreshCw size={16} aria-hidden /> {backups ? 'Refresh list' : 'Show backups'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={disconnect} disabled={isPending}>
                  <LogOut size={16} aria-hidden /> Disconnect
                </button>
              </div>
            ) : (
              <p className="subtle">Uploads, restores and disconnecting are done from Chuti on the host computer.</p>
            )}

            <form onSubmit={saveSchedule} className="fieldset form-grid">
              <label className="check">
                <input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule((s) => ({ ...s, enabled: e.target.checked }))} disabled={isPending} />
                Upload a backup automatically every day
              </label>
              <div className="form-grid cols-2">
                <Field label="At" htmlFor="cloud-hour" hint="If the computer is off or offline then, Chuti uploads when it next can.">
                  <select id="cloud-hour" className="select" value={schedule.hour} onChange={(e) => setSchedule((s) => ({ ...s, hour: e.target.value }))} disabled={isPending || !schedule.enabled} aria-describedby="cloud-hour-hint">
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}
                  </select>
                </Field>
                <Field label="Backups to keep" htmlFor="cloud-keep" hint="Older Chuti backups in the account are deleted after a successful upload.">
                  <input id="cloud-keep" className="input num" type="number" min={1} max={365} value={schedule.keep} onChange={(e) => setSchedule((s) => ({ ...s, keep: e.target.value }))} disabled={isPending} aria-describedby="cloud-keep-hint" />
                </Field>
              </div>
              <div><button type="submit" className="btn btn-secondary btn-sm" disabled={isPending}>Save schedule</button></div>
            </form>

            {backups && (
              backups.length === 0 ? (
                <EmptyState title="No Chuti backups in this account yet" />
              ) : (
                <div className="table-wrap table-scroll">
                  <table className="table">
                    <thead><tr><th>Uploaded</th><th className="num">Size</th><th className="right"><span className="sr-only">Restore</span></th></tr></thead>
                    <tbody>
                      {backups.map((b) => {
                        const made = b.createdAt ?? nameDate(b.name);
                        return (
                          <tr key={b.id}>
                            <td className="nowrap" title={b.name}>{made ? when(made) : b.name}</td>
                            <td className="num">{formatSize(b.size)}</td>
                            <td className="right">
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => restore(b)} disabled={isPending}>
                                <RotateCcw size={14} aria-hidden /> Restore
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </>
        )}
      </div>

      {setupFor && (
        <ClientSetupDialog
          provider={setupFor}
          custom={desktop?.configured[setupFor] === 'custom'}
          onClose={() => setSetupFor(null)}
          onSaved={() => {
            setSetupFor(null);
            void refreshStatus();
          }}
        />
      )}
      {secretFor && (
        <CloudSecretDialog
          name={secretFor.backup.name}
          message={secretFor.message}
          pending={isPending}
          onCancel={() => setSecretFor(null)}
          onSubmit={(secret) => doRestore(secretFor.backup, secret, true)}
        />
      )}
    </section>
  );
}

function ClientSetupDialog({ provider, custom, onClose, onSaved }: { provider: Provider; custom: boolean; onClose: () => void; onSaved: () => void }) {
  const titleId = useId();
  const { showToast } = useToast();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (input: { clientId: string; clientSecret?: string } | null) =>
    startTransition(async () => {
      const res = await bridge()?.cloudSetClient?.(provider, input);
      if (!res) return;
      if (res.ok) {
        showToast(input ? `${LABEL[provider]} app registration saved on this computer.` : 'App registration removed.', 'success');
        onSaved();
      } else {
        setError(res.error);
      }
    });

  return (
    <Modal isOpen onClose={onClose} labelledBy={titleId} maxWidth="560px" locked={pending}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(provider === 'google' ? { clientId, clientSecret } : { clientId });
        }}
        noValidate
      >
        <DialogHeader id={titleId} title={`Use your own ${LABEL[provider]} app registration`} description="Needed only when this copy of Chuti was built without one. Stored on this computer." onClose={onClose} />
        <div className="form-grid">
          {error && <Alert tone="danger" live>{error}</Alert>}
          {provider === 'google' ? (
            <ol className="subtle" style={{ paddingLeft: '1.2rem', display: 'grid', gap: '0.25rem' }}>
              <li>In Google Cloud Console, create a project and enable the <strong>Google Drive API</strong>.</li>
              <li>Set up the OAuth consent screen (External) with the <code>drive.file</code> scope, and <strong>publish it to production</strong>. In testing mode Google stops backups after 7 days.</li>
              <li>Create credentials → OAuth client ID → <strong>Desktop app</strong>, and paste its client ID and secret here.</li>
            </ol>
          ) : (
            <ol className="subtle" style={{ paddingLeft: '1.2rem', display: 'grid', gap: '0.25rem' }}>
              <li>In the Microsoft Entra admin center, register an app for <strong>accounts in any organization and personal Microsoft accounts</strong>.</li>
              <li>Add a <strong>Mobile and desktop</strong> platform with the redirect URI <code>http://localhost</code>, and allow public client flows.</li>
              <li>Add the delegated Graph permissions <code>Files.ReadWrite.AppFolder</code>, <code>User.Read</code> and <code>offline_access</code>, then paste the Application (client) ID here.</li>
            </ol>
          )}
          <Field label={provider === 'google' ? 'Client ID' : 'Application (client) ID'} htmlFor="cloud-client-id" required>
            <input id="cloud-client-id" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} disabled={pending} data-autofocus />
          </Field>
          {provider === 'google' && (
            <Field label="Client secret" htmlFor="cloud-client-secret" required hint="Google issues a secret for desktop clients; it is not treated as confidential.">
              <input id="cloud-client-secret" className="input" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" spellCheck={false} disabled={pending} aria-describedby="cloud-client-secret-hint" />
            </Field>
          )}
        </div>
        <div className="form-footer">
          {custom && <button type="button" className="btn btn-ghost" onClick={() => save(null)} disabled={pending} style={{ marginRight: 'auto' }}>Remove</button>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={pending || !clientId || (provider === 'google' && !clientSecret)}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function CloudSecretDialog({ name, message, pending, onCancel, onSubmit }: { name: string; message: string; pending: boolean; onCancel: () => void; onSubmit: (secret: string) => void }) {
  const titleId = useId();
  const [secret, setSecret] = useState('');
  return (
    <Modal isOpen onClose={onCancel} labelledBy={titleId} maxWidth="480px" locked={pending}>
      <form onSubmit={(e) => { e.preventDefault(); if (secret) onSubmit(secret); }} noValidate>
        <DialogHeader id={titleId} title="This backup needs its password" description={name} onClose={onCancel} />
        <div className="form-grid">
          <Alert tone="info" live>{message}</Alert>
          <Field label="Backup password or recovery code" htmlFor="cloud-restore-secret" required>
            <input id="cloud-restore-secret" className="input" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} disabled={pending} data-autofocus />
          </Field>
        </div>
        <div className="form-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>Cancel</button>
          <button type="submit" className="btn btn-danger" disabled={pending || !secret}>{pending ? 'Restoring…' : 'Restore'}</button>
        </div>
      </form>
    </Modal>
  );
}
