# Scenario Blender + acquired content

This pass reuses executable tooling, not just the reference's prompting ideas.
The MIT Scenario material builder and audit scripts are checked in, attributed
and executed in Blender 5.2.1 through the preparation workflow.

The first route is `?world=lagos-market`: a fictional market adaptation of Poly
Haven's authored Hidden Alley shell, with a BlenderKit stall adapted by removing
its regional lettering, a Poly Haven table, existing scanned goods, a civilian
performer with three animations and six Detour crowd pedestrians.

The same offline preparation runs here and on GitHub Actions. 3D Asset Server
resolves actual files and accompanying textures. Blender prepares them; glTF
Transform optimizes textures and geometry; Recast and three-mesh-bvh bake the
combined static stall and environment geometry. The site uses ordinary GLB
assets and the existing tap-to-direct, camera, interaction and sequence systems.

Runtime changes: authored environments may run the same population as imported
set assemblies. Actors can use animations embedded in their own GLB, and the
sequence start snapshot includes their crowd state. No old RPM actor is injected.

Limitations: adapted fictional environment, not geographic Lagos or GTA; a single
civilian model shared by the crowd; no traffic, new interiors, or live language
model connected. The Scenario paid-generation plugin/MCP is not connected.
This route is a concrete integration trial, not the completed requested city.

Preparation: `node tools/prepare/acquire_scenario_assets.mjs /tmp/kova-scenario-input`,
then Blender's `scenario_assets.py`, `scenario_world.mjs`, and `bake_world.mjs`.
The workflow is `.github/workflows/scenario-market.yml`; it saves prepared assets
and the real-app captures on the review branch before any production promotion.
