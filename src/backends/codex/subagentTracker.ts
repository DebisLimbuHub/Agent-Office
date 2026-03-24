import * as fs from 'fs';

import {
  FILE_WATCHER_POLL_INTERVAL_MS,
  PERMISSION_TIMER_DELAY_MS,
  TOOL_DONE_DELAY_MS,
} from '../../constants.js';
import type { BackendEventSink } from '../types.js';
import { formatToolStatus, parseToolInput, PERMISSION_EXEMPT_TOOLS } from './activity.js';
import {
  type CodexSessionMeta,
  listCodexSessionFiles,
  readCodexSessionMeta,
} from './sessionStore.js';

interface CodexSubagentState {
  childSessionId: string;
  parentAgentId: number;
  parentToolId: string;
  parentSessionId?: string;
  nickname?: string;
  transcriptFile?: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolNames: Map<string, string>;
  permissionSent: boolean;
}

const subagents = new Map<string, CodexSubagentState>();
const subagentWatchers = new Map<string, fs.FSWatcher>();
const subagentPollingTimers = new Map<string, ReturnType<typeof setInterval>>();
const subagentPermissionTimers = new Map<string, ReturnType<typeof setTimeout>>();

function stopWatching(childSessionId: string): void {
  const transcriptFile = subagents.get(childSessionId)?.transcriptFile;
  subagentWatchers.get(childSessionId)?.close();
  subagentWatchers.delete(childSessionId);

  const pollingTimer = subagentPollingTimers.get(childSessionId);
  if (pollingTimer) {
    clearInterval(pollingTimer);
    subagentPollingTimers.delete(childSessionId);
  }

  const permissionTimer = subagentPermissionTimers.get(childSessionId);
  if (permissionTimer) {
    clearTimeout(permissionTimer);
    subagentPermissionTimers.delete(childSessionId);
  }

  if (transcriptFile) {
    try {
      fs.unwatchFile(transcriptFile);
    } catch {
      // Ignore unwatch failures.
    }
  }
}

function clearPermission(childSessionId: string, emitEvent: BackendEventSink): void {
  const state = subagents.get(childSessionId);
  if (!state || !state.permissionSent) {
    return;
  }

  state.permissionSent = false;
  emitEvent({
    type: 'subagentPermissionCleared',
    agentId: state.parentAgentId,
    parentToolId: state.parentToolId,
  });
}

function schedulePermissionCheck(childSessionId: string, emitEvent: BackendEventSink): void {
  const existing = subagentPermissionTimers.get(childSessionId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    subagentPermissionTimers.delete(childSessionId);
    const state = subagents.get(childSessionId);
    if (!state) {
      return;
    }

    const hasNonExemptTool = [...state.activeToolIds].some((toolId) => {
      const toolName = state.activeToolNames.get(toolId);
      return !!toolName && !PERMISSION_EXEMPT_TOOLS.has(toolName);
    });

    if (!hasNonExemptTool || state.permissionSent) {
      return;
    }

    state.permissionSent = true;
    emitEvent({
      type: 'subagentPermissionRequired',
      agentId: state.parentAgentId,
      parentToolId: state.parentToolId,
    });
  }, PERMISSION_TIMER_DELAY_MS);

  subagentPermissionTimers.set(childSessionId, timer);
}

function finishSubagentTool(
  state: CodexSubagentState,
  toolId: string,
  emitEvent: BackendEventSink,
): void {
  if (!state.activeToolIds.has(toolId)) {
    return;
  }

  state.activeToolIds.delete(toolId);
  state.activeToolNames.delete(toolId);

  setTimeout(() => {
    emitEvent({
      type: 'subagentToolFinished',
      agentId: state.parentAgentId,
      parentToolId: state.parentToolId,
      toolId,
    });
  }, TOOL_DONE_DELAY_MS);

  schedulePermissionCheck(state.childSessionId, emitEvent);
}

function clearSubagent(childSessionId: string, emitEvent: BackendEventSink): void {
  const state = subagents.get(childSessionId);
  if (!state) {
    return;
  }

  stopWatching(childSessionId);
  subagents.delete(childSessionId);

  emitEvent({
    type: 'subagentCleared',
    agentId: state.parentAgentId,
    parentToolId: state.parentToolId,
  });
}

function processSubagentLine(
  state: CodexSubagentState,
  line: string,
  emitEvent: BackendEventSink,
): void {
  try {
    const record = JSON.parse(line) as {
      type?: unknown;
      payload?: Record<string, unknown>;
      timestamp?: unknown;
    };

    const payload =
      typeof record.payload === 'object' && record.payload !== null ? record.payload : null;
    if (!payload) {
      return;
    }

    if (record.type === 'event_msg' && payload.type === 'task_complete') {
      clearSubagent(state.childSessionId, emitEvent);
      return;
    }

    if (record.type !== 'response_item') {
      return;
    }

    if (payload.type === 'function_call') {
      const toolId = typeof payload.call_id === 'string' ? payload.call_id : null;
      const toolName = typeof payload.name === 'string' ? payload.name : null;
      if (!toolId || !toolName) {
        return;
      }

      const status = formatToolStatus(toolName, payload.arguments);
      state.activeToolIds.add(toolId);
      state.activeToolNames.set(toolId, toolName);
      emitEvent({
        type: 'subagentToolStarted',
        agentId: state.parentAgentId,
        parentToolId: state.parentToolId,
        toolId,
        status,
      });

      if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
        schedulePermissionCheck(state.childSessionId, emitEvent);
      }

      return;
    }

    if (payload.type === 'function_call_output' && typeof payload.call_id === 'string') {
      finishSubagentTool(state, payload.call_id, emitEvent);
      return;
    }

    if (payload.type === 'custom_tool_call' && typeof payload.name === 'string') {
      const toolName = payload.name;
      const toolId =
        typeof payload.call_id === 'string'
          ? payload.call_id
          : `sub-custom:${String(record.timestamp ?? toolName)}`;
      const status = formatToolStatus(toolName, payload.input);

      emitEvent({
        type: 'subagentToolStarted',
        agentId: state.parentAgentId,
        parentToolId: state.parentToolId,
        toolId,
        status,
      });

      if (payload.status === 'completed') {
        setTimeout(() => {
          emitEvent({
            type: 'subagentToolFinished',
            agentId: state.parentAgentId,
            parentToolId: state.parentToolId,
            toolId,
          });
        }, TOOL_DONE_DELAY_MS);
      }

      return;
    }

    if (payload.type === 'web_search_call' && payload.status === 'completed') {
      const toolId = `sub-web-search:${String(record.timestamp ?? state.childSessionId)}`;
      emitEvent({
        type: 'subagentToolStarted',
        agentId: state.parentAgentId,
        parentToolId: state.parentToolId,
        toolId,
        status: 'Searching the web',
      });
      setTimeout(() => {
        emitEvent({
          type: 'subagentToolFinished',
          agentId: state.parentAgentId,
          parentToolId: state.parentToolId,
          toolId,
        });
      }, TOOL_DONE_DELAY_MS);
    }
  } catch {
    // Ignore malformed lines.
  }
}

function readNewSubagentLines(childSessionId: string, emitEvent: BackendEventSink): void {
  const state = subagents.get(childSessionId);
  if (!state || !state.transcriptFile) {
    return;
  }

  try {
    const stat = fs.statSync(state.transcriptFile);
    if (stat.size <= state.fileOffset) {
      return;
    }

    const buffer = Buffer.alloc(stat.size - state.fileOffset);
    const fd = fs.openSync(state.transcriptFile, 'r');
    fs.readSync(fd, buffer, 0, buffer.length, state.fileOffset);
    fs.closeSync(fd);
    state.fileOffset = stat.size;

    const text = state.lineBuffer + buffer.toString('utf-8');
    const lines = text.split('\n');
    state.lineBuffer = lines.pop() || '';

    if (lines.some((line) => line.trim())) {
      const permissionTimer = subagentPermissionTimers.get(childSessionId);
      if (permissionTimer) {
        clearTimeout(permissionTimer);
        subagentPermissionTimers.delete(childSessionId);
      }
      clearPermission(childSessionId, emitEvent);
    }

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      processSubagentLine(state, line, emitEvent);
    }
  } catch {
    // Ignore transient file read issues.
  }
}

function startWatchingSubagent(childSessionId: string, emitEvent: BackendEventSink): void {
  const state = subagents.get(childSessionId);
  if (!state?.transcriptFile || subagentPollingTimers.has(childSessionId)) {
    return;
  }

  try {
    const watcher = fs.watch(state.transcriptFile, () => {
      readNewSubagentLines(childSessionId, emitEvent);
    });
    subagentWatchers.set(childSessionId, watcher);
  } catch {
    // Fall through to watchFile/polling.
  }

  try {
    fs.watchFile(state.transcriptFile, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => {
      readNewSubagentLines(childSessionId, emitEvent);
    });
  } catch {
    // Ignore watchFile issues and rely on manual polling.
  }

  const timer = setInterval(() => {
    if (!subagents.has(childSessionId)) {
      clearInterval(timer);
      subagentPollingTimers.delete(childSessionId);
      return;
    }
    readNewSubagentLines(childSessionId, emitEvent);
  }, FILE_WATCHER_POLL_INTERVAL_MS);

  subagentPollingTimers.set(childSessionId, timer);
}

export function registerCodexSubagent(
  parentAgentId: number,
  parentAgentSessionId: string | undefined,
  parentToolId: string,
  childSessionId: string,
  output: unknown,
  sessionsRoot: string,
  emitEvent: BackendEventSink,
): void {
  const parsedOutput = parseToolInput(output);
  const nickname = typeof parsedOutput.nickname === 'string' ? parsedOutput.nickname : undefined;

  const existing = subagents.get(childSessionId);
  if (existing) {
    existing.parentAgentId = parentAgentId;
    existing.parentToolId = parentToolId;
    existing.parentSessionId = parentAgentSessionId;
    if (nickname) {
      existing.nickname = nickname;
    }
  } else {
    subagents.set(childSessionId, {
      childSessionId,
      parentAgentId,
      parentToolId,
      parentSessionId: parentAgentSessionId,
      nickname,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolNames: new Map(),
      permissionSent: false,
    });
  }

  const transcriptFile = findDiscoveredSubagentTranscript(sessionsRoot, childSessionId);
  if (transcriptFile) {
    const state = subagents.get(childSessionId);
    if (state && !state.transcriptFile) {
      state.transcriptFile = transcriptFile;
      startWatchingSubagent(childSessionId, emitEvent);
      readNewSubagentLines(childSessionId, emitEvent);
    }
  }
}

function findDiscoveredSubagentTranscript(
  sessionsRoot: string,
  childSessionId: string,
): string | null {
  try {
    for (const filePath of listCodexSessionFiles(sessionsRoot)) {
      const meta = readCodexSessionMeta(filePath);
      if (meta?.id === childSessionId) {
        return filePath;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function attachDiscoveredCodexSubagent(
  meta: CodexSessionMeta,
  transcriptFile: string,
  emitEvent: BackendEventSink,
): boolean {
  const state = subagents.get(meta.id);
  if (!state) {
    return false;
  }

  state.parentSessionId = state.parentSessionId ?? meta.parentSessionId;
  state.transcriptFile = transcriptFile;
  startWatchingSubagent(meta.id, emitEvent);
  readNewSubagentLines(meta.id, emitEvent);
  return true;
}

export function cleanupCodexSubagentBySessionId(
  childSessionId: string,
  emitEvent: BackendEventSink,
): void {
  clearSubagent(childSessionId, emitEvent);
}

export function cleanupCodexSubagentsForAgent(
  parentAgentId: number,
  emitEvent: BackendEventSink,
): void {
  for (const [childSessionId, state] of subagents) {
    if (state.parentAgentId === parentAgentId) {
      clearSubagent(childSessionId, emitEvent);
    }
  }
}

export function disposeCodexSubagentState(emitEvent?: BackendEventSink): void {
  for (const childSessionId of [...subagents.keys()]) {
    if (emitEvent) {
      clearSubagent(childSessionId, emitEvent);
    } else {
      stopWatching(childSessionId);
      subagents.delete(childSessionId);
    }
  }
}
