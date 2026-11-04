import { useMemo, useRef, useState } from 'react';
import { tileToYard } from '../sim/geometry';
import { useApp } from '../store';
import type { Tile } from '../sim/types';

const SNAP_FT = 1.5;

function tileCorners(t: Tile) {
  return [
    { x: 0, y: 0 },
    { x: t.widthFt, y: 0 },
    { x: t.widthFt, y: t.heightFt },
    { x: 0, y: t.heightFt },
  ].map((p) => tileToYard(p, t));
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };
function box(t: Tile): Box {
  const c = tileCorners(t);
  return { minX: Math.min(...c.map((p) => p.x)), minY: Math.min(...c.map((p) => p.y)), maxX: Math.max(...c.map((p) => p.x)), maxY: Math.max(...c.map((p) => p.y)) };
}

type Side = 'left' | 'behind' | 'right' | 'front';
const SIDES: { side: Side; icon: string; label: string }[] = [
  { side: 'left', icon: '←', label: 'left of' },
  { side: 'behind', icon: '↑', label: 'behind' },
  { side: 'right', icon: '→', label: 'right of' },
  { side: 'front', icon: '↓', label: 'in front of' },
];

/** Move tile `t` so its bounding box sits flush against `target` on `side`, edges aligned. */
function attach(t: Tile, target: Tile, side: Side): Tile {
  const a = box(t);
  const b = box(target);
  const tx = side === 'left' ? b.minX - a.maxX : side === 'right' ? b.maxX - a.minX : b.minX - a.minX;
  const ty = side === 'behind' ? b.minY - a.maxY : side === 'front' ? b.maxY - a.minY : b.minY - a.minY;
  return { ...t, x: t.x + tx, y: t.y + ty };
}

/** Rotate a tile about its visual centre (tiles rotate about their top-left origin otherwise). */
function rotateAboutCentre(t: Tile, rotation: number): Tile {
  const a = box(t);
  const r = { ...t, rotation };
  const b = box(r);
  return { ...r, x: t.x + (a.minX + a.maxX - b.minX - b.maxX) / 2, y: t.y + (a.minY + a.maxY - b.minY - b.maxY) / 2 };
}

/** Scale a section about its centre (fixes a photo whose size guess was off). */
function scaleAboutCentre(t: Tile, k: number): Tile {
  const a = box(t);
  const r = { ...t, widthFt: t.widthFt * k, heightFt: t.heightFt * k, pxPerFt: t.pxPerFt / k };
  const b = box(r);
  return { ...r, x: t.x + (a.minX + a.maxX - b.minX - b.maxX) / 2, y: t.y + (a.minY + a.maxY - b.minY - b.maxY) / 2 };
}

export function Assemble() {
  const { draftTiles, setDraftTiles, go } = useApp();
  const [sel, setSel] = useState<string | null>(draftTiles[draftTiles.length - 1]?.id ?? null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; tx: number; ty: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Freeze the view box while dragging so tiles don't chase the pointer.
  const [frozen, setFrozen] = useState<string | null>(null);
  const live = useMemo(() => {
    const pts = draftTiles.flatMap(tileCorners);
    if (!pts.length) return '0 0 100 100';
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    // Pad in proportion to the yard so small sections still fill the board.
    const pad = Math.max(3, 0.15 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const maxX = Math.max(...xs) + pad;
    const maxY = Math.max(...ys) + pad;
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  }, [draftTiles]);
  const viewBox = frozen ?? live;

  const update = (id: string, patch: Partial<Tile>) => setDraftTiles(draftTiles.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const toFt = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  const snap = (t: Tile, x: number, y: number) => {
    // Snap this tile's (rotated) bounding box to other tiles' bounding boxes.
    const a = box({ ...t, x, y });
    let dx = 0;
    let dy = 0;
    let bestX = SNAP_FT;
    let bestY = SNAP_FT;
    for (const o of draftTiles) {
      if (o.id === t.id) continue;
      const b = box(o);
      for (const ae of [a.minX, a.maxX])
        for (const be of [b.minX, b.maxX])
          if (Math.abs(be - ae) < bestX) {
            bestX = Math.abs(be - ae);
            dx = be - ae;
          }
      for (const ae of [a.minY, a.maxY])
        for (const be of [b.minY, b.maxY])
          if (Math.abs(be - ae) < bestY) {
            bestY = Math.abs(be - ae);
            dy = be - ae;
          }
    }
    return { x: x + dx, y: y + dy };
  };

  const selected = draftTiles.find((t) => t.id === sel);
  const selIndex = draftTiles.findIndex((t) => t.id === sel);
  const others = draftTiles.filter((t) => t.id !== sel);
  // Default neighbour: the section scanned just before this one.
  const target = others.find((t) => t.id === targetId) ?? draftTiles[selIndex - 1] ?? others[0];
  const num = (t: Tile) => draftTiles.indexOf(t) + 1;
  const replace = (t: Tile) => setDraftTiles(draftTiles.map((x) => (x.id === t.id ? t : x)));

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn ghost sm" onClick={() => go('scan')}>
          ‹ Scan
        </button>
        <div className="title">Assemble your yard</div>
        <button className="btn sm primary" disabled={!draftTiles.length} onClick={() => go('build')}>
          Build ›
        </button>
      </header>
      <p className="hint pad">Tap a section, then use the arrows to put it next to another one. Drag to fine-tune — edges snap together, overlap is fine. If a section's size looks off next to the others, use Bigger / Smaller.</p>
      <div className="assemble">
        <svg
          ref={svgRef}
          viewBox={viewBox}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const p = toFt(e);
            const t = draftTiles.find((x) => x.id === d.id)!;
            update(d.id, snap(t, d.tx + p.x - d.sx, d.ty + p.y - d.sy));
          }}
          onPointerUp={() => {
            drag.current = null;
            setFrozen(null);
          }}
          onPointerLeave={() => {
            drag.current = null;
            setFrozen(null);
          }}
        >
          {draftTiles.map((t) => (
            <g
              key={t.id}
              transform={`translate(${t.x} ${t.y}) rotate(${t.rotation})`}
              onPointerDown={(e) => {
                setSel(t.id);
                setFrozen(viewBox);
                const p = toFt(e);
                drag.current = { id: t.id, sx: p.x, sy: p.y, tx: t.x, ty: t.y };
              }}
              style={{ cursor: 'grab' }}
            >
              <image href={t.imageDataUrl} width={t.widthFt} height={t.heightFt} preserveAspectRatio="none" opacity={0.92} />
              <rect width={t.widthFt} height={t.heightFt} className={t.id === sel ? 'tile-outline sel' : 'tile-outline'} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {draftTiles.map((t, i) => {
            const b = box(t);
            const r = Math.max(1.5, Math.min(b.maxX - b.minX, b.maxY - b.minY) / 10);
            return (
              <g key={`n-${t.id}`} pointerEvents="none" transform={`translate(${(b.minX + b.maxX) / 2} ${(b.minY + b.maxY) / 2})`}>
                <circle r={r} className={t.id === sel ? 'tile-num sel' : 'tile-num'} />
                <text fontSize={r * 1.2} textAnchor="middle" dominantBaseline="central" className="tile-num-text">
                  {i + 1}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {selected && (
        <div className="pad stack">
          {target && (
            <div className="card stack">
              <div className="row">
                <span className="small muted">Put section {num(selected)}</span>
                {others.length > 1 && (
                  <select className="mini-select" value={target.id} onChange={(e) => setTargetId(e.target.value)}>
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        next to section {num(o)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="attach">
                {SIDES.map(({ side, icon, label }) => (
                  <button key={side} className="btn sm" onClick={() => replace(attach(selected, target, side))}>
                    <b>{icon}</b> {label} {num(target)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="field">
            Turn section {num(selected)} · {selected.rotation}°
            <input
              type="range"
              min={-180}
              max={180}
              step={5}
              value={selected.rotation}
              onChange={(e) => replace(rotateAboutCentre(selected, Number(e.target.value)))}
            />
          </label>
          <div className="row">
            <span className="small muted grow">
              Size of section {num(selected)} · {Math.round(selected.widthFt)} × {Math.round(selected.heightFt)} ft
            </span>
            <button className="btn sm" onClick={() => replace(scaleAboutCentre(selected, 1 / 1.1))}>
              − Smaller
            </button>
            <button className="btn sm" onClick={() => replace(scaleAboutCentre(selected, 1.1))}>
              + Bigger
            </button>
          </div>
          <div className="row">
            <button className="btn" onClick={() => replace(rotateAboutCentre(selected, ((selected.rotation - 90 + 540) % 360) - 180))}>
              ⟲ 90°
            </button>
            <button className="btn" onClick={() => replace(rotateAboutCentre(selected, ((selected.rotation + 90 + 540) % 360) - 180))}>
              ⟳ 90°
            </button>
            <button
              className="btn danger"
              onClick={() => {
                setDraftTiles(draftTiles.filter((t) => t.id !== selected.id));
                setSel(null);
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
