import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BackendDescriptor } from '../../shared/protocol/backends.ts';
import { DEFAULT_SELECTED_BACKEND_ID, resolveSelectedBackendId } from '../src/backendOptions.ts';

const backends: BackendDescriptor[] = [
  {
    id: 'codex',
    displayName: 'Codex CLI',
    isImplemented: true,
    supportsBypassPermissions: true,
  },
  {
    id: 'claude',
    displayName: 'Claude Code',
    isImplemented: false,
    supportsBypassPermissions: false,
  },
];

test('DEFAULT_SELECTED_BACKEND_ID defaults to Codex', () => {
  assert.equal(DEFAULT_SELECTED_BACKEND_ID, 'codex');
});

test('resolveSelectedBackendId keeps the preferred backend when it is implemented', () => {
  assert.equal(resolveSelectedBackendId(backends, 'codex'), 'codex');
});

test('resolveSelectedBackendId falls back to the implemented default backend', () => {
  assert.equal(resolveSelectedBackendId(backends, 'claude', 'codex'), 'codex');
});

test('resolveSelectedBackendId falls back to the first implemented backend when needed', () => {
  const claudeFirst: BackendDescriptor[] = [
    {
      id: 'claude',
      displayName: 'Claude Code',
      isImplemented: false,
      supportsBypassPermissions: false,
    },
    {
      id: 'codex',
      displayName: 'Codex CLI',
      isImplemented: true,
      supportsBypassPermissions: true,
    },
  ];

  assert.equal(resolveSelectedBackendId(claudeFirst, 'claude', 'claude'), 'codex');
});
