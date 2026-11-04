import { create } from 'zustand';
import catalogData from './data/catalog.json';
import { save } from './lib/storage';
import type { AdviseResponse } from './lib/api';
import type { CatalogItem, Layout, Sprinkler, Tile, WeatherDay, Yard } from './sim/types';

export const catalog = catalogData.items as CatalogItem[];
export const catalogAsOf = catalogData.asOf;

export type Screen = 'home' | 'scan' | 'assemble' | 'build' | 'studio';
export type Mode = 'edit' | 'view';
export type Layer = 'coverage' | 'playback' | 'forecast';
export type Async<T> = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T };

interface State {
  screen: Screen;
  yard: Yard | null;
  draftTiles: Tile[]; // scan → assemble working set
  mode: Mode;
  layer: Layer;
  selectedId: string | null;
  placing: string | null; // catalog id being placed
  playT: number; // minutes into the cycle
  playing: boolean;
  day: number; // forecast day 0..7
  weather: Async<WeatherDay[]>;
  advice: Async<AdviseResponse>;
  preview: { recId: string; side: 'before' | 'after' } | null;

  go: (s: Screen) => void;
  setYard: (y: Yard | null) => void;
  setDraftTiles: (t: Tile[]) => void;
  setLayout: (fn: (l: Layout) => Layout) => void;
  updateHead: (id: string, patch: Partial<Sprinkler>) => void;
  set: (p: Partial<State>) => void;
}

const persist = (y: Yard | null) => {
  if (y) void save('currentYard', y);
};

export const useApp = create<State>((setState, get) => ({
  screen: 'home',
  yard: null,
  draftTiles: [],
  mode: 'edit',
  layer: 'coverage',
  selectedId: null,
  placing: null,
  playT: 0,
  playing: false,
  day: 0,
  weather: { status: 'idle' },
  advice: { status: 'idle' },
  preview: null,

  go: (screen) => setState({ screen }),
  setYard: (yard) => {
    setState({ yard, selectedId: null, placing: null, advice: { status: 'idle' }, preview: null, weather: { status: 'idle' }, day: 0, playT: 0, playing: false });
    persist(yard);
  },
  setDraftTiles: (draftTiles) => setState({ draftTiles }),
  setLayout: (fn) => {
    const y = get().yard;
    if (!y) return;
    const yard = { ...y, layout: fn(y.layout) };
    setState({ yard });
    persist(yard);
  },
  updateHead: (id, patch) =>
    get().setLayout((l) => ({ ...l, sprinklers: l.sprinklers.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
  set: (p) => setState(p),
}));
