import type * as fs from 'fs';

import type { BackendDescriptor, BackendId } from '../../shared/protocol/backends.js';
import type { AgentState, PersistedAgent } from '../types.js';

export type BackendAgentStatus = 'active' | 'waiting';

export type BackendEvent =
  | {
      type: 'sessionCreated';
      agentId: number;
      folderName?: string;
    }
  | {
      type: 'sessionClosed';
      agentId: number;
    }
  | {
      type: 'statusChanged';
      agentId: number;
      status: BackendAgentStatus;
    }
  | {
      type: 'toolStarted';
      agentId: number;
      toolId: string;
      status: string;
    }
  | {
      type: 'toolFinished';
      agentId: number;
      toolId: string;
    }
  | {
      type: 'toolsCleared';
      agentId: number;
    }
  | {
      type: 'permissionRequired';
      agentId: number;
    }
  | {
      type: 'permissionCleared';
      agentId: number;
    }
  | {
      type: 'subagentToolStarted';
      agentId: number;
      parentToolId: string;
      toolId: string;
      status: string;
    }
  | {
      type: 'subagentToolFinished';
      agentId: number;
      parentToolId: string;
      toolId: string;
    }
  | {
      type: 'subagentCleared';
      agentId: number;
      parentToolId: string;
    }
  | {
      type: 'subagentPermissionRequired';
      agentId: number;
      parentToolId: string;
    };

export type BackendEventSink = (event: BackendEvent) => void;

export interface BackendHostRuntime {
  nextAgentIdRef: { current: number };
  nextTerminalIndexRef: { current: number };
  activeAgentIdRef: { current: number | null };
  projectScanTimers: Map<string, ReturnType<typeof setInterval>>;
  agents: Map<number, AgentState>;
  knownTranscriptFiles: Set<string>;
  fileWatchers: Map<number, fs.FSWatcher>;
  pollingTimers: Map<number, ReturnType<typeof setInterval>>;
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>;
  transcriptPollTimers: Map<number, ReturnType<typeof setInterval>>;
  persistAgents: () => void;
  emitEvent: BackendEventSink;
}

export interface CreateSessionOptions {
  folderPath?: string;
  bypassPermissions?: boolean;
}

export interface AgentBackendProvider {
  readonly id: BackendId;
  readonly displayName: string;
  readonly isImplemented: boolean;
  readonly supportsBypassPermissions: boolean;
  createSession(runtime: BackendHostRuntime, options: CreateSessionOptions): Promise<void>;
  restoreSessions(runtime: BackendHostRuntime, persistedAgents: PersistedAgent[]): void;
  startDiscovery(runtime: BackendHostRuntime): void;
  focusSession(agent: AgentState): void;
  closeSession(agent: AgentState): void;
  getSessionsDirectory(cwd?: string): string | null;
}

export type { BackendDescriptor };
