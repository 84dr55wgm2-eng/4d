# Journal

## 2026-10-12 — Yaba, Lagos 2003 pass
- **Content acquisition moved to GitHub Actions.** The build sandbox only reaches GitHub and npm; Poly Haven, Objaverse,
  Sketchfab are blocked there. `content-acquire.yml` runs `tools/acquire/acquire.mjs` on the runner, prepares GLB/WebP
  (meshopt, 1–2k) and commits them with a provenance file. Catalogs (Poly Haven 521 models / 868 textures, Objaverse
  keyword hits) are committed in `tools/acquire/catalog/` so choices are reviewable.
- **No Lagos building pack exists in reachable CC0/CC-BY sources.** Architecture is therefore built from a semantic plan
  (walls + openings + rooms, Pascal-style) and rendered with CC0 PBR scans; furniture, street objects and vehicles are
  authored assets. Rejected after visual check: sci-fi desks, a modern flat-screen PC, a 481k-triangle Peugeot without
  textures, a VW bus whose parts were scattered km away, Soviet-style kiosks.
- **Plaster choice:** `white_plaster_rough_02` averages olive (B≈75/255) → replaced by neutral `white_plaster_02` with a
  paint factor ×1.45; HDRI switched from a riverside scene (green IBL cast) to `pedestrian_overpass`.
- **Doorway navigation bug:** no floor under the wall reveal produced a 0.32 m ledge → Recast cut the doorway. Fixed with
  a continuous threshold; district nav uses 0.3 m agent radius on a 15 cm grid.
- **Closed doors are real obstacles:** actor capsule pushes out of closed door boxes and `moveActorTo` refuses paths that
  cross them, with an explicit message.
- **Sequences:** beats (actions) + cuts anchored to beats, measured by fixed-step rehearsal; play/seek always restore the
  captured start state (no accumulated walks or doors). Export renders at a fixed step and encodes with WebCodecs.
- **Sector streaming:** district entities load within 34 m of actor/camera, release beyond 51 m; nav rebuilds when
  obstacles arrive or leave.
- **Commands:** deterministic French intent parser (not an LLM) → validated, undoable operations.
- **Interior look:** `painted_concrete` scan averages green (73,106,79) → dado now gloss-painted plaster; ceiling
  brightened; four canvas notices (price list, rules, services, generator surcharge — fictional wording).
- **« Déplace cette chaise devant cet ordinateur »** on a taken seat now swaps with the empty chair already there
  (refused only if someone sits on it); the reply names both chairs.
- **Touch check (390×844, emulated touch, Chromium):** tap actor → tap ground walks with follow camera; tap door →
  « Ouvrir » walks to the door and opens it (« Fermer » offered after); world menu and sequence panel fit without
  horizontal scroll; on narrow screens the inspector hides while the sequence panel is open. Not a device test.
