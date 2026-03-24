import { TOOL_DONE_DELAY_MS } from '../../constants.js';
import type { AgentState } from '../../types.js';
import type { BackendEventSink } from '../types.js';
import {
  extractToolTargetSessionId,
  formatToolStatus,
  parseToolInput,
  PERMISSION_EXEMPT_TOOLS,
} from './activity.js';
import { getCodexSessionsDirectory } from './sessionStore.js';
import { cleanupCodexSubagentBySessionId, registerCodexSubagent } from './subagentTracker.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
  emitEvent: BackendEventSink,
): void {
  agent.activeToolIds.clear();
  agent.activeToolStatuses.clear();
  agent.activeToolNames.clear();
  agent.activeToolInputs.clear();
  agent.activeSubagentToolIds.clear();
  agent.activeSubagentToolNames.clear();
  agent.permissionSent = false;
  emitEvent({ type: 'toolsCleared', agentId });
}

function beginTurn(
  agentId: number,
  agent: AgentState,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  const waitingTimer = waitingTimers.get(agentId);
  if (waitingTimer) {
    clearTimeout(waitingTimer);
    waitingTimers.delete(agentId);
  }

  const permissionTimer = permissionTimers.get(agentId);
  if (permissionTimer) {
    clearTimeout(permissionTimer);
    permissionTimers.delete(agentId);
  }

  if (hasTrackedActivity(agent)) {
    clearTrackedActivity(agentId, agent, emitEvent);
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
  const waitingTimer = waitingTimers.get(agentId);
  if (waitingTimer) {
    clearTimeout(waitingTimer);
    waitingTimers.delete(agentId);
  }

  agent.isWaiting = false;
  agent.hadToolsInTurn = true;
  emitEvent({ type: 'statusChanged', agentId, status: 'active' });
}

function schedulePermissionCheck(
  agentId: number,
  agents: Map<number, AgentState>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  const current = permissionTimers.get(agentId);
  if (current) {
    clearTimeout(current);
  }

  const timer = setTimeout(() => {
    permissionTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (!agent) {
      return;
    }

    const hasNonExemptTool = [...agent.activeToolIds].some((toolId) => {
      const toolName = agent.activeToolNames.get(toolId);
      return !!toolName && !PERMISSION_EXEMPT_TOOLS.has(toolName);
    });

    if (!hasNonExemptTool || agent.permissionSent) {
      return;
    }

    agent.permissionSent = true;
    emitEvent({ type: 'permissionRequired', agentId });
  }, 7000);

  permissionTimers.set(agentId, timer);
}

function finishTrackedTool(
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
  agent.activeToolInputs.delete(toolId);

  setTimeout(() => {
    emitEvent({ type: 'toolFinished', agentId, toolId });
  }, TOOL_DONE_DELAY_MS);

  schedulePermissionCheck(agentId, agents, permissionTimers, emitEvent);
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
    case 'task_started':
      beginTurn(agentId, agent, waitingTimers, permissionTimers, emitEvent);
      break;
    case 'task_complete': {
      const waitingTimer = waitingTimers.get(agentId);
      if (waitingTimer) {
        clearTimeout(waitingTimer);
        waitingTimers.delete(agentId);
      }
      const permissionTimer = permissionTimers.get(agentId);
      if (permissionTimer) {
        clearTimeout(permissionTimer);
        permissionTimers.delete(agentId);
      }

      if (hasTrackedActivity(agent)) {
        clearTrackedActivity(agentId, agent, emitEvent);
      }

      agent.isWaiting = true;
      agent.permissionSent = false;
      agent.hadToolsInTurn = false;
      emitEvent({ type: 'statusChanged', agentId, status: 'waiting' });
      break;
    }
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
  agent.activeToolInputs.set(toolId, parseToolInput(payload.arguments));

  emitEvent({ type: 'toolStarted', agentId, toolId, status });

  if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
    schedulePermissionCheck(agentId, agents, permissionTimers, emitEvent);
  }
}

function processFunctionCallOutput(
  agentId: number,
  payload: Record<string, unknown>,
  agents: Map<number, AgentState>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  emitEvent: BackendEventSink,
): void {
  const agent = agents.get(agentId);
  const toolId = typeof payload.call_id === 'string' ? payload.call_id : null;
  if (!agent || !toolId) {
    return;
  }

  const toolName = agent.activeToolNames.get(toolId);
  if (toolName === 'spawn_agent' && agent.backendSessionId) {
    const output = parseToolInput(payload.output);
    if (typeof output.agent_id === 'string') {
      registerCodexSubagent(
        agentId,
        agent.backendSessionId,
        toolId,
        output.agent_id,
        payload.output,
        getCodexSessionsDirectory(),
        emitEvent,
      );
    }
  }

  if (toolName === 'close_agent') {
    const targetSessionId =
      extractToolTargetSessionId(payload.output) ??
      extractToolTargetSessionId(agent.activeToolInputs.get(toolId));
    if (targetSessionId) {
      cleanupCodexSubagentBySessionId(targetSessionId, emitEvent);
    }
  }

  finishTrackedTool(agentId, toolId, agents, permissionTimers, emitEvent);
}

function processCustomToolCall(
  agentId: number,
  payload: Record<string, unknown>,
  record: Record<string, unknown>,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
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
  emitEvent({ type: 'toolStarted', agentId, toolId, status });

  if (payload.status === 'completed') {
    setTimeout(() => {
      emitEvent({ type: 'toolFinished', agentId, toolId });
    }, TOOL_DONE_DELAY_MS);
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
  const toolId = `web-search:${String(record.timestamp ?? agentId)}`;
  emitEvent({ type: 'toolStarted', agentId, toolId, status: 'Searching the web' });
  setTimeout(() => {
    emitEvent({ type: 'toolFinished', agentId, toolId });
  }, TOOL_DONE_DELAY_MS);
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
      processFunctionCallOutput(agentId, payload, agents, permissionTimers, emitEvent);
      break;
    case 'custom_tool_call':
      processCustomToolCall(agentId, payload, record, agents, waitingTimers, emitEvent);
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
    // Ignore malformed lines.
  }
}
