import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AgentState } from '../../types.js';
import {
  canAdoptActiveTerminal,
  findExistingCodexAgentBySessionId,
  findPendingCodexAgentForSession,
  shouldAttachCodexTranscript,
} from './discovery.js';

function createAgentState(id: number, overrides: Partial<AgentState> = {}): AgentState {
  return {
    id,
    backendId: 'codex',
    terminalRef: { name: `Agent Office #${id.toString()}` } as never,
    projectDir: '/workspace/project',
    transcriptFile: '',
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
    ...overrides,
  };
}

test('findPendingCodexAgentForSession prefers the active terminal when multiple pending agents share a cwd', () => {
  const first = createAgentState(1, { pendingSession: true });
  const second = createAgentState(2, { pendingSession: true });

  const match = findPendingCodexAgentForSession(
    [first, second],
    '/workspace/project',
    second.terminalRef,
  );

  assert.equal(match?.id, 2);
});

test('findExistingCodexAgentBySessionId matches restored pending sessions and shouldAttachCodexTranscript rebinds them', () => {
  const restoredPending = createAgentState(7, {
    backendSessionId: 'session-123',
    pendingSession: true,
    transcriptFile: '',
  });

  const match = findExistingCodexAgentBySessionId([restoredPending], 'session-123');

  assert.equal(match?.id, 7);
  assert.equal(shouldAttachCodexTranscript(restoredPending, '/tmp/codex/session-123.jsonl'), true);
});

test('canAdoptActiveTerminal only adopts unowned Agent Office terminals', () => {
  const owned = createAgentState(9, {
    terminalRef: { name: 'Agent Office #9' } as never,
  });

  assert.equal(canAdoptActiveTerminal(undefined, []), false);
  assert.equal(canAdoptActiveTerminal({ name: 'bash' }, []), false);
  assert.equal(canAdoptActiveTerminal(owned.terminalRef, [owned]), false);
  assert.equal(canAdoptActiveTerminal({ name: 'Agent Office #12' }, [owned]), true);
});
