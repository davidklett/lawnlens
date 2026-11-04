# LawnLens

Automated AR app for managing and monitoring sprinkler systems and grass health across home or commercial yards.

Point your phone at the yard and see sprinkler coverage, grass-health hotspots, and what to water next.

Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026).

## Goal

One demoable flow by Nov 4, 9:00 PM ET:

1. Capture / load a yard view
2. Segment lawn vs. non-lawn and flag dry / stressed zones
3. Overlay sprinkler coverage zones + per-zone status
4. Recommend a watering action (which zone, how long, why)

Home yards first; design so commercial properties (multi-zone, larger areas) fit the same model.

## Hackathon context

- Event: Meta Global AI Developer Hackathon, virtual, $1M prize pool
- Credits: $150 Meta Model API credits
- Themes: Build for Your World / Push the Frontier — LawnLens fits both
- Judging: impact 30%, creative use of Meta AI tooling 25%, demo + video 25%, technical depth 20%

## Hard constraint: Meta models only at runtime

- Every model the project calls at runtime must be a Meta model.
- Allowed: Muse Spark series, Muse Wonder, Muse Image, SAM 3.1 via Meta Model API; Meta open-weights models (Llama, SAM, Muse Glimmer, Muse Spark Open) however run.
- Non-Meta models must never run inside the app — no third-party model providers at runtime.
- Any coding tools or agents are fine during development and need no disclosure. Muse Code is optional but preferred.

## Planned stack

- Reasoning / recommendations: Muse Spark via Meta Model API
- Segmentation (lawn, zones, dry spots): SAM 3.1
- Visuals / overlays: Muse Image where useful, else client-side AR rendering
- App shell: TBD (mobile-first AR; keep it minimal for the demo)

## Run locally

```sh
npm install
cp .env.example .env.local   # add MODEL_API_KEY from https://dev.meta.ai
npm run dev                  # https://localhost:5173 (and https://<your-LAN-IP>:5173 for your phone)
npm test                     # simulation + API unit tests
```

The dev server uses a self-signed HTTPS cert (the phone camera requires HTTPS). Accept the browser warning once.
Without `MODEL_API_KEY`, SAM 3.1 / Muse Spark steps show a "Meta Model API unavailable" state; the editor, simulator and weather still work.
To ship your scanned yard as the sample, export it from the studio (⤓) and save it as `public/sample-yard.json`.

Design: [docs/design.md](docs/design.md) · Plan: [docs/plan.md](docs/plan.md)

## Repo state

Fresh repo on `main`. Nothing scaffolded yet. Next steps:

1. Pick app shell (web AR vs. native prototype)
2. Define zone + health data model
3. Wire one Meta model call end to end
4. Record demo video

See [AGENTS.md](/Users/dklett/code/hackathon/meta/lawnlens/AGENTS.md) for agent working rules.
