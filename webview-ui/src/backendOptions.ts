import type { BackendDescriptor, BackendId } from '../../shared/protocol/backends.ts';

export const DEFAULT_SELECTED_BACKEND_ID: BackendId = 'codex';

export function normalizeBackendId(
  value: unknown,
  fallback: BackendId = DEFAULT_SELECTED_BACKEND_ID,
): BackendId {
  return value === 'codex' || value === 'claude' ? value : fallback;
}

export function resolveSelectedBackendId(
  backends: BackendDescriptor[],
  preferredBackendId: BackendId,
  fallbackBackendId: BackendId = DEFAULT_SELECTED_BACKEND_ID,
): BackendId {
  const implemented = backends.filter((backend) => backend.isImplemented);

  if (implemented.some((backend) => backend.id === preferredBackendId)) {
    return preferredBackendId;
  }

  if (implemented.some((backend) => backend.id === fallbackBackendId)) {
    return fallbackBackendId;
  }

  return implemented[0]?.id ?? fallbackBackendId;
}
