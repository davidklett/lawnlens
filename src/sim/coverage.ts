import { CELL_LAWN, type Grid } from './grid';
import type { CatalogItem, HeadType, Layout, Metrics, Sprinkler } from './types';

/** Radial distribution profile, u = distance / radius in [0, 1]. */
function profile(type: HeadType, u: number): number {
  if (type === 'spray') return u < 0.8 ? 1 : 1 - ((u - 0.8) / 0.2) * 0.7;
  // Rotors, rotators and impacts: roughly triangular, designed for head-to-head spacing.
  return 1.4 - 1.1 * u;
}

// Normalize so the area-weighted mean of the profile over a disk equals 1.
const NORM = new Map<HeadType, number>();
for (const t of ['spray', 'rotor', 'rotator', 'impact'] as HeadType[]) {
  let s = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N;
    s += profile(t, u) * 2 * u * (1 / N);
  }
  NORM.set(t, s);
}

export function catalogById(catalog: CatalogItem[]): Map<string, CatalogItem> {
  return new Map(catalog.map((c) => [c.id, c]));
}

function angleDiff(a: number, b: number): number {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  return Math.abs(d);
}

/** Adds one head's precipitation (in/hr) into `out`. */
export function addHead(g: Grid, h: Sprinkler, item: CatalogItem, out: Float32Array, scale = 1): void {
  const R = h.radius;
  if (R <= 0) return;
  const norm = NORM.get(item.type) ?? 1;
  const full = h.arc >= 359.5;
  const half = h.arc / 2;
  const c0 = Math.max(0, Math.floor((h.x - R - g.originX) / g.cell));
  const c1 = Math.min(g.cols - 1, Math.floor((h.x + R - g.originX) / g.cell));
  const r0 = Math.max(0, Math.floor((h.y - R - g.originY) / g.cell));
  const r1 = Math.min(g.rows - 1, Math.floor((h.y + R - g.originY) / g.cell));
  for (let r = r0; r <= r1; r++) {
    const cy = g.originY + (r + 0.5) * g.cell - h.y;
    for (let c = c0; c <= c1; c++) {
      const cx = g.originX + (c + 0.5) * g.cell - h.x;
      const d = Math.hypot(cx, cy);
      if (d > R) continue;
      if (!full && d > 0.01) {
        const ang = (Math.atan2(cy, cx) * 180) / Math.PI;
        if (angleDiff(ang, h.rotation) > half) continue;
      }
      out[r * g.cols + c] += (scale * item.precipInHr * profile(item.type, d / R)) / norm;
    }
  }
}

export function coverage(g: Grid, sprinklers: Sprinkler[], catalog: CatalogItem[]): Float32Array {
  const byId = catalogById(catalog);
  const out = new Float32Array(g.cols * g.rows);
  for (const h of sprinklers) {
    const item = byId.get(h.catalogId);
    if (item) addHead(g, h, item, out);
  }
  return out;
}

export function zoneRates(g: Grid, layout: Layout, catalog: CatalogItem[]): Map<string, Float32Array> {
  const byId = catalogById(catalog);
  const m = new Map<string, Float32Array>();
  for (const h of layout.sprinklers) {
    const item = byId.get(h.catalogId);
    if (!item) continue;
    let arr = m.get(h.zoneId);
    if (!arr) m.set(h.zoneId, (arr = new Float32Array(g.cols * g.rows)));
    addHead(g, h, item, arr);
  }
  return m;
}

/** Total water output of a head, in in/hr * ft^2. */
function headOutput(h: Sprinkler, item: CatalogItem): number {
  return item.precipInHr * Math.PI * h.radius * h.radius * (Math.min(360, h.arc) / 360);
}

export function metrics(
  g: Grid,
  rate: Float32Array,
  layout: Layout,
  sprinklers: Sprinkler[] = layout.sprinklers,
  catalog: CatalogItem[] = [],
): Metrics {
  const lawnRates: number[] = [];
  let lawnVolume = 0;
  for (let i = 0; i < rate.length; i++)
    if (g.kind[i] === CELL_LAWN) {
      lawnRates.push(rate[i]);
      lawnVolume += rate[i] * g.cell * g.cell;
    }
  const n = lawnRates.length;
  const mean = n ? lawnRates.reduce((a, b) => a + b, 0) / n : 0;
  let du = 0;
  let under = 100;
  if (n && mean > 0) {
    const sorted = lawnRates.slice().sort((a, b) => a - b);
    const q = Math.max(1, Math.floor(n / 4));
    const lq = sorted.slice(0, q).reduce((a, b) => a + b, 0) / q;
    du = lq / mean;
    under = (100 * lawnRates.filter((r) => r < 0.5 * mean).length) / n;
  }
  // Overspray: share of all head output that does not land on lawn (includes water past the grid).
  const byId = catalogById(catalog);
  let total = 0;
  for (const h of sprinklers) {
    const item = byId.get(h.catalogId);
    if (item) total += headOutput(h, item);
  }
  if (total === 0) {
    for (let i = 0; i < rate.length; i++) total += rate[i] * g.cell * g.cell;
  }
  const overspray = total > 0 ? Math.max(0, 100 * (1 - lawnVolume / total)) : 0;
  // Weekly applied depth: per-zone run minutes.
  let weekly = 0;
  if (n && layout.zones.length) {
    const zr = zoneRatesFromSprinklers(g, sprinklers, byId);
    let depthSum = 0;
    for (const z of layout.zones) {
      const arr = zr.get(z.id);
      if (!arr) continue;
      let s = 0;
      for (let i = 0; i < arr.length; i++) if (g.kind[i] === CELL_LAWN) s += arr[i];
      depthSum += (s / n) * (z.runMinutes / 60);
    }
    weekly = depthSum * layout.schedule.daysPerWeek;
  }
  return {
    du: round(du, 3),
    meanRateInHr: round(mean, 3),
    underCoveredPct: round(under, 1),
    oversprayPct: round(overspray, 1),
    weeklyInches: round(weekly, 2),
  };
}

function zoneRatesFromSprinklers(g: Grid, sprinklers: Sprinkler[], byId: Map<string, CatalogItem>) {
  const m = new Map<string, Float32Array>();
  for (const h of sprinklers) {
    const item = byId.get(h.catalogId);
    if (!item) continue;
    let arr = m.get(h.zoneId);
    if (!arr) m.set(h.zoneId, (arr = new Float32Array(g.cols * g.rows)));
    addHead(g, h, item, arr);
  }
  return m;
}

export function round(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
