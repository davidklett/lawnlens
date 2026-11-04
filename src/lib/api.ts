// Client wrappers for /api. Every call resolves to {ok:true,...} or {ok:false,error} — never throws,
// and never substitutes sample data: callers must show the error.
import type { Feature, FeatureKind, HealthObservation, Layout, Metrics, Recommendation, WeatherDay } from '../sim/types';

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string; status?: number };

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, init);
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: `Server returned ${res.status} (not JSON).`, status: res.status };
    }
    const d = data as { ok?: boolean; error?: string };
    if (!res.ok || !d.ok) return { ok: false, error: d.error ?? `Request failed (${res.status}).`, status: res.status };
    return data as ApiResult<T>;
  } catch (e) {
    return { ok: false, error: `Network error: ${(e as Error).message}` };
  }
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export interface SegmentObject {
  polygons: { x: number; y: number }[][];
  confidence?: number;
}
export const segment = (image: string, kind: FeatureKind) =>
  call<{ kind: FeatureKind; prompt: string; objects: SegmentObject[] }>('/api/segment', post({ image, kind }));

export interface HealthCell {
  row: number;
  col: number;
  status: 'healthy' | 'stressed' | 'dry';
  score: number;
}
export const health = (image: string) => call<{ summary: string; grid: number; cells: HealthCell[]; model: string }>('/api/health', post({ image }));

export const weather = (lat: number, lon: number) => call<{ days: WeatherDay[] }>(`/api/weather?lat=${lat}&lon=${lon}`);

export interface AdviseResponse {
  baseline: Metrics;
  recommendations: Recommendation[];
  rejected: { title: string; why: string }[];
  rounds: number;
  simulateCalls: number;
  model: string;
}
export const advise = (body: { features: Feature[]; health: HealthObservation[]; layout: Layout; weather: WeatherDay[] }) =>
  call<AdviseResponse>('/api/advise', post(body));

export interface Place {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

/** Place search for the weather location (Open-Meteo geocoding: free, no key, not a model). Never throws. */
export async function geocode(query: string): Promise<{ ok: true; places: Place[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name=${encodeURIComponent(query)}`);
    if (!res.ok) return { ok: false, error: `Place search error ${res.status}` };
    const d = (await res.json()) as { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] };
    return {
      ok: true,
      places: (d.results ?? []).map((r) => ({
        name: r.name,
        detail: [r.admin1, r.country].filter(Boolean).join(', '),
        lat: Math.round(r.latitude * 1000) / 1000,
        lon: Math.round(r.longitude * 1000) / 1000,
      })),
    };
  } catch (e) {
    return { ok: false, error: `Place search unreachable: ${(e as Error).message}` };
  }
}
