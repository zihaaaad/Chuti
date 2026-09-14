import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { Alert, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'User guide' };

const SECTIONS = [
  { id: 'start', title: 'Getting started' },
  { id: 'employees', title: 'Employees & CSV import' },
  { id: 'leave', title: 'Recording leave' },
  { id: 'lates', title: 'Late arrivals & encashment' },
  { id: 'reports', title: 'Reports & printing' },
  { id: 'policy', title: 'Leave policy' },
  { id: 'year', title: 'Closing a leave year' },
  { id: 'data', title: 'Backups, security & LAN' },
];

export default async function GuidePage() {
  await requireAdmin();

  return (
    <>
      <PageHeader title="User guide" description="How to set up Chuti and run leave administration day to day." />
      <div className="guide">
        <nav aria-label="Guide sections" className="card" style={{ padding: '0.5rem' }}>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="nav-link">{s.title}</a>
          ))}
        </nav>

        <article className="card">
          <section id="start">
            <h2>Getting started</h2>
            <p>Chuti runs on one computer and keeps all data in its data folder: the database, uploaded documents and backups. Nothing is sent to the internet.</p>
            <h3>First-time setup</h3>
            <ol>
              <li>Sign in and replace the default password when asked.</li>
              <li>In <strong>Settings</strong>, set the organisation name, weekly days off and the sandwich rule.</li>
              <li>Add this year&apos;s public holidays.</li>
              <li>Add employees one by one, or import them from a spreadsheet.</li>
            </ol>
          </section>

          <section id="employees">
            <h2>Employees &amp; CSV import</h2>
            <p>Each employee has a yearly quota for Casual (CL), Sick (SL), Earned (EL) and Maternity (ML) leave. Leave Without Pay (LWP) has no quota.</p>
            <h3>Importing from a spreadsheet</h3>
            <ol>
              <li>On <strong>Employees</strong>, choose <strong>Import CSV</strong> and download the template.</li>
              <li>Fill in <code>EmployeeID, Name, Designation, Department, Phone, JoiningDate, Email</code>. Dates use YYYY-MM-DD.</li>
              <li>In Excel, save as <strong>CSV UTF-8</strong>, then upload it.</li>
            </ol>
            <p>The import is all-or-nothing. Rows with an ID that already exists are skipped and listed with the reason.</p>
            <Alert tone="info">When someone leaves, edit them and set the status to <strong>Resigned</strong>. Deleting an employee erases their whole history, including past payroll.</Alert>
          </section>

          <section id="leave">
            <h2>Recording leave</h2>
            <ol>
              <li>On <strong>Leave records</strong>, choose <strong>Record leave</strong>.</li>
              <li>Search for the employee by name or ID.</li>
              <li>Pick the leave type and dates. Tick <strong>Half day</strong> for 0.5 days.</li>
              <li>Check the preview. It shows the days charged, how weekends and holidays were treated, and the balance before and after.</li>
              <li>Optionally attach a document (PDF, image or Word, up to 10 MB), then save.</li>
            </ol>
            <p>Chuti blocks leave that overlaps existing leave on the same day (two half days are fine), and leave that is more than the remaining balance. Record the extra days as LWP.</p>
            <p>Deleting a record returns its days to the employee&apos;s balance.</p>
          </section>

          <section id="lates">
            <h2>Late arrivals &amp; encashment</h2>
            <p>On <strong>Overview</strong>, enter the <em>total</em> number of late arrivals for an employee in a month. Saving again replaces the total; it does not add to it. Every N late arrivals (set in Settings) cut one day of CL. The cut never takes CL below zero.</p>
            <p>To pay out unused Earned Leave, choose <strong>Encash EL</strong> on Leave records. The days leave the EL balance and appear in the ledger.</p>
          </section>

          <section id="reports">
            <h2>Reports &amp; printing</h2>
            <ul>
              <li><strong>Leave ledger</strong>: every leave in the chosen month. Leave that crosses into another month shows only the days inside the chosen month.</li>
              <li><strong>Payroll summary</strong>: per employee, days of each leave type in the month, late arrivals, CL cut, and paid days (calendar days minus LWP).</li>
              <li><strong>Employee statement</strong>: open an employee to see their balances and full ledger, and print it.</li>
            </ul>
            <p>Print uses A4 landscape with signature lines. Choose <strong>Save as PDF</strong> as the printer to keep a PDF. <strong>Export CSV</strong> opens directly in Excel.</p>
          </section>

          <section id="policy">
            <h2>Leave policy</h2>
            <h3>Weekly days off and holidays</h3>
            <p>Days off and holidays are never charged on their own. Changing them affects leave recorded afterwards; existing records keep their day counts.</p>
            <h3>Sandwich rule</h3>
            <p>When on, days off that fall <em>between</em> two leave days are charged too. With a Friday–Saturday weekend, leave from Thursday to Sunday charges 4 days. Leave that only starts or ends next to a weekend does not charge the weekend.</p>
          </section>

          <section id="year">
            <h2>Closing a leave year</h2>
            <p>At the end of the year, go to <strong>Settings → Leave year</strong> and choose <strong>Close leave year</strong>. Chuti will:</p>
            <ol>
              <li>save a backup,</li>
              <li>carry each employee&apos;s unused EL into the new year, up to the cap,</li>
              <li>let unused CL, SL and ML lapse,</li>
              <li>make records from the closed year read-only (they stay visible in reports).</li>
            </ol>
            <p>Leave already recorded on or after the new start date counts toward the new year.</p>
          </section>

          <section id="data">
            <h2>Backups, security &amp; LAN</h2>
            <h3>Backup copies (set this up first)</h3>
            <p>
              In <strong>Settings → Backup copies</strong>, choose a folder from the Chuti window on the host computer: a USB drive, a second disk, or a Google Drive / OneDrive folder that syncs to the cloud.
              Every day at the time you set, Chuti saves a complete copy there, including the database and all attachments, and keeps the newest copies. Overview warns you if copies stop, for example when the drive is unplugged.
            </p>
            <p>To restore, choose <strong>Restore</strong> next to a copy. To move to a new computer, install Chuti, choose the same backup folder, and restore the newest copy.</p>
            <h3>Protect copies with a backup password</h3>
            <p>
              Chuti won&apos;t save copies until you choose how they are protected. Choose <strong>Set a backup password</strong> (12+ characters, not the admin password). Chuti shows a <strong>recovery code</strong> once: print it and keep it away from the backup folder and the cloud account.
              Encrypted copies are useless to anyone who gets into your cloud account or finds the USB drive. Restoring asks for the password or the recovery code.
            </p>
            <Alert tone="warning">Lose both the password and the recovery code and the encrypted copies can never be opened. Also keep Chuti&apos;s own data folder out of OneDrive, Google Drive and Dropbox; Settings warns you if it isn&apos;t.</Alert>
            <h3>Quick restore points</h3>
            <p>Chuti also saves database-only snapshots in its own data folder on start-up and every 12 hours (latest 30). They are handy for undoing a mistake, but they sit on the same drive as your data. A copy of the current data is saved before every restore.</p>
            <p><strong>Balance check</strong> recalculates balances from the leave records and fixes any mismatch.</p>
            <p>The <strong>Activity log</strong> records every change with the time and the browser that made it.</p>
            <h3>Sharing over the office network</h3>
            <p>New installations can only be used on the host computer. Sharing is an explicit choice:</p>
            <ol>
              <li>In the desktop app, choose <strong>Network → Allow Access from Other Computers</strong>. Chuti restarts.</li>
              <li>Use <strong>Network → Copy LAN URL to Clipboard</strong> (for example <code>http://192.168.1.100:3000</code>).</li>
              <li>Allow inbound TCP on that port in Windows Firewall on the host computer.</li>
              <li>Colleagues open the URL in a browser and sign in with the admin password.</li>
            </ol>
            <p>With <code>start.bat</code>, answer <strong>Y</strong> when asked &ldquo;Allow network access?&rdquo;.</p>
            <Alert tone="warning">Anyone who knows the admin password can change every record. Use a strong password and change it when staff with access leave.</Alert>
          </section>
        </article>
      </div>
    </>
  );
}
