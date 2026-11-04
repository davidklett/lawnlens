import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAdvisor } from './_advisor';
import { samSegment } from './_meta';
import { POST as segmentPOST } from './segment';
import type { MetaResponse } from './_meta';
import type { CatalogItem, Feature, Layout } from '../src/sim/types';

const rotor: CatalogItem = {
  id: 'rotor', brand: 'T', model: 'R', name: 'Test rotor', type: 'rotor',
  radiusMin: 15, radiusMax: 40, arcMin: 40, arcMax: 360, precipInHr: 0.5, popUpIn: 4, priceUsd: 10, url: '',
};
const lawn: Feature = { id: 'l', kind: 'lawn', source: 'manual', polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }] };
const layout: Layout = {
  sprinklers: [{ id: 'h1', zoneId: 'z1', catalogId: 'rotor', x: 0, y: 0, radius: 20, arc: 90, rotation: 45 }],
  zones: [{ id: 'z1', name: 'Front', valve: 1, runMinutes: 20 }],
  schedule: { daysPerWeek: 3 },
};
const weather = Array.from({ length: 7 }, (_, d) => ({ date: `d${d}`, et0In: 0.2, rainIn: 0, tMaxF: 88 }));

const call = (output: MetaResponse['output'], id = 'r'): MetaResponse => ({ id, status: 'completed', output });
const fn = (name: string, args: unknown, call_id = name) => ({ type: 'function_call', name, call_id, arguments: JSON.stringify(args) });

describe('runAdvisor', () => {
  it('runs tools, then keeps only recommendations the simulator confirms', async () => {
    const good = [{ op: 'set_head', id: 'h1', radius: 40 }, { op: 'add_head', catalogId: 'rotor', x: 40, y: 40, radius: 40, arc: 90, rotation: 225, zoneId: 'z1' }];
    const bad = [{ op: 'set_head', id: 'h1', radius: 15 }];
    const seen: Record<string, unknown>[] = [];
    const model = vi
      .fn()
      .mockImplementationOnce(async (b) => (seen.push(b), call([fn('get_catalog', {}), fn('simulate', { changes: good })], 'r1')))
      .mockImplementationOnce(async (b) => (seen.push(b), call([fn('submit_recommendations', {
        recommendations: [
          { title: 'Add a corner rotor', reason: 'fills gap', changes: good },
          { title: 'Shrink radius', reason: 'worse', changes: bad },
          { title: 'Unknown head', reason: 'noop', changes: [{ op: 'move_head', id: 'nope', x: 1, y: 1 }] },
        ],
      })], 'r2')));
    const out = await runAdvisor({ features: [lawn], health: [], layout, weather }, [rotor], model);
    expect(out.simulateCalls).toBe(1);
    expect(out.recommendations.map((r) => r.title)).toEqual(['Add a corner rotor']);
    expect(out.recommendations[0].after.du).toBeGreaterThan(out.recommendations[0].before.du);
    expect(out.rejected).toHaveLength(2);
    expect(seen[1].previous_response_id).toBe('r1');
    expect((seen[1].input as { call_id: string }[]).map((i) => i.call_id)).toEqual(['get_catalog', 'simulate']);
  });

  it('stops after the round cap if the model never submits', async () => {
    const model = vi.fn(async () => call([fn('get_weather', {})]));
    const out = await runAdvisor({ features: [lawn], health: [], layout, weather }, [rotor], model);
    expect(model).toHaveBeenCalledTimes(6);
    expect(out.recommendations).toEqual([]);
  });
});

describe('Meta API wiring', () => {
  const env = process.env.MODEL_API_KEY;
  afterEach(() => {
    process.env.MODEL_API_KEY = env;
    vi.unstubAllGlobals();
  });

  it('returns a 503 degraded error when the key is missing', async () => {
    delete process.env.MODEL_API_KEY;
    const res = await segmentPOST(new Request('http://x/api/segment', { method: 'POST', body: JSON.stringify({ image: 'data:image/png;base64,AA', kind: 'lawn' }) }));
    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBe(false);
  });

  it('parses a streamed SAM 3.1 response into polygons', async () => {
    process.env.MODEL_API_KEY = 'test';
    // Example output from the @meta-sam/parser README (frame 0, two objects).
    const text =
      '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>' +
      "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" +
      ',1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>' +
      '<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n';
    const lane = { item_id: 'm', output_index: 0, content_index: 0 };
    const events = [
      { type: 'response.output_text.delta', ...lane, delta: text.slice(0, 50) },
      { type: 'response.output_text.delta', ...lane, delta: text.slice(50) },
      { type: 'response.output_text.done', ...lane, text },
      { type: 'response.completed' },
    ];
    const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    const fetchMock = vi.fn(async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const objs = await samSegment('data:image/png;base64,AA', 'button');
    expect(objs).toHaveLength(2);
    for (const o of objs) {
      expect(o.polygons.length).toBeGreaterThan(0);
      for (const p of o.polygons[0]) {
        expect(p.x).toBeGreaterThanOrEqual(150);
        expect(p.x).toBeLessThanOrEqual(272);
        expect(p.y).toBeGreaterThanOrEqual(227);
        expect(p.y).toBeLessThanOrEqual(256);
      }
    }
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.model).toBe('sam-3.1');
    expect(body.stream).toBe(true);
  });
});

describe('demo yard', () => {
  it('a NE-corner rotor is a verified improvement on the synthetic demo yard', async () => {
    const { syntheticDemoYard } = await import('../src/data/sampleYard');
    const catalogData = (await import('../src/data/catalog.json')).default;
    const y = syntheticDemoYard();
    const changes = [{ op: 'add_head', catalogId: 'hu-pgp', x: 60, y: 0, radius: 32, arc: 90, rotation: 135, zoneId: 'z1' }];
    const model = vi
      .fn()
      .mockResolvedValueOnce(call([fn('submit_recommendations', { recommendations: [{ title: 'Add NE rotor', reason: 'fills gap', changes }] })]));
    const out = await runAdvisor({ features: y.features, health: y.health, layout: y.layout, weather }, catalogData.items as CatalogItem[], model);
    expect(out.recommendations).toHaveLength(1);
    expect(out.recommendations[0].after.underCoveredPct).toBeLessThan(out.recommendations[0].before.underCoveredPct);
  });
});
