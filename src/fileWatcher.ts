import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { BackendEventSink } from './backends/types.js';
import { FILE_WATCHER_POLL_INTERVAL_MS, PROJECT_SCAN_INTERVAL_MS } from './constants.js';
import { cancelPermissionTimer, cancelWaitingTimer, clearAgentActivity } from './timerManager.js';
import type { AgentState, BackendId } from './types.js';

/** Backend-specific callback that parses a single transcript line and emits events. */
export type LineProcessor = (
  agentId: number,
  line: string,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
) => void;

export function startFileWatching(
  agentId: number,
  filePath: string,
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
  processLine: LineProcessor,
): void {
  // Primary: fs.watch (unreliable on macOS — may miss events)
  try {
    const watcher = fs.watch(filePath, () => {
      readNewLines(agentId, agents, waitingTimers, permissionTimers, emitEvent, processLine);
    });
    fileWatchers.set(agentId, watcher);
  } catch (e) {
    console.log(`[Agent Office] fs.watch failed for agent ${agentId}: ${e}`);
  }

  // Secondary: fs.watchFile (stat-based polling, reliable on macOS)
  try {
    fs.watchFile(filePath, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => {
      readNewLines(agentId, agents, waitingTimers, permissionTimers, emitEvent, processLine);
    });
  } catch (e) {
    console.log(`[Agent Office] fs.watchFile failed for agent ${agentId}: ${e}`);
  }

  // Tertiary: manual poll as last resort
  const interval = setInterval(() => {
    if (!agents.has(agentId)) {
      clearInterval(interval);
      try {
        fs.unwatchFile(filePath);
      } catch {
        /* ignore */
      }
      return;
    }
    readNewLines(agentId, agents, waitingTimers, permissionTimers, emitEvent, processLine);
  }, FILE_WATCHER_POLL_INTERVAL_MS);
  pollingTimers.set(agentId, interval);
}

export function readNewLines(
  agentId: number,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
  processLine: LineProcessor,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  try {
    const stat = fs.statSync(agent.transcriptFile);
    if (stat.size <= agent.fileOffset) return;

    const buf = Buffer.alloc(stat.size - agent.fileOffset);
    const fd = fs.openSync(agent.transcriptFile, 'r');
    fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
    fs.closeSync(fd);
    agent.fileOffset = stat.size;

    const text = agent.lineBuffer + buf.toString('utf-8');
    const lines = text.split('\n');
    agent.lineBuffer = lines.pop() || '';

    const hasLines = lines.some((l) => l.trim());
    if (hasLines) {
      // New data arriving — cancel timers (data flowing means agent is still active)
      cancelWaitingTimer(agentId, waitingTimers);
      cancelPermissionTimer(agentId, permissionTimers);
      if (agent.permissionSent) {
        agent.permissionSent = false;
        emitEvent({ type: 'permissionCleared', agentId });
      }
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      processLine(agentId, line, agents, waitingTimers, permissionTimers, emitEvent);
    }
  } catch (e) {
    console.log(`[Agent Office] Read error for agent ${agentId}: ${e}`);
  }
}

export function ensureProjectScan(
  projectDir: string,
  knownTranscriptFiles: Set<string>,
  projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
  activeAgentIdRef: { current: number | null },
  nextAgentIdRef: { current: number },
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
  backendId: BackendId,
  persistAgents: () => void,
  processLine: LineProcessor,
): void {
  if (projectScanTimerRef.current) return;
  // Seed with all existing transcript files so we only react to truly new ones
  try {
    const files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(projectDir, f));
    for (const f of files) {
      knownTranscriptFiles.add(f);
    }
  } catch {
    /* dir may not exist yet */
  }

  projectScanTimerRef.current = setInterval(() => {
    scanForNewTranscriptFiles(
      projectDir,
      knownTranscriptFiles,
      activeAgentIdRef,
      nextAgentIdRef,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      emitEvent,
      backendId,
      persistAgents,
      processLine,
    );
  }, PROJECT_SCAN_INTERVAL_MS);
}

function scanForNewTranscriptFiles(
  projectDir: string,
  knownTranscriptFiles: Set<string>,
  activeAgentIdRef: { current: number | null },
  nextAgentIdRef: { current: number },
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
  backendId: BackendId,
  persistAgents: () => void,
  processLine: LineProcessor,
): void {
  let files: string[];
  try {
    files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(projectDir, f));
  } catch {
    return;
  }

  for (const file of files) {
    if (!knownTranscriptFiles.has(file)) {
      knownTranscriptFiles.add(file);
      if (activeAgentIdRef.current !== null) {
        // Active agent focused → /clear reassignment
        console.log(
          `[Agent Office] New transcript detected: ${path.basename(file)}, reassigning to agent ${activeAgentIdRef.current}`,
        );
        reassignAgentToFile(
          activeAgentIdRef.current,
          file,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          emitEvent,
          persistAgents,
          processLine,
        );
      } else {
        // No active agent → try to adopt the focused terminal
        const activeTerminal = vscode.window.activeTerminal;
        if (activeTerminal) {
          let owned = false;
          for (const agent of agents.values()) {
            if (agent.terminalRef === activeTerminal) {
              owned = true;
              break;
            }
          }
          if (!owned) {
            adoptTerminalForFile(
              activeTerminal,
              file,
              projectDir,
              nextAgentIdRef,
              agents,
              activeAgentIdRef,
              fileWatchers,
              pollingTimers,
              waitingTimers,
              permissionTimers,
              emitEvent,
              backendId,
              persistAgents,
              processLine,
            );
          }
        }
      }
    }
  }
}

function adoptTerminalForFile(
  terminal: vscode.Terminal,
  transcriptFile: string,
  projectDir: string,
  nextAgentIdRef: { current: number },
  agents: Map<number, AgentState>,
  activeAgentIdRef: { current: number | null },
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
  backendId: BackendId,
  persistAgents: () => void,
  processLine: LineProcessor,
): void {
  const id = nextAgentIdRef.current++;
  const agent: AgentState = {
    id,
    backendId,
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
  };

  agents.set(id, agent);
  activeAgentIdRef.current = id;
  persistAgents();

  console.log(
    `[Agent Office] Agent ${id}: adopted terminal "${terminal.name}" for ${path.basename(transcriptFile)}`,
  );
  emitEvent({ type: 'sessionCreated', agentId: id });

  startFileWatching(
    id,
    transcriptFile,
    agents,
    fileWatchers,
    pollingTimers,
    waitingTimers,
    permissionTimers,
    emitEvent,
    processLine,
  );
  readNewLines(id, agents, waitingTimers, permissionTimers, emitEvent, processLine);
}

export function reassignAgentToFile(
  agentId: number,
  newFilePath: string,
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
  persistAgents: () => void,
  processLine: LineProcessor,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  // Stop old file watching
  fileWatchers.get(agentId)?.close();
  fileWatchers.delete(agentId);
  const pt = pollingTimers.get(agentId);
  if (pt) {
    clearInterval(pt);
  }
  pollingTimers.delete(agentId);
  try {
    fs.unwatchFile(agent.transcriptFile);
  } catch {
    /* ignore */
  }

  // Clear activity
  cancelWaitingTimer(agentId, waitingTimers);
  cancelPermissionTimer(agentId, permissionTimers);
  clearAgentActivity(agent, agentId, permissionTimers, emitEvent);

  // Swap to new file
  agent.transcriptFile = newFilePath;
  agent.fileOffset = 0;
  agent.lineBuffer = '';
  persistAgents();

  // Start watching new file
  startFileWatching(
    agentId,
    newFilePath,
    agents,
    fileWatchers,
    pollingTimers,
    waitingTimers,
    permissionTimers,
    emitEvent,
    processLine,
  );
  readNewLines(agentId, agents, waitingTimers, permissionTimers, emitEvent, processLine);
}
