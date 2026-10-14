# Reference ledger

Format: **source** → component taken / adapted → project file → usable effect → **status**.
Status vocabulary: **INTÉGRÉ** (code executed or content loaded in the product) · **CONCEPT APPLIQUÉ** (pattern
re-implemented here, no code transplanted) · **IDÉE RETENUE** (planned contribution, not in the product yet) ·
**NON APPLICABLE** (explained) · **BLOQUÉ** (explained).

## Mondes, chargement, navigation
- **luckeyfaraday/claude-of-duty** → offline-baked serialized MeshBVH + capsule shapecast; Recast navmesh → `CollisionWorld.ts`, `Navigation.ts`, `tools/prepare/bake_world.mjs`; Yaba derives BVH + tiled Recast from the semantic plan (`DistrictRuntime.geometry`) → actor never crosses walls, 1.2 m doorway passable → **INTÉGRÉ**
- **shadany7824/playgta5** → content-as-data (manifest → assets → cache), quality budgets, sector-scoped loading → `manifest.json`, `ContentCache.ts`, `Engine` budgets, `EntityRuntime.stream()` (entities + their bytes load only within 34 m of actor/camera, released beyond 51 m; HUD shows resident/total) → **CONCEPT APPLIQUÉ** (our own browser-native implementation of the idea; no playgta5 code is used). Pass 3 adds three separate levels — persistent bytes (OPFS/IDB), parsed models in memory, visible instances (`AssetRegistry.retain/release`, eviction after 15 s without instances) — and obstacles from measured footprints so streaming never changes routes. The repo excludes the 19.7 GB `.mirror` data: no GTA map is available or used.
- **joncodeofficial/gta-vice-city-wasm** → remote content → OPFS storage → normal runtime → `ContentCache.ts` → **INTÉGRÉ**
- **luckeyfaraday/kino-der-toten** → "prepare content for runtime" → `tools/prepare/*`, `tools/acquire/*` → **CONCEPT APPLIQUÉ**; repository returned 404 (Oct 12, 2026), not re-searched.
- **x8BitRain/webXash** → packaged content import + IndexedDB persistence → `AssetResources.ts` (GLB/ZIP import), `idb.ts` → **CONCEPT APPLIQUÉ** (no webXash code)
- **JohnImril/diablo_web** → UI separate from engine, workers → `Studio`/React split, meshopt workers → **CONCEPT APPLIQUÉ**
- **apmlabs/webwars** → browser Hedgewars/WASM port → **NON APPLICABLE** (not a world/asset source)
- **morluto/rea** → evidence-driven reverse engineering → **NON APPLICABLE** this pass (no opaque bundle to analyse)

## Acquisition et construction sémantique
- **arielshad/3d-asset-server** → live search + `/files` discovery with companion resources → `AssetRegistry.ts`, `AssetResources.ts` (WEB tab) → **INTÉGRÉ**. Bulk acquisition for Yaba uses the same SEARCH→FETCH→NORMALIZE→CACHE→PLACE idea in `tools/acquire/acquire.mjs` (Poly Haven API, Objaverse) run in GitHub Actions (the build sandbox cannot reach those hosts).
- **pascalorg/editor** → rooms as polygons/rects, openings attached to walls, semantic hierarchy, undo → `DistrictBuilder.ts` (walls with door/window/shopfront openings, slabs, rooms; pass 3: interior lining cut around the same openings), `WorldStore` → **CONCEPT APPLIQUÉ** (no code taken; repository not re-read this pass)
- **wy51ai/floorplan-3d** → plan ↔ 3D coherence → one `DistrictPlan` drives render, collision and navigation; edits (enlarge room) rebuild all three; pass 3: parameters (street, café side/position/size, workstations, layout, storeys) regenerate the plan, shown as a top view in the creator (`PlanMap`) → **CONCEPT APPLIQUÉ** (no code taken)
- **amirmushichge/unreal-home-wizard** → furniture placed by use → workstation = desk + CRT + chair with seat zone, approach point, facing (`DistrictOps.workstation`, relations seatFor/onSurface/faces); pass 3: positions computed from the models' measured footprints, wall socket + power cable per station, shops stocked by trade (`ShopDresser`) → **CONCEPT APPLIQUÉ** (no code taken)
- **iamtechartist** (home-sweet-home, coastal-simulation, ocean-simulation, tideglass-cove, human-cell-visualizer, Architectural X-Ray) → interior layers / x-ray visibility, construction states, environment quality → **IDÉE RETENUE** (not inspected this pass; next: cut-away/x-ray toggle for interiors)

## Environnements capturés
- **superspl.at / playcanvas/supersplat-viewer** → splat lane (Spark `.sog`) → content model keeps `format: 'sog'` → **IDÉE RETENUE**. Blocker: no verifiable splat of Lagos; a splat needs navigation/collision proxies (same plan as district collision) before it can be staged.

## Personnage, mouvements, fabrication d'assets (le personnage actuel est conservé)
- **met4citizen/TalkingHead** → gaze/look-at, gesture layering → **IDÉE RETENUE** (head look-at toward target object)
- **lhupyn/motion-engine** → transitions, interruptions, layers → **CONCEPT APPLIQUÉ** partially (no code taken): pass 3 makes interruption real — `SequencePlayer.stop()` cancels the walk, the approach and every pending wait (`halt()`); seated pose layered on the existing rig → full motion layering **IDÉE RETENUE**
- **nanocle/Charakuru** → staged character data → `AssetRecord.runtime.parts/clips/materialTints` → **CONCEPT APPLIQUÉ** (data model only)
- **neilsonnn/image-blaster**, **aldegad/image-gen**, **aldegad/artkit**, **aldegad/sprite-gen**, **idlerunner00/procedural-pixel-creatures**, **thebuggeddev** → references/variants generation → **IDÉE RETENUE** (signboards are canvas-generated text, not image generation)
- **shinshin86/aituber-onair** → presenter/avatar pipeline → **NON APPLICABLE** to scene direction (studio must not become a presenter app)
- **Tripo (spatialinsiders article, developers.tripo3d.com)** → rigging / text-to-motion → **BLOQUÉ** (requires API key; must not be exposed in a GitHub Pages frontend; a server-side relay is needed)
- **ysk424/marvelous-designer-mcp** → clothing via an external pro tool → **IDÉE RETENUE**

## Trajectoires, réalisation, montage, export
- **HeroicSwan/after-effects-mcp** → ACTION → CAPTURE → INSPECT → REPAIR → `tools/studio.mjs`, `tools/scenarios/*` → **INTÉGRÉ** (dev loop)
- **buildwithhanif/claude-animation-skill**, **JohnHeibel/ClaudeAnimationBase**, **JohnHeibel/PDoomVideo**, **WinterArc21/AE-MCP** → frame-indexed, reproducible rendering on a shared clock → `SequencePlayer` (fixed-step rehearse/seek/export, WebCodecs + mp4/webm muxers) → **CONCEPT APPLIQUÉ** (not inspected; no code taken)
- **veedstudio/open-edit** → editable sequence/timeline → sequence panel: actions added / removed / reordered / retargeted / re-timed, cuts stay anchored to their action, stale timing detected and re-measured → **CONCEPT APPLIQUÉ** (no code taken)
- **anmarw38-ops/Pathvision**, **amirmushichge/machine-vision** → trajectories & orientation → navmesh paths + heading-following camera → **IDÉE RETENUE** for camera paths (cuts only in this pass)
- **guanmo-ai/awesome-ai-motion**, **KumachanSteps/trpg-web-tools**, x.com/0xmovez motion reference → **IDÉE RETENUE**

## Outils et organisation
- **EpicGames/unreal-engine-skills-for-claude-code-plugin** → progressive tool discovery → `ToolRegistry.ts` (`world.*`, `direction.*` …) → **INTÉGRÉ**
- **yugo-ibuki/unitmux**, **zenn.dev/nana** (scrap dddb68d6c192fe) → light docs, separated spec/impl/journal, explicit resume state → `CLAUDE.md`, `docs/RESUME.md`, `docs/JOURNAL.md` → **CONCEPT APPLIQUÉ**

## Caméra
- Automatic follow framing (exterior / interior profiles, obstacle probing now and ~0.6 s ahead, room bounds, post-interpolation wall check, shared reset) → `CameraDirector.updateFollow` → own implementation; no reference repository was used for it.

## Content sources (provenance)
- Amazon Lumberyard Bistro (CC-BY 4.0) via NVIDIA-RTX/RTXPT-Assets.
- Yaba: Poly Haven CC0 models and PBR scans (35 models, 20 materials; pass 3: 24 shop models — steel and wooden shelving, tins, bottles, medical boxes, baskets, produce, crates, cement, gas bottle, toolbox — and three nodes of `modular_electric_cables`: quad socket, conduit, light switch) — **INTÉGRÉ** (loaded in shops and in the café) + Objaverse CC-BY models (retro PC set by dr.badass2142, Peugeot 504 break by medraphc, Toyota Corolla E70 by ditovirnantio, …) — per-file record in `public/content/lagos/provenance.json`.
- Ready Player Me avatar + RPM Animation Library — fetched at runtime (license forbids redistribution).
- Khronos glTF-Sample-Assets, three.js example models — fetched at runtime.

## Studio de lieux (correction « séparer le studio du contenu GTA », 2026-10-12)
Aucun téléchargement de fichiers du jeu, aucun asset Rockstar dans le dépôt ou sur Pages. playgta5 `mirror_site.py` → **NON APPLICABLE** (retiré par la correction).
- **dexyfex/CodeWalker** (MIT, `485d56b`) → CodeWalker.Core : `RpfFile.ScanStructure/GetFiles/FindChildArchive/ExtractFile`, `MetaXml.GetXml`, `XmlMeta.GetData/GetYndData`, `GTA5Keys.GenerateV2` → `tools/gta/cw-extract` → **INTÉGRÉ** pour le round-trip XML des fixtures (xml-check exécuté) ; extraction sur archives réelles **BLOQUÉ** (pas de fichiers du jeu).
- **Sollumz/Sollumz** (GPL-3, `75d323e`) → import XML headless `bpy.ops.sollumz.import_assets`, `sz_lods`, pont matériaux → `tools/gta/blender/sollumz_to_gltf.py` (processus Blender séparé) → **BLOQUÉ** (Blender inaccessible ici ; script jamais exécuté).
- **pascalorg/editor** (MIT) → `AgentOperation`, `SceneChanges`, `applySceneChanges`, `mergeSceneChanges`, refus typés, `findValidPlacement/itemPlanAabb/aabbsOverlap` → `src/vendor/pascal/*` (provenance dans `README.md`), `src/assembly/operations.ts` → **INTÉGRÉ** (code exécuté par chaque opération d’assemblage). Les ensembles GTA ne sont pas convertis en primitives Pascal ; `export_glb` de Pascal non utilisé.
- **recast-navigation-js** `Crowd` (Detour Crowd) → `src/sim/Simulation.ts` → **INTÉGRÉ** (piétons, évitement, reprise après blocage). Yuka → **NON APPLICABLE** (Detour Crowd suffit, pas de seconde dépendance).
- **Anthropic SDK TypeScript** `@anthropic-ai/sdk@0.133` → `server/agent-relay/server.mjs` (clé côté serveur, modèle et prompt fixés) → **INTÉGRÉ** côté code, testé jusqu’à `provider_not_configured` ; appel réel au modèle **BLOQUÉ** (aucune clé ni hébergement fourni).
- **fflate** `Unzip` en flux → `src/content/PackageStore.ts` (OPFS / IndexedDB, quota) → **INTÉGRÉ**.
- **CesiumMan** (Khronos glTF-Sample-Assets, CC BY 4.0) → personnage du paquet de test → **INTÉGRÉ** (contenu de test, non GTA).


## 2026-10-14 — Scenario Blender and 3D Asset Server

- `scenario-labs/skills`, commit `907764d4490920a913b60947f9b673359b7a002e`: actual MIT `bx_materials.py` and `bx_audit.py` vendored in `tools/vendor/scenario-blender`. Executed under Blender 5.2.1 by `tools/prepare/scenario_assets.py` (PBR builder, material checks and mesh audit). No paid Scenario generation invoked.
- `arielshad/3d-asset-server` / `https://3d.shep.bot`: acquisition script executes search and file discovery, downloads BlenderKit stall and Poly Haven table plus all companions. Sources and per-asset terms recorded in `acquisition.json`.
- Existing authored Poly Haven Hidden Alley shell reused in a fictional market adaptation. This is not geographic Lagos, GTA, a full city, or live AI world generation.
- Mixamo Michelle and compatible source motion from three.js examples: own mesh/rig and three embedded clips, replacing the old default RPM performer for this route. The crowd currently shares the same civilian mesh.
- Existing Detour simulation extended to authored worlds; no new crowd algorithm written. Existing tap-to-direct, manual follow-camera override and sequence clock reused. Foreground navigation derived from the actual authored floor, with acquired-stall footprints carved out; full collision mesh kept separately.

## 2026-10-14 — Cybercity / NEON KAIDO: priority integrated-world reference

- User-provided repository: https://github.com/xikhar/cybercity
- Author profile provided by user: https://github.com/xikhar — retain alongside the repository for future related references; other repositories have not been examined.
- Examined source revision: `21ce1e48294628e3a597bfdfd74be6e9c347856c`. Repository cloned and source inspected; rendering/performance not yet tested. No Cybercity code or assets currently integrated in KOVA.
- Reuse intent: evaluate the complete coordinated engine + city + population + traffic as an integration base, then adapt to Lagos and KOVA's touch-directed movement and cinematic controls. Do not reduce this reference to visual inspiration or a handful of props. Preserve real upstream systems and implement only required adaptations.
- Actual source: `src/world/layout.js` coordinates avenue, cross streets, alley, river/promenade, bridge, elevated rail, expressway and skyline. Buildings include authored procedural shop interior geometry; accessibility and interactive doors are not verified.
- `src/systems/crowd`: male/female GLBs, six outfits each, nine named animation clips per base, phone/umbrella accessories, lane steering/avoidance, pooled nearby skinned characters and distant VAT instancing. Not a full cognition or city navigation system.
- `src/systems/vehicles`: multiple model families with LOD, parking, lane traffic with signal states and following distances, Rapier drivable vehicles and chase camera.
- `src/systems/player/controller.js`: first/third-person camera with Rapier obstacle queries. Existing inputs are keyboard/mouse and pointer lock; KOVA touch-directed movement needs adaptation.
- Weather, wet materials, atmospheric effects, signage and procedural audio are implemented modules.
- Technical coupling: Three.js 0.186.1 WebGPU/TSL renderer/materials and Rapier 0.20.0; renderer attempts WebGL2 fallback, not yet validated on target devices. Fixed shared layout, not an existing natural-language world creator. No generative AI world assembly found, no verified automatic day/night cycle.
- Package declares ISC; no standalone LICENSE or per-asset provenance document found in examined revision. Do not invent asset provenance or license coverage.

### xikhar profile follow-up — 2026-10-14

Profile inventory checked (19 public repositories at inspection). Retain these complementary references; none is integrated or render-tested in KOVA:
- https://github.com/xikhar/beyond-fable — source cloned; ChunkManager.ts and Environment.ts inspected. Budgeted chunk generation, vegetation LOD/instancing and a real advancing sun/moon day-night environment. Candidate complement to Cybercity for natural terrain, water, weather and large-world streaming. README's visual/performance claims have not been independently validated.
- https://github.com/xikhar/atlas — source cloned; README and pbr_maps.py inspected. Portable asset-creation skills plus actual Python raster/PBR/chroma utilities. model3d-gen, character-consistency, threejs-pipeline and threejs-shaders are useful workflow references. PBR maps derived from image luminance are approximations, not measured material properties. Not an existing world engine.
- https://github.com/xikhar/Walden — README inspected: third-person actor, spring-bone cloth, streamed terrain, LOD vegetation, Blender asset pipelines. Source motions/Tripo exports are not all included; do not claim complete character pipeline installed.
- https://github.com/xikhar/persona — README inspected: VRM/VRMA action library, cursor gaze, audio-driven speaking presence and local MCP controls. Desktop Electron app; does NOT itself run an LLM, produce speech or transcribe audio. Optional Kimodo motion generation depends on a separate service. Candidate runtime/action library patterns, not a website AI backend.
- https://github.com/xikhar/imagex — README inspected: visual generation graph, references, selective output runs, reusable assets and durable job recovery; local Express/React implementation, not a 3D world generator. Its authentication/provider path must not be assumed available in KOVA.
- https://github.com/xikhar/spiderbench — README inspected: dense procedural city and traversal/rendering systems, but explicit non-commercial and no-redistribution terms. Technical assessment reference only; do not mark as freely reusable or copy into the published product under an assumed MIT license.
Priority judgment: Cybercity for coordinated urban world; Beyond Fable for natural-world/day-night/streaming; Atlas for production tools. Walden, Persona and Imagex complement specific needs and require source-level integration assessment.
