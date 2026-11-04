import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import { cellColors, type ColorMode } from '../scene/colors';
import { YardScene } from '../scene/YardScene';
import { applyChanges, clampHead } from '../sim/changes';
import { coverage, metrics as computeMetrics, zoneRates } from '../sim/coverage';
import { forecast } from '../sim/forecast';
import { buildGrid } from '../sim/grid';
import { activeZoneAt, appliedAt, timelineMinutes } from '../sim/playback';
import { catalog, useApp } from '../store';
import type { Layout, Metrics } from '../sim/types';
import { AdvisorPanel, HeadsPanel, SimPanel, ZonesPanel } from './StudioPanels';

type Tab = 'heads' | 'zones' | 'sim' | 'advisor';
const PLAY_MIN_PER_SEC = 2;

export default function Studio() {
  const s = useApp();
  const yard = s.yard!;
  const [tab, setTab] = useState<Tab>('heads');

  // Layout shown in the scene: real layout, or a recommendation preview.
  const rec = s.preview && s.advice.status === 'ready' ? s.advice.data.recommendations.find((r) => r.id === s.preview!.recId) : undefined;
  const shownLayout: Layout = useMemo(
    () => (rec && s.preview?.side === 'after' ? applyChanges(yard.layout, rec.changes, catalog) : yard.layout),
    [rec, s.preview?.side, yard.layout],
  );

  const grid = useMemo(() => buildGrid(yard.features), [yard.features]);
  const rate = useMemo(() => coverage(grid, shownLayout.sprinklers, catalog), [grid, shownLayout.sprinklers]);
  const metrics: Metrics = useMemo(() => computeMetrics(grid, rate, shownLayout, shownLayout.sprinklers, catalog), [grid, rate, shownLayout]);
  const rates = useMemo(() => zoneRates(grid, shownLayout, catalog), [grid, shownLayout]);
  const weatherDays = s.weather.status === 'ready' ? s.weather.data : null;
  const fc = useMemo(() => (weatherDays ? forecast(grid, shownLayout, catalog, weatherDays, yard.health) : null), [grid, shownLayout, weatherDays, yard.health]);
  const total = timelineMinutes(shownLayout);

  const colorMode: ColorMode = useMemo(() => {
    if (s.layer === 'playback') return { kind: 'applied', values: appliedAt(grid, shownLayout, catalog, s.playT, rates) };
    if (s.layer === 'forecast' && fc) return { kind: 'moisture', values: fc.days[Math.min(s.day, fc.days.length - 1)] };
    return { kind: 'coverage', values: rate, mean: metrics.meanRateInHr };
  }, [s.layer, s.playT, s.day, grid, shownLayout, rates, fc, rate, metrics.meanRateInHr]);
  const colors = useMemo(() => cellColors(grid, colorMode), [grid, colorMode]);

  // Weather: fetch once a location is known. Failure is shown, never faked.
  useEffect(() => {
    if (!yard.location || s.weather.status !== 'idle') return;
    s.set({ weather: { status: 'loading' } });
    void api.weather(yard.location.lat, yard.location.lon).then((r) =>
      s.set({ weather: r.ok ? { status: 'ready', data: r.days } : { status: 'error', error: r.error } }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yard.location, s.weather.status]);

  // Playback clock.
  useEffect(() => {
    if (!s.playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const t = Math.min(total, useApp.getState().playT + ((now - last) / 1000) * PLAY_MIN_PER_SEC);
      last = now;
      s.set({ playT: t, playing: t < total });
      if (t < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.playing, total]);

  const activeZoneId = s.layer === 'playback' && s.playing ? activeZoneAt(shownLayout, s.playT) : null;

  const exportYard = () => {
    const blob = new Blob([JSON.stringify(yard)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${yard.name.replace(/\W+/g, '-').toLowerCase()}.lawnlens.json`;
    a.click();
  };

  return (
    <div className="studio">
      <header className="topbar overlay">
        <button className="btn ghost sm" onClick={() => s.go('home')}>
          ‹
        </button>
        <div className="title">
          {yard.name}
          {yard.isSample && <span className="badge">sample</span>}
        </div>
        <div className="seg">
          <button className={s.mode === 'edit' ? 'on' : ''} onClick={() => s.set({ mode: 'edit' })}>
            Plan
          </button>
          <button className={s.mode === 'view' ? 'on' : ''} onClick={() => s.set({ mode: 'view', placing: null })}>
            3D
          </button>
        </div>
        <button className="btn ghost sm" title="Export yard file" onClick={exportYard}>
          ⤓
        </button>
      </header>

      {yard.sampleNote && <div className="sample-note">{yard.sampleNote}</div>}

      <div className="canvas-wrap">
        <YardScene
          grid={grid}
          colors={colors}
          features={yard.features}
          layout={shownLayout}
          catalog={catalog}
          mode={s.mode}
          selectedId={s.selectedId}
          activeZoneId={activeZoneId}
          placing={!!s.placing}
          onSelect={(id) => {
            s.set({ selectedId: id });
            if (id) setTab('heads');
          }}
          onMoveHead={(id, x, y) => !s.preview && s.updateHead(id, { x, y })}
          onPlace={(x, y) => {
            const placing = useApp.getState().placing;
            const item = catalog.find((c) => c.id === placing);
            if (!item) return s.set({ selectedId: null });
            const id = `h${Date.now().toString(36)}`;
            const zoneId = yard.layout.zones[0]?.id ?? 'z1';
            s.setLayout((l) => ({
              ...l,
              zones: l.zones.length ? l.zones : [{ id: 'z1', name: 'Zone 1', valve: 1, runMinutes: 20 }],
              sprinklers: [
                ...l.sprinklers,
                clampHead({ id, zoneId, catalogId: item.id, x, y, radius: Math.round(item.radiusMax * 0.85), arc: 360, rotation: 0 }, item),
              ],
            }));
            s.set({ placing: null, selectedId: id });
          }}
        />
        <div className="metrics">
          <Metric label="Uniformity" value={`${Math.round(metrics.du * 100)}%`} good={metrics.du >= 0.7} bad={metrics.du < 0.5} />
          <Metric label="Under-watered" value={`${metrics.underCoveredPct.toFixed(0)}%`} good={metrics.underCoveredPct < 10} bad={metrics.underCoveredPct > 25} />
          <Metric label="Overspray" value={`${metrics.oversprayPct.toFixed(0)}%`} good={metrics.oversprayPct < 15} bad={metrics.oversprayPct > 30} />
          <Metric label="Per week" value={`${metrics.weeklyInches.toFixed(2)}″`} />
          {fc && <Metric label={`Dry day ${s.layer === 'forecast' ? s.day : 7}`} value={`${fc.dryPct[s.layer === 'forecast' ? s.day : fc.dryPct.length - 1].toFixed(0)}%`} bad={fc.dryPct[fc.dryPct.length - 1] > 15} />}
        </div>
        {s.preview && rec && (
          <div className="preview-pill">
            Previewing: <b>{s.preview.side === 'after' ? 'after' : 'before'}</b> · {rec.title}
          </div>
        )}
        {s.placing && <div className="preview-pill">Tap the lawn to place the head</div>}
        <Legend layer={s.layer} />
      </div>

      <div className="sheet">
        <nav className="tabs">
          {(['heads', 'zones', 'sim', 'advisor'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'heads' ? 'Heads' : t === 'zones' ? 'Zones' : t === 'sim' ? 'Simulate' : 'Muse advisor'}
            </button>
          ))}
        </nav>
        <div className="sheet-body">
          {tab === 'heads' && <HeadsPanel />}
          {tab === 'zones' && <ZonesPanel metrics={metrics} />}
          {tab === 'sim' && <SimPanel total={total} forecastDry={fc?.dryPct ?? null} />}
          {tab === 'advisor' && <AdvisorPanel />}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <div className={`metric ${good ? 'good' : ''} ${bad ? 'bad' : ''}`}>
      <span className="v">{value}</span>
      <span className="l">{label}</span>
    </div>
  );
}

function Legend({ layer }: { layer: string }) {
  const items =
    layer === 'forecast'
      ? [['#8a6237', 'dry'], ['#c8a64a', 'stressed'], ['#43a047', 'healthy']]
      : layer === 'playback'
        ? [['#86c86a', 'dry'], ['#2f7f74', 'soaking'], ['#22607f', 'wet']]
        : [['#9b6b35', 'gap'], ['#c9a443', 'thin'], ['#4caf50', 'on target'], ['#1d5f8a', 'heavy']];
  return (
    <div className="legend">
      {items.map(([c, l]) => (
        <span key={l}>
          <i style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );
}
