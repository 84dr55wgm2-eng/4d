# Resume state

_Last pass: 2026-10-12 — Yaba, Lagos 2003._

## Works in the product (verified by driving the real app)
- `?world=yaba`: street with sidewalks, drains, poles and overhead wires, 14 semantic buildings, period vehicles,
  street props, an accessible cybercafé (6 CRT workstations, fluorescent bank, fans, counter, notices).
- Tap actor → tap destination → navmesh path, automatic follow camera. Closed door blocks with an explicit message.
- Door open/close, chair sit/stand, light toggle, pickable objects; states saved with the world.
- French commands: enlarge café (street unchanged), add workstations on a wall, move selected chair to selected
  computer (swaps with an empty chair already there), time of day; all undoable.
- Relations graph (`in`, `seatFor`, `onSurface`, `faces`, `connects`, `partOf`) kept in the world document.
- Reference sequence: 3 shots (wide, follow, interior) anchored to 3 actions, fixed-step rehearsal, seek restores the
  start state, video export (WebM/MP4 via WebCodecs).
- Sector streaming: entities load within 34 m of actor/camera.

## Known limits
- No Lagos-specific building pack exists in reachable sources: architecture is semantic construction + CC0 scans.
- Missing: danfo bus, okada, market stalls, pedestrians/extras.
- Command parser is not an LLM (needs a server relay to stay keyless).
- Export needs WebCodecs (desktop Chrome/Edge; Safari partial). No real-iPhone measurement has been done.

## Next actions
- Danfo / okada acquisition (Objaverse search lane), cables PC → wall, low partitions between workstations.
- Camera paths between cuts; head look-at toward the target object.
- Server relay for an LLM planner calling `window.studio.tools`.
