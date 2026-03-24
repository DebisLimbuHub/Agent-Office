import * as path from 'path';

import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from '../../constants.js';

const TOOL_STATUS_OVERRIDES: Record<string, string> = {
  apply_patch: 'Applying patch',
  close_agent: 'Closing agent',
  parallel: 'Running multiple commands',
  request_user_input: 'Waiting for your answer',
  resume_agent: 'Resuming agent',
  send_input: 'Messaging agent',
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

export function parseToolInput(value: unknown): Record<string, unknown> {
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

export function extractToolTargetSessionId(rawInput: unknown): string | null {
  const input = parseToolInput(rawInput);
  const directId =
    typeof input.agent_id === 'string'
      ? input.agent_id
      : typeof input.id === 'string'
        ? input.id
        : typeof input.session_id === 'string'
          ? input.session_id
          : null;

  if (directId) {
    return directId;
  }

  const agent = isRecord(input.agent) ? input.agent : null;
  if (!agent) {
    return null;
  }

  return typeof agent.id === 'string' ? agent.id : null;
}

export function extractSubtaskLabel(rawInput: unknown): string | null {
  const input = parseToolInput(rawInput);
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

  return message ? truncate(message, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) : null;
}

export function formatToolStatus(toolName: string, rawInput: unknown): string {
  const input = parseToolInput(rawInput);
  const baseName = (value: unknown) => (typeof value === 'string' ? path.basename(value) : '');

  if (toolName === 'spawn_agent') {
    const label = extractSubtaskLabel(rawInput);
    return label ? `Subtask: ${label}` : 'Subtask: delegated task';
  }

  if (toolName in TOOL_STATUS_OVERRIDES) {
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
