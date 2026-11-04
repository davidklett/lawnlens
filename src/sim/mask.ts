import { polygonArea, simplify } from './geometry';
import type { Polygon } from './types';

// Clockwise 8-neighbourhood starting West (y grows downward).
const DX = [-1, -1, 0, 1, 1, 1, 0, -1];
const DY = [0, -1, -1, -1, 0, 1, 1, 1];
function dirOf(dx: number, dy: number): number {
  for (let i = 0; i < 8; i++) if (DX[i] === dx && DY[i] === dy) return i;
  return 0;
}

/**
 * Convert a row-major 0/1 raster into simplified outer polygons (one per connected component
 * with at least `minAreaFrac` of the largest component's area). Coordinates are in raster pixels.
 */
export function rasterToPolygons(raster: Uint8Array, width: number, height: number, tolerance = 1.5, minAreaFrac = 0.15): Polygon[] {
  const label = new Int32Array(width * height);
  const comps: { start: number; area: number }[] = [];
  const queue = new Int32Array(width * height);
  for (let i = 0; i < raster.length; i++) {
    if (!raster[i] || label[i]) continue;
    const id = comps.length + 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    label[i] = id;
    let area = 0;
    while (head < tail) {
      const p = queue[head++];
      area++;
      const x = p % width;
      const y = (p / width) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
      for (const q of nb)
        if (q >= 0 && raster[q] && !label[q]) {
          label[q] = id;
          queue[tail++] = q;
        }
    }
    comps.push({ start: i, area }); // i is first in scan order → top-left boundary pixel
  }
  if (!comps.length) return [];
  const maxArea = Math.max(...comps.map((c) => c.area));
  const out: Polygon[] = [];
  comps.forEach((c, k) => {
    if (c.area < maxArea * minAreaFrac || c.area < 4) return;
    const id = k + 1;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && label[y * width + x] === id;
    const sx = c.start % width;
    const sy = (c.start / width) | 0;
    const pts = [{ x: sx + 0.5, y: sy + 0.5 }];
    let px = sx;
    let py = sy;
    let back = 0; // came from West
    const limit = 4 * width * height + 8;
    for (let n = 0; n < limit; n++) {
      let found = -1;
      for (let k2 = 1; k2 <= 8; k2++) {
        const d = (back + k2) % 8;
        if (inside(px + DX[d], py + DY[d])) {
          found = d;
          break;
        }
      }
      if (found < 0) break; // isolated pixel
      const prev = (found + 7) % 8;
      const bx = px + DX[prev];
      const by = py + DY[prev];
      px += DX[found];
      py += DY[found];
      back = dirOf(bx - px, by - py);
      if (px === sx && py === sy) break;
      pts.push({ x: px + 0.5, y: py + 0.5 });
    }
    const simple = simplify(pts, tolerance);
    if (simple.length >= 3 && polygonArea(simple) > 0) out.push(simple);
  });
  return out;
}
