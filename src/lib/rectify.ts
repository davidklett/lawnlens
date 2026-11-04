import { applyHomography, isConvexQuad, solveHomography } from '../sim/geometry';
import type { Vec2 } from '../sim/types';

export interface RectifyResult {
  dataUrl: string;
  widthFt: number;
  heightFt: number;
  pxPerFt: number;
}

const MAX_PX = 1400;
/**
 * Only ground-plane pixels are flattened correctly. Far from the camera (and anything standing up, like
 * hedges and fences) a few source pixels get stretched across many output pixels and smear. Keep output
 * pixels whose projective depth is at most this multiple of the depth at the rectangle's far corners.
 */
const MAX_DEPTH_RATIO = 1.25;

/**
 * Warp a perspective photo to a top-down tile. `corners` are image-pixel taps in order
 * back-left, back-right, front-right, front-left of a ground rectangle `widthFt` × `depthFt`.
 * The output is exactly the tapped area unless `marginFrac` adds a margin (× the larger side) around it.
 */
export function rectify(img: HTMLImageElement | HTMLCanvasElement, corners: Vec2[], widthFt: number, depthFt: number, marginFrac = 0): RectifyResult | string {
  if (corners.length !== 4) return 'Tap all 4 corners first.';
  if (!(widthFt > 0 && depthFt > 0)) return 'Enter the rectangle width and depth in feet.';
  if (!isConvexQuad(corners)) return 'Those corners cross or line up — tap them in order around the rectangle.';
  const m = marginFrac * Math.max(widthFt, depthFt);
  const W = widthFt + 2 * m;
  const D = depthFt + 2 * m;
  // Resolution follows the output pixel budget, not the (guessed) size in feet, so small guesses stay sharp.
  const ppf = MAX_PX / Math.max(W, D);
  const dst = [
    { x: m, y: m },
    { x: m + widthFt, y: m },
    { x: m + widthFt, y: m + depthFt },
    { x: m, y: m + depthFt },
  ];
  // Inverse mapping: tile feet -> source pixels.
  const h = solveHomography(dst, corners);
  if (!h) return 'Could not solve the perspective from those corners.';

  // Homogeneous depth w grows with distance from the camera; area magnification ∝ 1/w³.
  const depth = (p: Vec2) => h[6] * p.x + h[7] * p.y + h[8];
  const maxDepth = MAX_DEPTH_RATIO * Math.max(...dst.map(depth));

  const sw = img.width;
  const sh = img.height;
  const src = document.createElement('canvas');
  src.width = sw;
  src.height = sh;
  const sctx = src.getContext('2d')!;
  sctx.drawImage(img, 0, 0);
  const sdata = sctx.getImageData(0, 0, sw, sh).data;

  const ow = Math.round(W * ppf);
  const oh = Math.round(D * ppf);
  const out = document.createElement('canvas');
  out.width = ow;
  out.height = oh;
  const octx = out.getContext('2d')!;
  const odata = octx.createImageData(ow, oh);
  const o = odata.data;
  let x0 = ow;
  let y0 = oh;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const p = { x: (x + 0.5) / ppf, y: (y + 0.5) / ppf };
      const w = h[6] * p.x + h[7] * p.y + h[8];
      const k = (y * ow + x) * 4;
      o[k] = 32; o[k + 1] = 40; o[k + 2] = 34; o[k + 3] = 255;
      if (w <= 0 || w > maxDepth) continue; // past the horizon, or too stretched to be useful
      const s = applyHomography(h, p);
      const sx = Math.floor(s.x);
      const sy = Math.floor(s.y);
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
      const j = (sy * sw + sx) * 4;
      o[k] = sdata[j];
      o[k + 1] = sdata[j + 1];
      o[k + 2] = sdata[j + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  octx.putImageData(odata, 0, 0);
  if (x1 < x0) return 'Nothing in that photo maps to the ground — check the corners.';
  // Crop to the pixels that actually show ground, so the tile's size reflects real content.
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const crop = document.createElement('canvas');
  crop.width = cw;
  crop.height = ch;
  crop.getContext('2d')!.drawImage(out, x0, y0, cw, ch, 0, 0, cw, ch);
  return { dataUrl: crop.toDataURL('image/jpeg', 0.85), widthFt: cw / ppf, heightFt: ch / ppf, pxPerFt: ppf };
}

/** Load a data URL / object URL into an image element, downscaled so its long side ≤ maxSide. */
export function loadImage(src: string, maxSide = 1600): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * s);
      c.height = Math.round(im.naturalHeight * s);
      c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
      resolve(c);
    };
    im.onerror = () => reject(new Error('Could not read that image.'));
    im.src = src;
  });
}
