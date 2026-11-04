import { pointInPolygon } from './geometry';
import { CELL_LAWN, cellCenter, type Grid } from './grid';
import { appliedAt, timelineMinutes } from './playback';
import type { CatalogItem, HealthObservation, Layout, WeatherDay } from './types';

export const SOIL_CAPACITY_IN = 1.0; // plant-available water in the root zone
export const TURF_KC = 0.8; // cool-season turf crop coefficient
export const DRY_FRACTION = 0.3;
export const STRESSED_FRACTION = 0.5;

const START: Record<HealthObservation['status'], number> = { healthy: 0.8, stressed: 0.45, dry: 0.2 };
const DEFAULT_START = 0.75;

export interface ForecastResult {
  /** moisture fraction (0..1) per cell; index 0 = today before watering, index d = end of day d */
  days: Float32Array[];
  /** % of lawn cells below DRY_FRACTION, same indexing as days */
  dryPct: number[];
}

export function isWateringDay(day: number, daysPerWeek: number): boolean {
  const n = Math.max(0, Math.min(7, Math.round(daysPerWeek)));
  return Math.floor(((day % 7) + 1) * n / 7) > Math.floor(((day % 7) * n) / 7);
}

export function initialMoisture(g: Grid, health: HealthObservation[]): Float32Array {
  const m = new Float32Array(g.cols * g.rows);
  for (let i = 0; i < m.length; i++) {
    if (g.kind[i] !== CELL_LAWN) continue;
    m[i] = DEFAULT_START;
    if (!health.length) continue;
    const p = cellCenter(g, i);
    for (const h of health)
      if (pointInPolygon(p, h.polygon)) {
        m[i] = START[h.status];
        break;
      }
  }
  return m;
}

export function forecast(
  g: Grid,
  layout: Layout,
  catalog: CatalogItem[],
  weather: WeatherDay[],
  health: HealthObservation[],
): ForecastResult {
  const cycle = appliedAt(g, layout, catalog, timelineMinutes(layout));
  let m = initialMoisture(g, health);
  const days = [m.slice()];
  const dryPct = [dryPercent(g, m)];
  for (let d = 0; d < weather.length; d++) {
    const w = weather[d];
    const water = isWateringDay(d, layout.schedule.daysPerWeek);
    const next = new Float32Array(m.length);
    for (let i = 0; i < m.length; i++) {
      if (g.kind[i] !== CELL_LAWN) continue;
      const depth = m[i] * SOIL_CAPACITY_IN + (water ? cycle[i] : 0) + w.rainIn - w.et0In * TURF_KC;
      next[i] = Math.max(0, Math.min(1, depth / SOIL_CAPACITY_IN));
    }
    m = next;
    days.push(m.slice());
    dryPct.push(dryPercent(g, m));
  }
  return { days, dryPct };
}

function dryPercent(g: Grid, m: Float32Array): number {
  if (!g.lawnCount) return 0;
  let n = 0;
  for (let i = 0; i < m.length; i++) if (g.kind[i] === CELL_LAWN && m[i] < DRY_FRACTION) n++;
  return Math.round((1000 * n) / g.lawnCount) / 10;
}
