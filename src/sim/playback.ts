import { zoneRates } from './coverage';
import type { Grid } from './grid';
import type { CatalogItem, Layout } from './types';

export function timelineMinutes(layout: Layout): number {
  return layout.zones.reduce((s, z) => s + Math.max(0, z.runMinutes), 0);
}

/** Which zone is running at time t (minutes from start of the cycle), or null. */
export function activeZoneAt(layout: Layout, tMin: number): string | null {
  let start = 0;
  for (const z of layout.zones) {
    if (tMin >= start && tMin < start + z.runMinutes) return z.id;
    start += z.runMinutes;
  }
  return null;
}

/** Applied depth (inches) per cell after tMin minutes of one watering cycle; zones run in array order. */
export function appliedAt(
  g: Grid,
  layout: Layout,
  catalog: CatalogItem[],
  tMin: number,
  rates: Map<string, Float32Array> = zoneRates(g, layout, catalog),
): Float32Array {
  const out = new Float32Array(g.cols * g.rows);
  let start = 0;
  for (const z of layout.zones) {
    const m = Math.min(Math.max(tMin - start, 0), z.runMinutes);
    start += z.runMinutes;
    const arr = rates.get(z.id);
    if (!arr || m <= 0) continue;
    const f = m / 60;
    for (let i = 0; i < out.length; i++) out[i] += arr[i] * f;
  }
  return out;
}
