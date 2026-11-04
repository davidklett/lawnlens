import { useEffect, useRef, useState } from 'react';
import { syntheticDemoYard } from '../data/sampleYard';
import { load } from '../lib/storage';
import { useApp } from '../store';
import type { Yard } from '../sim/types';

function isYard(v: unknown): v is Yard {
  const y = v as Yard;
  return !!y && Array.isArray(y.features) && !!y.layout && Array.isArray(y.layout.sprinklers);
}

export function Home() {
  const { setYard, go, setDraftTiles } = useApp();
  const [saved, setSaved] = useState<Yard | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load<Yard>('currentYard').then((y) => isYard(y) && setSaved(y));
  }, []);

  const open = (y: Yard) => {
    setYard(y);
    go('studio');
  };

  const openSample = async () => {
    // Prefer the owner's real pre-scanned yard if it has been exported to public/sample-yard.json.
    try {
      const res = await fetch('/sample-yard.json');
      if (res.ok) {
        const y = await res.json();
        if (isYard(y)) return open({ ...y, isSample: true, name: y.name.includes('pre-scanned') ? y.name : `${y.name} (pre-scanned)` });
      }
    } catch {
      /* fall through to synthetic */
    }
    open(syntheticDemoYard());
  };

  const importFile = async (f: File) => {
    try {
      const y = JSON.parse(await f.text());
      if (!isYard(y)) throw new Error('not a LawnLens yard file');
      open(y);
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="home">
      <div className="hero">
        <div className="logo">
          <span className="logo-mark">◆</span> LawnLens
        </div>
        <h1>See how your yard waters — before you dig.</h1>
        <p className="muted">Scan your lawn, drop in real sprinkler heads, and let Meta Muse Spark test fixes in a live simulation.</p>
      </div>
      <div className="stack">
        <button
          className="btn primary big"
          onClick={() => {
            setDraftTiles([]);
            go('scan');
          }}
        >
          Scan my yard
        </button>
        {saved && (
          <button className="btn big" onClick={() => open(saved)}>
            Continue: {saved.name}
          </button>
        )}
        <button className="btn big" onClick={openSample}>
          Open sample yard
        </button>
        <button className="btn ghost" onClick={() => fileRef.current?.click()}>
          Import yard file…
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        {msg && <div className="banner error">{msg}</div>}
      </div>
      <p className="fineprint muted">Models: SAM 3.1 + Muse Spark via the Meta Model API. Weather: Open-Meteo.</p>
    </div>
  );
}
