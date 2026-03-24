import * as fs from 'fs';
import * as vscode from 'vscode';

import { WORKSPACE_KEY_AGENT_SEATS, WORKSPACE_KEY_AGENTS } from './constants.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './timerManager.js';
import type { AgentState, PersistedAgent } from './types.js';
import { normalizeBackendId } from './types.js';

export function removeAgent(
  agentId: number,
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  transcriptPollTimers: Map<number, ReturnType<typeof setInterval>>,
  persistAgents: () => void,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  const transcriptPollTimer = transcriptPollTimers.get(agentId);
  if (transcriptPollTimer) {
    clearInterval(transcriptPollTimer);
  }
  transcriptPollTimers.delete(agentId);

  fileWatchers.get(agentId)?.close();
  fileWatchers.delete(agentId);

  const pollingTimer = pollingTimers.get(agentId);
  if (pollingTimer) {
    clearInterval(pollingTimer);
  }
  pollingTimers.delete(agentId);

  try {
    fs.unwatchFile(agent.transcriptFile);
  } catch {
    /* ignore */
  }

  cancelWaitingTimer(agentId, waitingTimers);
  cancelPermissionTimer(agentId, permissionTimers);

  agents.delete(agentId);
  persistAgents();
}

export function persistAgents(
  agents: Map<number, AgentState>,
  context: vscode.ExtensionContext,
): void {
  const persisted: PersistedAgent[] = [];
  for (const agent of agents.values()) {
    persisted.push({
      id: agent.id,
      backendId: agent.backendId,
      terminalName: agent.terminalRef.name,
      transcriptFile: agent.transcriptFile,
      projectDir: agent.projectDir,
      folderName: agent.folderName,
    });
  }
  context.workspaceState.update(WORKSPACE_KEY_AGENTS, persisted);
}

export function loadPersistedAgents(context: vscode.ExtensionContext): PersistedAgent[] {
  const persisted = context.workspaceState.get<
    Array<Partial<PersistedAgent> & Record<string, unknown>>
  >(WORKSPACE_KEY_AGENTS, []);

  return persisted.flatMap((entry) => {
    if (
      typeof entry.id !== 'number' ||
      typeof entry.terminalName !== 'string' ||
      typeof (entry.transcriptFile ?? (entry as Record<string, unknown>).jsonlFile) !== 'string' ||
      typeof entry.projectDir !== 'string'
    ) {
      return [];
    }

    return [
      {
        id: entry.id,
        backendId: normalizeBackendId(entry.backendId),
        terminalName: entry.terminalName,
        transcriptFile: (entry.transcriptFile ??
          (entry as Record<string, unknown>).jsonlFile) as string,
        projectDir: entry.projectDir,
        folderName: typeof entry.folderName === 'string' ? entry.folderName : undefined,
      },
    ];
  });
}

export function sendExistingAgents(
  agents: Map<number, AgentState>,
  context: vscode.ExtensionContext,
  webview: vscode.Webview | undefined,
): void {
  if (!webview) return;
  const agentIds: number[] = [];
  for (const id of agents.keys()) {
    agentIds.push(id);
  }
  agentIds.sort((a, b) => a - b);

  const agentMeta = context.workspaceState.get<
    Record<string, { palette?: number; seatId?: string }>
  >(WORKSPACE_KEY_AGENT_SEATS, {});

  const folderNames: Record<number, string> = {};
  for (const [id, agent] of agents) {
    if (agent.folderName) {
      folderNames[id] = agent.folderName;
    }
  }
  console.log(
    `[Agent Office] sendExistingAgents: agents=${JSON.stringify(agentIds)}, meta=${JSON.stringify(agentMeta)}`,
  );

  webview.postMessage({
    type: 'existingAgents',
    agents: agentIds,
    agentMeta,
    folderNames,
  });

  sendCurrentAgentStatuses(agents, webview);
}

export function sendCurrentAgentStatuses(
  agents: Map<number, AgentState>,
  webview: vscode.Webview | undefined,
): void {
  if (!webview) return;
  for (const [agentId, agent] of agents) {
    for (const [toolId, status] of agent.activeToolStatuses) {
      webview.postMessage({
        type: 'agentToolStart',
        id: agentId,
        toolId,
        status,
      });
    }
    if (agent.isWaiting) {
      webview.postMessage({
        type: 'agentStatus',
        id: agentId,
        status: 'waiting',
      });
    }
  }
}

export function sendLayout(
  context: vscode.ExtensionContext,
  webview: vscode.Webview | undefined,
  defaultLayout?: Record<string, unknown> | null,
): void {
  if (!webview) return;
  const result = migrateAndLoadLayout(context, defaultLayout);
  webview.postMessage({
    type: 'layoutLoaded',
    layout: result?.layout ?? null,
    wasReset: result?.wasReset ?? false,
  });
}
