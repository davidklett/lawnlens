import { errorResponse, json, MetaApiError, samSegment } from './_meta';
import type { FeatureKind } from '../src/sim/types';

/** One SAM concept prompt per feature kind (SAM takes one short noun phrase per request). */
export const PROMPTS: Record<FeatureKind, string> = {
  lawn: 'grass lawn',
  tree: 'tree',
  shrub: 'shrub',
  bed: 'flower bed',
  hardscape: 'paved patio',
};

/**
 * POST { image: dataUrl, kind: FeatureKind }
 * → { ok, kind, prompt, objects: [{ polygons (image px), confidence }] }
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const { image, kind } = (await req.json()) as { image?: string; kind?: FeatureKind };
    if (!image?.startsWith('data:image/')) throw new MetaApiError('Expected image as a data URL.', 400);
    if (!kind || !(kind in PROMPTS)) throw new MetaApiError('Unknown feature kind.', 400);
    const objects = await samSegment(image, PROMPTS[kind]);
    return json({ ok: true, kind, prompt: PROMPTS[kind], objects, model: 'sam-3.1' });
  } catch (e) {
    return errorResponse(e);
  }
}
