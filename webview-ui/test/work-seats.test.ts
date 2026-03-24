import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PlacedFurniture, Seat } from '../src/office/types.ts';
import { Direction } from '../src/office/types.ts';
import { findClosestAvailableWorkSeat, isWorkSeat } from '../src/office/workSeats.ts';

test('work-seat selection prefers a desk-facing seat over a lounge seat', () => {
  const furniture: PlacedFurniture[] = [
    { uid: 'desk-1', type: 'DESK_FRONT', col: 2, row: 2 },
    { uid: 'pc-1', type: 'PC_FRONT_OFF', col: 3, row: 2 },
    { uid: 'coffee-1', type: 'COFFEE_TABLE', col: 6, row: 6 },
  ];
  const seats = new Map<string, Seat>([
    [
      'desk-chair-1',
      { uid: 'desk-chair-1', seatCol: 3, seatRow: 4, facingDir: Direction.UP, assigned: false },
    ],
    [
      'sofa-1',
      { uid: 'sofa-1', seatCol: 5, seatRow: 6, facingDir: Direction.RIGHT, assigned: false },
    ],
  ]);

  const workSeatIds = [...seats.entries()]
    .filter(([, seat]) => isWorkSeat(seat, furniture))
    .map(([seatId]) => seatId);
  const loungeSeatId = [...seats.entries()].find(([, seat]) => !isWorkSeat(seat, furniture))?.[0];

  assert(workSeatIds.length > 0);
  assert.ok(loungeSeatId);

  const chosenSeatId = findClosestAvailableWorkSeat(seats, furniture, 6, 6, loungeSeatId);

  assert(chosenSeatId);
  assert.notEqual(chosenSeatId, loungeSeatId);
  assert(workSeatIds.includes(chosenSeatId));
});

test('tables without computers do not count as workstation seats when a computer desk exists', () => {
  const furniture: PlacedFurniture[] = [
    { uid: 'pc-desk', type: 'DESK_FRONT', col: 2, row: 2 },
    { uid: 'pc-1', type: 'PC_FRONT_OFF', col: 3, row: 2 },
    { uid: 'coffee-1', type: 'COFFEE_TABLE', col: 10, row: 10 },
  ];

  const deskSeat: Seat = {
    uid: 'desk-seat',
    seatCol: 3,
    seatRow: 4,
    facingDir: Direction.UP,
    assigned: false,
  };
  const loungeSeat: Seat = {
    uid: 'lounge-seat',
    seatCol: 9,
    seatRow: 10,
    facingDir: Direction.RIGHT,
    assigned: false,
  };

  assert.equal(isWorkSeat(deskSeat, furniture), true);
  assert.equal(isWorkSeat(loungeSeat, furniture), false);
});
