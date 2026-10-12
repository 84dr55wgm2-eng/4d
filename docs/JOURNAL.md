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

## 2026-10-12 — pass 3 (camera, causes, content, parametric creator, sequences, loading)
- **Follow camera:** one framing function for live follow and reset (`snapFollow`); exterior profile 5.4 m / 35 mm,
  interior 3.6 m / 24 mm higher; yaw candidates probed now and 0.6 s ahead, room rectangle respected, segment
  look→camera re-checked after interpolation. Pinch/wheel became a zoom factor on the automatic distance.
- **Real causes fixed:** room ceiling/dado planes had 0–1 UVs under metre tiling (now metre UVs); the café light hung
  0.45 m *above* its ceiling plane (it lit the back face); the global IBL lit interiors like the street. Interiors now
  have their own painted lining cut around openings and a reduced sky share (`INTERIOR_ENV`); the emissive ceiling
  patch was removed. Lights switch by intensity (hiding a light recompiled every shader: 5.5 s in software GL).
- **Furniture height bug:** workstations and counter were 15 cm above the tiled floor (floor offset added twice).
  Positions now come from measured footprints (desk, CRT set incl. keyboard/mouse, chair).
- **Signs:** awnings moved above the shutter box; boards hang on the balcony front or above the awnings; canvas text
  is measured, wrapped, fitted to width and height; weathering is seeded.
- **Shops:** goods boxes replaced by Poly Haven CC0 shelving + goods chosen by trade; shelf levels measured on the
  model; everything instanced (≈30 draw calls for all stocked shops), dressed only near the camera once ready.
- **Creator:** `districtPlan(params)` generates the street; brief reading keeps place/era/constraints, refuses to
  relabel another city, reads « marché » vs « marche vers » in context; capacity measured by trial composition.
- **Sequences:** stop cancels the walk/approach/waits; seek/export report failures; stale timing detected by key;
  held objects in the start state; actions editable (add/remove/reorder/retarget/re-time), cuts follow their action.
- **Loading:** obstacles from manifest footprints (routes independent of streaming); instance refcounts and
  eviction of unused models; protected ids (interaction target, held objects, sequence targets).
- Published Yaba package carries `revision`; an older saved copy is kept as « … (avant mise à jour) ».

## 2026-10-12 — Studio de lieux, contenu GTA séparé
- Correction de mission appliquée : pas d’acquisition des fichiers du jeu, pas de redistribution ; le studio public
  ne lit que des paquets préparés ; les archives brutes passent par un service privé chez le propriétaire.
- Trois environnements (public / préparation / données locales) ; paquet `cws-package` v1 comme frontière.
- Opérations d’assemblage au contrat Pascal, une transaction par appel, vérifiées avant commit (navmesh compris).
- Les constructions Recast concurrentes faisaient avorter la page : reconstructions sérialisées.
- La vérification a révélé une porte infranchissable dans la fixture (dalle limitée à l’intérieur des murs) :
  fixture corrigée, paquet de test reconstruit.
- Agent : la boucle d’outils tourne dans le navigateur ; le relais ne fait que porter la clé. Vérifié avec un
  fournisseur scripté de test, jamais présenté comme un modèle.
- Accueil : lieu vide par défaut ; Yaba et l’acteur RPM ne sont plus montrés comme livraison.
