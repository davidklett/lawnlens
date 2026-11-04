// Server-only client for the Meta Model API (https://api.meta.ai/v1). Never import from client code.
import { decodeMaskToRaster, parseImageStream, recordsOfKind, type ResponsesEvent } from '@meta-sam/parser';
import { rasterToPolygons } from '../src/sim/mask';
import type { Polygon } from '../src/sim/types';

export const META_BASE = 'https://api.meta.ai/v1';
export const museModel = () => process.env.MUSE_MODEL || 'muse-spark-1.3';
export const samModel = () => process.env.SAM_MODEL || 'sam-3.1';

export class MetaApiError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export function apiKey(): string {
  const k = process.env.MODEL_API_KEY;
  if (!k) throw new MetaApiError('Meta Model API key is not configured on the server (MODEL_API_KEY).', 503);
  return k;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof MetaApiError) return json({ ok: false, error: err.message }, err.status);
  return json({ ok: false, error: `Unexpected server error: ${(err as Error)?.message ?? String(err)}` }, 500);
}

async function post(path: string, body: unknown, stream = false): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${META_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
        ...(stream ? { Accept: 'text/event-stream' } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof MetaApiError) throw e;
    throw new MetaApiError(`Meta Model API unreachable: ${(e as Error).message}`, 503);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new MetaApiError(`Meta Model API ${res.status}: ${text.slice(0, 400)}`, res.status === 401 || res.status === 403 ? 503 : 502);
  }
  return res;
}

// ---------- Responses API (Muse Spark) ----------

export interface ResponseOutputItem {
  type: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  content?: { type: string; text?: string }[];
}
export interface MetaResponse {
  id: string;
  status: string;
  output: ResponseOutputItem[];
}

export async function responses(body: Record<string, unknown>): Promise<MetaResponse> {
  const res = await post('/responses', { model: museModel(), ...body });
  return (await res.json()) as MetaResponse;
}

export function outputText(r: MetaResponse): string {
  return r.output
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('');
}

// ---------- SAM 3.1 ----------

async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncIterable<ResponsesEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
      const data = chunk
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data) as ResponsesEvent;
      } catch {
        /* ignore keep-alives / malformed lines */
      }
    }
    if (done) break;
  }
}

export interface SegmentObject {
  polygons: Polygon[]; // in source image pixels
  confidence?: number;
}

/** Segment one concept (short noun phrase) in an image. Returns polygons in image pixel coordinates. */
export async function samSegment(imageDataUrl: string, prompt: string): Promise<SegmentObject[]> {
  const res = await post(
    '/responses',
    {
      model: samModel(),
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: imageDataUrl }] }],
      stream: true,
      metadata: { include_confidence: 'true' },
    },
    true,
  );
  if (!res.body) throw new MetaApiError('SAM returned an empty body.');
  const parsed = parseImageStream(sseEvents(res.body));
  for await (const _ of parsed) {
    /* drain snapshots */
  }
  const result = await parsed.finalResult;
  if (result.outcome.status !== 'completed') throw new MetaApiError(`SAM segmentation ended early: ${JSON.stringify(result.outcome)}`);
  const out: SegmentObject[] = [];
  for (const rec of recordsOfKind(result.records, 'mask')) {
    const raster = decodeMaskToRaster(rec.mask);
    const { width, height } = rec.mask;
    const sx = (rec.bounds.right - rec.bounds.left) / width;
    const sy = (rec.bounds.bottom - rec.bounds.top) / height;
    const polys = rasterToPolygons(raster, width, height, 2).map((poly) =>
      poly.map((p) => ({ x: rec.bounds.left + p.x * sx, y: rec.bounds.top + p.y * sy })),
    );
    if (polys.length) out.push({ polygons: polys, confidence: rec.confidence });
  }
  return out;
}
