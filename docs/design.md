# LawnLens v1 — Design

Status: approved for planning · 2026-11-02
Deadline: Nov 4, 2026, 9:00 PM ET (Meta Global AI Developer Hackathon)

## 1. Intent

Point your phone at your yard, turn it into a playful low-poly 3D twin, lay out sprinklers from real products, and *watch* how the yard waters — then get advice from Meta's Muse Spark that it has already verified by running the simulation.

The hero moment for the demo video: **"your dry spot is exactly where your sprinklers don't reach"** — seen in a stylized 3D yard, fixed with one tap, and proven by the simulation.

### Why this shape

- Judging: impact 30%, creative Meta tooling 25%, demo/video 25%, technical depth 20%.
- A simulation-first design shows SAM 3.1 and Muse Spark working together on a concrete, visual problem, and gives the advisor something checkable to do rather than free-form chat.
- Stylized (not photoreal) visuals forgive imprecise capture and render cheaply on phones.

## 2. Goals, non-goals, anti-goals

**Goals (v1)**
- Guided multi-section scan of a real yard → scaled top-down plan.
- SAM 3.1 segmentation → low-poly 3D scene (lawn, trees, beds, hardscape).
- Sprinkler layout editor using a curated catalog of real Home Depot products.
- Three-layer watering simulation (coverage, run playback, 7-day moisture).
- Muse Spark advisor that tests its proposals in the simulator before recommending them.
- A labelled, pre-scanned Sample yard so anyone can try the app without scanning.

**Non-goals (deferred to later versions)**
- Live AR overlays, WebXR, or true 3D/photogrammetry scanning.
- Automatic photo stitching.
- Google Maps / satellite input by address.
- Live Home Depot price/stock data.
- Accounts, cloud sync, multi-device.
- Commercial multi-property management (data model should not preclude it).
- Detecting existing sprinkler heads from photos.

**Anti-goals (failure even if it "works")**
- Any non-Meta model called at runtime, including as a fallback.
- Silently showing fabricated or sample data as if it were a live result.
- Advice the simulator hasn't checked.
- An editor that's frustrating to use with fingers on a phone.
- Meta API key reachable from the browser.

## 3. Hard constraints

- **Meta models only at runtime**: Muse Spark (Meta Model API), SAM 3.1 (Meta Model API, or Meta open weights self-hosted if not on the API). Non-model APIs (weather) are allowed.
- **Secrets**: API key lives in Vercel env vars and local `.env` only; never in the repo or client bundle.
- **Degraded state**: if a Meta API or weather call fails, the UI shows a visible error/degraded state for that step. Never fall back to sample data silently.
- **Budget**: $150 Meta Model API credits — cache responses (see §8).

## 4. User flow

1. **Start** — "Scan my yard" or "Open Sample yard (pre-scanned)".
2. **Scan** — guided capture, one section at a time:
   - Live camera view (`getUserMedia`), capture photo.
   - Tap 4 points forming a rough rectangle on the ground → perspective-rectify to top-down.
   - Enter one known length (e.g. "fence edge = 40 ft") → scale in feet.
   - Repeat for N sections.
3. **Assemble** — each section appears as a top-down tile; user drags/rotates tiles into place on a shared canvas (edge snapping). Manual alignment is intended for v1.
4. **Build** — each tile is sent to SAM 3.1; masks → polygons in yard coordinates → low-poly scene. Muse Spark vision reads grass health per tile.
5. **Edit** (top-down orthographic camera) — add heads from the catalog, drag to place, rotate to aim the arc, bottom sheet for model / radius / arc / zone. Coverage heatmap updates live.
6. **Simulate** (camera animates to tilted, orbitable perspective) — play zone run sequence; scrub a 7-day forecast.
7. **Advise** — Muse Spark agent proposes verified fixes; user sees before/after and taps Apply.

## 5. Architecture

```
Phone browser (Vite + React + TS + react-three-fiber + drei)
  ├─ Scan / Assemble UI      (camera, 4-tap rectify, scale, tile alignment)
  ├─ Scene (r3f)             (one scene, two camera modes)
  ├─ Sim engine (pure TS)    ← shared module
  └─ Storage (IndexedDB)
          │ HTTPS
Vercel serverless functions (/api, TypeScript)
  ├─ /api/segment   → SAM 3.1
  ├─ /api/health    → Muse Spark (vision)
  ├─ /api/advise    → Muse Spark agent loop (tools run server-side, incl. sim engine)
  └─ /api/weather   → Open-Meteo (no key, not a model)
```

- **Hosting**: Vercel — static Vite build + `/api` functions. Provides HTTPS (required for phone camera) for both testing and demo. First deploy requires the owner's go-ahead.
- **Local dev**: `vercel dev` (or Vite + functions) with HTTPS reachable from a phone (self-signed cert or tunnel).
- **Storage**: IndexedDB in the browser for yards, tiles (image blobs), plan, layout, cached model responses. No database.
- **Sim engine**: framework-free TypeScript module imported by both the client and `/api/advise`, so Muse's `simulate` tool runs the exact same code the user sees.

## 6. Data model

All coordinates are yard space in **feet**, origin at an arbitrary corner, +x east-ish, +y north-ish (no true geo-orientation needed in v1).

- **Yard** — id, name, location {lat, lon} (geolocation; Sample yard stores its own), isSample, createdAt.
- **Tile** — id, yardId, imageBlob (rectified), sourcePhotoBlob, corners (4 image points), scale (px per ft), transform in yard space (x, y, rotation).
- **Feature** — id, yardId, kind (`lawn` | `tree` | `shrub` | `bed` | `hardscape`), polygon (yard ft), source (`sam` | `manual`).
- **Zone** — id, yardId, name, valve number, runMinutes, order in run sequence, status.
- **Sprinkler** — id, zoneId, catalogItemId, position (x, y), rotation (deg, arc start direction), arc (deg), radius (ft), nozzle/flow (GPM, derived from catalog for the chosen radius/arc).
- **HealthObservation** — id, yardId, region (polygon or grid cells), status (`healthy` | `stressed` | `dry`), score (0–1), timestamp, source (`muse-vision` | `manual`).
- **Recommendation** — id, yardId, zoneId?, kind (`move` | `swap-model` | `adjust-arc` | `adjust-radius` | `run-time` | `add-head` | …), proposed change (diff against layout/schedule), reason, before/after metrics, createdAt.
- **WeatherSnapshot** — location, fetchedAt, hourly series (temp, RH, wind, solar radiation, precip) + daily ET₀ if available.

Multiple yards per device are supported by the model even if the UI only shows one at a time (keeps commercial/multi-property open).

## 7. Simulation

Grid over the lawn polygon, ~1 ft cells (tunable for performance). Simplified but believable — not agronomy-grade.

**Layer 1 — Coverage (static, live while editing)**
- Each head deposits water over its arc within its radius using a radial distribution profile (heavier near the head tapering to the edge; exact profile per head type is the builder's call).
- Output per cell: precipitation rate (in/hr).
- Metrics: lower-quarter distribution uniformity (DU_lq) or similar, % lawn under-covered, % over-sprayed onto hardscape.
- Visualized as a heatmap on the lawn in edit mode; coverage circles/arcs drawn per head.

**Layer 2 — Run playback**
- Zones fire in sequence with their run times (playback is time-compressed).
- Animated low-poly water arcs per active head; cells darken as applied water accumulates.

**Layer 3 — 7-day moisture forecast**
- Per-cell soil moisture bucket: + sprinkler application (per schedule) + rain; − evapotranspiration (ET₀ from weather × a turf crop coefficient).
- Initial moisture seeded from HealthObservations.
- 7-day scrubber recolors grass (green → yellow → brown) by moisture.

Sim inputs: lawn polygon, features (hardscape for overspray), sprinklers, zones/schedule, weather, initial health. The engine is deterministic and pure so it's testable and callable from the advisor.

## 8. Meta model usage

**Model choice**: Muse Spark — use whichever version (1.2 / 1.3) the official Meta Model API docs list as current. API is OpenAI-compatible (`https://api.meta.ai/v1`, Responses API). Confirm exact endpoints from official docs before coding against them.

1. **SAM 3.1 — scene building** (`/api/segment`)
   - Input: one rectified tile image. Text prompts: `lawn`, `tree`, `shrub`, `flower bed`, `patio/driveway/path`.
   - Output: masks → simplified polygons (client or server) → transformed into yard space via tile transform.
   - **Open item / first build task**: confirm SAM 3.1 is exposed via the Meta Model API. If not, self-host SAM open weights (Meta, therefore allowed) — this would change hosting for segmentation only.

2. **Muse Spark vision — health read** (`/api/health`)
   - Input: tile image + lawn mask/polygon.
   - Output (structured): regions with status `healthy | stressed | dry` and score → HealthObservations.

3. **Muse Spark agent — advisor** (`/api/advise`), the headline feature
   - Tools exposed: `get_weather`, `get_catalog`, `simulate(layoutDiff, scheduleDiff)` → returns coverage metrics, DU, under/over-covered %, 7-day dry-cell count.
   - Loop: Muse proposes changes, calls `simulate`, iterates, returns only recommendations whose simulated metrics improved. Response is structured (Recommendation objects with before/after metrics).
   - Cap iterations/tool calls per request to control cost and latency.
   - UI: before/after toggle on the scene; Apply updates the layout.

4. **Optional bonus**: Muse `web_search` built-in tool for local watering restrictions (odd/even days, drought rules), shown with citations.

**Cost controls**: cache SAM and health responses per tile (keyed by image hash) in IndexedDB; cap advisor iterations; the Sample yard ships with its SAM/health results pre-recorded so it costs nothing to open.

## 9. Sprinkler catalog

- Static `catalog.json`, ~12–20 real products sold at Home Depot (Rain Bird, Hunter, Orbit; rotors, spray heads, impacts, nozzles).
- Per item: SKU, name, brand, type, price snapshot, product URL, image, min/max radius (ft), arc range (adjustable / fixed values), flow (GPM at given radius/arc, from manufacturer spec sheets), pop-up height.
- UI labels prices "as of Nov 2026" with a "View at Home Depot" link.
- Live inventory/pricing is a v2 item.

## 10. Rendering

- One r3f scene, two camera modes:
  - **Edit**: top-down orthographic; drag = raycast to ground plane; two-finger rotate = arc direction; bottom sheet for parameters. Orbit controls disabled.
  - **View**: animated transition to tilted perspective with orbit controls, for playback and forecast.
- Low-poly stylized look: extruded lawn slab with per-cell vertex/texture tint by health/moisture; instanced low-poly trees/shrubs; simple pop-up head meshes; particle/arc water; flat-shaded hardscape and beds.
- Must stay smooth on a mid-range phone; prefer instancing and a single heatmap texture over per-cell meshes.

## 11. Sample yard

- The owner scans their real yard on Nov 3 (daylight). That capture is used as test data, filmed for the demo video, and shipped as **"Sample yard (pre-scanned)"**: tiles, alignment, SAM polygons, health read, and a starter layout, stored as a static fixture.
- Always labelled as pre-scanned. Live calls never silently substitute it.
- Location (for weather) stored with the fixture; live yards use browser geolocation with manual lat/lon fallback.

## 12. Scope spine and cut order

**Spine (demo fails without these)**
1. Scan → rectify → scale → manual tile alignment.
2. SAM 3.1 lawn segmentation → low-poly scene.
3. Catalog head placement in top-down edit mode + live coverage heatmap (Layer 1).
4. Muse Spark advisor with ≥1 simulate-verified recommendation and before/after.

**Cut order if behind (first cut first)**
1. Muse `web_search` watering restrictions.
2. SAM classes beyond lawn (trees/beds become hand-placed props).
3. 7-day moisture forecast (Layer 3) → simple "after this run" state.
4. Muse vision health read → hand-marked dry patches on the Sample yard, labelled `manual`.
5. Run playback animation (Layer 2) — protect if at all possible; it's the video's money shot.

## 13. Builder's calls (decided by default — override if needed)

- Unit tests with Vitest on the sim engine (deterministic inputs → expected coverage/DU/moisture). UI and model calls verified manually on device.
- Polygon simplification, grid resolution, distribution profile shapes, and ET crop coefficient are implementation details within "believable".
- Perspective rectification and mask→polygon done with lightweight client-side math or a small library; adding a major dependency (e.g. OpenCV.js) needs the owner's OK.
- Repo layout: single Vite app at the root with `api/` for Vercel functions and a `src/sim/` module shared with the functions.

## 14. Open items

- Confirm SAM 3.1 availability and request format on the Meta Model API (first build task).
- Confirm current Muse Spark model id and tool-calling/structured-output request format from official docs.
- Get the owner's go-ahead before the first Vercel deploy.
