import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BackendDescriptor } from '../../shared/protocol/backends.ts';
import { resolveSelectedBackendId } from '../src/backendOptions.ts';

const backends: BackendDescriptor[] = [
  {
    id: 'claude',
    displayName: 'Claude Code',
    isImplemented: true,
    supportsBypassPermissions: true,
  },
  {
    id: 'codex',
    displayName: 'Codex CLI',
    isImplemented: false,
    supportsBypassPermissions: false,
  },
];

test('resolveSelectedBackendId keeps the preferred backend when it is implemented', () => {
  assert.equal(resolveSelectedBackendId(backends, 'claude'), 'claude');
});

test('resolveSelectedBackendId falls back to an implemented default backend', () => {
  assert.equal(resolveSelectedBackendId(backends, 'codex', 'claude'), 'claude');
});

test('resolveSelectedBackendId falls back to the first implemented backend when needed', () => {
  const codexFirst: BackendDescriptor[] = [
    {
      id: 'codex',
      displayName: 'Codex CLI',
      isImplemented: false,
      supportsBypassPermissions: false,
    },
    {
      id: 'claude',
      displayName: 'Claude Code',
      isImplemented: true,
      supportsBypassPermissions: true,
    },
  ];

  assert.equal(resolveSelectedBackendId(codexFirst, 'codex', 'codex'), 'claude');
});
