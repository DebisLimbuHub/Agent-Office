import * as path from 'path';

import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
  TOOL_DONE_DELAY_MS,
} from '../../constants.js';
import {
  cancelPermissionTimer,
  cancelWaitingTimer,
  startPermissionTimer,
} from '../../timerManager.js';
import type { AgentState } from '../../types.js';
import type { BackendEventSink } from '../types.js';

const TOOL_STATUS_OVERRIDES: Record<string, string> = {
  apply_patch: 'Applying patch',
  close_agent: 'Closing agent',
  parallel: 'Running multiple commands',
  request_user_input: 'Waiting for your answer',
  resume_agent: 'Resuming agent',
  send_input: 'Messaging agent',
  spawn_agent: 'Delegating task',
  update_plan: 'Planning',
  view_image: 'Viewing image',
  wait_agent: 'Waiting for agent',
};

export const PERMISSION_EXEMPT_TOOLS = new Set([
  'apply_patch',
  'close_agent',
  'parallel',
  'request_user_input',
  'resume_agent',
  'send_input',
  'spawn_agent',
  'update_plan',
  'view_image',
  'wait_agent',
  'web_search',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function parseToolInput(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function formatToolStatus(toolName: string, rawInput: unknown): string {
  const input = parseToolInput(rawInput);
  const baseName = (value: unknown) => (typeof value === 'string' ? path.basename(value) : '');

  if (toolName in TOOL_STATUS_OVERRIDES) {
    if (toolName === 'spawn_agent') {
      const message =
        typeof input.message === 'string'
          ? input.message
          : Array.isArray(input.items)
            ? input.items
                .map((item) =>
                  isRecord(item) && typeof item.text === 'string' ? item.text.trim() : '',
                )
                .find(Boolean)
            : '';
      return message
        ? `Delegating: ${truncate(message, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH)}`
        : 'Delegating task';
    }

    if (toolName === 'parallel') {
      const toolUses = Array.isArray(input.tool_uses) ? input.tool_uses.length : 0;
      return toolUses > 0
        ? `Running ${toolUses} parallel task${toolUses === 1 ? '' : 's'}`
        : 'Running multiple commands';
    }

    return TOOL_STATUS_OVERRIDES[toolName];
  }

  switch (toolName) {
    case 'exec_command': {
      const cmd = typeof input.cmd === 'string' ? input.cmd : '';
      return `Running: ${truncate(cmd, BASH_COMMAND_DISPLAY_MAX_LENGTH)}`;
    }
    case 'open':
      return `Opening ${baseName(input.ref_id) || 'resource'}`;
    case 'click':
      return 'Following link';
    case 'find':
      return 'Searching page';
    case 'search_query':
    case 'image_query':
      return 'Searching the web';
    case 'finance':
      return 'Checking markets';
    case 'weather':
      return 'Checking weather';
    case 'sports':
      return 'Checking sports';
    case 'time':
      return 'Checking time';
    default:
      return `Using ${toolName}`;
  }
}

function hasTrackedActivity(agent: AgentState): boolean {
  return (
    agent.activeToolIds.size > 0 ||
    agent.activeToolStatuses.size > 0 ||
    agent.activeToolNames.size > 0 ||
    agent.activeSubagentToolIds.size > 0 ||
    agent.activeSubagentToolNames.size > 0
  );
}

function clearTrackedActivity(
  agentId: number,
  agent: AgentState,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  agent.activeToolIds.clear();
  agent.activeToolStatuses.clear();
  agent.activeToolNames.clear();
  agent.activeSubagentToolIds.clear();
  agent.activeSubagentToolNames.clear();
  agent.permissionSent = false;
  cancelPermissionTimer(agentId, permissionTimers);
  emitEvent({ type: 'toolsCleared', agentId });
}

function beginTurn(
  agentId: number,
  agent: AgentState,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  cancelWaitingTimer(agentId, waitingTimers);
  cancelPermissionTimer(agentId, permissionTimers);

  if (hasTrackedActivity(agent)) {
    clearTrackedActivity(agentId, agent, permissionTimers, emitEvent);
  }

  agent.isWaiting = false;
  agent.permissionSent = false;
  agent.hadToolsInTurn = false;
  emitEvent({ type: 'statusChanged', agentId, status: 'active' });
}

function markAgentWorking(
  agentId: number,
  agent: AgentState,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  cancelWaitingTimer(agentId, waitingTimers);
  agent.isWaiting = false;
  agent.hadToolsInTurn = true;
  emitEvent({ type: 'statusChanged', agentId, status: 'active' });
}

function restartPermissionTimerIfNeeded(
  agentId: number,
  agents: Map<number, AgentState>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  const agent = agents.get(agentId);
  if (!agent) {
    return;
  }

  const hasNonExemptTool = [...agent.activeToolIds].some((toolId) => {
    const toolName = agent.activeToolNames.get(toolId);
    return !!toolName && !PERMISSION_EXEMPT_TOOLS.has(toolName);
  });

  if (hasNonExemptTool) {
    startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, emitEvent);
  }
}

function completeTrackedTool(
  agentId: number,
  toolId: string,
  agents: Map<number, AgentState>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  const agent = agents.get(agentId);
  if (!agent || !agent.activeToolIds.has(toolId)) {
    return;
  }

  agent.activeToolIds.delete(toolId);
  agent.activeToolStatuses.delete(toolId);
  agent.activeToolNames.delete(toolId);

  setTimeout(() => {
    emitEvent({ type: 'toolFinished', agentId, toolId });
  }, TOOL_DONE_DELAY_MS);

  restartPermissionTimerIfNeeded(agentId, agents, permissionTimers, emitEvent);
}

function emitTransientTool(
  agentId: number,
  status: string,
  toolId: string,
  emitEvent: BackendEventSink,
): void {
  emitEvent({ type: 'toolStarted', agentId, toolId, status });
  setTimeout(() => {
    emitEvent({ type: 'toolFinished', agentId, toolId });
  }, TOOL_DONE_DELAY_MS);
}

function processEventMessage(
  agentId: number,
  payload: Record<string, unknown>,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  const agent = agents.get(agentId);
  if (!agent) {
    return;
  }

  switch (payload.type) {
    case 'user_message':
      beginTurn(agentId, agent, waitingTimers, permissionTimers, emitEvent);
      break;
    case 'task_complete':
      cancelWaitingTimer(agentId, waitingTimers);
      cancelPermissionTimer(agentId, permissionTimers);

      if (hasTrackedActivity(agent)) {
        clearTrackedActivity(agentId, agent, permissionTimers, emitEvent);
      }

      agent.isWaiting = true;
      agent.permissionSent = false;
      agent.hadToolsInTurn = false;
      emitEvent({ type: 'statusChanged', agentId, status: 'waiting' });
      break;
    default:
      break;
  }
}

function processFunctionCall(
  agentId: number,
  payload: Record<string, unknown>,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  const agent = agents.get(agentId);
  if (!agent) {
    return;
  }

  const toolId = typeof payload.call_id === 'string' ? payload.call_id : null;
  const toolName = typeof payload.name === 'string' ? payload.name : null;
  if (!toolId || !toolName) {
    return;
  }

  const status = formatToolStatus(toolName, payload.arguments);
  markAgentWorking(agentId, agent, waitingTimers, emitEvent);

  agent.activeToolIds.add(toolId);
  agent.activeToolStatuses.set(toolId, status);
  agent.activeToolNames.set(toolId, toolName);

  emitEvent({ type: 'toolStarted', agentId, toolId, status });

  if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
    startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, emitEvent);
  }
}

function processCustomToolCall(
  agentId: number,
  payload: Record<string, unknown>,
  record: Record<string, unknown>,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  const agent = agents.get(agentId);
  if (!agent) {
    return;
  }

  const toolName = typeof payload.name === 'string' ? payload.name : 'custom_tool';
  const toolId =
    typeof payload.call_id === 'string'
      ? payload.call_id
      : `custom:${String(record.timestamp ?? toolName)}`;
  const status = formatToolStatus(toolName, payload.input);

  markAgentWorking(agentId, agent, waitingTimers, emitEvent);

  if (!agent.activeToolIds.has(toolId) && payload.status !== 'completed') {
    agent.activeToolIds.add(toolId);
    agent.activeToolStatuses.set(toolId, status);
    agent.activeToolNames.set(toolId, toolName);
    emitEvent({ type: 'toolStarted', agentId, toolId, status });
  } else if (payload.status === 'completed' && !agent.activeToolIds.has(toolId)) {
    emitTransientTool(agentId, status, toolId, emitEvent);
  }

  if (payload.status === 'completed') {
    completeTrackedTool(agentId, toolId, agents, permissionTimers, emitEvent);
  } else if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
    startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, emitEvent);
  }
}

function processWebSearchCall(
  agentId: number,
  payload: Record<string, unknown>,
  record: Record<string, unknown>,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  const agent = agents.get(agentId);
  if (!agent || payload.status !== 'completed') {
    return;
  }

  markAgentWorking(agentId, agent, waitingTimers, emitEvent);
  emitTransientTool(
    agentId,
    'Searching the web',
    `web-search:${String(record.timestamp)}`,
    emitEvent,
  );
}

function processResponseItem(
  agentId: number,
  payload: Record<string, unknown>,
  record: Record<string, unknown>,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  switch (payload.type) {
    case 'function_call':
      processFunctionCall(agentId, payload, agents, waitingTimers, permissionTimers, emitEvent);
      break;
    case 'function_call_output':
      if (typeof payload.call_id === 'string') {
        completeTrackedTool(agentId, payload.call_id, agents, permissionTimers, emitEvent);
      }
      break;
    case 'custom_tool_call':
      processCustomToolCall(
        agentId,
        payload,
        record,
        agents,
        waitingTimers,
        permissionTimers,
        emitEvent,
      );
      break;
    case 'web_search_call':
      processWebSearchCall(agentId, payload, record, agents, waitingTimers, emitEvent);
      break;
    default:
      break;
  }
}

export function processTranscriptLine(
  agentId: number,
  line: string,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    const payload = isRecord(record.payload) ? record.payload : null;
    if (!payload) {
      return;
    }

    switch (record.type) {
      case 'event_msg':
        processEventMessage(agentId, payload, agents, waitingTimers, permissionTimers, emitEvent);
        break;
      case 'response_item':
        processResponseItem(
          agentId,
          payload,
          record,
          agents,
          waitingTimers,
          permissionTimers,
          emitEvent,
        );
        break;
      default:
        break;
    }
  } catch {
    // Ignore malformed lines
  }
}
