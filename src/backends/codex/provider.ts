import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { TERMINAL_NAME_PREFIX, TRANSCRIPT_POLL_INTERVAL_MS } from '../../constants.js';
import { readNewLines, reassignAgentToFile, startFileWatching } from '../../fileWatcher.js';
import type { AgentState, PersistedAgent } from '../../types.js';
import type { AgentBackendProvider, BackendHostRuntime, CreateSessionOptions } from '../types.js';
import {
  canAdoptActiveTerminal,
  findExistingCodexAgentBySessionId,
  findPendingCodexAgentForSession,
  shouldAttachCodexTranscript,
} from './discovery.js';
import {
  type CodexSessionMeta,
  getCodexSessionsDirectory,
  isCodexSubagentSession,
  isTopLevelCodexSession,
  listCodexSessionFiles,
  readCodexSessionMeta,
} from './sessionStore.js';
import { attachDiscoveredCodexSubagent } from './subagentTracker.js';
import { processTranscriptLine } from './transcriptParser.js';

function createCodexAgentState(
  id: number,
  terminal: vscode.Terminal,
  projectDir: string,
  transcriptFile: string,
  folderName?: string,
  backendSessionId?: string,
  pendingSession = false,
): AgentState {
  return {
    id,
    backendId: 'codex',
    terminalRef: terminal,
    projectDir,
    transcriptFile,
    backendSessionId,
    pendingSession,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeToolInputs: new Map(),
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
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    // Extension dev hosts can be launched without opening a folder. In that case,
    // allow transcript discovery to attach to the sessions we just started.
    return true;
  }

  return !!getWorkspaceFolderForPath(sessionCwd);
}

function hydrateAgentFromSessionMeta(
  agent: AgentState,
  meta: CodexSessionMeta,
  transcriptFile: string,
): void {
  agent.projectDir = meta.cwd;
  agent.transcriptFile = transcriptFile;
  agent.backendSessionId = meta.id;
  agent.pendingSession = false;
  agent.folderName = getFolderNameForPath(meta.cwd);
}

function startTranscriptWatching(
  agentId: number,
  runtime: BackendHostRuntime,
  readFromStart = false,
): void {
  const agent = runtime.agents.get(agentId);
  if (!agent || !agent.transcriptFile) {
    return;
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

  if (readFromStart) {
    readNewLines(
      agentId,
      runtime.agents,
      runtime.waitingTimers,
      runtime.permissionTimers,
      runtime.emitEvent,
      processTranscriptLine,
    );
  }
}

function watchTranscriptWhenReady(
  agentId: number,
  runtime: BackendHostRuntime,
  persistedAgent?: PersistedAgent,
): void {
  const agent = runtime.agents.get(agentId);
  if (!agent || !agent.transcriptFile || agent.pendingSession) {
    return;
  }

  try {
    if (fs.existsSync(agent.transcriptFile)) {
      if (persistedAgent) {
        const stat = fs.statSync(agent.transcriptFile);
        agent.fileOffset = stat.size;
      }

      startTranscriptWatching(agentId, runtime, !persistedAgent);
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

    if (currentAgent.pendingSession || !currentAgent.transcriptFile) {
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

      startTranscriptWatching(agentId, runtime, !persistedAgent);
    } catch {
      /* file may not exist yet */
    }
  }, TRANSCRIPT_POLL_INTERVAL_MS);

  runtime.transcriptPollTimers.set(agentId, pollTimer);
}

function adoptTerminalForTranscript(
  terminal: vscode.Terminal,
  meta: CodexSessionMeta,
  transcriptFile: string,
  runtime: BackendHostRuntime,
): void {
  const agentId = runtime.nextAgentIdRef.current++;
  const agent = createCodexAgentState(
    agentId,
    terminal,
    meta.cwd,
    transcriptFile,
    getFolderNameForPath(meta.cwd),
    meta.id,
    false,
  );

  runtime.agents.set(agentId, agent);
  runtime.activeAgentIdRef.current = agentId;
  runtime.persistAgents();

  runtime.emitEvent({
    type: 'sessionCreated',
    agentId,
    folderName: agent.folderName,
  });

  startTranscriptWatching(agentId, runtime, true);
}

function findOwnedCodexAgentForTerminal(
  runtime: BackendHostRuntime,
  terminal: vscode.Terminal | undefined,
): AgentState | undefined {
  if (!terminal) {
    return undefined;
  }

  return [...runtime.agents.values()].find(
    (agent) => agent.backendId === 'codex' && agent.terminalRef === terminal,
  );
}

function attachTranscriptToAgent(
  agent: AgentState,
  meta: CodexSessionMeta,
  transcriptFile: string,
  runtime: BackendHostRuntime,
  readFromStart = true,
): void {
  hydrateAgentFromSessionMeta(agent, meta, transcriptFile);
  runtime.knownTranscriptFiles.add(transcriptFile);
  runtime.persistAgents();
  startTranscriptWatching(agent.id, runtime, readFromStart);
}

function scanForNewCodexSessions(runtime: BackendHostRuntime, sessionsRoot: string): void {
  for (const file of listCodexSessionFiles(sessionsRoot)) {
    if (runtime.knownTranscriptFiles.has(file)) {
      continue;
    }

    runtime.knownTranscriptFiles.add(file);

    const meta = readCodexSessionMeta(file);
    if (!meta) {
      continue;
    }

    if (isCodexSubagentSession(meta)) {
      attachDiscoveredCodexSubagent(meta, file, runtime.emitEvent);
      continue;
    }

    if (!isTopLevelCodexSession(meta) || !isRelevantWorkspaceSession(meta.cwd)) {
      continue;
    }

    const existingBySessionId = findExistingCodexAgentBySessionId(runtime.agents.values(), meta.id);
    if (existingBySessionId) {
      if (shouldAttachCodexTranscript(existingBySessionId, file)) {
        attachTranscriptToAgent(existingBySessionId, meta, file, runtime);
      }
      continue;
    }

    const activeTerminal = vscode.window.activeTerminal;
    const pendingAgent = findPendingCodexAgentForSession(
      runtime.agents.values(),
      meta.cwd,
      activeTerminal,
    );
    if (pendingAgent) {
      attachTranscriptToAgent(pendingAgent, meta, file, runtime);
      continue;
    }

    const ownedActiveAgent = findOwnedCodexAgentForTerminal(runtime, activeTerminal);
    if (ownedActiveAgent && !ownedActiveAgent.pendingSession) {
      ownedActiveAgent.projectDir = meta.cwd;
      ownedActiveAgent.folderName = getFolderNameForPath(meta.cwd);
      ownedActiveAgent.backendSessionId = meta.id;
      reassignAgentToFile(
        ownedActiveAgent.id,
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

    if (!activeTerminal || !canAdoptActiveTerminal(activeTerminal, runtime.agents.values())) {
      continue;
    }

    adoptTerminalForTranscript(activeTerminal, meta, file, runtime);
  }
}

export const codexBackendProvider: AgentBackendProvider = {
  id: 'codex',
  displayName: 'Codex CLI',
  isImplemented: true,
  supportsBypassPermissions: true,
  async createSession(runtime: BackendHostRuntime, options: CreateSessionOptions) {
    const folders = vscode.workspace.workspaceFolders;
    const cwd = options.folderPath || folders?.[0]?.uri.fsPath || '';
    const isMultiRoot = !!(folders && folders.length > 1);
    const terminalIndex = runtime.nextTerminalIndexRef.current++;
    const terminal = vscode.window.createTerminal({
      name: `${TERMINAL_NAME_PREFIX} #${terminalIndex}`,
      cwd: cwd || undefined,
    });

    const agentId = runtime.nextAgentIdRef.current++;
    const folderName = isMultiRoot && cwd ? path.basename(cwd) : undefined;
    const agent = createCodexAgentState(agentId, terminal, cwd, '', folderName, undefined, true);

    runtime.agents.set(agentId, agent);
    runtime.activeAgentIdRef.current = agentId;
    runtime.persistAgents();
    runtime.emitEvent({ type: 'sessionCreated', agentId, folderName });

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

      const sessionMeta =
        persistedAgent.transcriptFile && fs.existsSync(persistedAgent.transcriptFile)
          ? readCodexSessionMeta(persistedAgent.transcriptFile)
          : null;
      const backendSessionId = persistedAgent.backendSessionId ?? sessionMeta?.id;
      const agent = createCodexAgentState(
        persistedAgent.id,
        terminal,
        sessionMeta?.cwd ?? persistedAgent.projectDir,
        persistedAgent.transcriptFile,
        persistedAgent.folderName ??
          getFolderNameForPath(sessionMeta?.cwd ?? persistedAgent.projectDir),
        backendSessionId,
        persistedAgent.pendingSession === true,
      );

      runtime.agents.set(persistedAgent.id, agent);
      if (persistedAgent.transcriptFile) {
        runtime.knownTranscriptFiles.add(persistedAgent.transcriptFile);
      }

      maxId = Math.max(maxId, persistedAgent.id);
      const terminalIndexMatch = persistedAgent.terminalName.match(/#(\d+)$/);
      if (terminalIndexMatch) {
        maxTerminalIndex = Math.max(maxTerminalIndex, parseInt(terminalIndexMatch[1], 10));
      }

      if (!agent.pendingSession && agent.transcriptFile) {
        watchTranscriptWhenReady(persistedAgent.id, runtime, persistedAgent);
      }
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

    for (const file of [...listCodexSessionFiles(sessionsRoot)].reverse()) {
      const meta = readCodexSessionMeta(file);
      if (!meta) {
        runtime.knownTranscriptFiles.add(file);
        continue;
      }

      if (isCodexSubagentSession(meta)) {
        attachDiscoveredCodexSubagent(meta, file, runtime.emitEvent);
        runtime.knownTranscriptFiles.add(file);
        continue;
      }

      if (!isTopLevelCodexSession(meta) || !isRelevantWorkspaceSession(meta.cwd)) {
        runtime.knownTranscriptFiles.add(file);
        continue;
      }

      const existingBySessionId = findExistingCodexAgentBySessionId(
        runtime.agents.values(),
        meta.id,
      );
      if (existingBySessionId) {
        if (shouldAttachCodexTranscript(existingBySessionId, file)) {
          attachTranscriptToAgent(existingBySessionId, meta, file, runtime, false);
        }
        runtime.knownTranscriptFiles.add(file);
        continue;
      }

      const pendingAgent = findPendingCodexAgentForSession(runtime.agents.values(), meta.cwd);
      if (pendingAgent) {
        attachTranscriptToAgent(pendingAgent, meta, file, runtime, false);
      }

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
