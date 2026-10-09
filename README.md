# Cinematic World Studio

Browser-native studio for building cinematic scenes in real, authored worlds: explore with a human actor, stage cameras, edit the world semantically. Runs entirely in the browser; content is data (manifest → cache → runtime).

**V1 world:** Paris Bistro Street (Amazon Lumberyard Bistro, CC-BY 4.0) · **Actor:** civilian human (Ready Player Me rig + RPM motion library)

## Controls
| Mode | |
|---|---|
| EXPLORE (1) | `WASD` walk, `Shift` run, drag to orbit, wheel to zoom |
| EDIT (2) | click to select, `W/R/S` move/rotate/scale gizmo, `Ctrl+D` duplicate, `Del` delete, right-drag look, `WASD/QE` fly |
| DIRECT (3) | orbit camera, lenses 24/35/50/85 mm, Save shot / recall, Frame/Track actor, Walk to… |
| any | `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo, `Esc` deselect, `` ` `` diagnostics |

`window.studio.ops` exposes the deterministic operation layer (`selectEntity`, `moveEntity`, `rotateEntity`, `findAssets`, `placeAsset`, `moveActorTo`, `turnActorTo`, `setCamera`, `saveShot`, `recallShot`, `setWorldState`, …), the future AI tool surface.

## Layout
- `src/core` data model · `src/world` WorldStore (undo/redo) · `src/storage` OPFS content cache + IndexedDB
- `src/assets` AssetRegistry · `src/runtime` engine, actor, collision, navigation, cameras, studio · `src/ops` operations · `src/ui` Liquid-glass UI
- `public/content` manifest + world packages (prepared GLB, baked collision BVH + navmesh)
- `tools/prepare` offline content preparation · `tools/studio.mjs` headless capture harness

Development runs in the cloud (`npm run dev`); nothing is installed on the user's machine.
