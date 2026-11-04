# LawnLens v1 Implementation Plan

**Goal:** A testable demo of the design's spine: scan → rectify → align → SAM 3.1 scene → place catalog heads in top-down edit mode with live coverage → Muse Spark advisor with sim-verified recommendations; plus run playback and a 7-day forecast.

**Architecture:** Single Vite + React + TS app at repo root. Pure-TS sim engine in `src/sim/` (Vitest-tested) shared by the client and `api/advise.ts`. Vercel-style Web handlers in `api/*.ts` (`export async function POST(req: Request): Promise<Response>`), mounted in local dev by a small Vite middleware plugin so `npm run dev` works without the Vercel CLI. Browser state in a zustand store persisted to IndexedDB.

**Tech stack:** Vite, React 18, TypeScript, three, @react-three/fiber, @react-three/drei, zustand, @meta-sam/parser (Meta's SAM output parser), @vitejs/plugin-basic-ssl (dev HTTPS for phone camera), Vitest.

**Spec:** `docs/design.md`

## Global constraints

- Runtime models: `sam-3.1` and `muse-spark-1.3` via `https://api.meta.ai/v1` only. Key from `MODEL_API_KEY` server-side; never in client code.
- Weather: Open-Meteo (no key). Not a model.
- Any failed API call → visible degraded/error state in UI. Never substitute sample data silently.
- Yard units: feet. Grid cell: 1 ft.
- No commits/deploys without owner's explicit request (AGENTS.md).

## Review focus

1. No `MODEL_API_KEY` set → every model step shows a clear "Meta API unavailable" state; editor/sim still usable.
2. SAM returns zero lawn matches → build step reports it; user can still continue with empty scene (manual lawn not in v1 — report clearly).
3. Degenerate corner taps (collinear / self-crossing quad) → rectify refuses with message, no NaN tiles.
4. Advisor returns a change that makes metrics worse or references an unknown head → server drops it.
5. Head dragged outside lawn / radius beyond catalog range → clamped to catalog range; coverage still computes.

## Files

- `src/sim/types.ts` — Yard, Tile, Feature, Zone, Sprinkler, HealthObservation, Recommendation, WeatherDay, LayoutChange.
- `src/sim/geometry.ts` — pointInPolygon, polygonArea, bounds, homography solve/apply.
- `src/sim/grid.ts` — `buildGrid(features, cellFt=1): Grid` (cell kind: lawn/hardscape/other).
- `src/sim/coverage.ts` — `coverage(grid, sprinklers, catalog): Float32Array` (in/hr), `metrics(grid, rate)`.
- `src/sim/playback.ts` — `appliedAt(grid, layout, catalog, tMin): Float32Array` (inches).
- `src/sim/forecast.ts` — `forecast(grid, layout, catalog, weather, health): ForecastResult`.
- `src/sim/changes.ts` — `applyChanges(layout, changes): Layout`, `evaluate(...)`.
- `src/sim/*.test.ts` — Vitest.
- `src/data/catalog.json` — curated products.
- `src/data/sampleYard.ts` — labelled synthetic demo yard (replaced by owner's real scan).
- `src/lib/rectify.ts` — canvas warp via homography.
- `src/lib/api.ts` — client fetch wrappers with typed degraded results.
- `src/lib/storage.ts` — IndexedDB persistence.
- `src/store.ts` — zustand app store.
- `src/screens/*` — Home, Scan, Assemble, Build, Studio (scene + panels).
- `src/scene/*` — r3f scene pieces.
- `api/_meta.ts` — Meta API client (responses, SAM parse, mask→polygon).
- `api/segment.ts`, `api/health.ts`, `api/advise.ts`, `api/weather.ts`.
- `vite.config.ts` — react, basic-ssl, dev API middleware.

## Tasks

1. **Scaffold** — package.json, tsconfig, vite config with API middleware, index.html, `.env.example`. Verify `npm run build` and `npm test` run.
2. **Sim engine (TDD)** — geometry, grid, coverage + metrics (DU_lq, under-covered %, overspray %), playback, forecast, changes/evaluate. Tests: single full-circle head on square lawn covers centre > edge; normalized mean over its disk ≈ catalog precip rate; DU of two head-to-head rotors > one; forecast with zero water and positive ET dries monotonically; applyChanges on unknown id is ignored.
3. **Catalog + sample yard** — catalog.json (specs from manufacturer charts; prices approximate, labelled); synthetic sample yard labelled "Demo yard (synthetic)".
4. **API** — weather (Open-Meteo daily et0/precip/temp, 7 days), segment (SAM per prompt, parse with @meta-sam/parser, mask → outer contour → simplified polygon in tile px), health (Muse vision, json_schema 8×8 grid), advise (tool loop ≤ 6 rounds: get_weather, get_catalog, simulate, submit_recommendations; server re-evaluates and keeps only improving recs). All return `{ok:false, error}` with 503 when key missing.
5. **Client store + storage + rectify**.
6. **Screens: Scan → Assemble → Build** — camera (getUserMedia, file-input fallback), 4-tap handles, width/depth ft entry, rectify; tile drag/rotate; build calls segment + health per tile with progress and per-step error display.
7. **Studio scene** — lawn slab with heatmap/forecast texture, features, heads with arc overlays, edit (ortho top-down, drag/select) vs view (perspective orbit, playback particles), bottom sheet (catalog, radius, arc, rotation, zone), zones panel, metrics, playback controls, 7-day scrubber, advisor panel with before/after + Apply, export/import yard JSON.
8. **Verify** — `npm test`, `npm run build`, run dev server, smoke-test endpoints (degraded without key), drive UI in a browser if available.
