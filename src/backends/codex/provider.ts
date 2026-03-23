import * as vscode from 'vscode';

import type { AgentBackendProvider } from '../types.js';

export const codexBackendProvider: AgentBackendProvider = {
  id: 'codex',
  displayName: 'Codex',
  isImplemented: false,
  async createSession() {
    vscode.window.showInformationMessage(
      'Agent Office: Codex backend support is scaffolded but not implemented yet.',
    );
  },
  restoreSessions() {
    // TODO: Add Codex session restoration once the backend integration exists.
  },
  startDiscovery() {
    // TODO: Add Codex session discovery once the backend integration exists.
  },
  focusSession(agent) {
    agent.terminalRef.show();
  },
  closeSession(agent) {
    agent.terminalRef.dispose();
  },
  getSessionsDirectory() {
    return null;
  },
};
