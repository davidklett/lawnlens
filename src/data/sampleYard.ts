import type { Polygon, Yard } from '../sim/types';

const octagon = (cx: number, cy: number, r: number): Polygon =>
  Array.from({ length: 8 }, (_, i) => ({ x: cx + r * Math.cos((i * Math.PI) / 4), y: cy + r * Math.sin((i * Math.PI) / 4) }));

/**
 * Hand-built synthetic yard for trying the editor and simulator without scanning.
 * Clearly labelled; replaced by the owner's real scan via public/sample-yard.json.
 */
export function syntheticDemoYard(): Yard {
  const now = new Date().toISOString();
  return {
    id: 'demo-synthetic',
    name: 'Demo yard (synthetic)',
    isSample: true,
    sampleNote: 'Synthetic demo data drawn by hand — not a scan. Health patches are hand-marked.',
    location: { lat: 33.749, lon: -84.388 },
    tiles: [],
    features: [
      { id: 'lawn-1', kind: 'lawn', source: 'manual', polygon: [{ x: 0, y: 6 }, { x: 24, y: 6 }, { x: 26, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 44 }, { x: 0, y: 44 }] },
      { id: 'bed-1', kind: 'bed', source: 'manual', polygon: [{ x: 0, y: 0 }, { x: 26, y: 0 }, { x: 24, y: 6 }, { x: 0, y: 6 }] },
      { id: 'patio-1', kind: 'hardscape', source: 'manual', polygon: [{ x: 18, y: 44 }, { x: 42, y: 44 }, { x: 42, y: 58 }, { x: 18, y: 58 }] },
      { id: 'tree-1', kind: 'tree', source: 'manual', polygon: octagon(47, 15, 5) },
      { id: 'shrub-1', kind: 'shrub', source: 'manual', polygon: octagon(4, 40, 2.5) },
      { id: 'shrub-2', kind: 'shrub', source: 'manual', polygon: octagon(10, 3, 2) },
    ],
    health: [
      { id: 'h-dry', status: 'dry', score: 0.2, source: 'manual', timestamp: now, polygon: [{ x: 48, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 20 }, { x: 50, y: 22 }] },
      { id: 'h-stressed', status: 'stressed', score: 0.45, source: 'manual', timestamp: now, polygon: [{ x: 50, y: 22 }, { x: 60, y: 20 }, { x: 60, y: 34 }, { x: 46, y: 32 }] },
    ],
    layout: {
      zones: [
        { id: 'z1', name: 'Back lawn', valve: 1, runMinutes: 25 },
        { id: 'z2', name: 'Patio edge', valve: 2, runMinutes: 10 },
      ],
      schedule: { daysPerWeek: 3 },
      sprinklers: [
        { id: 'h1', zoneId: 'z1', catalogId: 'hu-pgp', x: 0, y: 6, radius: 30, arc: 90, rotation: 45 },
        { id: 'h2', zoneId: 'z1', catalogId: 'hu-pgp', x: 28, y: 0, radius: 30, arc: 180, rotation: 90 },
        { id: 'h3', zoneId: 'z1', catalogId: 'hu-pgp', x: 0, y: 44, radius: 30, arc: 90, rotation: 315 },
        { id: 'h4', zoneId: 'z1', catalogId: 'hu-pgp', x: 30, y: 44, radius: 30, arc: 220, rotation: 270 },
        { id: 'h5', zoneId: 'z2', catalogId: 'rb-1804-15van', x: 45, y: 44, radius: 15, arc: 180, rotation: 270 },
      ],
    },
    createdAt: now,
  };
}
