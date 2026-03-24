import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { TOOL_DONE_DELAY_MS } from '../../constants.js';
import type { BackendEvent } from '../types.js';
import { disposeCodexSubagentState, registerCodexSubagent } from './subagentTracker.js';

function waitForToolDone(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, TOOL_DONE_DELAY_MS + 50);
  });
}

test('registerCodexSubagent replays child session activity into subagent events', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-codex-subagent-'));
  const childDir = path.join(rootDir, '2026', '03', '24');
  const childFile = path.join(childDir, 'child.jsonl');
  const events: BackendEvent[] = [];

  try {
    fs.mkdirSync(childDir, { recursive: true });
    fs.writeFileSync(
      childFile,
      [
        JSON.stringify({
          type: 'session_meta',
          payload: {
            id: 'child-session',
            cwd: '/workspace/project',
            source: {
              subagent: {
                thread_spawn: {
                  parent_thread_id: 'parent-session',
                },
              },
            },
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'function_call',
            call_id: 'child-call',
            name: 'exec_command',
            arguments: JSON.stringify({ cmd: 'npm run test' }),
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'child-call',
            output: 'ok',
          },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'task_complete',
          },
        }),
        '',
      ].join('\n'),
      'utf-8',
    );

    registerCodexSubagent(
      7,
      'parent-session',
      'parent-tool',
      'child-session',
      JSON.stringify({ agent_id: 'child-session', nickname: 'Newton' }),
      rootDir,
      (event) => events.push(event),
    );

    await waitForToolDone();

    assert(events.some((event) => event.type === 'subagentToolStarted'));
    assert(
      events.some(
        (event) =>
          event.type === 'subagentToolStarted' &&
          event.agentId === 7 &&
          event.parentToolId === 'parent-tool' &&
          event.toolId === 'child-call' &&
          event.status === 'Running: npm run test',
      ),
    );
    assert(
      events.some(
        (event) =>
          event.type === 'subagentToolFinished' &&
          event.agentId === 7 &&
          event.parentToolId === 'parent-tool' &&
          event.toolId === 'child-call',
      ),
    );
    assert(
      events.some(
        (event) =>
          event.type === 'subagentCleared' &&
          event.agentId === 7 &&
          event.parentToolId === 'parent-tool',
      ),
    );
  } finally {
    disposeCodexSubagentState();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
