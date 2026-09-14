// Runs once when the Next.js server starts (see node_modules/next/dist/docs/.../instrumentation.md).
// Starts the daily "backup copies" scheduler so copies are made even if nobody signs in that day.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startBackupCopyScheduler } = await import('./lib/backup-copies');
  startBackupCopyScheduler();
}
