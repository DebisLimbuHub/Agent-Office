import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { TERMINAL_NAME_PREFIX, TRANSCRIPT_POLL_INTERVAL_MS } from '../../constants.js';
import { readNewLines, reassignAgentToFile, startFileWatching } from '../../fileWatcher.js';
import type { AgentState, PersistedAgent } from '../../types.js';
import type { AgentBackendProvider, BackendHostRuntime, CreateSessionOptions } from '../types.js';
import {
  getCodexSessionsDirectory,
  isTopLevelCodexSession,
  listCodexSessionFiles,
  readCodexSessionMeta,
} from './sessionStore.js';
import { processTranscriptLine } from './transcriptParser.js';

function createCodexAgentState(
  id: number,
  terminal: vscode.Terminal,
  projectDir: string,
  transcriptFile: string,
  folderName?: string,
): AgentState {
  return {
    id,
    backendId: 'codex',
    terminalRef: terminal,
    projectDir,
    transcriptFile,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    folderName,
  };
}

function getWorkspaceFolderForPath(sessionCwd: string): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }

  return folders.find((folder) => {
    const relative = path.relative(folder.uri.fsPath, sessionCwd);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}

function getFolderNameForPath(sessionCwd: string): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length <= 1) {
    return undefined;
  }

  return getWorkspaceFolderForPath(sessionCwd)?.name;
}

function isRelevantWorkspaceSession(sessionCwd: string): boolean {
  return !!getWorkspaceFolderForPath(sessionCwd);
}

function watchTranscriptWhenReady(
  agentId: number,
  runtime: BackendHostRuntime,
  persistedAgent?: PersistedAgent,
): void {
  const agent = runtime.agents.get(agentId);
  if (!agent) {
    return;
  }

  try {
    if (fs.existsSync(agent.transcriptFile)) {
      if (persistedAgent) {
        const stat = fs.statSync(agent.transcriptFile);
        agent.fileOffset = stat.size;
      }

      startFileWatching(
        agentId,
        agent.transcriptFile,
        runtime.agents,
        runtime.fileWatchers,
        runtime.pollingTimers,
        runtime.waitingTimers,
        runtime.permissionTimers,
        runtime.emitEvent,
        processTranscriptLine,
      );

      if (!persistedAgent) {
        readNewLines(
          agentId,
          runtime.agents,
          runtime.waitingTimers,
          runtime.permissionTimers,
          runtime.emitEvent,
          processTranscriptLine,
        );
      }

      return;
    }
  } catch {
    /* file may not exist yet */
  }

  const pollTimer = setInterval(() => {
    const currentAgent = runtime.agents.get(agentId);
    if (!currentAgent) {
      clearInterval(pollTimer);
      runtime.transcriptPollTimers.delete(agentId);
      return;
    }

    try {
      if (!fs.existsSync(currentAgent.transcriptFile)) {
        return;
      }

      clearInterval(pollTimer);
      runtime.transcriptPollTimers.delete(agentId);

      if (persistedAgent) {
        const stat = fs.statSync(currentAgent.transcriptFile);
        currentAgent.fileOffset = stat.size;
      }

      startFileWatching(
        agentId,
        currentAgent.transcriptFile,
        runtime.agents,
        runtime.fileWatchers,
        runtime.pollingTimers,
        runtime.waitingTimers,
        runtime.permissionTimers,
        runtime.emitEvent,
        processTranscriptLine,
      );

      if (!persistedAgent) {
        readNewLines(
          agentId,
          runtime.agents,
          runtime.waitingTimers,
          runtime.permissionTimers,
          runtime.emitEvent,
          processTranscriptLine,
        );
      }
    } catch {
      /* file may not exist yet */
    }
  }, TRANSCRIPT_POLL_INTERVAL_MS);

  runtime.transcriptPollTimers.set(agentId, pollTimer);
}

function adoptTerminalForTranscript(
  terminal: vscode.Terminal,
  transcriptFile: string,
  projectDir: string,
  folderName: string | undefined,
  runtime: BackendHostRuntime,
): void {
  const agentId = runtime.nextAgentIdRef.current++;
  const agent = createCodexAgentState(agentId, terminal, projectDir, transcriptFile, folderName);
  runtime.agents.set(agentId, agent);
  runtime.activeAgentIdRef.current = agentId;
  runtime.persistAgents();

  runtime.emitEvent({
    type: 'sessionCreated',
    agentId,
    folderName,
  });

  startFileWatching(
    agentId,
    transcriptFile,
    runtime.agents,
    runtime.fileWatchers,
    runtime.pollingTimers,
    runtime.waitingTimers,
    runtime.permissionTimers,
    runtime.emitEvent,
    processTranscriptLine,
  );
  readNewLines(
    agentId,
    runtime.agents,
    runtime.waitingTimers,
    runtime.permissionTimers,
    runtime.emitEvent,
    processTranscriptLine,
  );
}

function scanForNewCodexSessions(runtime: BackendHostRuntime, sessionsRoot: string): void {
  const files = listCodexSessionFiles(sessionsRoot);
  for (const file of files) {
    if (runtime.knownTranscriptFiles.has(file)) {
      continue;
    }

    runtime.knownTranscriptFiles.add(file);

    const meta = readCodexSessionMeta(file);
    if (!meta || !isTopLevelCodexSession(meta) || !isRelevantWorkspaceSession(meta.cwd)) {
      continue;
    }

    const folderName = getFolderNameForPath(meta.cwd);
    const activeTerminal = vscode.window.activeTerminal;
    const activeAgentId = runtime.activeAgentIdRef.current;
    const activeAgent = activeAgentId !== null ? runtime.agents.get(activeAgentId) : undefined;

    if (activeAgent && activeAgent.backendId === 'codex') {
      activeAgent.projectDir = meta.cwd;
      activeAgent.folderName = folderName;
      reassignAgentToFile(
        activeAgent.id,
        file,
        runtime.agents,
        runtime.fileWatchers,
        runtime.pollingTimers,
        runtime.waitingTimers,
        runtime.permissionTimers,
        runtime.emitEvent,
        runtime.persistAgents,
        processTranscriptLine,
      );
      runtime.persistAgents();
      continue;
    }

    if (!activeTerminal) {
      continue;
    }

    const terminalAlreadyOwned = [...runtime.agents.values()].some(
      (agent) => agent.terminalRef === activeTerminal,
    );
    if (terminalAlreadyOwned) {
      continue;
    }

    adoptTerminalForTranscript(activeTerminal, file, meta.cwd, folderName, runtime);
  }
}

export const codexBackendProvider: AgentBackendProvider = {
  id: 'codex',
  displayName: 'Codex CLI',
  isImplemented: true,
  supportsBypassPermissions: true,
  async createSession(runtime: BackendHostRuntime, options: CreateSessionOptions) {
    const folders = vscode.workspace.workspaceFolders;
    const cwd = options.folderPath || folders?.[0]?.uri.fsPath;
    const terminalIndex = runtime.nextTerminalIndexRef.current++;
    const terminal = vscode.window.createTerminal({
      name: `${TERMINAL_NAME_PREFIX} #${terminalIndex}`,
      cwd,
    });

    terminal.show();
    terminal.sendText(
      options.bypassPermissions ? 'codex --dangerously-bypass-approvals-and-sandbox' : 'codex',
    );
  },
  restoreSessions(runtime: BackendHostRuntime, persistedAgents: PersistedAgent[]) {
    if (persistedAgents.length === 0) {
      return;
    }

    const liveTerminals = vscode.window.terminals;
    let maxId = 0;
    let maxTerminalIndex = 0;

    for (const persistedAgent of persistedAgents) {
      const terminal = liveTerminals.find(
        (candidate) => candidate.name === persistedAgent.terminalName,
      );
      if (!terminal) {
        continue;
      }

      const agent = createCodexAgentState(
        persistedAgent.id,
        terminal,
        persistedAgent.projectDir,
        persistedAgent.transcriptFile,
        persistedAgent.folderName,
      );

      runtime.agents.set(persistedAgent.id, agent);
      runtime.knownTranscriptFiles.add(persistedAgent.transcriptFile);

      maxId = Math.max(maxId, persistedAgent.id);
      const terminalIndexMatch = persistedAgent.terminalName.match(/#(\d+)$/);
      if (terminalIndexMatch) {
        maxTerminalIndex = Math.max(maxTerminalIndex, parseInt(terminalIndexMatch[1], 10));
      }

      watchTranscriptWhenReady(persistedAgent.id, runtime, persistedAgent);
    }

    if (maxId >= runtime.nextAgentIdRef.current) {
      runtime.nextAgentIdRef.current = maxId + 1;
    }
    if (maxTerminalIndex >= runtime.nextTerminalIndexRef.current) {
      runtime.nextTerminalIndexRef.current = maxTerminalIndex + 1;
    }
  },
  startDiscovery(runtime: BackendHostRuntime) {
    const sessionsRoot = this.getSessionsDirectory();
    if (!sessionsRoot) {
      return;
    }

    const timerKey = `${this.id}:${sessionsRoot}`;
    if (runtime.projectScanTimers.has(timerKey)) {
      return;
    }

    for (const file of listCodexSessionFiles(sessionsRoot)) {
      runtime.knownTranscriptFiles.add(file);
    }

    const timer = setInterval(() => {
      scanForNewCodexSessions(runtime, sessionsRoot);
    }, TRANSCRIPT_POLL_INTERVAL_MS);

    runtime.projectScanTimers.set(timerKey, timer);
  },
  focusSession(agent) {
    agent.terminalRef.show();
  },
  closeSession(agent) {
    agent.terminalRef.dispose();
  },
  getSessionsDirectory() {
    return getCodexSessionsDirectory();
  },
};
