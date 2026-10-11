# World composition / touch pass

The previous world brief only searched for assets. The world menu now offers an editable plan and **Créer et ouvrir ce monde**, using the same deterministic `world.plan/create` tools. It produces a separate persisted document, loads authored architecture and props, builds Recast navigation and collision, and exposes the world in the catalog after reload. The + button is available on phone screens.

The initial kit supports European exterior streets and courtyards with 2–8 buildings (courtyards: 2–4), ground, vegetation, chair, lantern and a pickable prop. Unsupported location/period/interior requests are shown as content gaps. This is a limited composition kit, not an arbitrary-world AI generator. Native Bistro geometry and the existing actor model/rig/clips are preserved.

Follow camera now tracks heading as well as position, without requiring manual orbit. Actor + ground taps are the primary control, with a Stop button. Editor camera supports mouse and touch orbit/pan/zoom. Superseded movement resolves as interrupted instead of leaving pending interactions. Semantic objects expose contextual actions; small models have expanded screen hit targets. Shared materials are isolated per instance, so one lantern's state does not leak to another.

Chairs use a runtime seated pose on the existing rig, with occupied state and a validated stand point. Pickable props follow the actor's hand until placed on a valid surface. Interaction state persists and restores. The kit does not include doors; open/close is only offered to an individual authored object with hinge metadata. Baked Bistro chairs and doors have not been automatically separated into interactive entities.

## Verification

- `npm run build`: TypeScript and production Vite build pass.
- Real app in Chromium/Playwright, desktop width 1280×720 and touch viewport 390×844: nonblank scene; no relevant page errors; creator form → plan → create → distinct world URL → authored objects → reload.
- Mouse click on actor, then click on ground: actor arrives near [4,0,-3], camera yaw follows heading + π. Touchscreen tap selects the actor on the phone viewport.
- Click on lantern → visible **Éteindre** button → actor approaches → semantic state disabled and runtime light invisible.
- Sit → save → reload: occupied chair and seated actor restore. Stand, pickup, putdown and superseding a pending movement return successful/explicit interrupted results.
- Invalid building move outside the world is rejected without modifying its transform. Separate geometry checks confirm building footprints have no walkable interior floor, and street/courtyard central routes exist.
- Mobile creator remains within viewport (390px document width), scrolls, and exposes creation controls. Screenshots inspected; initial seat orientation and hidden mobile world access were corrected.

Movement was advanced with the runtime's deterministic frame stepping in software WebGL to test the full navigation/animation/camera chain. This is not a device FPS benchmark. Safari/iPhone hardware performance and external WEB provider availability are not verified in this pass.
