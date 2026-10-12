# Cinematic World Studio

Browser-native studio for building cinematic scenes in real, authored worlds: explore with a human actor, stage cameras, edit the world semantically. Runs entirely in the browser; content is data (manifest → cache → runtime).

**Worlds:** Yaba, Lagos — 2003 (semantic construction + Poly Haven CC0 / Objaverse CC-BY content, `?world=yaba`) · Paris Bistro Street (Amazon Lumberyard Bistro, CC-BY 4.0) · **Actor:** Ready Player Me rig + RPM motion library

## Controls (touch first)
| Mode | |
|---|---|
| EXPLORE | tap the actor, then tap a destination (pathfinding + automatic camera); tap again elsewhere to change destination, ■ to stop; tap a door / chair / light / object for its actions (Ouvrir, S'asseoir, Allumer, Prendre…) |
| EDIT | tap to select, gizmo buttons for move/rotate/scale, tap empty space to deselect, lock, undo/redo; world menu → « Modifier ce monde » for French commands |
| DIRECT | lenses, save/recall shots; « Séquence » → reference scene, timeline, play/seek, re-time, video export (WebCodecs) |
| keyboard (optional) | `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo, `Esc` deselect, `` ` `` diagnostics |

`window.studio.ops` exposes the deterministic operation layer (`selectEntity`, `moveEntity`, `rotateEntity`, `findAssets`, `placeAsset`, `moveActorTo`, `turnActorTo`, `setCamera`, `saveShot`, `recallShot`, `setWorldState`, `command`, `createReferenceSequence`, …); `window.studio.tools` groups them into toolsets (`world.*`, `direction.*`). The French command parser is deterministic, not a language model: wiring an LLM needs a server-side relay so no key ships in this static frontend.

## Layout
- `src/core` data model · `src/world` WorldStore (undo/redo) · `src/storage` OPFS content cache + IndexedDB
- `src/assets` AssetRegistry · `src/runtime` engine, actor, collision, navigation, cameras, studio · `src/ops` operations · `src/ui` Liquid-glass UI
- `public/content` manifest + world packages (prepared GLB, baked collision BVH + navmesh)
- `tools/prepare` offline content preparation · `tools/studio.mjs` headless capture harness

Development runs in the cloud (`npm run dev`); nothing is installed on the user's machine.
