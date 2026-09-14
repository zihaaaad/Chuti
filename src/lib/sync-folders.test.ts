import { describe, expect, it } from 'vitest';
import { detectSyncProvider } from './sync-folders';

const env = { OneDrive: 'C:\\Users\\Rina\\OneDrive - Green School' };

describe('detectSyncProvider', () => {
  it('recognises the OneDrive folder from the environment, including redirected Documents', () => {
    expect(detectSyncProvider('C:\\Users\\Rina\\OneDrive - Green School\\Documents\\ChutiData', env)).toBe('OneDrive');
  });

  it('recognises common sync client folder names', () => {
    expect(detectSyncProvider('G:\\My Drive\\Chuti Backups', {})).toBe('Google Drive');
    expect(detectSyncProvider('C:\\Users\\Rina\\Dropbox\\Chuti', {})).toBe('Dropbox');
    expect(detectSyncProvider('C:\\Users\\Rina\\iCloudDrive\\Chuti', {})).toBe('iCloud Drive');
    expect(detectSyncProvider('D:\\OneDrive\\Backups', {})).toBe('OneDrive');
  });

  it('does not flag ordinary local or removable folders', () => {
    expect(detectSyncProvider('E:\\ChutiBackups', env)).toBeNull();
    expect(detectSyncProvider('C:\\Users\\Rina\\Documents\\Inbox\\Chuti', env)).toBeNull();
    expect(detectSyncProvider('D:\\Dropboxes-old\\x', {})).toBeNull();
  });
});
