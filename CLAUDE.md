# Cinematic World Studio — working rules

Browser-native 3D scene studio (Three.js + React + Vite), published by `.github/workflows/pages.yml` to
https://84dr55wgm2-eng.github.io/4d/ from branch `claude/amazing-mendel-bv6uox`.

## Non-negotiables
- The actor is fixed: Ready Player Me avatar + RPM idle/walk/jog clips. Never replace, retarget or reduce it.
- Bistro stays available; saved worlds, imports, cache, undo/redo, shots and interactions must keep working.
- Visible content near the camera comes from authored assets or semantic construction with PBR scans — never
  placeholder boxes. Record provenance (`public/content/lagos/provenance.json`) for every acquired file.
- Never label an idea as "integrated": integrated = code executed or content loaded in the product.
- No secrets in the frontend. No Vercel. No new repository.

## Where things are
- `src/world/district/*` — Yaba district: plan (`YabaPlan`), construction (`DistrictBuilder`), runtime
  (`DistrictRuntime`), targeted ops (`DistrictOps`), composition (`YabaWorld`), French commands (`Commands`).
- `src/runtime/SequencePlayer.ts` — shots + actions on one clock (rehearse / play / seek / export).
- `src/ops/operations.ts` + `src/ops/ToolRegistry.ts` — validated operations, exposed as `window.studio.tools`.
- `tools/acquire/*` + `.github/workflows/content-acquire.yml` — content acquisition runs in GitHub Actions
  (Poly Haven CC0, Objaverse CC0/CC-BY): edit `tools/acquire/request.json`, push, pull the bot commit.
- `tools/prepare/yaba_world.ts` — regenerates `public/content/worlds/yaba/world.json` (`npx tsx …`).
- `tools/studio.mjs` + `tools/scenarios/*` — headless capture/inspection loop (software GL: slow, use `step()`).

- Place studio (imported content): `src/content/*` (package store, catalogue, conversion-service client),
  `src/assembly/*` (Pascal-contract operations, set runtime), `src/vendor/pascal/*`, `src/sim/Simulation.ts`,
  `src/agent/Agent.ts` (browser tool loop), `src/ui/PlacePanel.tsx`; `server/agent-relay` (model key server-side);
  `tools/gta/*` (cw-extract, Sollumz script, package builder, private conversion service, test fixtures).
  No game file or Rockstar asset is ever committed or published; the test package is NOT GTA content.

## Docs
- `docs/REFERENCE_LEDGER.md` — every reference: what was taken, where, status.
- `docs/RESUME.md` — current state, open issues, next actions (update at the end of each pass).
- `docs/gta-pipeline.md` — environments A/B/C, conversion commands, service API, relay parameters.
- `docs/JOURNAL.md` — dated decisions log. `docs/world-creator-pass.md` — previous pass notes.

## Verification habit
Build (`npm run build`), then drive the real app (`node tools/studio.mjs <scenario> tools/out '<url>?world=yaba&capture'`)
and look at the captured frames. Don't edit `src/` while a capture run is in progress (Vite reloads the page).
