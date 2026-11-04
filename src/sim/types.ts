// Shared domain types. All yard coordinates are in feet.

export type Vec2 = { x: number; y: number };
export type Polygon = Vec2[];

export type FeatureKind = 'lawn' | 'tree' | 'shrub' | 'bed' | 'hardscape';

export interface Feature {
  id: string;
  kind: FeatureKind;
  polygon: Polygon;
  source: 'sam' | 'manual';
}

export type HeadType = 'spray' | 'rotor' | 'rotator' | 'impact';

export interface CatalogItem {
  id: string;
  brand: string;
  model: string;
  name: string;
  type: HeadType;
  radiusMin: number; // ft
  radiusMax: number; // ft
  arcMin: number; // deg
  arcMax: number; // deg
  precipInHr: number; // nominal precipitation rate over the wetted area
  popUpIn: number;
  priceUsd: number; // approximate snapshot
  url: string;
}

export interface Sprinkler {
  id: string;
  zoneId: string;
  catalogId: string;
  x: number;
  y: number;
  radius: number; // ft
  arc: number; // deg, 1..360
  rotation: number; // deg, direction of the arc's centre line (0 = +x, CCW)
}

export interface Zone {
  id: string;
  name: string;
  valve: number;
  runMinutes: number;
}

export interface Schedule {
  daysPerWeek: number; // 0..7, spread evenly over the week
}

export interface Layout {
  sprinklers: Sprinkler[];
  zones: Zone[];
  schedule: Schedule;
}

export type HealthStatus = 'healthy' | 'stressed' | 'dry';

export interface HealthObservation {
  id: string;
  polygon: Polygon;
  status: HealthStatus;
  score: number; // 0..1, 1 = healthiest
  timestamp: string;
  source: 'muse-vision' | 'manual';
}

export interface WeatherDay {
  date: string;
  et0In: number; // reference evapotranspiration, inches
  rainIn: number;
  tMaxF: number;
}

export interface Tile {
  id: string;
  imageDataUrl: string; // rectified top-down image
  widthFt: number;
  heightFt: number;
  pxPerFt: number;
  x: number; // yard position of tile's top-left corner (ft)
  y: number;
  rotation: number; // deg
}

export interface Yard {
  id: string;
  name: string;
  isSample: boolean;
  sampleNote?: string;
  location?: { lat: number; lon: number };
  tiles: Tile[];
  features: Feature[];
  health: HealthObservation[];
  layout: Layout;
  createdAt: string;
}

export type LayoutChange =
  | { op: 'move_head'; id: string; x: number; y: number }
  | { op: 'set_head'; id: string; radius?: number; arc?: number; rotation?: number; catalogId?: string; zoneId?: string }
  | { op: 'add_head'; catalogId: string; x: number; y: number; radius: number; arc: number; rotation: number; zoneId: string }
  | { op: 'remove_head'; id: string }
  | { op: 'set_zone_minutes'; id: string; runMinutes: number }
  | { op: 'set_days_per_week'; daysPerWeek: number };

export interface Metrics {
  du: number; // lower-quarter distribution uniformity, 0..1
  meanRateInHr: number;
  underCoveredPct: number; // % lawn cells below 50% of lawn mean rate (or dry)
  oversprayPct: number; // % of applied water landing off-lawn
  weeklyInches: number; // mean applied depth per week on lawn
  dryCellsDay7?: number; // % lawn cells dry at end of forecast
}

export interface Recommendation {
  id: string;
  title: string;
  reason: string;
  changes: LayoutChange[];
  before: Metrics;
  after: Metrics;
}
