'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileUp } from 'lucide-react';
import { importHolidays } from '@/app/actions/settings';
import type { ParsedHolidayRow } from '@/lib/domain/holidays-csv';
import Modal from '@/components/Modal';
import { Alert, DialogHeader, Field } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { formatDisplayRange } from '@/lib/domain/dates';

const STATUS_LABEL: Record<ParsedHolidayRow['status'], { text: string; tone: string }> = {
  new: { text: 'Will be added', tone: 'badge-success' },
  duplicate: { text: 'Already listed', tone: '' },
  invalid: { text: 'Skipped', tone: 'badge-danger' },
};

export default function HolidayImport() {
  const router = useRouter();
  const { showToast } = useToast();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedHolidayRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reset = () => {
    setFile(null);
    setRows(null);
    setError(null);
  };

  const run = (apply: boolean) => {
    if (!file) return;
    const fd = new FormData();
    fd.set('file', file);
    setError(null);
    startTransition(async () => {
      const res = await importHolidays(fd, apply);
      if (!res.success) return setError(res.error);
      if (apply) {
        showToast(`Added ${res.data.added} holiday${res.data.added === 1 ? '' : 's'}.`, 'success');
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setRows(res.data.rows);
      }
    });
  };

  const newCount = rows?.filter((r) => r.status === 'new').length ?? 0;

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { reset(); setOpen(true); }}>
        <FileUp size={14} aria-hidden /> Import from file
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} labelledBy={titleId} maxWidth="680px" locked={isPending}>
        <DialogHeader
          id={titleId}
          title="Import holidays"
          description="Upload the official holiday list as a CSV file. You'll see what will be added before anything is saved."
          onClose={() => setOpen(false)}
        />
        <div className="form-grid">
          {error && <Alert tone="danger" live>{error}</Alert>}
          <p>
            Columns: <code>Title, StartDate, EndDate</code>. EndDate is optional for one-day holidays. Dates can be written <code>2026-03-26</code> or <code>26/03/2026</code>.
          </p>
          <Alert tone="info">Eid, Durga Puja and other moon- or calendar-dependent holidays move every year. Take their dates from the government&apos;s official holiday list.</Alert>
          <a href="/holidays_template.csv" download className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }}>
            <Download size={14} aria-hidden /> Download template
          </a>
          <Field label="CSV file" htmlFor="holiday-file" required>
            <input id="holiday-file" className="input" type="file" accept=".csv,text/csv" disabled={isPending} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRows(null); }} />
          </Field>

          {rows && (
            <>
              <p className="subtle">
                {newCount} to add, {rows.filter((r) => r.status === 'duplicate').length} already listed, {rows.filter((r) => r.status === 'invalid').length} with problems.
              </p>
              <div className="table-wrap table-scroll">
                <table className="table">
                  <thead><tr><th className="num">Line</th><th>Holiday</th><th>Dates</th><th>Result</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.line}>
                        <td className="num">{r.line}</td>
                        <td>{r.title || <span className="subtle">(no name)</span>}</td>
                        <td className="nowrap">{r.status === 'invalid' ? `${r.start_date} ${r.end_date}`.trim() : formatDisplayRange(r.start_date, r.end_date)}</td>
                        <td>
                          <span className={`badge ${STATUS_LABEL[r.status].tone}`}>{STATUS_LABEL[r.status].text}</span>
                          {r.problem && r.status === 'invalid' && <span className="sub">{r.problem}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="form-footer">
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={isPending}>Cancel</button>
          {rows ? (
            <button type="button" className="btn btn-primary" onClick={() => run(true)} disabled={isPending || newCount === 0}>
              {isPending ? 'Adding…' : `Add ${newCount} holiday${newCount === 1 ? '' : 's'}`}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => run(false)} disabled={isPending || !file}>
              {isPending ? 'Reading…' : 'Preview'}
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
