// Constants safe to import from both server and client code.
export const MIN_PASSWORD_LENGTH_CLIENT = 8;
export const MAX_ATTACHMENT_MB = 10;
export const ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx';
export const PREVIEWABLE_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'];

export function isPreviewablePath(p: string): boolean {
  const lower = p.toLowerCase();
  return PREVIEWABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
