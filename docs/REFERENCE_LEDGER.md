# Reference ledger

Format: **source** → component taken / adapted → project file → usable effect → **status**.
Status vocabulary: **INTÉGRÉ** (code executed or content loaded in the product) · **CONCEPT APPLIQUÉ** (pattern
re-implemented here, no code transplanted) · **IDÉE RETENUE** (planned contribution, not in the product yet) ·
**NON APPLICABLE** (explained) · **BLOQUÉ** (explained).

## Mondes, chargement, navigation
- **luckeyfaraday/claude-of-duty** → offline-baked serialized MeshBVH + capsule shapecast; Recast navmesh → `CollisionWorld.ts`, `Navigation.ts`, `tools/prepare/bake_world.mjs`; Yaba derives BVH + tiled Recast from the semantic plan (`DistrictRuntime.geometry`) → actor never crosses walls, 1.2 m doorway passable → **INTÉGRÉ**
- **shadany7824/playgta5** → content-as-data (manifest → assets → cache), quality budgets, sector-scoped loading → `manifest.json`, `ContentCache.ts`, `Engine` budgets, `EntityRuntime.stream()` (entities + their bytes load only within 34 m of actor/camera, released beyond 51 m; HUD shows resident/total) → **INTÉGRÉ** (browser-native subset). The repo excludes the 19.7 GB `.mirror` data: no GTA map is available or used.
- **joncodeofficial/gta-vice-city-wasm** → remote content → OPFS storage → normal runtime → `ContentCache.ts` → **INTÉGRÉ**
- **luckeyfaraday/kino-der-toten** → "prepare content for runtime" → `tools/prepare/*`, `tools/acquire/*` → **CONCEPT APPLIQUÉ**; repository returned 404 (Oct 12, 2026), not re-searched.
- **x8BitRain/webXash** → packaged content import + IndexedDB persistence → `AssetResources.ts` (GLB/ZIP import), `idb.ts` → **CONCEPT APPLIQUÉ** (no webXash code)
- **JohnImril/diablo_web** → UI separate from engine, workers → `Studio`/React split, meshopt workers → **CONCEPT APPLIQUÉ**
- **apmlabs/webwars** → browser Hedgewars/WASM port → **NON APPLICABLE** (not a world/asset source)
- **morluto/rea** → evidence-driven reverse engineering → **NON APPLICABLE** this pass (no opaque bundle to analyse)

## Acquisition et construction sémantique
- **arielshad/3d-asset-server** → live search + `/files` discovery with companion resources → `AssetRegistry.ts`, `AssetResources.ts` (WEB tab) → **INTÉGRÉ**. Bulk acquisition for Yaba uses the same SEARCH→FETCH→NORMALIZE→CACHE→PLACE idea in `tools/acquire/acquire.mjs` (Poly Haven API, Objaverse) run in GitHub Actions (the build sandbox cannot reach those hosts).
- **pascalorg/editor** → rooms as polygons/rects, openings attached to walls, semantic hierarchy, undo → `DistrictBuilder.ts` (walls with door/window/shopfront openings, slabs, rooms), `WorldStore` → **CONCEPT APPLIQUÉ** (its house generator uses templates; ours composes one authored street kit, not an arbitrary city)
- **wy51ai/floorplan-3d** → plan ↔ 3D coherence → one `DistrictPlan` drives render, collision and navigation; edits (enlarge room) rebuild all three → **CONCEPT APPLIQUÉ**
- **amirmushichge/unreal-home-wizard** → furniture placed by use → workstation = desk + CRT + chair with seat zone, approach point, facing (`DistrictOps.workstation`, relations seatFor/onSurface/faces) → **CONCEPT APPLIQUÉ**
- **iamtechartist** (home-sweet-home, coastal-simulation, ocean-simulation, tideglass-cove, human-cell-visualizer, Architectural X-Ray) → interior layers / x-ray visibility, construction states, environment quality → **IDÉE RETENUE** (not inspected this pass; next: cut-away/x-ray toggle for interiors)

## Environnements capturés
- **superspl.at / playcanvas/supersplat-viewer** → splat lane (Spark `.sog`) → content model keeps `format: 'sog'` → **IDÉE RETENUE**. Blocker: no verifiable splat of Lagos; a splat needs navigation/collision proxies (same plan as district collision) before it can be staged.

## Personnage, mouvements, fabrication d'assets (le personnage actuel est conservé)
- **met4citizen/TalkingHead** → gaze/look-at, gesture layering → **IDÉE RETENUE** (head look-at toward target object)
- **lhupyn/motion-engine** → transitions, interruptions, layers → **CONCEPT APPLIQUÉ** partially: interruptible beats (`SequencePlayer` tokens, `cancelPath`), seated pose layered on the existing rig → full motion layering **IDÉE RETENUE**
- **nanocle/Charakuru** → staged character data → `AssetRecord.runtime.parts/clips/materialTints` → **CONCEPT APPLIQUÉ** (data model only)
- **neilsonnn/image-blaster**, **aldegad/image-gen**, **aldegad/artkit**, **aldegad/sprite-gen**, **idlerunner00/procedural-pixel-creatures**, **thebuggeddev** → references/variants generation → **IDÉE RETENUE** (signboards are canvas-generated text, not image generation)
- **shinshin86/aituber-onair** → presenter/avatar pipeline → **NON APPLICABLE** to scene direction (studio must not become a presenter app)
- **Tripo (spatialinsiders article, developers.tripo3d.com)** → rigging / text-to-motion → **BLOQUÉ** (requires API key; must not be exposed in a GitHub Pages frontend; a server-side relay is needed)
- **ysk424/marvelous-designer-mcp** → clothing via an external pro tool → **IDÉE RETENUE**

## Trajectoires, réalisation, montage, export
- **HeroicSwan/after-effects-mcp** → ACTION → CAPTURE → INSPECT → REPAIR → `tools/studio.mjs`, `tools/scenarios/*` → **INTÉGRÉ** (dev loop)
- **buildwithhanif/claude-animation-skill**, **JohnHeibel/ClaudeAnimationBase**, **JohnHeibel/PDoomVideo**, **WinterArc21/AE-MCP** → frame-indexed, reproducible rendering on a shared clock → `SequencePlayer` (fixed-step rehearse/seek/export, WebCodecs + mp4/webm muxers) → **CONCEPT APPLIQUÉ** (not inspected; no code taken)
- **veedstudio/open-edit** → editable sequence/timeline → sequence panel (beats + cuts anchored to beats, editable shot/offset) → **CONCEPT APPLIQUÉ**
- **anmarw38-ops/Pathvision**, **amirmushichge/machine-vision** → trajectories & orientation → navmesh paths + heading-following camera → **IDÉE RETENUE** for camera paths (cuts only in this pass)
- **guanmo-ai/awesome-ai-motion**, **KumachanSteps/trpg-web-tools**, x.com/0xmovez motion reference → **IDÉE RETENUE**

## Outils et organisation
- **EpicGames/unreal-engine-skills-for-claude-code-plugin** → progressive tool discovery → `ToolRegistry.ts` (`world.*`, `direction.*` …) → **INTÉGRÉ**
- **yugo-ibuki/unitmux**, **zenn.dev/nana** (scrap dddb68d6c192fe) → light docs, separated spec/impl/journal, explicit resume state → `CLAUDE.md`, `docs/RESUME.md`, `docs/JOURNAL.md` → **CONCEPT APPLIQUÉ**

## Content sources (provenance)
- Amazon Lumberyard Bistro (CC-BY 4.0) via NVIDIA-RTX/RTXPT-Assets.
- Yaba: Poly Haven CC0 models and PBR scans (35 models, 20 materials) + Objaverse CC-BY models (retro PC set by dr.badass2142, Peugeot 504 break by medraphc, Toyota Corolla E70 by ditovirnantio, …) — per-file record in `public/content/lagos/provenance.json`.
- Ready Player Me avatar + RPM Animation Library — fetched at runtime (license forbids redistribution).
- Khronos glTF-Sample-Assets, three.js example models — fetched at runtime.
