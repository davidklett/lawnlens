import { catalogById, coverage, metrics } from './coverage';
import { forecast } from './forecast';
import { buildGrid } from './grid';
import type { CatalogItem, Feature, HealthObservation, Layout, LayoutChange, Metrics, Sprinkler, WeatherDay } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function clampHead(h: Sprinkler, item: CatalogItem | undefined): Sprinkler {
  if (!item) return h;
  return {
    ...h,
    radius: clamp(h.radius, item.radiusMin, item.radiusMax),
    arc: clamp(h.arc, Math.max(1, item.arcMin), item.arcMax),
    rotation: ((h.rotation % 360) + 360) % 360,
  };
}

let addCounter = 0;

/** Pure: returns a new layout. Unknown ids / catalog items are ignored. */
export function applyChanges(layout: Layout, changes: LayoutChange[], catalog: CatalogItem[]): Layout {
  const byId = catalogById(catalog);
  let sprinklers = layout.sprinklers.map((s) => ({ ...s }));
  let zones = layout.zones.map((z) => ({ ...z }));
  let schedule = { ...layout.schedule };
  for (const ch of changes) {
    switch (ch.op) {
      case 'move_head':
        sprinklers = sprinklers.map((s) => (s.id === ch.id ? { ...s, x: ch.x, y: ch.y } : s));
        break;
      case 'set_head':
        sprinklers = sprinklers.map((s) => {
          if (s.id !== ch.id) return s;
          const catalogId = ch.catalogId && byId.has(ch.catalogId) ? ch.catalogId : s.catalogId;
          const zoneId = ch.zoneId && zones.some((z) => z.id === ch.zoneId) ? ch.zoneId : s.zoneId;
          return clampHead(
            { ...s, catalogId, zoneId, radius: ch.radius ?? s.radius, arc: ch.arc ?? s.arc, rotation: ch.rotation ?? s.rotation },
            byId.get(catalogId),
          );
        });
        break;
      case 'add_head': {
        const item = byId.get(ch.catalogId);
        if (!item || !zones.some((z) => z.id === ch.zoneId)) break;
        sprinklers.push(
          clampHead(
            { id: `h-new-${Date.now().toString(36)}-${addCounter++}`, zoneId: ch.zoneId, catalogId: ch.catalogId, x: ch.x, y: ch.y, radius: ch.radius, arc: ch.arc, rotation: ch.rotation },
            item,
          ),
        );
        break;
      }
      case 'remove_head':
        sprinklers = sprinklers.filter((s) => s.id !== ch.id);
        break;
      case 'set_zone_minutes':
        zones = zones.map((z) => (z.id === ch.id ? { ...z, runMinutes: clamp(ch.runMinutes, 0, 120) } : z));
        break;
      case 'set_days_per_week':
        schedule = { daysPerWeek: clamp(Math.round(ch.daysPerWeek), 0, 7) };
        break;
    }
  }
  return { sprinklers, zones, schedule };
}

export function evaluate(
  yard: { features: Feature[]; health: HealthObservation[] },
  layout: Layout,
  catalog: CatalogItem[],
  weather?: WeatherDay[],
): Metrics {
  const g = buildGrid(yard.features);
  const m = metrics(g, coverage(g, layout.sprinklers, catalog), layout, layout.sprinklers, catalog);
  if (weather && weather.length) {
    const f = forecast(g, layout, catalog, weather, yard.health);
    m.dryCellsDay7 = f.dryPct[f.dryPct.length - 1];
  }
  return m;
}

/** Simple score: higher is better. Used to keep only improving recommendations. */
export function score(m: Metrics): number {
  return m.du * 100 - m.underCoveredPct - 0.5 * m.oversprayPct - (m.dryCellsDay7 ?? 0);
}
