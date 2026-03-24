export type BackendId = 'claude' | 'codex';

export const DEFAULT_BACKEND_ID: BackendId = 'codex';

export interface BackendDescriptor {
  id: BackendId;
  displayName: string;
  isImplemented: boolean;
  supportsBypassPermissions: boolean;
}

export function isBackendId(value: unknown): value is BackendId {
  return value === 'claude' || value === 'codex';
}

export function normalizeBackendId(
  value: unknown,
  fallback: BackendId = DEFAULT_BACKEND_ID,
): BackendId {
  return isBackendId(value) ? value : fallback;
}
