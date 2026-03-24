import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getActivityText } from '../src/office/activityText.ts';

test('getActivityText shows Working for agents with an active backend status and no tool records', () => {
  assert.equal(getActivityText(1, {}, 'active', null), 'Working');
});

test('getActivityText prefers the current tool label for agents with an active backend status', () => {
  assert.equal(getActivityText(1, {}, 'active', 'Read'), 'Read');
});

test('getActivityText shows waiting text when the agent is waiting', () => {
  assert.equal(getActivityText(1, {}, 'waiting', null), 'Waiting for input');
});

test('getActivityText shows Idle before any backend activity has started', () => {
  assert.equal(getActivityText(1, {}, undefined, null), 'Idle');
});
