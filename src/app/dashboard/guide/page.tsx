'use client';

import { useState } from 'react';
import { BookOpen, Users, FileText, Settings, BarChart3, ShieldCheck, HelpCircle, Network } from 'lucide-react';

export default function GuidePage() {
  const [activeTab, setActiveTab] = useState<'getting-started' | 'employees' | 'leaves' | 'reports' | 'settings' | 'backups'>('getting-started');

  const tabs = [
    { id: 'getting-started', name: 'Getting Started', icon: BookOpen },
    { id: 'employees', name: 'Employees & CSV', icon: Users },
    { id: 'leaves', name: 'Recording Leaves', icon: FileText },
    { id: 'reports', name: 'Reports & Printing', icon: BarChart3 },
    { id: 'settings', name: 'System Settings', icon: Settings },
    { id: 'backups', name: 'Backups & LAN', icon: Network },
  ] as const;

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--primary)' }}>User Guide & System Manual</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)' }}>
          Detailed instructions for administrators to configure, manage, and use the Chuti Leave Management System.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '2rem', alignItems: 'start' }}>
        {/* Left: Tab selectors */}
        <div className="card animate-scale-in" style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', animation: 'popup-scale-in 0.05s ease-out' }}>
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="tab-btn"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  width: '100%',
                  textAlign: 'left',
                  backgroundColor: isActive ? 'var(--primary-light)' : 'transparent',
                  color: isActive ? 'var(--primary)' : 'var(--foreground-muted)',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                <Icon size={16} style={{ color: isActive ? 'var(--primary-accent)' : 'inherit' }} />
                {tab.name}
              </button>
            );
          })}
        </div>

        {/* Right: Content panel */}
        <div className="card animate-scale-in" style={{ minHeight: '60vh', padding: '2rem', animation: 'popup-scale-in 0.05s ease-out' }}>
          {activeTab === 'getting-started' && (
            <div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
                <BookOpen size={20} style={{ color: 'var(--primary-accent)' }} />
                Getting Started with Chuti
              </h2>
              <p style={{ marginBottom: '1rem' }}>
                Chuti is a professional, offline-first Leave Management System designed to be run locally on a single machine or accessed over a Local Area Network (LAN). It uses a clean, forest green minimalist design and has zero dependency on cloud internet connections.
              </p>
              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Key Concepts</h3>
              <ul style={{ paddingLeft: '1.25rem', fontSize: '0.875rem', color: 'var(--foreground-muted)', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                <li>
                  <strong>Offline First:</strong> All records, scanned documents, and settings are saved locally on this machine. No data is shared with external services.
                </li>
                <li>
                  <strong>Leave Balances:</strong> Each employee has dedicated balances for Casual Leave (CL), Sick Leave (SL), Earned Leave (EL), and Maternity Leave (ML) that automatically deduct when leaves are recorded.
                </li>
                <li>
                  <strong>Local Storage:</strong> Uploaded attachments are saved inside the <code>public/uploads/</code> folder. Database files are stored as <code>database.db</code>.
                </li>
              </ul>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Initial Setup Steps</h3>
              <ol style={{ paddingLeft: '1.25rem', fontSize: '0.875rem', color: 'var(--foreground-muted)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <li>Navigate to the <strong>Settings</strong> panel.</li>
                <li>Customize the <strong>Institute Name</strong>. This will display on your dashboards and PDF reports.</li>
                <li>Configure the <strong>Weekend Days</strong> and official holidays to ensure leave duration calculations exclude non-working days accurately.</li>
                <li>Proceed to the <strong>Employees</strong> section to add your team members.</li>
              </ol>
            </div>
          )}

          {activeTab === 'employees' && (
            <div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
                <Users size={20} style={{ color: 'var(--primary-accent)' }} />
                Employee Management & Bulk Import
              </h2>
              <p style={{ marginBottom: '1.25rem' }}>
                Manage your staff directory, view current leave balances, or add team members manually or in bulk.
              </p>
              
              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Adding Employees Manually</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', marginBottom: '1rem' }}>
                Click <strong>Add Employee</strong> under the Employees page. Fill in their Employee ID, Name, Designation, Department, Phone, and Joining Date. You can also specify custom yearly leave allocations (CL, SL, EL, ML) for individual employees.
              </p>

              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Bulk CSV Import</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', marginBottom: '1rem' }}>
                To save time, you can upload employee data using a spreadsheet CSV file:
              </p>
              <ol style={{ paddingLeft: '1.25rem', fontSize: '0.875rem', color: 'var(--foreground-muted)', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <li>Click <strong>Download Template CSV</strong> on the Employees page to download the correctly formatted file.</li>
                <li>Open the downloaded CSV in Microsoft Excel or Google Sheets.</li>
                <li>Add your employees&apos; details under the respective column headers: <code>EmployeeID</code>, <code>Name</code>, <code>Designation</code>, <code>Department</code>, <code>Phone</code>, and <code>JoiningDate</code> (formatted as YYYY-MM-DD).</li>
                <li>Save the spreadsheet as a CSV (Comma Separated Values) file.</li>
                <li>Click <strong>Choose File</strong> inside the Import section, select your file, and click <strong>Import CSV</strong>.</li>
              </ol>
              <div style={{
                backgroundColor: 'var(--warning-bg)',
                border: '1px solid rgba(163, 98, 15, 0.15)',
                color: 'var(--warning)',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.8125rem'
              }}>
                <strong>Duplicate ID Detection:</strong> If the CSV contains an Employee ID that is already registered, the system will skip that row and display a summary of skipped duplicates so that you can fix them.
              </div>
            </div>
          )}

          {activeTab === 'leaves' && (
            <div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
                <FileText size={20} style={{ color: 'var(--primary-accent)' }} />
                Recording & Editing Leaves
              </h2>
              <p style={{ marginBottom: '1.25rem' }}>
                Chuti streamlines leave requests, checks overlapping dates, keeps track of balances, and organizes scanned documents locally.
              </p>

              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Recording a Leave</h3>
              <ol style={{ paddingLeft: '1.25rem', fontSize: '0.875rem', color: 'var(--foreground-muted)', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <li>Click the <strong>Record Leave</strong> button.</li>
                <li>Select the employee. The system displays their remaining balances (CL, SL, EL) directly in the selection list to assist your decision.</li>
                <li>Select the Leave Type and enter the Start and End dates.</li>
                <li>To log a half-day leave, check the <strong>Half Day (0.5)</strong> checkbox.</li>
                <li>Upload a supporting document (image or PDF scan) under <strong>Supporting Document</strong>.</li>
                <li>Click <strong>Save Leave Record</strong> to deduct the balance and log the entry.</li>
              </ol>

              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Viewing and Editing Attachments</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', marginBottom: '1rem' }}>
                Any record with an attachment displays a **Preview** (eye icon) button. Clicking this icon loads a local preview of the photo or PDF directly inside the app, without opening other programs.
              </p>
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', marginBottom: '1rem' }}>
                Click **Edit** (pencil icon) in the Actions column of a leave record to modify the dates, reasons, or attachments. In the edit modal, you can delete the existing attachment or replace it with a new upload.
              </p>

              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Overlap & Balance Checking</h3>
              <div style={{
                backgroundColor: 'var(--info-bg)',
                border: '1px solid rgba(33, 85, 117, 0.15)',
                color: 'var(--info)',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.8125rem'
              }}>
                <strong>Smart Validations:</strong> The system automatically blocks leave dates that overlap with existing bookings (unless both are logged as half-days on the same day). It also blocks bookings if the requested duration exceeds the employee&apos;s remaining quota.
              </div>
            </div>
          )}

          {activeTab === 'reports' && (
            <div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
                <BarChart3 size={20} style={{ color: 'var(--primary-accent)' }} />
                Reports Center & PDF Printing
              </h2>
              <p style={{ marginBottom: '1.25rem' }}>
                Generate leave ledger logs, compile monthly payroll attendance summary sheets, print documents, or export data.
              </p>

              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Leave Ledger Log vs. Payroll Summary</h3>
              <ul style={{ paddingLeft: '1.25rem', fontSize: '0.875rem', color: 'var(--foreground-muted)', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <li>
                  <strong>Leave Ledger Log:</strong> Shows detailed historical entries of leaves taken by employees, including dates, reasons, and types.
                </li>
                <li>
                  <strong>Payroll Summary:</strong> Collates and computes monthly attendance metrics for each employee. It calculates total leaves taken (Casual, Sick, Earned), late counts, deducted CL days, and Net Paid Days (Month Calendar Days minus Leave Without Pay days).
                </li>
              </ul>

              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Printing A4 Landscape PDF Reports</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', marginBottom: '1rem' }}>
                Clicking the <strong>Print Report</strong> button automatically triggers your browser&apos;s print utility. The system uses specific print layouts configured to:
              </p>
              <ol style={{ paddingLeft: '1.25rem', fontSize: '0.875rem', color: 'var(--foreground-muted)', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <li>Hide the sidebar navigation menu, filter controls, action bars, and buttons.</li>
                <li>Include a clean printed header showing the Institute Name and the generated date.</li>
                <li>Force the document to output in **A4 Landscape** format to fit wide payroll summaries without clipping.</li>
                <li>Prevent table rows from splitting awkwardly across page boundaries.</li>
              </ol>
              <div style={{
                backgroundColor: 'var(--success-bg)',
                border: '1px solid rgba(45, 106, 79, 0.15)',
                color: 'var(--success)',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.8125rem'
              }}>
                <strong>How to Save as PDF:</strong> When the browser print window opens, select <strong>Save as PDF</strong> (instead of selecting a physical printer) under the &quot;Destination&quot; dropdown. This saves the report locally as a PDF.
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
                <Settings size={20} style={{ color: 'var(--primary-accent)' }} />
                System Settings & Policies
              </h2>
              <p style={{ marginBottom: '1.25rem' }}>
                Configure the organizational profiles, weekend rules, and late attendance deductions.
              </p>

              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Organizational Profile</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', marginBottom: '1rem' }}>
                Specify your organization name in the **Institute Name** input field. This name is used at the top of the sidebar and headers of printable PDF reports.
              </p>

              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Weekend Schedules</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', marginBottom: '1rem' }}>
                Configure which days of the week are weekends (e.g. Friday and Saturday, Sunday only). The leave calculator uses this setting to subtract non-working days from leave requests automatically.
              </p>

              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Sandwich Rule Toggle</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', marginBottom: '1rem' }}>
                When the **Sandwich Rule** is enabled, if a leave request spans across a weekend or an official holiday, those weekends/holidays are included in the leave duration calculation (deducting them from the balance). If disabled, weekends and holidays are skipped.
              </p>

              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Late Attendance CL Deductions</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', marginBottom: '1rem' }}>
                Set the late threshold limit (e.g., 3 lates). The system automatically computes and deducts 1 day of Casual Leave (CL) for every 3 late attendances logged for that month.
              </p>

              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Official Holidays Manager</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', marginBottom: '1rem' }}>
                Add official calendar holidays (e.g., National days, seasonal holidays). The system automatically detects these dates and excludes them from leave calculations when the sandwich rule is disabled.
              </p>
            </div>
          )}

          {activeTab === 'backups' && (
            <div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
                <ShieldCheck size={20} style={{ color: 'var(--primary-accent)' }} />
                Data Integrity & Local backups
              </h2>
              <p style={{ marginBottom: '1.25rem' }}>
                Technical guidelines for administrators to keep data secure and share access.
              </p>

              <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Local Auto-Backups</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', marginBottom: '1.25rem' }}>
                Every single time the local server starts up, the system automatically duplicates the database and saves a dated copy in the <code>/backups</code> directory (e.g., <code>database_backup_YYYY-MM-DD.db</code>). If the system experiences a power failure or file corruption, you can restore previous logs using these backups.
              </p>

              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Local Network (LAN) Sharing</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--foreground-muted)', marginBottom: '1rem' }}>
                You can allow other computers in the same office or WiFi network to access the portal:
              </p>
              <ol style={{ paddingLeft: '1.25rem', fontSize: '0.875rem', color: 'var(--foreground-muted)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <li>Run the launcher file <code>start.bat</code>.</li>
                <li>The console will display the local network URL (e.g., <code>http://192.168.1.100:3000</code>).</li>
                <li>Ensure the hosting computer is connected to the network and your local Windows Firewall allows traffic on Port 3000.</li>
                <li>Other staff can open their browsers and enter that network URL to access the system directly.</li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
