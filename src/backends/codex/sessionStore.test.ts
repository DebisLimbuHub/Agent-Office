import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  isTopLevelCodexSession,
  listCodexSessionFiles,
  readCodexSessionMeta,
} from './sessionStore.js';

test('listCodexSessionFiles finds nested session files in sorted order', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-codex-sessions-'));

  try {
    const nestedDir = path.join(rootDir, '2026', '03', '24');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'ignore.txt'), 'skip me', 'utf-8');
    fs.writeFileSync(path.join(nestedDir, 'b.jsonl'), '', 'utf-8');
    fs.writeFileSync(path.join(nestedDir, 'a.jsonl'), '', 'utf-8');

    assert.deepEqual(listCodexSessionFiles(rootDir), [
      path.join(nestedDir, 'a.jsonl'),
      path.join(nestedDir, 'b.jsonl'),
    ]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('readCodexSessionMeta returns the top-level session metadata shape', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-codex-meta-'));
  const filePath = path.join(rootDir, 'session.jsonl');

  try {
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'session-123',
          cwd: '/workspace/project',
          source: 'cli',
          agent_nickname: null,
          agent_role: null,
        },
      })}\n${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })}\n`,
      'utf-8',
    );

    const meta = readCodexSessionMeta(filePath);
    assert.deepEqual(meta, {
      id: 'session-123',
      cwd: '/workspace/project',
      source: 'cli',
      agentNickname: undefined,
      agentRole: undefined,
    });
    assert.equal(meta ? isTopLevelCodexSession(meta) : false, true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('readCodexSessionMeta handles very large session_meta lines', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-codex-long-meta-'));
  const filePath = path.join(rootDir, 'session.jsonl');

  try {
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'session-789',
          cwd: '/workspace/project',
          source: 'cli',
          base_instructions: {
            text: 'x'.repeat(80_000),
          },
        },
      })}\n`,
      'utf-8',
    );

    assert.deepEqual(readCodexSessionMeta(filePath), {
      id: 'session-789',
      cwd: '/workspace/project',
      source: 'cli',
      agentNickname: undefined,
      agentRole: undefined,
    });
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('isTopLevelCodexSession rejects nested subagent sessions', () => {
  assert.equal(
    isTopLevelCodexSession({
      id: 'session-456',
      cwd: '/workspace/project',
      source: {
        subagent: {
          thread_spawn: {
            parent_thread_id: 'parent',
          },
        },
      },
    }),
    false,
  );
});
