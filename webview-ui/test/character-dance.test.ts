import assert from 'node:assert/strict';
import { test } from 'node:test';

import { updateCharacter } from '../src/office/engine/characters.ts';
import type { Seat, TileType } from '../src/office/types.ts';
import { CharacterState, Direction, TileType as TileKind } from '../src/office/types.ts';

function createTestCharacter(overrides: Partial<Parameters<typeof updateCharacter>[0]> = {}) {
  return {
    id: 1,
    state: CharacterState.TYPE,
    dir: Direction.DOWN,
    x: 24,
    y: 24,
    tileCol: 1,
    tileRow: 1,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette: 0,
    hueShift: 0,
    frame: 0,
    frameTimer: 0,
    danceTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: 3,
    isActive: false,
    seatId: 'seat-1',
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    ...overrides,
  };
}

const walkableTiles = [
  { col: 1, row: 1 },
  { col: 2, row: 1 },
  { col: 1, row: 2 },
];
const seats = new Map<string, Seat>([
  [
    'seat-1',
    {
      uid: 'seat-1',
      seatCol: 1,
      seatRow: 1,
      facingDir: Direction.UP,
      assigned: true,
    },
  ],
]);
const tileMap: TileType[][] = [
  [TileKind.FLOOR_1, TileKind.FLOOR_1, TileKind.FLOOR_1],
  [TileKind.FLOOR_1, TileKind.FLOOR_1, TileKind.FLOOR_1],
  [TileKind.FLOOR_1, TileKind.FLOOR_1, TileKind.FLOOR_1],
];
const blockedTiles = new Set<string>();

test('inactive typing agents settle into idle after their seat timer expires', () => {
  const ch = createTestCharacter();

  updateCharacter(ch, 0.016, walkableTiles, seats, tileMap, blockedTiles);

  assert.equal(ch.state, CharacterState.IDLE);
  assert.equal(ch.danceTimer, 0);
  assert.equal(ch.wanderCount, 0);
});

test('legacy dancing agents settle into idle immediately', () => {
  const ch = createTestCharacter({
    state: CharacterState.DANCE,
    dir: Direction.LEFT,
    danceTimer: 0,
    wanderTimer: 1,
    isActive: false,
  });

  updateCharacter(ch, 0.016, walkableTiles, seats, tileMap, blockedTiles);

  assert.equal(ch.state, CharacterState.IDLE);
  assert.equal(ch.danceTimer, 0);
  assert.equal(ch.wanderTimer, 1);
});

test('dancing agents snap back into work when reactivated', () => {
  const ch = createTestCharacter({
    state: CharacterState.DANCE,
    dir: Direction.LEFT,
    danceTimer: 0.5,
    wanderTimer: 10,
    isActive: true,
  });

  updateCharacter(ch, 0.016, walkableTiles, seats, tileMap, blockedTiles);

  assert.equal(ch.state, CharacterState.TYPE);
  assert.equal(ch.dir, Direction.UP);
  assert.equal(ch.danceTimer, 0);
});
