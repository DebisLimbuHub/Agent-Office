import type * as vscode from 'vscode';

export type { BackendId } from '../shared/protocol/backends.js';
export { normalizeBackendId } from '../shared/protocol/backends.js';

import type { BackendId } from '../shared/protocol/backends.js';

export interface AgentState {
  id: number;
  backendId: BackendId;
  terminalRef: vscode.Terminal;
  projectDir: string;
  transcriptFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
  activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
}

export interface PersistedAgent {
  id: number;
  backendId: BackendId;
  terminalName: string;
  transcriptFile: string;
  projectDir: string;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
}
