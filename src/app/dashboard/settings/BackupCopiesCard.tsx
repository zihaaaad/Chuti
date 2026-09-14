'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FolderOpen, FolderSync, HardDrive, Lock, RotateCcw, Save } from 'lucide-react';
import { restoreBackupCopy, runBackupCopyNow, stopBackupCopies, updateBackupCopySchedule } from '@/app/actions/maintenance';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import Modal from '@/components/Modal';
import { Alert, DialogHeader, EmptyState, Field } from '@/components/ui';
import BackupProtection, { type EncryptionView } from './BackupProtection';

export interface BackupCopiesView {
  folder: string | null;
  source: 'desktop' | 'environment' | null;
  enabled: boolean;
  hour: number;
  keep: number;
  lastSuccessAt: string | null;
  lastFile: string | null;
  lastSize: number | null;
  lastErrorAt: string | null;
  lastError: string | null;
  sameDriveAsData: boolean;
  folderReachable: boolean;
  folderSync: string | null;
  dataFolderSync: string | null;
  health: 'ok' | 'overdue' | 'failing' | 'off' | 'unset';
  copies: { name: string; size: number; createdAt: string; encrypted: boolean }[];
  encryption: EncryptionView;
}

interface DesktopBridge {
  chooseBackupFolder?: () => Promise<{ ok: boolean; canceled?: boolean; error?: string; folder?: string }>;
  openBackupFolder?: () => Promise<boolean>;
}

function bridge(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as { chuti?: DesktopBridge }).chuti;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export default function BackupCopiesCard({ view }: { view: BackupCopiesView }) {
  const router = useRouter();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [isDesktop, setIsDesktop] = useState(false);
  const [schedule, setSchedule] = useState({ enabled: view.enabled, hour: String(view.hour), keep: String(view.keep) });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDesktop(!!bridge()?.chooseBackupFolder);
  }, []);

  const chooseFolder = () =>
    startTransition(async () => {
      const res = await bridge()?.chooseBackupFolder?.();
      if (!res || res.canceled) return;
      if (res.ok) {
        showToast(`Backup copies will be saved to ${res.folder}. Choose “Back up now” to make the first one.`, 'success');
        router.refresh();
      } else {
        showToast(res.error ?? 'That folder could not be used.', 'error');
      }
    });

  const backUpNow = () =>
    startTransition(async () => {
      const res = await runBackupCopyNow();
      showToast(res.success ? `Saved ${res.data.name} with ${res.data.attachments} attachment${res.data.attachments === 1 ? '' : 's'}.` : res.error, res.success ? 'success' : 'error');
      router.refresh();
    });

  const saveSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set('enabled', String(schedule.enabled));
    fd.set('hour', schedule.hour);
    fd.set('keep', schedule.keep);
    startTransition(async () => {
      const res = await updateBackupCopySchedule(fd);
      showToast(res.success ? 'Backup schedule saved.' : res.error, res.success ? 'success' : 'error');
    });
  };

  const stop = async () => {
    const ok = await confirm({
      title: 'Stop saving backup copies?',
      message: 'Chuti will stop saving copies to this folder. Copies already there are kept. You can choose a folder again from the desktop app.',
      confirmText: 'Stop backup copies',
      isDanger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await stopBackupCopies();
      showToast(res.success ? 'Backup copies stopped.' : res.error, res.success ? 'success' : 'error');
      router.refresh();
    });
  };

  const [secretFor, setSecretFor] = useState<{ name: string; message: string } | null>(null);

  const doRestore = (name: string, secret?: string) =>
    startTransition(async () => {
      const res = await restoreBackupCopy(name, secret);
      if (res.success) {
        setSecretFor(null);
        showToast(`Restored, including ${res.data.attachments} attachment${res.data.attachments === 1 ? '' : 's'}.`, 'success');
        router.refresh();
      } else if (res.code === 'SECRET_REQUIRED') {
        setSecretFor({ name, message: res.error });
      } else {
        setSecretFor(null);
        showToast(res.error, 'error');
      }
    });

  const restore = async (copy: BackupCopiesView['copies'][number]) => {
    const ok = await confirm({
      title: 'Restore this backup copy?',
      message: `All data will be replaced with the copy from ${when(copy.createdAt)}, and its attachments will be put back. Anything recorded after that is lost. A copy of the current data is saved first.`,
      confirmText: 'Restore copy',
      confirmInputText: 'RESTORE',
      isDanger: true,
    });
    if (ok) doRestore(copy.name);
  };

  return (
    <section className="card" id="backup-copies" aria-labelledby="copies-title">
      <div className="card-head">
        <div>
          <h2 id="copies-title"><HardDrive size={18} aria-hidden /> Backup copies</h2>
          <p>Full copies of your data and attachments, saved to a folder you choose on this computer.</p>
        </div>
      </div>

      <div className="form-grid">
        {view.dataFolderSync && (
          <Alert tone="danger">
            Chuti&apos;s data folder is inside {view.dataFolderSync}. The live database, including staff details and medical attachments, is being uploaded to {view.dataFolderSync} <strong>unencrypted</strong>, and syncing a database while it is in use can corrupt it. Move it to a local folder such as <code>C:\ChutiData</code>: close Chuti, move the folder, then use File → Change Data Folder.
          </Alert>
        )}
        {!view.folder ? (
          <>
            <Alert tone="warning">
              Automatic backups are stored in Chuti&apos;s own data folder. If that drive fails, they are lost too. Choose a second drive, a USB drive, or a Google Drive / OneDrive synced folder.
            </Alert>
            {isDesktop ? (
              <div>
                <button type="button" className="btn btn-primary" onClick={chooseFolder} disabled={isPending}>
                  <FolderSync size={16} aria-hidden /> Choose backup folder…
                </button>
              </div>
            ) : (
              <p className="subtle">
                Open Chuti on the host computer to choose the folder. When running from source, set the <code>CHUTI_BACKUP_DIR</code> environment variable instead.
              </p>
            )}
          </>
        ) : (
          <>
            <dl className="dl">
              <dt>Folder</dt>
              <dd style={{ wordBreak: 'break-all' }}>
                {view.folder}
                {view.source === 'environment' && <span className="subtle"> (from CHUTI_BACKUP_DIR)</span>}
              </dd>
              <dt>Last copy</dt>
              <dd>
                {view.lastSuccessAt ? `${when(view.lastSuccessAt)}${view.lastSize ? ` · ${formatSize(view.lastSize)}` : ''}` : 'None yet'}
              </dd>
            </dl>

            {!view.folderReachable && <Alert tone="danger">The folder is not available. Reconnect the drive, or choose another folder.</Alert>}
            {view.health === 'failing' && view.lastError && view.folderReachable && (
              <Alert tone="danger">The last copy failed{view.lastErrorAt ? ` on ${when(view.lastErrorAt)}` : ''}: {view.lastError}</Alert>
            )}
            {view.health === 'overdue' && view.folderReachable && <Alert tone="warning">No copy has been saved in the last 48 hours.</Alert>}
            {view.sameDriveAsData && !view.folderSync && (
              <Alert tone="warning">This folder is on the same drive as Chuti&apos;s data. If that drive fails you lose both. Prefer a USB drive, a second disk or a synced cloud folder.</Alert>
            )}
            {view.folderSync && (
              <p className="subtle">This folder syncs to {view.folderSync}, so every copy is also stored in that account. Turn on 2-step verification for it and never share the folder.</p>
            )}

            <BackupProtection encryption={view.encryption} folderSync={view.folderSync} isDesktop={isDesktop} onChanged={() => router.refresh()} />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={backUpNow}
                disabled={isPending || !view.folderReachable || view.encryption.mode === 'unset' || (view.encryption.mode === 'on' && !view.encryption.unlocked)}
              >
                <Save size={16} aria-hidden /> {isPending ? 'Working…' : 'Back up now'}
              </button>
              {isDesktop && (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => bridge()?.openBackupFolder?.()} disabled={!view.folderReachable}>
                    <FolderOpen size={16} aria-hidden /> Open folder
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={chooseFolder} disabled={isPending}>Change folder…</button>
                </>
              )}
              {view.source !== 'environment' && (
                <button type="button" className="btn btn-ghost" onClick={stop} disabled={isPending}>Stop</button>
              )}
            </div>

            <form onSubmit={saveSchedule} className="fieldset form-grid" style={{ marginTop: '0.25rem' }}>
              <label className="check">
                <input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule((s) => ({ ...s, enabled: e.target.checked }))} disabled={isPending} />
                Save a copy automatically every day
              </label>
              <div className="form-grid cols-2">
                <Field label="At" htmlFor="copy-hour" hint="If the computer is off then, the copy is made when Chuti next runs.">
                  <select id="copy-hour" className="select" value={schedule.hour} onChange={(e) => setSchedule((s) => ({ ...s, hour: e.target.value }))} disabled={isPending || !schedule.enabled} aria-describedby="copy-hour-hint">
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Copies to keep" htmlFor="copy-keep" hint="Older copies are deleted after a new one is saved.">
                  <input id="copy-keep" className="input num" type="number" min={1} max={365} value={schedule.keep} onChange={(e) => setSchedule((s) => ({ ...s, keep: e.target.value }))} disabled={isPending} aria-describedby="copy-keep-hint" />
                </Field>
              </div>
              <div><button type="submit" className="btn btn-secondary btn-sm" disabled={isPending}>Save schedule</button></div>
            </form>

            {view.copies.length === 0 ? (
              view.folderReachable && <EmptyState title="No copies in this folder yet" />
            ) : (
              <div className="table-wrap table-scroll">
                <table className="table">
                  <thead><tr><th>Saved</th><th className="num">Size</th><th className="right"><span className="sr-only">Restore</span></th></tr></thead>
                  <tbody>
                    {view.copies.map((c) => (
                      <tr key={c.name}>
                        <td className="nowrap" title={c.name}>
                          {when(c.createdAt)}{' '}
                          {c.encrypted ? (
                            <span className="badge badge-success" title="Encrypted"><Lock size={11} aria-hidden /> Encrypted</span>
                          ) : (
                            <span className="badge badge-warning">Not encrypted</span>
                          )}
                        </td>
                        <td className="num">{formatSize(c.size)}</td>
                        <td className="right">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => restore(c)} disabled={isPending}>
                            <RotateCcw size={14} aria-hidden /> Restore
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {secretFor && (
        <RestoreSecretDialog
          name={secretFor.name}
          message={secretFor.message}
          pending={isPending}
          onCancel={() => setSecretFor(null)}
          onSubmit={(secret) => doRestore(secretFor.name, secret)}
        />
      )}
    </section>
  );
}

function RestoreSecretDialog({ name, message, pending, onCancel, onSubmit }: { name: string; message: string; pending: boolean; onCancel: () => void; onSubmit: (secret: string) => void }) {
  const titleId = useId();
  const [secret, setSecret] = useState('');
  return (
    <Modal isOpen onClose={onCancel} labelledBy={titleId} maxWidth="480px" locked={pending}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (secret) onSubmit(secret);
        }}
        noValidate
      >
        <DialogHeader id={titleId} title="This copy is encrypted" description={name} onClose={onCancel} />
        <div className="form-grid">
          <Alert tone="info" live>{message}</Alert>
          <Field label="Backup password or recovery code" htmlFor="restore-secret" required hint="Type it only on the Chuti computer or over a network you trust.">
            <input id="restore-secret" className="input" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} disabled={pending} aria-describedby="restore-secret-hint" data-autofocus />
          </Field>
        </div>
        <div className="form-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>Cancel</button>
          <button type="submit" className="btn btn-danger" disabled={pending || !secret}>{pending ? 'Restoring…' : 'Restore copy'}</button>
        </div>
      </form>
    </Modal>
  );
}
