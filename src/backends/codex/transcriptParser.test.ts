import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { TOOL_DONE_DELAY_MS } from '../../constants.js';
import type { BackendEvent } from '../types.js';
import { disposeCodexSubagentState, registerCodexSubagent } from './subagentTracker.js';
import { processTranscriptLine } from './transcriptParser.js';

function createAgentState() {
  return {
    id: 1,
    backendId: 'codex' as const,
    terminalRef: {} as never,
    projectDir: '/workspace/project',
    transcriptFile: '/workspace/project/.codex/session.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set<string>(),
    activeToolStatuses: new Map<string, string>(),
    activeToolNames: new Map<string, string>(),
    activeToolInputs: new Map<string, Record<string, unknown>>(),
    activeSubagentToolIds: new Map<string, Set<string>>(),
    activeSubagentToolNames: new Map<string, Map<string, string>>(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
  };
}

function waitForToolDone(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, TOOL_DONE_DELAY_MS + 50);
  });
}

test('Codex parser maps exec_command lifecycle to tool and waiting events', async () => {
  const agents = new Map([[1, createAgentState()]]);
  const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const events: BackendEvent[] = [];

  try {
    processTranscriptLine(
      1,
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }),
      agents,
      waitingTimers,
      permissionTimers,
      (event) => events.push(event),
    );

    processTranscriptLine(
      1,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'call-exec',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm run build' }),
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      (event) => events.push(event),
    );

    assert.equal(agents.get(1)?.activeToolNames.get('call-exec'), 'exec_command');
    assert.equal(permissionTimers.has(1), true);
    assert(events.some((event) => event.type === 'toolStarted' && event.toolId === 'call-exec'));
    assert(
      events.some(
        (event) =>
          event.type === 'toolStarted' &&
          event.toolId === 'call-exec' &&
          event.status === 'Running: npm run build',
      ),
    );

    processTranscriptLine(
      1,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call-exec',
          output: 'ok',
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      (event) => events.push(event),
    );

    await waitForToolDone();

    assert.equal(agents.get(1)?.activeToolIds.has('call-exec'), false);
    assert(events.some((event) => event.type === 'toolFinished' && event.toolId === 'call-exec'));

    processTranscriptLine(
      1,
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } }),
      agents,
      waitingTimers,
      permissionTimers,
      (event) => events.push(event),
    );

    assert.equal(agents.get(1)?.isWaiting, true);
    assert.equal(events.at(-1)?.type, 'statusChanged');
    assert.deepEqual(events.at(-1), { type: 'statusChanged', agentId: 1, status: 'waiting' });
  } finally {
    disposeCodexSubagentState();
    for (const timer of waitingTimers.values()) {
      clearTimeout(timer);
    }
    for (const timer of permissionTimers.values()) {
      clearTimeout(timer);
    }
  }
});

test('Codex parser formats spawn_agent as a delegation tool', () => {
  const agents = new Map([[1, createAgentState()]]);
  const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const events: BackendEvent[] = [];

  try {
    processTranscriptLine(
      1,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'call-spawn',
          name: 'spawn_agent',
          arguments: JSON.stringify({
            message: 'Implement the Codex backend provider and verify the parser mapping',
          }),
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      (event) => events.push(event),
    );

    const toolStart = events.find(
      (event) => event.type === 'toolStarted' && event.toolId === 'call-spawn',
    );

    assert.equal(toolStart?.type, 'toolStarted');
    assert.equal(toolStart?.agentId, 1);
    assert.equal(toolStart?.toolId, 'call-spawn');
    assert.equal(toolStart?.status, 'Subtask: Implement the Codex backend provider and…');
    assert.equal(permissionTimers.has(1), false);
  } finally {
    disposeCodexSubagentState();
    for (const timer of waitingTimers.values()) {
      clearTimeout(timer);
    }
    for (const timer of permissionTimers.values()) {
      clearTimeout(timer);
    }
  }
});

test('Codex parser surfaces completed apply_patch calls as transient tools', async () => {
  const agents = new Map([[1, createAgentState()]]);
  const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const events: BackendEvent[] = [];

  processTranscriptLine(
    1,
    JSON.stringify({
      timestamp: '2026-03-24T12:00:00.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        status: 'completed',
        call_id: 'call-patch',
        name: 'apply_patch',
        input: '*** Begin Patch',
      },
    }),
    agents,
    waitingTimers,
    permissionTimers,
    (event) => events.push(event),
  );

  await waitForToolDone();

  assert(events.some((event) => event.type === 'toolStarted' && event.toolId === 'call-patch'));
  assert(events.some((event) => event.type === 'toolFinished' && event.toolId === 'call-patch'));
  disposeCodexSubagentState();
});

test('Codex parser clears subagents when close_agent only includes the child id in the input', async () => {
  const agents = new Map([
    [
      1,
      {
        ...createAgentState(),
        backendSessionId: 'parent-session',
      },
    ],
  ]);
  const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const events: BackendEvent[] = [];
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-codex-close-agent-'));

  try {
    registerCodexSubagent(
      1,
      'parent-session',
      'parent-tool',
      'child-session',
      JSON.stringify({ agent_id: 'child-session' }),
      rootDir,
      (event) => events.push(event),
    );

    processTranscriptLine(
      1,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'call-close',
          name: 'close_agent',
          arguments: JSON.stringify({ agent_id: 'child-session' }),
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      (event) => events.push(event),
    );

    processTranscriptLine(
      1,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call-close',
          output: JSON.stringify({ previous_status: 'active' }),
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      (event) => events.push(event),
    );

    await waitForToolDone();

    assert(
      events.some(
        (event) =>
          event.type === 'subagentCleared' &&
          event.agentId === 1 &&
          event.parentToolId === 'parent-tool',
      ),
    );
  } finally {
    disposeCodexSubagentState();
    fs.rmSync(rootDir, { recursive: true, force: true });
    for (const timer of waitingTimers.values()) {
      clearTimeout(timer);
    }
    for (const timer of permissionTimers.values()) {
      clearTimeout(timer);
    }
  }
});
