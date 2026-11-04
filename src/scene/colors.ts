import { CELL_LAWN, type Grid } from '../sim/grid';

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function ramp(stops: [number, string][], v: number): RGB {
  const s = stops.map(([t, c]) => [t, hex(c)] as [number, RGB]);
  if (v <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (v <= s[i][0]) {
      const [t0, c0] = s[i - 1];
      const [t1, c1] = s[i];
      const f = (v - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return s[s.length - 1][1];
}

// Coverage relative to lawn mean: brown gap → yellow thin → green on target → teal heavy.
export const COVERAGE_STOPS: [number, string][] = [
  [0, '#9b6b35'],
  [0.3, '#c9a443'],
  [0.65, '#9cc94f'],
  [1, '#4caf50'],
  [1.6, '#2a9d8f'],
  [2.4, '#1d5f8a'],
];
// Soil moisture fraction: dry → stressed → healthy.
export const MOISTURE_STOPS: [number, string][] = [
  [0, '#8a6237'],
  [0.3, '#c8a64a'],
  [0.5, '#9fca55'],
  [0.8, '#43a047'],
  [1, '#2e7d32'],
];
// Applied water during playback (inches).
export const APPLIED_STOPS: [number, string][] = [
  [0, '#86c86a'],
  [0.15, '#4f9f5a'],
  [0.35, '#2f7f74'],
  [0.6, '#22607f'],
];

export type ColorMode = { kind: 'coverage'; values: Float32Array; mean: number } | { kind: 'moisture'; values: Float32Array } | { kind: 'applied'; values: Float32Array };

/** RGBA pixels, one per grid cell, row 0 = smallest y. */
export function cellColors(g: Grid, mode: ColorMode): Uint8Array {
  const out = new Uint8Array(g.cols * g.rows * 4);
  const denom = mode.kind === 'coverage' ? Math.max(mode.mean, 0.05) : 1;
  for (let i = 0; i < g.cols * g.rows; i++) {
    let c: RGB;
    if (g.kind[i] !== CELL_LAWN) c = [110, 140, 90];
    else if (mode.kind === 'coverage') c = ramp(COVERAGE_STOPS, mode.values[i] / denom);
    else if (mode.kind === 'moisture') c = ramp(MOISTURE_STOPS, mode.values[i]);
    else c = ramp(APPLIED_STOPS, mode.values[i]);
    // Low-res "pixel grass" jitter for a playful look.
    const j = ((i * 2654435761) >>> 0) % 13 - 6;
    out[i * 4] = Math.max(0, Math.min(255, c[0] + j));
    out[i * 4 + 1] = Math.max(0, Math.min(255, c[1] + j));
    out[i * 4 + 2] = Math.max(0, Math.min(255, c[2] + j));
    out[i * 4 + 3] = 255;
  }
  return out;
}

export const ZONE_COLORS = ['#ff7043', '#42a5f5', '#ab47bc', '#ffca28', '#26c6da', '#ec407a', '#9ccc65', '#8d6e63'];
