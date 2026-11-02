# AGENTS.md — LawnLens

Instructions for any coding agent working in this repo. This is the source of truth for agent behavior.

## Project

LawnLens: automated AR app for sprinkler management + grass-health monitoring (home and commercial yards).
Goal: one demoable flow by Nov 4, 9:00 PM ET — capture yard view → segment lawn/health zones → overlay sprinkler coverage → recommend watering action.
Context: Meta Global AI Developer Hackathon. $150 Meta Model API credits. Judged on impact (30%), creative Meta tooling use (25%), demo/video (25%), technical depth (20%).

## Hard constraints

1. Runtime models must ALL be Meta models. Allowed: Muse Spark series, Muse Wonder, Muse Image, SAM 3.1 via Meta Model API; Meta open weights (Llama, SAM, Muse Glimmer, Muse Spark Open) however hosted.
2. Never add a runtime call to a non-Meta model. No exceptions, no fallbacks, no "optional" third-party providers.
3. Dev-time tooling is unrestricted: any coding agent or model may assist with writing code. Do not ship those dependencies into the runtime path.
4. Keep secrets out of the repo. `.env` files, API keys, and credits live locally only.

## Workflow

- Read `README.md` and this file before starting. Check `git status` before editing.
- Smallest diff that satisfies the request. No unrelated refactors, no scaffolding beyond what was asked.
- Match existing stack and conventions once scaffolding lands; don't introduce a second framework to be safe.
- Verify what you change: run the repo's own tests/checks for the touched area. If none exist, say so plainly.
- Never commit, push, tag, or publish unless the user explicitly asks for that exact action. Leave work uncommitted for review.
- Report: what changed (files), how you verified it, and anything still unverified.

## Build guidance

- Mobile-first AR, but keep the demo simple: a working single-flow slice beats broad coverage.
- Prefer one Meta model call end to end before adding more (suggested order: SAM 3.1 segmentation → Muse Spark recommendation → visuals).
- Data model should cover: zones (id, polygon, sprinkler id, status), health observations (zone, score, dry/stressed/healthy, timestamp, source), recommendations (zone, duration, reason).
- If a Meta API is unreachable, surface the degraded state in the app output — never silently return fake healthy data.

## Ask before

- Choosing the app shell (web vs. native) or adding a major dependency
- Any network call to a non-Meta model provider, for any reason
- Committing, pushing, or publishing anything
