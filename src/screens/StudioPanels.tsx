import { useState } from 'react';
import * as api from '../lib/api';
import { ZONE_COLORS } from '../scene/colors';
import { applyChanges, clampHead } from '../sim/changes';
import { activeZoneAt } from '../sim/playback';
import { catalog, catalogAsOf, useApp } from '../store';
import type { Metrics } from '../sim/types';

export function HeadsPanel() {
  const s = useApp();
  const layout = s.yard!.layout;
  const head = layout.sprinklers.find((h) => h.id === s.selectedId);

  if (s.placing) {
    const item = catalog.find((c) => c.id === s.placing);
    return (
      <div className="stack">
        <p>
          Tap the lawn to place a <b>{item?.name}</b>.
        </p>
        <button className="btn" onClick={() => s.set({ placing: null })}>
          Cancel
        </button>
      </div>
    );
  }

  if (head) {
    const item = catalog.find((c) => c.id === head.catalogId);
    const set = (patch: Partial<typeof head>) => {
      const next = { ...head, ...patch };
      s.updateHead(head.id, clampHead(next, catalog.find((c) => c.id === next.catalogId)));
    };
    return (
      <div className="stack">
        <div className="row between">
          <b>Head {head.id}</b>
          <button className="btn ghost sm" onClick={() => s.set({ selectedId: null })}>
            Done
          </button>
        </div>
        <label className="field">
          Model
          <select value={head.catalogId} onChange={(e) => set({ catalogId: e.target.value })}>
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.brand} {c.model} · {c.type} · {c.radiusMin}–{c.radiusMax} ft
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Zone
          <select value={head.zoneId} onChange={(e) => set({ zoneId: e.target.value })}>
            {layout.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
        {item && (
          <>
            <Slider label={`Throw radius · ${head.radius} ft`} min={item.radiusMin} max={item.radiusMax} step={1} value={head.radius} onChange={(v) => set({ radius: v })} />
            <Slider label={`Arc · ${head.arc}°`} min={Math.max(1, item.arcMin)} max={item.arcMax} step={5} value={head.arc} onChange={(v) => set({ arc: v })} />
            <Slider label={`Aim · ${head.rotation}°`} min={0} max={355} step={5} value={head.rotation} onChange={(v) => set({ rotation: v })} />
            <p className="muted small">
              {item.precipInHr} in/hr · ~${item.priceUsd} ·{' '}
              <a href={item.url} target="_blank" rel="noreferrer">
                View at Home Depot
              </a>
            </p>
          </>
        )}
        <button
          className="btn danger"
          onClick={() => {
            s.setLayout((l) => ({ ...l, sprinklers: l.sprinklers.filter((h) => h.id !== head.id) }));
            s.set({ selectedId: null });
          }}
        >
          Remove head
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="muted small">
        Tap a head to edit it, drag it in Plan view, or add one from the catalog. Prices approximate as of {catalogAsOf}.
      </p>
      <ul className="catalog">
        {catalog.map((c) => (
          <li key={c.id}>
            <div className="grow">
              <b>
                {c.brand} {c.model}
              </b>
              <span className="muted small">
                {c.type} · {c.radiusMin}–{c.radiusMax} ft · {c.precipInHr} in/hr · ~${c.priceUsd}
              </span>
            </div>
            <button className="btn sm" onClick={() => s.set({ placing: c.id, mode: 'edit', selectedId: null })}>
              Add
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ZonesPanel({ metrics }: { metrics: Metrics }) {
  const s = useApp();
  const layout = s.yard!.layout;
  return (
    <div className="stack">
      {layout.zones.map((z, i) => (
        <div key={z.id} className="zone">
          <i className="swatch" style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }} />
          <input
            className="grow"
            value={z.name}
            onChange={(e) => s.setLayout((l) => ({ ...l, zones: l.zones.map((x) => (x.id === z.id ? { ...x, name: e.target.value } : x)) }))}
          />
          <span className="muted small">{layout.sprinklers.filter((h) => h.zoneId === z.id).length} heads</span>
          <Slider
            label={`${z.runMinutes} min`}
            min={0}
            max={60}
            step={1}
            value={z.runMinutes}
            onChange={(v) => s.setLayout((l) => applyChanges(l, [{ op: 'set_zone_minutes', id: z.id, runMinutes: v }], catalog))}
          />
        </div>
      ))}
      <button
        className="btn"
        onClick={() =>
          s.setLayout((l) => {
            const n = l.zones.length + 1;
            return { ...l, zones: [...l.zones, { id: `z${Date.now().toString(36)}`, name: `Zone ${n}`, valve: n, runMinutes: 15 }] };
          })
        }
      >
        + Add zone
      </button>
      <Slider
        label={`Water ${layout.schedule.daysPerWeek} day(s) per week · ${metrics.weeklyInches.toFixed(2)}″/week applied`}
        min={0}
        max={7}
        step={1}
        value={layout.schedule.daysPerWeek}
        onChange={(v) => s.setLayout((l) => applyChanges(l, [{ op: 'set_days_per_week', daysPerWeek: v }], catalog))}
      />
      <p className="muted small">Most lawns need about 1–1.5″ per week in summer, including rain.</p>
    </div>
  );
}

export function SimPanel({ total, forecastDry }: { total: number; forecastDry: number[] | null }) {
  const s = useApp();
  const yard = s.yard!;
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<api.Place[] | null>(null);
  const [locNote, setLocNote] = useState<string | null>(null);
  const search = async () => {
    setLocNote(null);
    const r = await api.geocode(query.trim());
    if (!r.ok) return setLocNote(r.error);
    setPlaces(r.places);
    if (!r.places.length) setLocNote(`No places found for “${query.trim()}”.`);
  };
  const zone = activeZoneAt(yard.layout, s.playT);

  const setLocation = (loc: { lat: number; lon: number }) => {
    useApp.getState().setYard({ ...yard, location: loc });
    s.set({ layer: 'forecast' });
  };

  return (
    <div className="stack">
      <div className="seg wide">
        {(['coverage', 'playback', 'forecast'] as const).map((l) => (
          <button key={l} className={s.layer === l ? 'on' : ''} onClick={() => s.set({ layer: l, playing: false })}>
            {l === 'coverage' ? 'Coverage' : l === 'playback' ? 'Run cycle' : '7-day'}
          </button>
        ))}
      </div>

      {s.layer === 'coverage' && <p className="muted small">Heatmap of how much water each square foot gets while the system runs. Brown = gap, teal/blue = puddling.</p>}

      {s.layer === 'playback' && (
        <>
          <div className="row">
            <button
              className="btn primary"
              disabled={!total}
              onClick={() => s.set({ playing: !s.playing, mode: 'view', playT: s.playT >= total ? 0 : s.playT })}
            >
              {s.playing ? 'Pause' : s.playT >= total && total ? 'Replay' : 'Play cycle'}
            </button>
            <span className="muted small grow">
              {Math.floor(s.playT)} / {total} min {zone ? `· ${yard.layout.zones.find((z) => z.id === zone)?.name} running` : ''}
            </span>
          </div>
          <input type="range" min={0} max={total || 1} step={0.5} value={s.playT} onChange={(e) => s.set({ playT: Number(e.target.value), playing: false })} />
        </>
      )}

      {s.layer === 'forecast' && (
        <>
          {s.weather.status === 'loading' && <p className="muted">Fetching 7-day weather…</p>}
          {s.weather.status === 'error' && (
            <div className="banner error">
              Weather unavailable: {s.weather.error}
              <button className="btn sm" onClick={() => s.set({ weather: { status: 'idle' } })}>
                Retry
              </button>
            </div>
          )}
          {!yard.location && (
            <div className="stack">
              <p className="muted small">Where is this yard? The 7-day forecast uses local weather.</p>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (query.trim()) void search();
                }}
              >
                <input placeholder="City or town, e.g. Seattle" value={query} onChange={(e) => setQuery(e.target.value)} />
                <button className="btn primary" disabled={!query.trim()}>
                  Search
                </button>
              </form>
              {places && places.length > 0 && (
                <div className="stack">
                  {places.map((p) => (
                    <button key={`${p.lat},${p.lon}`} className="btn place" onClick={() => setLocation({ lat: p.lat, lon: p.lon })}>
                      <b>{p.name}</b> <span className="muted small">{p.detail}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                className="btn ghost sm"
                onClick={() =>
                  navigator.geolocation?.getCurrentPosition(
                    (p) => setLocation({ lat: Math.round(p.coords.latitude * 1000) / 1000, lon: Math.round(p.coords.longitude * 1000) / 1000 }),
                    () => setLocNote('The browser blocked location. Allow it from the icon in the address bar, or search for your city above.'),
                  )
                }
              >
                Or use my current location
              </button>
              {locNote && <p className="small warn-text">{locNote}</p>}
            </div>
          )}
          {s.weather.status === 'ready' && forecastDry && (
            <>
              <input type="range" min={0} max={s.weather.data.length} step={1} value={s.day} onChange={(e) => s.set({ day: Number(e.target.value) })} />
              <div className="days">
                {[{ date: 'Today', et0In: 0, rainIn: 0, tMaxF: NaN }, ...s.weather.data].map((d, i) => (
                  <button key={i} className={`day ${i === s.day ? 'on' : ''}`} onClick={() => s.set({ day: i })}>
                    <b>{i === 0 ? 'Now' : new Date(d.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })}</b>
                    {i > 0 && <span>{d.tMaxF}°F</span>}
                    {i > 0 && d.rainIn > 0.01 && <span>☂ {d.rainIn.toFixed(2)}″</span>}
                    <span className={forecastDry[i] > 15 ? 'bad-text' : ''}>{forecastDry[i].toFixed(0)}% dry</span>
                  </button>
                ))}
              </div>
              <p className="muted small">Soil moisture per square foot: sprinklers on watering days + rain − evapotranspiration (Open-Meteo ET₀).</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function AdvisorPanel() {
  const s = useApp();
  const yard = s.yard!;
  const advice = s.advice;

  const ask = async () => {
    s.set({ advice: { status: 'loading' }, preview: null });
    const r = await api.advise({
      features: yard.features,
      health: yard.health,
      layout: yard.layout,
      weather: s.weather.status === 'ready' ? s.weather.data : [],
    });
    s.set({ advice: r.ok ? { status: 'ready', data: r } : { status: 'error', error: r.error } });
  };

  return (
    <div className="stack">
      <p className="muted small">
        Muse Spark studies your yard, weather and the catalog, then <b>tests each idea in the simulator</b>. Only changes the simulation confirms are shown.
      </p>
      <button className="btn primary" disabled={advice.status === 'loading' || !yard.layout.sprinklers.length} onClick={ask}>
        {advice.status === 'loading' ? 'Muse Spark is testing layouts…' : 'Ask Muse Spark for fixes'}
      </button>
      {!yard.layout.sprinklers.length && <p className="muted small">Add at least one head first.</p>}
      {s.weather.status !== 'ready' && <p className="muted small">Tip: load the 7-day weather (Simulate → 7-day) so advice accounts for heat and rain.</p>}
      {advice.status === 'error' && (
        <div className="banner error">
          <b>Advisor unavailable.</b> {advice.error}
        </div>
      )}
      {advice.status === 'ready' && (
        <>
          <p className="muted small">
            {advice.data.model} · {advice.data.simulateCalls} simulation runs · {advice.data.rounds} rounds
            {advice.data.rejected.length > 0 && ` · ${advice.data.rejected.length} idea(s) rejected by the simulator`}
          </p>
          {advice.data.recommendations.length === 0 && <div className="banner warn">No verified improvements found — your layout may already be close to optimal, or try again.</div>}
          {advice.data.recommendations.map((r) => {
            const previewing = s.preview?.recId === r.id;
            return (
              <div key={r.id} className="rec">
                <b>{r.title}</b>
                <p>{r.reason}</p>
                <div className="deltas">
                  <Delta label="Uniformity" a={r.before.du * 100} b={r.after.du * 100} unit="%" higher />
                  <Delta label="Under-watered" a={r.before.underCoveredPct} b={r.after.underCoveredPct} unit="%" />
                  <Delta label="Overspray" a={r.before.oversprayPct} b={r.after.oversprayPct} unit="%" />
                  {r.before.dryCellsDay7 !== undefined && <Delta label="Dry by day 7" a={r.before.dryCellsDay7} b={r.after.dryCellsDay7 ?? 0} unit="%" />}
                </div>
                <div className="row">
                  <button
                    className="btn"
                    onClick={() => s.set({ preview: previewing && s.preview?.side === 'after' ? { recId: r.id, side: 'before' } : { recId: r.id, side: 'after' } })}
                  >
                    {previewing ? (s.preview?.side === 'after' ? 'Show before' : 'Show after') : 'Preview'}
                  </button>
                  {previewing && (
                    <button className="btn ghost" onClick={() => s.set({ preview: null })}>
                      Exit preview
                    </button>
                  )}
                  <button
                    className="btn primary grow"
                    onClick={() => {
                      s.setLayout((l) => applyChanges(l, r.changes, catalog));
                      s.set({ preview: null, advice: { status: 'idle' } });
                    }}
                  >
                    Apply
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function Delta({ label, a, b, unit, higher }: { label: string; a: number; b: number; unit: string; higher?: boolean }) {
  const better = higher ? b > a + 0.05 : b < a - 0.05;
  const worse = higher ? b < a - 0.05 : b > a + 0.05;
  return (
    <span className={`delta ${better ? 'good' : ''} ${worse ? 'bad' : ''}`}>
      {label} {a.toFixed(0)}
      {unit} → <b>{b.toFixed(0)}{unit}</b>
    </span>
  );
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
