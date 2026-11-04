import catalogData from '../src/data/catalog.json';
import type { CatalogItem } from '../src/sim/types';
import { errorResponse, json, MetaApiError, museModel, responses } from './_meta';
import { runAdvisor, type AdviseInput } from './_advisor';
import { fetchWeather } from './_weather';

const catalog = catalogData.items as CatalogItem[];

/**
 * POST { features, health, layout, weather?, location? }
 * → { ok, baseline, recommendations, rejected, rounds, simulateCalls, model }
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as Partial<AdviseInput> & { location?: { lat: number; lon: number } };
    if (!body.features?.length || !body.layout) throw new MetaApiError('Yard features and layout are required.', 400);
    if (!body.layout.sprinklers.length) throw new MetaApiError('Add at least one sprinkler before asking for advice.', 400);
    let weather = body.weather ?? [];
    if (!weather.length && body.location) weather = await fetchWeather(body.location.lat, body.location.lon);
    const result = await runAdvisor(
      { features: body.features, health: body.health ?? [], layout: body.layout, weather },
      catalog,
      responses,
    );
    return json({ ok: true, ...result, model: museModel() });
  } catch (e) {
    return errorResponse(e);
  }
}
