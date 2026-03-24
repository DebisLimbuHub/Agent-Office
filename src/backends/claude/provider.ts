import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { TERMINAL_NAME_PREFIX, TRANSCRIPT_POLL_INTERVAL_MS } from '../../constants.js';
import { ensureProjectScan, readNewLines, startFileWatching } from '../../fileWatcher.js';
import type { AgentState, PersistedAgent } from '../../types.js';
import type { AgentBackendProvider, BackendHostRuntime, CreateSessionOptions } from '../types.js';
import { processTranscriptLine } from './transcriptParser.js';

export function getClaudeProjectDirPath(cwd?: string): string | null {
  const workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) return null;
  const dirName = workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
  const projectDir = path.join(os.homedir(), '.claude', 'projects', dirName);
  console.log(`[Agent Office] Project dir: ${workspacePath} → ${dirName}`);
  return projectDir;
}

function createClaudeAgentState(
  id: number,
  terminal: vscode.Terminal,
  projectDir: string,
  transcriptFile: string,
  folderName?: string,
): AgentState {
  return {
    id,
    backendId: 'claude',
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

function watchTranscriptWhenReady(
  agentId: number,
  runtime: BackendHostRuntime,
  persistedAgent?: PersistedAgent,
): void {
  const agent = runtime.agents.get(agentId);
  if (!agent) return;

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

      console.log(
        persistedAgent
          ? `[Agent Office] Restored agent ${agentId}: found transcript file`
          : `[Agent Office] Agent ${agentId}: found transcript file ${path.basename(currentAgent.transcriptFile)}`,
      );
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

export const claudeBackendProvider: AgentBackendProvider = {
  id: 'claude',
  displayName: 'Claude Code',
  isImplemented: true,
  async createSession(runtime: BackendHostRuntime, options: CreateSessionOptions) {
    const folders = vscode.workspace.workspaceFolders;
    const cwd = options.folderPath || folders?.[0]?.uri.fsPath;
    const isMultiRoot = !!(folders && folders.length > 1);
    const terminalIndex = runtime.nextTerminalIndexRef.current++;
    const terminal = vscode.window.createTerminal({
      name: `${TERMINAL_NAME_PREFIX} #${terminalIndex}`,
      cwd,
    });
    terminal.show();

    const sessionId = crypto.randomUUID();
    const claudeCmd = options.bypassPermissions
      ? `claude --session-id ${sessionId} --dangerously-skip-permissions`
      : `claude --session-id ${sessionId}`;
    terminal.sendText(claudeCmd);

    const projectDir = getClaudeProjectDirPath(cwd);
    if (!projectDir) {
      console.log('[Agent Office] No project dir, cannot track agent');
      return;
    }

    const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
    runtime.knownTranscriptFiles.add(expectedFile);

    const agentId = runtime.nextAgentIdRef.current++;
    const folderName = isMultiRoot && cwd ? path.basename(cwd) : undefined;
    const agent = createClaudeAgentState(agentId, terminal, projectDir, expectedFile, folderName);

    runtime.agents.set(agentId, agent);
    runtime.activeAgentIdRef.current = agentId;
    runtime.persistAgents();
    console.log(`[Agent Office] Agent ${agentId}: created for terminal ${terminal.name}`);
    runtime.emitEvent({ type: 'sessionCreated', agentId, folderName });

    ensureProjectScan(
      projectDir,
      runtime.knownTranscriptFiles,
      runtime.projectScanTimerRef,
      runtime.activeAgentIdRef,
      runtime.nextAgentIdRef,
      runtime.agents,
      runtime.fileWatchers,
      runtime.pollingTimers,
      runtime.waitingTimers,
      runtime.permissionTimers,
      runtime.emitEvent,
      'claude',
      runtime.persistAgents,
      processTranscriptLine,
    );

    watchTranscriptWhenReady(agentId, runtime);
  },
  restoreSessions(runtime: BackendHostRuntime, persistedAgents: PersistedAgent[]) {
    if (persistedAgents.length === 0) return;

    const liveTerminals = vscode.window.terminals;
    let maxId = 0;
    let maxTerminalIndex = 0;
    let restoredProjectDir: string | null = null;

    for (const persistedAgent of persistedAgents) {
      const terminal = liveTerminals.find(
        (candidate) => candidate.name === persistedAgent.terminalName,
      );
      if (!terminal) continue;

      const agent = createClaudeAgentState(
        persistedAgent.id,
        terminal,
        persistedAgent.projectDir,
        persistedAgent.transcriptFile,
        persistedAgent.folderName,
      );

      runtime.agents.set(persistedAgent.id, agent);
      runtime.knownTranscriptFiles.add(persistedAgent.transcriptFile);
      console.log(
        `[Agent Office] Restored agent ${persistedAgent.id} → terminal "${persistedAgent.terminalName}"`,
      );

      maxId = Math.max(maxId, persistedAgent.id);
      const terminalIndexMatch = persistedAgent.terminalName.match(/#(\d+)$/);
      if (terminalIndexMatch) {
        maxTerminalIndex = Math.max(maxTerminalIndex, parseInt(terminalIndexMatch[1], 10));
      }

      restoredProjectDir = persistedAgent.projectDir;
      watchTranscriptWhenReady(persistedAgent.id, runtime, persistedAgent);
    }

    if (maxId >= runtime.nextAgentIdRef.current) {
      runtime.nextAgentIdRef.current = maxId + 1;
    }
    if (maxTerminalIndex >= runtime.nextTerminalIndexRef.current) {
      runtime.nextTerminalIndexRef.current = maxTerminalIndex + 1;
    }

    if (restoredProjectDir) {
      ensureProjectScan(
        restoredProjectDir,
        runtime.knownTranscriptFiles,
        runtime.projectScanTimerRef,
        runtime.activeAgentIdRef,
        runtime.nextAgentIdRef,
        runtime.agents,
        runtime.fileWatchers,
        runtime.pollingTimers,
        runtime.waitingTimers,
        runtime.permissionTimers,
        runtime.emitEvent,
        'claude',
        runtime.persistAgents,
        processTranscriptLine,
      );
    }
  },
  startDiscovery(runtime: BackendHostRuntime) {
    const projectDir = getClaudeProjectDirPath();
    if (!projectDir) return;

    ensureProjectScan(
      projectDir,
      runtime.knownTranscriptFiles,
      runtime.projectScanTimerRef,
      runtime.activeAgentIdRef,
      runtime.nextAgentIdRef,
      runtime.agents,
      runtime.fileWatchers,
      runtime.pollingTimers,
      runtime.waitingTimers,
      runtime.permissionTimers,
      runtime.emitEvent,
      'claude',
      runtime.persistAgents,
      processTranscriptLine,
    );
  },
  focusSession(agent) {
    agent.terminalRef.show();
  },
  closeSession(agent) {
    agent.terminalRef.dispose();
  },
  getSessionsDirectory(cwd?: string) {
    return getClaudeProjectDirPath(cwd);
  },
};
