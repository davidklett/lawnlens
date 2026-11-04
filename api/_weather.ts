import type { WeatherDay } from '../src/sim/types';
import { MetaApiError } from './_meta';

/** 7-day daily forecast from Open-Meteo (free, no key, not a model). */
export async function fetchWeather(lat: number, lon: number): Promise<WeatherDay[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new MetaApiError('Invalid location for weather.', 400);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=et0_fao_evapotranspiration,precipitation_sum,temperature_2m_max&timezone=auto&forecast_days=7`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new MetaApiError(`Weather service unreachable: ${(e as Error).message}`, 503);
  }
  if (!res.ok) throw new MetaApiError(`Weather service error ${res.status}`, 502);
  const d = (await res.json()) as {
    daily: { time: string[]; et0_fao_evapotranspiration: number[]; precipitation_sum: number[]; temperature_2m_max: number[] };
  };
  const mmToIn = (mm: number) => Math.round(((mm ?? 0) / 25.4) * 1000) / 1000;
  return d.daily.time.map((date, i) => ({
    date,
    et0In: mmToIn(d.daily.et0_fao_evapotranspiration[i]),
    rainIn: mmToIn(d.daily.precipitation_sum[i]),
    tMaxF: Math.round((d.daily.temperature_2m_max[i] * 9) / 5 + 32),
  }));
}
