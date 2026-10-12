# World composition / touch pass

The previous world brief only searched for assets. The world menu now offers an editable plan and **Assembler et ouvrir ce décor**, using the same deterministic `world.plan/create` tools. It produces a separate persisted document, loads authored architecture and props, builds Recast navigation and collision, and exposes the world in the catalog after reload. The + button is available on phone screens.

The initial kit supports European exterior streets and courtyards with 2–8 buildings (courtyards: 2–4), ground, vegetation, chair, lantern and a pickable prop. Recognized unsupported location/period/interior requests are shown as content gaps and creation is rejected when the plan has gaps. This is a limited composition kit, not an arbitrary-world AI generator. Native Bistro geometry and the existing actor model/rig/clips are preserved.

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


## Complete scene import — October 12, 2026

The Lagos attempt exposed a product failure: a limited Bistro arrangement was presented under an unsupported place name. The UI now names that mode explicitly as the Bistro kit. A plan with missing content cannot be created through either the UI or `world.create`; already saved incomplete compositions show a warning.

A separate import lane accepts a supplied GLB, a ZIP with one glTF root and its buffers/textures, or a direct CORS-accessible GLB/glTF URL. External provider records use `/files` discovery instead of assuming that every asset can be converted to GLB. Companion bytes persist through the content cache. Environment imports preserve their authored origin, proportions and visible meshes. Scene geometry (including instances) generates collision and tiled Recast navigation; a connected spawn is checked before opening. Collision-only mesh simplification retains the visible asset unchanged. Derived geometry/navigation and imported documents persist in the same browser. Tools `world.import_asset` and `world.import_url` use the same path.

Validation: production build passed; Chromium imported the existing 71 MB Bistro file through the new file lane, built navigation from its scene, walked the original actor, saved and reloaded the imported document. This proves the importer, not a new Lagos environment. A live Poly Haven electricity-pole asset loaded as glTF with seven companion resources and actual model bounds. ZIP embedding, missing dependencies, an empty file and ambiguous archives were checked separately. Street/courtyard central paths and excluded building footprints remain valid with tiled navigation. Existing touch/interactions are covered by the previous regression scenario.

Limits: 200 MB of model/dependency bytes and 500 m footprint per sector; collision is capped at two million triangles after simplification. Spatial cells are metadata, not streaming. Imported environments are an intact scene; individual doors, chairs and shop interiors are not automatically made semantic/interactable. Automatic spawn selection is geometric and may need authored spawn metadata. Mobile hardware performance, signed URL renewal and very large worlds remain unverified. There is no Lagos-specific content pack or arbitrary brief-to-city compiler in this change.
