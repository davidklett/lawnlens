import { describe, expect, it } from 'vitest';
import { rasterToPolygons } from './mask';
import { polygonArea, pointInPolygon } from './geometry';

function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number, r = new Uint8Array(w * h)) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) r[y * w + x] = 1;
  return r;
}

describe('rasterToPolygons', () => {
  it('traces a filled rectangle into a polygon of about the same area', () => {
    const polys = rasterToPolygons(rect(50, 40, 10, 5, 40, 35), 50, 40);
    expect(polys).toHaveLength(1);
    expect(polygonArea(polys[0])).toBeGreaterThan(29 * 29 * 0.9);
    expect(pointInPolygon({ x: 25, y: 20 }, polys[0])).toBe(true);
    expect(polys[0].length).toBeLessThan(12);
  });
  it('returns separate polygons for separate blobs and drops specks', () => {
    const r = rect(60, 30, 2, 2, 20, 20);
    rect(60, 30, 30, 2, 50, 25, r);
    r[29 * 60 + 59] = 1; // speck
    expect(rasterToPolygons(r, 60, 30)).toHaveLength(2);
  });
  it('handles an empty raster', () => {
    expect(rasterToPolygons(new Uint8Array(100), 10, 10)).toEqual([]);
  });
});
