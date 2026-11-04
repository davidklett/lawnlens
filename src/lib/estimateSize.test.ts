import { describe, expect, it } from 'vitest';
import { estimateSize, roundFt } from './estimateSize';

/** Pinhole camera at (0, 0, height) ft, looking along +y, pitched down by `pitchDeg`. Image y grows downward. */
function project(p: [number, number], { f, w, h, height, pitchDeg }: { f: number; w: number; h: number; height: number; pitchDeg: number }) {
  const t = (pitchDeg * Math.PI) / 180;
  const v = [p[0], p[1], -height];
  const zc = [0, Math.cos(t), -Math.sin(t)];
  const yc = [0, -Math.sin(t), -Math.cos(t)];
  const d = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = d(v, zc);
  return { x: (f * v[0]) / z + w / 2, y: (f * d(v, yc)) / z + h / 2 };
}

// 20 ft wide × 12 ft deep rectangle, 15–27 ft in front of the camera, offset to the right.
const RECT: [number, number][] = [
  [-8, 27], // back-left
  [12, 27], // back-right
  [12, 15], // front-right
  [-8, 15], // front-left
];

describe('estimateSize', () => {
  it('uses a typical phone focal length when the rectangle is square-on to the camera', () => {
    // Back edge parallel to the image: its vanishing point is at infinity, so the focal can't be recovered.
    const cam = { f: 1152, w: 1600, h: 1200, height: 5, pitchDeg: 18 };
    const e = estimateSize(RECT.map((p) => project(p, cam)), cam.w, cam.h, 5)!;
    expect(e.focalFromImage).toBe(false);
    expect(e.widthFt).toBeCloseTo(20, 0);
    expect(e.depthFt).toBeCloseTo(12, 0);
  });

  it('recovers the focal length from an angled rectangle', () => {
    const cam = { f: 1400, w: 1600, h: 1200, height: 5, pitchDeg: 18 };
    const a = (25 * Math.PI) / 180;
    const rot = RECT.map(([x, y]): [number, number] => [2 + (x - 2) * Math.cos(a) - (y - 21) * Math.sin(a), 21 + (x - 2) * Math.sin(a) + (y - 21) * Math.cos(a)]);
    const e = estimateSize(rot.map((p) => project(p, cam)), cam.w, cam.h, 5)!;
    expect(e.focalFromImage).toBe(true);
    expect(e.widthFt).toBeCloseTo(20, 0);
    expect(e.depthFt).toBeCloseTo(12, 0);
  });

  it('scales with the assumed camera height', () => {
    const cam = { f: 1150, w: 1600, h: 1200, height: 9, pitchDeg: 30 };
    const corners = RECT.map((p) => project(p, cam));
    const right = estimateSize(corners, cam.w, cam.h, 9)!;
    const low = estimateSize(corners, cam.w, cam.h, 4.5)!;
    expect(right.widthFt).toBeCloseTo(20, 0);
    expect(low.widthFt / right.widthFt).toBeCloseTo(0.5, 2);
  });

  it('rejects degenerate corners', () => {
    const line = [0, 1, 2, 3].map((i) => ({ x: i * 100, y: 500 }));
    expect(estimateSize(line, 1600, 1200, 5)).toBeNull();
  });

  it('rounds to tape-measure values', () => {
    expect(roundFt(7.3)).toBe(7.5);
    expect(roundFt(23.6)).toBe(24);
  });
});
