# Reference ledger

REFERENCE → exact component/pattern used → our module → status

- **luckeyfaraday/claude-of-duty** → offline-baked serialized MeshBVH + capsule shapecast (`.tools/bake_collision_bvh.mjs`, `export/web/collision-world.js`); offline Recast navmesh bake (`.tools/bake_navmesh.mjs`) → `tools/prepare/bake_world.mjs`, `src/runtime/CollisionWorld.ts`, `src/runtime/Navigation.ts` → USED
- **shadany7824/playgta5** → content-as-data (manifest → assets → cache → runtime), quality profiles that change budget not content → `public/content/manifest.json`, `src/storage/ContentCache.ts`, `Engine` budgets → USED (lightweight)
- **joncodeofficial/gta-vice-city-wasm** → remote content → background storage (OPFS) → normal runtime; persistence separate from app code → `src/storage/ContentCache.ts` (OPFS bytes + IndexedDB metadata) → USED
- **playcanvas/supersplat-viewer / engine assets** → splat lane evaluated with Spark (`@sparkjsdev/spark`, .sog); not V1-verifiable in software GL (2M splats ≫ 10 min/frame) → content model keeps `format: 'sog'` open → DEFERRED
- **arielshad/3d-asset-server** → SEARCH→FETCH→NORMALIZE→CACHE→PLACE record shape → `src/assets/AssetRegistry.ts` (`find`, `loadGLTF`, `normalize`) → USED (local manifest provider only)
- **pascalorg/editor** → semantic serializable entities, commands + undo/redo, headless ops → `src/core/types.ts`, `src/world/WorldStore.ts`, `src/ops/operations.ts` → USED (concepts only)
- **HeroicSwan/after-effects-mcp** → ACTION → CAPTURE → INSPECT → REPAIR loop → `tools/studio.mjs` + `tools/scenarios/*` → USED
- **nanocle/Charakuru** → staged character data (body/head/hair/outfit/rig/motion) → `AssetRecord.runtime.parts/clips/rigProfile` → DESIGN ONLY
- **kino-der-toten** → "prepare content for runtime" principle → `tools/prepare/*` → PRINCIPLE ONLY (not opened yet)
- **morluto/rea, marvelous-designer-mcp, image-blaster, webXash, diablo_web, webwars** → not needed yet → NOT USED

## Content sources
- Amazon Lumberyard Bistro (CC-BY 4.0) via `NVIDIA-RTX/RTXPT-Assets` (glTF + BC7 DDS, Git LFS) → `tools/prepare/bistro_materials.py` + `optimize.mjs` + `bake_world.mjs`
- Ready Player Me avatar (three.js examples) + RPM Animation Library → fetched at runtime from pinned upstream commits (license forbids redistribution)
- Khronos glTF-Sample-Assets, three.js example models → fetched at runtime from pinned commits
- Poly Haven HDRIs (CC0, via three.js examples) → `public/content/env`
