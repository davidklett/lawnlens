import { describe, expect, it } from 'vitest';
import { solveHomography, applyHomography, isConvexQuad, pointInPolygon, simplify } from './geometry';
import { buildGrid, cellIndexAt } from './grid';
import { coverage, metrics, zoneRates } from './coverage';
import { appliedAt, timelineMinutes } from './playback';
import { forecast } from './forecast';
import { applyChanges, evaluate } from './changes';
import type { CatalogItem, Feature, Layout, WeatherDay } from './types';

const rotor: CatalogItem = {
  id: 'rotor', brand: 'T', model: 'R', name: 'Test rotor', type: 'rotor',
  radiusMin: 20, radiusMax: 40, arcMin: 40, arcMax: 360, precipInHr: 0.5, popUpIn: 4, priceUsd: 10, url: '',
};
const spray: CatalogItem = { ...rotor, id: 'spray', type: 'spray', radiusMin: 8, radiusMax: 15, arcMin: 0, arcMax: 360, precipInHr: 1.5 };
const catalog = [rotor, spray];

const square = (x0: number, y0: number, s: number) => [
  { x: x0, y: y0 }, { x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s },
];
const lawn: Feature = { id: 'l', kind: 'lawn', polygon: square(0, 0, 40), source: 'manual' };
const patio: Feature = { id: 'p', kind: 'hardscape', polygon: square(40, 0, 20), source: 'manual' };

const layoutWith = (heads: Layout['sprinklers']): Layout => ({
  sprinklers: heads,
  zones: [{ id: 'z1', name: 'Zone 1', valve: 1, runMinutes: 30 }],
  schedule: { daysPerWeek: 3 },
});
const head = (id: string, x: number, y: number, extra: Partial<Layout['sprinklers'][0]> = {}) => ({
  id, zoneId: 'z1', catalogId: 'rotor', x, y, radius: 30, arc: 360, rotation: 0, ...extra,
});

describe('geometry', () => {
  it('solves a homography that maps the 4 source points onto the targets', () => {
    const src = [{ x: 10, y: 10 }, { x: 200, y: 30 }, { x: 220, y: 180 }, { x: 0, y: 160 }];
    const dst = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }];
    const h = solveHomography(src, dst)!;
    src.forEach((p, i) => {
      const q = applyHomography(h, p);
      expect(q.x).toBeCloseTo(dst[i].x, 6);
      expect(q.y).toBeCloseTo(dst[i].y, 6);
    });
  });
  it('rejects degenerate and self-crossing quads', () => {
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }])).toBe(false);
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }])).toBe(false);
    expect(isConvexQuad(square(0, 0, 1))).toBe(true);
    expect(solveHomography([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], square(0, 0, 1))).toBeNull();
  });
  it('point in polygon and simplify', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square(0, 0, 10))).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square(0, 0, 10))).toBe(false);
    const line = Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplify(line, 0.1)).toHaveLength(2);
  });
});

describe('grid', () => {
  it('marks lawn and hardscape cells', () => {
    const g = buildGrid([lawn, patio]);
    expect(g.kind[cellIndexAt(g, 20, 20)]).toBe(1);
    expect(g.kind[cellIndexAt(g, 50, 10)]).toBe(2);
    expect(g.lawnCount).toBe(1600);
  });
});

describe('coverage', () => {
  it('is heavier near a rotor than at its edge and averages to the catalog precip rate', () => {
    const g = buildGrid([{ ...lawn, polygon: square(-40, -40, 80) }]);
    const h = head('a', 0, 0);
    const rate = coverage(g, [h], catalog);
    expect(rate[cellIndexAt(g, 1, 1)]).toBeGreaterThan(rate[cellIndexAt(g, 27, 0)]);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < rate.length; i++) if (rate[i] > 0) { sum += rate[i]; n++; }
    expect(sum / n).toBeCloseTo(0.5, 1);
  });
  it('only wets cells inside the arc', () => {
    const g = buildGrid([{ ...lawn, polygon: square(-40, -40, 80) }]);
    const rate = coverage(g, [head('a', 0, 0, { arc: 90, rotation: 45 })], catalog);
    expect(rate[cellIndexAt(g, 10, 10)]).toBeGreaterThan(0);
    expect(rate[cellIndexAt(g, -10, -10)]).toBe(0);
  });
  it('head-to-head rotors are more uniform than a single head', () => {
    const g = buildGrid([lawn]);
    const one = metrics(g, coverage(g, [head('a', 0, 0, { arc: 90, rotation: 45, radius: 40 })], catalog), layoutWith([]));
    const four = metrics(
      g,
      coverage(g, [
        head('a', 0, 0, { arc: 90, rotation: 45, radius: 40 }),
        head('b', 40, 0, { arc: 90, rotation: 135, radius: 40 }),
        head('c', 40, 40, { arc: 90, rotation: 225, radius: 40 }),
        head('d', 0, 40, { arc: 90, rotation: 315, radius: 40 }),
      ], catalog),
      layoutWith([]),
    );
    expect(four.du).toBeGreaterThan(one.du);
    expect(four.underCoveredPct).toBeLessThan(one.underCoveredPct);
  });
  it('counts water landing on the patio as overspray', () => {
    const g = buildGrid([lawn, patio]);
    const m = metrics(g, coverage(g, [head('a', 40, 20, { radius: 30 })], catalog), layoutWith([]), [head('a', 40, 20, { radius: 30 })], catalog);
    expect(m.oversprayPct).toBeGreaterThan(30);
  });
  it('splits rates by zone', () => {
    const g = buildGrid([lawn]);
    const z = zoneRates(g, layoutWith([head('a', 20, 20), { ...head('b', 0, 0), zoneId: 'z2' }]), catalog);
    expect(z.get('z1')).toBeDefined();
    expect(z.get('z2')).toBeDefined();
  });
});

describe('playback', () => {
  it('accumulates depth over the run and stops after it', () => {
    const g = buildGrid([lawn]);
    const layout = layoutWith([head('a', 20, 20)]);
    const i = cellIndexAt(g, 22, 20);
    const half = appliedAt(g, layout, catalog, 15)[i];
    const full = appliedAt(g, layout, catalog, 30)[i];
    const after = appliedAt(g, layout, catalog, 60)[i];
    expect(full).toBeCloseTo(half * 2, 5);
    expect(after).toBeCloseTo(full, 5);
    expect(timelineMinutes(layout)).toBe(30);
  });
});

describe('forecast', () => {
  const hot: WeatherDay[] = Array.from({ length: 7 }, (_, d) => ({ date: `d${d}`, et0In: 0.25, rainIn: 0, tMaxF: 95 }));
  it('dries out monotonically with no water', () => {
    const g = buildGrid([lawn]);
    const f = forecast(g, layoutWith([]), catalog, hot, []);
    for (let d = 1; d < f.dryPct.length; d++) expect(f.dryPct[d]).toBeGreaterThanOrEqual(f.dryPct[d - 1]);
    expect(f.dryPct[7]).toBe(100);
  });
  it('seeds dry areas from health observations', () => {
    const g = buildGrid([lawn]);
    const f = forecast(g, layoutWith([]), catalog, hot, [
      { id: 'h', polygon: square(0, 0, 10), status: 'dry', score: 0.1, timestamp: '', source: 'manual' },
    ]);
    expect(f.dryPct[0]).toBeGreaterThan(5);
  });
});

describe('changes', () => {
  it('ignores unknown heads and clamps to catalog ranges', () => {
    const layout = layoutWith([head('a', 0, 0)]);
    const next = applyChanges(layout, [
      { op: 'move_head', id: 'nope', x: 5, y: 5 },
      { op: 'set_head', id: 'a', radius: 999, arc: 10 },
    ], catalog);
    expect(next.sprinklers).toHaveLength(1);
    expect(next.sprinklers[0].radius).toBe(40);
    expect(next.sprinklers[0].arc).toBe(40);
    expect(layout.sprinklers[0].radius).toBe(30);
  });
  it('evaluate reports a dry-day metric when weather is given', () => {
    const m = evaluate({ features: [lawn], health: [] }, layoutWith([head('a', 20, 20)]), catalog, [
      { date: 'd', et0In: 0.2, rainIn: 0, tMaxF: 90 },
    ]);
    expect(m.dryCellsDay7).toBeDefined();
    expect(m.du).toBeGreaterThan(0);
  });
});
