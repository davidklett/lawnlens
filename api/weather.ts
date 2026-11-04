import { errorResponse, json } from './_meta';
import { fetchWeather } from './_weather';

export async function GET(req: Request): Promise<Response> {
  try {
    const u = new URL(req.url);
    const days = await fetchWeather(Number(u.searchParams.get('lat')), Number(u.searchParams.get('lon')));
    return json({ ok: true, days, source: 'open-meteo' });
  } catch (e) {
    return errorResponse(e);
  }
}
