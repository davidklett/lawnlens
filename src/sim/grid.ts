import { boundsOf, pointInPolygon } from './geometry';
import type { Feature } from './types';

/** Cell kinds: 0 other, 1 lawn, 2 hardscape, 3 bed. */
export const CELL_OTHER = 0;
export const CELL_LAWN = 1;
export const CELL_HARDSCAPE = 2;
export const CELL_BED = 3;

export interface Grid {
  originX: number;
  originY: number;
  cols: number;
  rows: number;
  cell: number; // ft
  kind: Uint8Array;
  lawnCount: number;
}

const PAD_FT = 5;

export function buildGrid(features: Feature[], cell = 1): Grid {
  const b = boundsOf(features.map((f) => f.polygon));
  const originX = Math.floor(b.minX - PAD_FT);
  const originY = Math.floor(b.minY - PAD_FT);
  const cols = Math.max(1, Math.ceil((b.maxX + PAD_FT - originX) / cell));
  const rows = Math.max(1, Math.ceil((b.maxY + PAD_FT - originY) / cell));
  const kind = new Uint8Array(cols * rows);
  // Paint order: lawn first, then beds, then hardscape on top. Trees/shrubs over lawn stay lawn.
  const order: [Feature['kind'], number][] = [['lawn', CELL_LAWN], ['bed', CELL_BED], ['hardscape', CELL_HARDSCAPE]];
  for (const [k, value] of order) {
    for (const f of features) {
      if (f.kind !== k || f.polygon.length < 3) continue;
      const fb = boundsOf([f.polygon]);
      const c0 = Math.max(0, Math.floor((fb.minX - originX) / cell));
      const c1 = Math.min(cols - 1, Math.floor((fb.maxX - originX) / cell));
      const r0 = Math.max(0, Math.floor((fb.minY - originY) / cell));
      const r1 = Math.min(rows - 1, Math.floor((fb.maxY - originY) / cell));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const p = { x: originX + (c + 0.5) * cell, y: originY + (r + 0.5) * cell };
          if (pointInPolygon(p, f.polygon)) kind[r * cols + c] = value;
        }
    }
  }
  let lawnCount = 0;
  for (let i = 0; i < kind.length; i++) if (kind[i] === CELL_LAWN) lawnCount++;
  return { originX, originY, cols, rows, cell, kind, lawnCount };
}

export function cellIndexAt(g: Grid, x: number, y: number): number {
  const c = Math.floor((x - g.originX) / g.cell);
  const r = Math.floor((y - g.originY) / g.cell);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return -1;
  return r * g.cols + c;
}

export function cellCenter(g: Grid, i: number): { x: number; y: number } {
  const c = i % g.cols;
  const r = Math.floor(i / g.cols);
  return { x: g.originX + (c + 0.5) * g.cell, y: g.originY + (r + 0.5) * g.cell };
}
