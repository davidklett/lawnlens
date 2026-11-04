import { solveHomography } from '../sim/geometry';
import type { Vec2 } from '../sim/types';

export interface SizeEstimate {
  widthFt: number;
  depthFt: number;
  /** True when the focal length was recovered from the rectangle itself (more reliable). */
  focalFromImage: boolean;
}

/** Typical phone main camera (~26 mm equivalent): focal length ≈ 0.72 × the long image side, in pixels. */
const DEFAULT_FOCAL_FRAC = 0.72;

/**
 * Estimate the real size of a ground rectangle from its 4 corners in a photo
 * (order: back-left, back-right, front-right, front-left), assuming the phone was
 * `cameraHeightFt` above the ground. No model call: plain camera geometry.
 *
 * The rectangle's right angle lets us recover the focal length; the camera height sets the scale.
 * Returns null when the corners don't describe a plausible ground rectangle.
 */
export function estimateSize(corners: Vec2[], imageW: number, imageH: number, cameraHeightFt: number): SizeEstimate | null {
  if (corners.length !== 4 || !(cameraHeightFt > 0)) return null;
  const cx = imageW / 2;
  const cy = imageH / 2;
  const unit = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const H = solveHomography(
    unit,
    corners.map((c) => ({ x: c.x - cx, y: c.y - cy })),
  );
  if (!H) return null;
  const h1 = [H[0], H[3], H[6]];
  const h2 = [H[1], H[4], H[7]];
  const h3 = [H[2], H[5], H[8]];

  // Orthogonality of the rectangle's edges: (h1x·h2x + h1y·h2y)/f² + h1z·h2z = 0.
  const long = Math.max(imageW, imageH);
  let f = DEFAULT_FOCAL_FRAC * long;
  let focalFromImage = false;
  const den = h1[2] * h2[2];
  if (Math.abs(den) > 1e-12) {
    const f2 = -(h1[0] * h2[0] + h1[1] * h2[1]) / den;
    if (f2 > 0) {
      const fi = Math.sqrt(f2);
      if (fi > 0.45 * long && fi < 2 * long) {
        f = fi;
        focalFromImage = true;
      }
    }
  }

  const kinv = (v: number[]) => [v[0] / f, v[1] / f, v[2]];
  const c1 = kinv(h1);
  const c2 = kinv(h2);
  const c3 = kinv(h3);
  const n = cross(c1, c2);
  const nLen = norm(n);
  if (nLen < 1e-12) return null;
  // c1 = s·W·r1, c2 = s·D·r2, c3 = s·t; camera height = |n̂·t| = |n̂·c3| / s.
  const s = Math.abs(dot(n, c3) / nLen) / cameraHeightFt;
  if (!(s > 0)) return null;
  const widthFt = norm(c1) / s;
  const depthFt = norm(c2) / s;
  if (!Number.isFinite(widthFt) || !Number.isFinite(depthFt) || widthFt < 0.5 || depthFt < 0.5 || widthFt > 500 || depthFt > 500) return null;
  return { widthFt, depthFt, focalFromImage };
}

/** Round to a friendly tape-measure value: 0.5 ft under 10 ft, whole feet above. */
export function roundFt(v: number): number {
  return v < 10 ? Math.round(v * 2) / 2 : Math.round(v);
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => Math.sqrt(dot(a, a));
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
