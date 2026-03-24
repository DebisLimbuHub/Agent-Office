import { DEFAULT_BACKEND_ID } from '../../shared/protocol/backends.js';
import { claudeBackendProvider } from './claude/provider.js';
import { codexBackendProvider } from './codex/provider.js';
import type { AgentBackendProvider, BackendDescriptor } from './types.js';

const providers = new Map<AgentBackendProvider['id'], AgentBackendProvider>([
  [claudeBackendProvider.id, claudeBackendProvider],
  [codexBackendProvider.id, codexBackendProvider],
]);

export function getBackendProvider(backendId: AgentBackendProvider['id']): AgentBackendProvider {
  const provider = providers.get(backendId);
  if (!provider) {
    throw new Error(`Unknown backend provider: ${backendId}`);
  }
  return provider;
}

export function listBackendProviders(): AgentBackendProvider[] {
  return [...providers.values()];
}

export function listBackendDescriptors(): BackendDescriptor[] {
  return listBackendProviders().map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    isImplemented: provider.isImplemented,
    supportsBypassPermissions: provider.supportsBypassPermissions,
  }));
}

export { DEFAULT_BACKEND_ID };
