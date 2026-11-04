import { useEffect, useRef, useState } from 'react';
import * as api from '../lib/api';
import { polygonArea, tileToYard } from '../sim/geometry';
import { useApp } from '../store';
import type { Feature, FeatureKind, HealthObservation, Tile, Yard } from '../sim/types';

const KINDS: FeatureKind[] = ['lawn', 'tree', 'shrub', 'bed', 'hardscape'];
type StepState = { label: string; status: 'pending' | 'running' | 'done' | 'error'; detail?: string };

async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, async () => {
      while (i < tasks.length) {
        const k = i++;
        out[k] = await tasks[k]();
      }
    }),
  );
  return out;
}

function getLocation(): Promise<{ lat: number; lon: number } | undefined> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Math.round(p.coords.latitude * 1000) / 1000, lon: Math.round(p.coords.longitude * 1000) / 1000 }),
      () => resolve(undefined),
      { timeout: 8000, maximumAge: 3600_000 },
    );
  });
}

export function Build() {
  const { draftTiles, go, setYard } = useApp();
  const [steps, setSteps] = useState<StepState[]>([]);
  const [result, setResult] = useState<{ yard: Yard; lawnSqft: number; errors: number; healthSummary: string[]; notConfigured?: string } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    const jobs: { tile: Tile; kind: FeatureKind | 'health'; label: string }[] = [];
    draftTiles.forEach((tile, ti) => {
      for (const kind of KINDS) jobs.push({ tile, kind, label: `Section ${ti + 1} · SAM 3.1 · ${kind}` });
      jobs.push({ tile, kind: 'health', label: `Section ${ti + 1} · Muse Spark · grass health` });
    });
    setSteps(jobs.map((j) => ({ label: j.label, status: 'pending' })));
    const setStep = (i: number, s: Partial<StepState>) => setSteps((prev) => prev.map((p, k) => (k === i ? { ...p, ...s } : p)));

    const features: Feature[] = [];
    const health: HealthObservation[] = [];
    const summaries: string[] = [];
    let errors = 0;
    // A missing server key fails every call identically — stop after the first one instead of listing 6 × N errors.
    let notConfigured: string | undefined;
    const fail = (i: number, error: string) => {
      errors++;
      if (error.includes('MODEL_API_KEY')) notConfigured = error;
      setStep(i, { status: 'error', detail: error });
    };
    const locationP = getLocation();

    await pool(
      jobs.map((job, i) => async () => {
        if (notConfigured) return setStep(i, { status: 'pending', detail: 'skipped' });
        setStep(i, { status: 'running' });
        const t = job.tile;
        const toYard = (p: { x: number; y: number }) => tileToYard({ x: p.x / t.pxPerFt, y: p.y / t.pxPerFt }, t);
        if (job.kind === 'health') {
          const r = await api.health(t.imageDataUrl);
          if (!r.ok) return fail(i, r.error);
          summaries.push(r.summary);
          const cw = t.widthFt / r.grid;
          const ch = t.heightFt / r.grid;
          for (const c of r.cells) {
            const poly = [
              { x: c.col * cw, y: c.row * ch },
              { x: (c.col + 1) * cw, y: c.row * ch },
              { x: (c.col + 1) * cw, y: (c.row + 1) * ch },
              { x: c.col * cw, y: (c.row + 1) * ch },
            ].map((p) => tileToYard(p, t));
            health.push({ id: `hl-${t.id}-${c.row}-${c.col}`, polygon: poly, status: c.status, score: c.score, timestamp: new Date().toISOString(), source: 'muse-vision' });
          }
          return setStep(i, { status: 'done', detail: `${r.cells.filter((c) => c.status !== 'healthy').length} stressed/dry cells` });
        }
        const r = await api.segment(t.imageDataUrl, job.kind);
        if (!r.ok) return fail(i, r.error);
        let n = 0;
        r.objects.forEach((o, oi) =>
          o.polygons.forEach((poly, pi) => {
            const yardPoly = poly.map(toYard);
            if (polygonArea(yardPoly) < 2) return;
            n++;
            features.push({ id: `${job.kind}-${t.id}-${oi}-${pi}`, kind: job.kind as FeatureKind, polygon: yardPoly, source: 'sam' });
          }),
        );
        setStep(i, { status: 'done', detail: n ? `${n} found` : 'none found' });
      }),
      3,
    );

    const location = await locationP;
    const lawnSqft = features.filter((f) => f.kind === 'lawn').reduce((s, f) => s + polygonArea(f.polygon), 0);
    const yard: Yard = {
      id: `yard-${Date.now().toString(36)}`,
      name: 'My yard',
      isSample: false,
      location,
      tiles: draftTiles,
      features,
      health,
      layout: { zones: [{ id: 'z1', name: 'Zone 1', valve: 1, runMinutes: 20 }], schedule: { daysPerWeek: 3 }, sprinklers: [] },
      createdAt: new Date().toISOString(),
    };
    setResult({ yard, lawnSqft, errors, healthSummary: summaries, notConfigured });
  }

  const allFailed = result && (!!result.notConfigured || result.errors === steps.length);

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn ghost sm" onClick={() => go(draftTiles.length === 1 ? 'scan' : 'assemble')}>
          ‹ {draftTiles.length === 1 ? 'Scan' : 'Assemble'}
        </button>
        <div className="title">Building your yard</div>
        <span />
      </header>
      {!result?.notConfigured && (
      <ul className="steps pad">
        {steps.map((s, i) => (
          <li key={i} className={`step ${s.status}`}>
            <span className="dot" />
            <span className="grow">{s.label}</span>
            <span className="detail">{s.status === 'running' ? '…' : s.detail}</span>
          </li>
        ))}
      </ul>
      )}
      {result && (
        <div className="pad stack">
          {result.notConfigured ? (
            <div className="banner error">
              <b>Meta Model API key not set.</b>
              <span>
                SAM 3.1 and Muse Spark can't run, so nothing was segmented — no fake data was filled in. Add <code>MODEL_API_KEY</code> to{' '}
                <code>.env.local</code>, restart <code>npm run dev</code>, then Retry. Your scanned sections are kept.
              </span>
            </div>
          ) : allFailed ? (
            <div className="banner error">
              <b>Meta Model API unavailable.</b> No segmentation or health data was produced — nothing has been filled in with fake data.
              <br />
              {steps[0]?.detail}
            </div>
          ) : result.errors > 0 ? (
            <div className="banner warn">{result.errors} step(s) failed — the scene below is partial.</div>
          ) : null}
          {!allFailed && (
            <div className="card">
              <b>{Math.round(result.lawnSqft).toLocaleString()} ft²</b> of lawn found · {result.yard.features.length} features
              {result.healthSummary.length > 0 && <p className="muted">{result.healthSummary.join(' ')}</p>}
              {result.lawnSqft === 0 && <p className="warn-text">SAM found no lawn. Try re-scanning with more grass in frame.</p>}
              {!result.yard.location && <p className="muted">Location unavailable — set it in Simulate to get weather.</p>}
            </div>
          )}
          <div className="row">
            <button className="btn" onClick={() => { setResult(null); started.current = false; void run(); }}>
              Retry
            </button>
            <button
              className="btn primary grow"
              onClick={() => {
                setYard(result.yard);
                go('studio');
              }}
            >
              {allFailed ? 'Open anyway (empty)' : 'Open studio ›'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
