import { claudeBackendProvider } from './claude/provider.js';
import { codexBackendProvider } from './codex/provider.js';
import type { AgentBackendProvider } from './types.js';

const providers = new Map<AgentBackendProvider['id'], AgentBackendProvider>([
  [claudeBackendProvider.id, claudeBackendProvider],
  [codexBackendProvider.id, codexBackendProvider],
]);

export const DEFAULT_BACKEND_ID: AgentBackendProvider['id'] = 'claude';

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
