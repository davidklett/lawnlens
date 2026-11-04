import { applyChanges, evaluate, score } from '../src/sim/changes';
import { coverage } from '../src/sim/coverage';
import { boundsOf } from '../src/sim/geometry';
import { buildGrid, CELL_LAWN, cellCenter } from '../src/sim/grid';
import type { CatalogItem, Feature, HealthObservation, Layout, LayoutChange, Metrics, Recommendation, WeatherDay } from '../src/sim/types';
import type { MetaResponse } from './_meta';

export const MAX_ROUNDS = 6;
export const MIN_SCORE_GAIN = 0.5;

export interface AdviseInput {
  features: Feature[];
  health: HealthObservation[];
  layout: Layout;
  weather: WeatherDay[];
}

const changeSchema = {
  type: 'object',
  description:
    'One layout edit. op=move_head(id,x,y) | set_head(id, radius?, arc?, rotation?, catalogId?, zoneId?) | add_head(catalogId,x,y,radius,arc,rotation,zoneId) | remove_head(id) | set_zone_minutes(id=zone id, runMinutes) | set_days_per_week(daysPerWeek). Coordinates in feet; rotation in degrees = direction of the arc centre (0 = +x, 90 = +y, y grows downward on the plan), arc in degrees.',
  properties: {
    op: { type: 'string', enum: ['move_head', 'set_head', 'add_head', 'remove_head', 'set_zone_minutes', 'set_days_per_week'] },
    id: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    radius: { type: 'number' },
    arc: { type: 'number' },
    rotation: { type: 'number' },
    catalogId: { type: 'string' },
    zoneId: { type: 'string' },
    runMinutes: { type: 'number' },
    daysPerWeek: { type: 'number' },
  },
  required: ['op'],
};

export const TOOLS = [
  { type: 'function', name: 'get_weather', description: '7-day forecast for the yard: daily reference ET (in), rain (in), max temp (F).', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'get_catalog', description: 'Sprinkler products available (Home Depot), with radius/arc ranges and precipitation rates.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  {
    type: 'function',
    name: 'simulate',
    description: 'Run the LawnLens watering simulation with the given changes applied to the CURRENT layout. Returns metrics (du: distribution uniformity 0-1 higher better; underCoveredPct, oversprayPct, dryCellsDay7: lower better; weeklyInches applied) and remaining under-covered spots.',
    parameters: { type: 'object', properties: { changes: { type: 'array', items: changeSchema } }, required: ['changes'] },
  },
  {
    type: 'function',
    name: 'submit_recommendations',
    description: 'Finish: submit 1-3 recommendations you verified with simulate. Each is a self-contained set of changes against the CURRENT layout.',
    parameters: {
      type: 'object',
      properties: {
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short imperative, e.g. "Move head h3 4 ft north-east"' },
              reason: { type: 'string', description: 'One or two sentences a homeowner understands, citing the simulated improvement and weather.' },
              changes: { type: 'array', items: changeSchema },
            },
            required: ['title', 'reason', 'changes'],
          },
        },
      },
      required: ['recommendations'],
    },
  },
];

export const INSTRUCTIONS =
  'You are LawnLens, an irrigation designer. Improve the homeowner\'s sprinkler layout and schedule using ONLY products from get_catalog. ' +
  'Always test ideas with simulate before recommending them, iterate if a change does not help, and keep recommendations practical (moving a head a few feet, changing a nozzle/arc/radius, adjusting run time, adding a head only if needed). ' +
  'Use head ids and zone ids exactly as given. Call submit_recommendations once with your best verified options; do not answer in plain text.';

/** Under-covered lawn spots, clustered into 5 ft blocks, worst first. */
export function problemSpots(features: Feature[], layout: Layout, catalog: CatalogItem[], limit = 8) {
  const g = buildGrid(features);
  const rate = coverage(g, layout.sprinklers, catalog);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < rate.length; i++) if (g.kind[i] === CELL_LAWN) { sum += rate[i]; n++; }
  const mean = n ? sum / n : 0;
  const blocks = new Map<string, { x: number; y: number; count: number }>();
  for (let i = 0; i < rate.length; i++) {
    if (g.kind[i] !== CELL_LAWN || rate[i] >= 0.5 * mean) continue;
    const p = cellCenter(g, i);
    const key = `${Math.floor(p.x / 5)},${Math.floor(p.y / 5)}`;
    const b = blocks.get(key) ?? { x: 0, y: 0, count: 0 };
    b.x += p.x; b.y += p.y; b.count++;
    blocks.set(key, b);
  }
  return [...blocks.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((b) => ({ x: Math.round(b.x / b.count), y: Math.round(b.y / b.count), sqft: b.count }));
}

export function describeYard(input: AdviseInput, catalog: CatalogItem[], baseline: Metrics): string {
  const lawn = input.features.filter((f) => f.kind === 'lawn');
  const b = boundsOf(lawn.map((f) => f.polygon));
  const r = (v: number) => Math.round(v * 10) / 10;
  const feat = input.features.map((f) => ({ kind: f.kind, polygon: f.polygon.map((p) => [r(p.x), r(p.y)]) }));
  const dry = input.health.filter((h) => h.status !== 'healthy').map((h) => ({ status: h.status, polygon: h.polygon.map((p) => [r(p.x), r(p.y)]) }));
  return JSON.stringify({
    units: 'feet; x to the right, y downward on the plan (top-down view); rotation 0 = +x, 90 = +y',
    lawnBounds: { minX: r(b.minX), minY: r(b.minY), maxX: r(b.maxX), maxY: r(b.maxY) },
    features: feat,
    observedStressedOrDry: dry,
    sprinklers: input.layout.sprinklers,
    zones: input.layout.zones,
    schedule: input.layout.schedule,
    baselineMetrics: baseline,
    underCoveredSpots: problemSpots(input.features, input.layout, catalog),
  });
}

type CallModel = (body: Record<string, unknown>) => Promise<MetaResponse>;

export interface AdviseResult {
  baseline: Metrics;
  recommendations: Recommendation[];
  rejected: { title: string; why: string }[];
  rounds: number;
  simulateCalls: number;
}

/** Runs the Muse Spark tool loop and keeps only recommendations the simulator confirms. */
export async function runAdvisor(input: AdviseInput, catalog: CatalogItem[], callModel: CallModel): Promise<AdviseResult> {
  const yard = { features: input.features, health: input.health };
  const baseline = evaluate(yard, input.layout, catalog, input.weather);
  let simulateCalls = 0;
  type Submitted = { title: string; reason: string; changes: LayoutChange[] }[];
  let submitted: Submitted | null = null as Submitted | null;

  let res = await callModel({
    instructions: INSTRUCTIONS,
    input: `Current yard (JSON):\n${describeYard(input, catalog, baseline)}\n\nFind the best fixes for coverage gaps, overspray and the dry areas over the next 7 days.`,
    tools: TOOLS,
    reasoning: { effort: 'medium' },
  });
  let rounds = 1;

  while (rounds <= MAX_ROUNDS) {
    const calls = res.output.filter((o) => o.type === 'function_call');
    if (!calls.length) break;
    const outputs: { type: 'function_call_output'; call_id: string; output: string }[] = [];
    for (const c of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.arguments || '{}');
      } catch {
        outputs.push({ type: 'function_call_output', call_id: c.call_id!, output: JSON.stringify({ error: 'arguments were not valid JSON' }) });
        continue;
      }
      let out: unknown;
      switch (c.name) {
        case 'get_weather':
          out = input.weather;
          break;
        case 'get_catalog':
          out = catalog.map(({ url: _u, ...rest }) => rest);
          break;
        case 'simulate': {
          simulateCalls++;
          const changes = (Array.isArray(args.changes) ? args.changes : []) as LayoutChange[];
          const next = applyChanges(input.layout, changes, catalog);
          out = { metrics: evaluate(yard, next, catalog, input.weather), baseline, underCoveredSpots: problemSpots(input.features, next, catalog, 5) };
          break;
        }
        case 'submit_recommendations':
          submitted = (Array.isArray(args.recommendations) ? args.recommendations : []) as Submitted;
          out = { received: true };
          break;
        default:
          out = { error: `unknown tool ${c.name}` };
      }
      outputs.push({ type: 'function_call_output', call_id: c.call_id!, output: JSON.stringify(out) });
    }
    if (submitted) break;
    if (rounds === MAX_ROUNDS) break;
    res = await callModel({
      previous_response_id: res.id,
      input:
        rounds === MAX_ROUNDS - 1
          ? [...outputs, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Last round: call submit_recommendations now with your best verified options.' }] }]
          : outputs,
      tools: TOOLS,
    });
    rounds++;
  }

  const recommendations: Recommendation[] = [];
  const rejected: AdviseResult['rejected'] = [];
  const baseScore = score(baseline);
  (submitted ?? []).slice(0, 3).forEach((rec, i) => {
    const changes = Array.isArray(rec.changes) ? rec.changes : [];
    const after = evaluate(yard, applyChanges(input.layout, changes, catalog), catalog, input.weather);
    if (!changes.length || score(after) - baseScore < MIN_SCORE_GAIN) {
      rejected.push({ title: rec.title, why: 'Simulation showed no meaningful improvement.' });
      return;
    }
    recommendations.push({ id: `rec-${i}`, title: String(rec.title), reason: String(rec.reason), changes, before: baseline, after });
  });
  return { baseline, recommendations, rejected, rounds, simulateCalls };
}
