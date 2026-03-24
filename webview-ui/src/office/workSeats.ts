import { AUTO_ON_FACING_DEPTH, AUTO_ON_SIDE_DEPTH } from '../constants.js';
import { getCatalogEntry } from './layout/furnitureCatalog.js';
import type { PlacedFurniture, Seat } from './types.js';
import { Direction } from './types.js';

function getDeskFootprint(type: string): { w: number; h: number } | null {
  if (type === 'DESK_FRONT') {
    return { w: 3, h: 2 };
  }
  if (type === 'DESK_SIDE' || type === 'DESK_SIDE:left') {
    return { w: 1, h: 4 };
  }

  const entry = getCatalogEntry(type);
  if (entry?.type.startsWith('DESK_')) {
    return { w: entry.footprintW, h: entry.footprintH };
  }

  return null;
}

function getComputerFootprint(type: string): { w: number; h: number } | null {
  if (type.startsWith('PC_')) {
    return { w: 1, h: 2 };
  }

  const entry = getCatalogEntry(type);
  if (entry?.type.startsWith('PC_')) {
    return { w: entry.footprintW, h: entry.footprintH };
  }

  return null;
}

function buildTiles(
  furniture: PlacedFurniture[],
  getFootprint: (type: string) => { w: number; h: number } | null,
): Set<string> {
  const tiles = new Set<string>();
  for (const item of furniture) {
    const footprint = getFootprint(item.type);
    if (!footprint) continue;
    for (let dr = 0; dr < footprint.h; dr++) {
      for (let dc = 0; dc < footprint.w; dc++) {
        tiles.add(`${item.col + dc},${item.row + dr}`);
      }
    }
  }
  return tiles;
}

function facesAnyTarget(seat: Seat, targetTiles: Set<string>): boolean {
  const dCol = seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0;
  const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0;

  for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
    const baseCol = seat.seatCol + dCol * d;
    const baseRow = seat.seatRow + dRow * d;
    if (targetTiles.has(`${baseCol},${baseRow}`)) {
      return true;
    }

    if (dCol !== 0) {
      if (targetTiles.has(`${baseCol},${baseRow - 1}`)) return true;
      if (targetTiles.has(`${baseCol},${baseRow + 1}`)) return true;
    } else {
      if (targetTiles.has(`${baseCol - 1},${baseRow}`)) return true;
      if (targetTiles.has(`${baseCol + 1},${baseRow}`)) return true;
    }
  }

  for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
    const baseCol = seat.seatCol + dCol * d;
    const baseRow = seat.seatRow + dRow * d;
    if (dCol !== 0) {
      if (targetTiles.has(`${baseCol},${baseRow - 1}`)) return true;
      if (targetTiles.has(`${baseCol},${baseRow + 1}`)) return true;
    } else {
      if (targetTiles.has(`${baseCol - 1},${baseRow}`)) return true;
      if (targetTiles.has(`${baseCol + 1},${baseRow}`)) return true;
    }
  }

  return false;
}

export function isWorkSeat(seat: Seat, furniture: PlacedFurniture[]): boolean {
  const computerTiles = buildTiles(furniture, getComputerFootprint);
  if (computerTiles.size > 0) {
    return facesAnyTarget(seat, computerTiles);
  }

  const deskTiles = buildTiles(furniture, getDeskFootprint);
  return facesAnyTarget(seat, deskTiles);
}

export function findClosestAvailableWorkSeat(
  seats: Map<string, Seat>,
  furniture: PlacedFurniture[],
  originCol: number,
  originRow: number,
  currentSeatId?: string | null,
): string | null {
  let bestSeatId: string | null = null;
  let bestDistance = Infinity;

  for (const [seatId, seat] of seats) {
    if (seat.assigned && seatId !== currentSeatId) {
      continue;
    }
    if (!isWorkSeat(seat, furniture)) {
      continue;
    }

    const distance = Math.abs(seat.seatCol - originCol) + Math.abs(seat.seatRow - originRow);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSeatId = seatId;
    }
  }

  return bestSeatId;
}
