import { errorResponse, json, MetaApiError, museModel, outputText, responses } from './_meta';

export const HEALTH_GRID = 8;

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'One sentence on overall turf condition.' },
    cells: {
      type: 'array',
      description: `Grass cells on an ${HEALTH_GRID}x${HEALTH_GRID} grid over the image (row 0 = top, col 0 = left). Only include cells that are mostly grass.`,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          row: { type: 'integer' },
          col: { type: 'integer' },
          status: { type: 'string', enum: ['healthy', 'stressed', 'dry'] },
          score: { type: 'number', description: '0 = dead/brown, 1 = lush green' },
        },
        required: ['row', 'col', 'status', 'score'],
      },
    },
  },
  required: ['summary', 'cells'],
};

/** POST { image: dataUrl } → { ok, summary, grid, cells: [{row,col,status,score}] } */
export async function POST(req: Request): Promise<Response> {
  try {
    const { image } = (await req.json()) as { image?: string };
    if (!image?.startsWith('data:image/')) throw new MetaApiError('Expected image as a data URL.', 400);
    const r = await responses({
      instructions:
        'You are a turfgrass agronomist. The image is a top-down (perspective-corrected) photo of part of a residential yard. ' +
        'Judge grass colour and density to classify each grid cell: healthy (uniform green), stressed (thin, dull, blue-grey or patchy), dry (yellow/brown/dormant). ' +
        'Skip cells that are not grass (paving, beds, trees, outside the yard).',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: `Classify grass health on an ${HEALTH_GRID}x${HEALTH_GRID} grid.` },
            { type: 'input_image', image_url: image },
          ],
        },
      ],
      text: { format: { type: 'json_schema', name: 'lawn_health', schema } },
      reasoning: { effort: 'low' },
    });
    const parsed = JSON.parse(outputText(r)) as { summary: string; cells: { row: number; col: number; status: string; score: number }[] };
    const cells = parsed.cells.filter(
      (c) => c.row >= 0 && c.row < HEALTH_GRID && c.col >= 0 && c.col < HEALTH_GRID && ['healthy', 'stressed', 'dry'].includes(c.status),
    );
    return json({ ok: true, summary: parsed.summary, grid: HEALTH_GRID, cells, model: museModel() });
  } catch (e) {
    if (e instanceof SyntaxError) return json({ ok: false, error: 'Muse Spark returned unparseable health data.' }, 502);
    return errorResponse(e);
  }
}
