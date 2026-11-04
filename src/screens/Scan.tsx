import { useEffect, useMemo, useRef, useState } from 'react';
import { estimateSize, roundFt } from '../lib/estimateSize';
import { loadImage, rectify, type RectifyResult } from '../lib/rectify';
import { useApp } from '../store';
import type { Vec2 } from '../sim/types';

type Step = 'camera' | 'corners' | 'review';
const VANTAGES = [
  { label: 'Standing', heightFt: 5 },
  { label: 'Porch / deck', heightFt: 9 },
  { label: 'Upstairs window', heightFt: 15 },
];

/** Starting corners: a trapezoid on the lower part of the photo, ready to drag. */
function defaultCorners(w: number, h: number): Vec2[] {
  return [
    { x: 0.3 * w, y: 0.5 * h },
    { x: 0.7 * w, y: 0.5 * h },
    { x: 0.85 * w, y: 0.85 * h },
    { x: 0.15 * w, y: 0.85 * h },
  ];
}

export function Scan() {
  const { draftTiles, setDraftTiles, go } = useApp();
  const [step, setStep] = useState<Step>('camera');
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [corners, setCorners] = useState<Vec2[]>([]);
  const [vantage, setVantage] = useState(0);
  const [manual, setManual] = useState<{ w: string; d: string } | null>(null);
  const [result, setResult] = useState<RectifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usePhoto = async (src: string) => {
    try {
      const img = await loadImage(src);
      setPhoto(img);
      setCorners(defaultCorners(img.width, img.height));
      setManual(null);
      setError(null);
      setStep('corners');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const estimate = useMemo(
    () => (photo ? estimateSize(corners, photo.width, photo.height, VANTAGES[vantage].heightFt) : null),
    [photo, corners, vantage],
  );
  const w = manual ? Number(manual.w) : estimate ? roundFt(estimate.widthFt) : NaN;
  const d = manual ? Number(manual.d) : estimate ? roundFt(estimate.depthFt) : NaN;
  const editing = manual !== null || !estimate;

  const doRectify = () => {
    if (!photo) return;
    const r = rectify(photo, corners, w, d);
    if (typeof r === 'string') return setError(r);
    setError(null);
    setResult(r);
    setStep('review');
  };

  const accept = () => {
    if (!result) return;
    const x = draftTiles.reduce((s, t) => Math.max(s, t.x + t.widthFt), 0) + (draftTiles.length ? 2 : 0);
    setDraftTiles([
      ...draftTiles,
      { id: `tile-${Date.now().toString(36)}`, imageDataUrl: result.dataUrl, widthFt: result.widthFt, heightFt: result.heightFt, pxPerFt: result.pxPerFt, x, y: 0, rotation: 0 },
    ]);
    setResult(null);
    setPhoto(null);
    setStep('camera');
  };

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn ghost sm" onClick={() => go('home')}>
          ‹ Home
        </button>
        <div className="title">
          Scan · section {draftTiles.length + (step === 'camera' ? 1 : 1)}
        </div>
        <button className="btn sm primary" disabled={!draftTiles.length} onClick={() => go(draftTiles.length === 1 ? 'build' : 'assemble')}>
          Done ({draftTiles.length})
        </button>
      </header>

      {step === 'camera' && <Camera onPhoto={usePhoto} />}

      {step === 'corners' && photo && (
        <div className="pad stack">
          <p className="hint">
            Drag the 4 dots around the patch of ground to keep — only what's inside becomes the top-down tile. Dots 1–2 are the far edge. Tap anywhere to pull the nearest dot there. The size guess and the flattening assume the 4 dots form a real rectangle on the ground, so straight edges (patio, path, fence line) work best; for a curvy lawn, check the size with Edit.
          </p>
          <CornerPicker photo={photo} corners={corners} onChange={setCorners} />
          <div className="card stack">
            <div className="row">
              <span className="muted small">Photo taken from</span>
              <div className="seg">
                {VANTAGES.map((v, i) => (
                  <button key={v.label} className={vantage === i ? 'on' : ''} onClick={() => setVantage(i)}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
            {editing ? (
              <>
                {!estimate && <span className="small warn-text">Couldn't estimate the size from this angle — enter it.</span>}
                <div className="row">
                  <label className="field">
                    Width (1→2), ft
                    <input inputMode="decimal" value={manual?.w ?? ''} onChange={(e) => setManual({ w: e.target.value, d: manual?.d ?? '' })} />
                  </label>
                  <label className="field">
                    Depth (2→3), ft
                    <input inputMode="decimal" value={manual?.d ?? ''} onChange={(e) => setManual({ w: manual?.w ?? '', d: e.target.value })} />
                  </label>
                </div>
                {estimate && (
                  <button className="btn ghost sm" onClick={() => setManual(null)}>
                    Use estimate ({roundFt(estimate.widthFt)} × {roundFt(estimate.depthFt)} ft)
                  </button>
                )}
              </>
            ) : (
              <div className="row between">
                <div>
                  <div className="size-guess">
                    ≈ {w} × {d} ft
                  </div>
                  <span className="muted small">Estimated from the photo's perspective. Sanity check: a fence panel is ~8 ft, a car ~15 ft.</span>
                </div>
                <button className="btn sm" onClick={() => setManual({ w: String(w), d: String(d) })}>
                  Edit
                </button>
              </div>
            )}
          </div>
          <div className="row">
            <button className="btn" onClick={() => setCorners(defaultCorners(photo.width, photo.height))}>
              Reset
            </button>
            <button className="btn" onClick={() => setStep('camera')}>
              Retake
            </button>
            <button className="btn primary grow" disabled={corners.length !== 4 || !(w > 0 && d > 0)} onClick={doRectify}>
              {editing ? 'Make top-down' : 'Looks right · make top-down'}
            </button>
          </div>
        </div>
      )}

      {step === 'review' && result && (
        <div className="pad stack">
          <p className="hint">
            Top-down tile: {result.widthFt.toFixed(0)} × {result.heightFt.toFixed(0)} ft. Only the ground is flattened — things that stand up (hedges, fences, trees) lean outward.
          </p>
          <img className="tile-preview" src={result.dataUrl} alt="Rectified section" />
          <div className="row">
            <button className="btn" onClick={() => setStep('corners')}>
              Adjust corners
            </button>
            <button className="btn primary grow" onClick={accept}>
              Keep section · scan next
            </button>
          </div>
        </div>
      )}

      {error && <div className="banner error pad">{error}</div>}

      {draftTiles.length > 0 && (
        <div className="thumbs pad">
          {draftTiles.map((t, i) => (
            <img key={t.id} src={t.imageDataUrl} alt={`Section ${i + 1}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function Camera({ onPhoto }: { onPhoto: (src: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camError, setCamError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Live camera needs HTTPS and a supported browser — use “Choose photo” instead.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
      })
      .catch((e) => setCamError(`Camera unavailable (${(e as Error).name}). Use “Choose photo” instead.`));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    onPhoto(c.toDataURL('image/jpeg', 0.9));
  };

  return (
    <div className="camera">
      {camError ? <div className="camera-off muted">{camError}</div> : <video ref={videoRef} playsInline muted />}
      <div className="camera-guide">Stand high (porch, window, ladder). Frame one section with a measurable rectangle on the ground.</div>
      <div className="camera-bar">
        <button className="btn ghost" onClick={() => fileRef.current?.click()}>
          Choose photo
        </button>
        <button className="shutter" aria-label="Capture" disabled={!!camError} onClick={capture} />
        <span style={{ width: 96 }} />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPhoto(URL.createObjectURL(f));
        }}
      />
    </div>
  );
}

function CornerPicker({ photo, corners, onChange }: { photo: HTMLCanvasElement; corners: Vec2[]; onChange: (c: Vec2[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const url = useRef<string>('');
  if (!url.current) url.current = photo.toDataURL('image/jpeg', 0.8);

  const toImage = (e: React.PointerEvent): Vec2 => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * photo.width, y: ((e.clientY - r.top) / r.height) * photo.height };
  };

  return (
    <div
      ref={ref}
      className="picker"
      style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
      onPointerDown={(e) => {
        if (drag !== null) return;
        const p = toImage(e);
        if (corners.length < 4) return onChange([...corners, p]);
        let best = 0;
        corners.forEach((c, i) => {
          if (Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot(corners[best].x - p.x, corners[best].y - p.y)) best = i;
        });
        onChange(corners.map((c, i) => (i === best ? p : c)));
        ref.current?.setPointerCapture?.(e.pointerId);
        setDrag(best);
      }}
      onPointerMove={(e) => {
        if (drag !== null) onChange(corners.map((c, i) => (i === drag ? toImage(e) : c)));
      }}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => setDrag(null)}
    >
      <img src={url.current} alt="Captured section" draggable={false} />
      <svg viewBox={`0 0 ${photo.width} ${photo.height}`} preserveAspectRatio="none">
        {corners.length > 1 && (
          <polygon points={corners.map((c) => `${c.x},${c.y}`).join(' ')} className="quad" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {corners.map((c, i) => (
        <div
          key={i}
          className="handle"
          style={{ left: `${(c.x / photo.width) * 100}%`, top: `${(c.y / photo.height) * 100}%` }}
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            setDrag(i);
          }}
        >
          {i + 1}
        </div>
      ))}
    </div>
  );
}
