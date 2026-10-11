# Reference ledger

REFERENCE → exact component/pattern used → our module → status

- **luckeyfaraday/claude-of-duty** → offline-baked serialized MeshBVH + capsule shapecast (`.tools/bake_collision_bvh.mjs`, `export/web/collision-world.js`); offline Recast navmesh bake (`.tools/bake_navmesh.mjs`) → `tools/prepare/bake_world.mjs`, `src/runtime/CollisionWorld.ts`, `src/runtime/Navigation.ts` → USED
- **shadany7824/playgta5** → content-as-data (manifest → world catalog → assets → persistent cache → runtime), package selection instead of a hardcoded scene, same-world quality budgets → `public/content/manifest.json`, dynamic world lookup in `Studio`, `src/storage/ContentCache.ts`, `Engine` budgets → USED (browser-native subset; block/range streaming still deferred)
- **joncodeofficial/gta-vice-city-wasm** → remote content → background storage (OPFS) → normal runtime; persistence separate from app code → `src/storage/ContentCache.ts` (OPFS bytes + IndexedDB metadata) → USED
- **playcanvas/supersplat-viewer / engine assets** → splat lane evaluated with Spark (`@sparkjsdev/spark`, .sog); not V1-verifiable in software GL (2M splats ≫ 10 min/frame) → content model keeps `format: 'sog'` open → DEFERRED
- **arielshad/3d-asset-server** → SEARCH→FETCH→NORMALIZE→CACHE→PLACE plus live multi-provider discovery → `src/assets/AssetRegistry.ts` local + remote search/registration, Library PROJECT/WEB source tabs, persistent external records in IndexedDB → USED (live HTTP provider; GLB-first import)
- **pascalorg/editor** → semantic serializable entities, commands + undo/redo, headless ops → `src/core/types.ts`, `src/world/WorldStore.ts`, `src/ops/operations.ts` → USED (concepts only)
- **EpicGames/unreal-engine-skills-for-claude-code-plugin** → small-context tool discovery (`listToolsets` → `describeToolset` → `callTool`) instead of registering every operation in model context → `src/ops/ToolRegistry.ts` / `window.studio.tools` → USED
- **HeroicSwan/after-effects-mcp** → ACTION → CAPTURE → INSPECT → REPAIR loop → `tools/studio.mjs` + `tools/scenarios/*` → USED
- **nanocle/Charakuru** → staged character data (body/head/hair/outfit/rig/motion) → `AssetRecord.runtime.parts/clips/rigProfile` → DESIGN ONLY
- **kino-der-toten** → "prepare content for runtime" principle → `tools/prepare/*` → PRINCIPLE ONLY (not opened yet)
- **morluto/rea, marvelous-designer-mcp, image-blaster, webXash, diablo_web, webwars** → not needed yet → NOT USED

## Content sources
- Amazon Lumberyard Bistro (CC-BY 4.0) via `NVIDIA-RTX/RTXPT-Assets` (glTF + BC7 DDS, Git LFS) → `tools/prepare/bistro_materials.py` + `optimize.mjs` + `bake_world.mjs`
- Ready Player Me avatar (three.js examples) + RPM Animation Library → fetched at runtime from pinned upstream commits (license forbids redistribution)
- Khronos glTF-Sample-Assets, three.js example models → fetched at runtime from pinned commits
- Poly Haven HDRIs (CC0, via three.js examples) → `public/content/env`


## Product pass — touch + interaction
- Pointer/touch is the primary actor control: tap actor → tap navmesh destination; tapping a semantic object while the actor is selected approaches it and executes its default supported action.
- Semantic interaction state is document data, not an animation trick. V1 proof: LIGHT assets carry toggle state and runtime light/emissive response; DOOR open/close is supported when an authored door asset provides interaction metadata.
- Keyboard locomotion is no longer part of the EXPLORE product path.
- The checked-in manifest is no longer the full asset universe: WEB search queries the public 3d-asset-server and selected records persist locally before passing through the same cache/normalize/place path.
