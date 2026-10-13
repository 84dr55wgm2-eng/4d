# Blender trial — verified 2026-10-13

The complete authored Poly Haven Hidden Alley scene was exported with Blender 4.2.9, optimized,
and integrated into the existing app with collision and navigation data. Prepared assets are committed,
not dependent on scratch storage. The old actor is not instantiated. Actor-specific directing buttons
are hidden when there is no actor.

The initial capture exposed oversized bricks (lost source world-space shader coordinates) and white
branches (an unsupported procedural colour ramp). A postprocessor restores metre-based UV projection,
a bark colour and alpha masking for foliage/fence cutouts. Corrected views were inspected locally.
GitHub preparation and captures passed in run 38351876210; the two required frames are committed under
public/content/worlds/hidden-alley/review/.

Once deployed, the root and ?world=hidden-alley open the trial. Touch controls: drag to orbit; pinch to zoom.
This is a scenery trial, not GTA, not Lagos, and not acceptance of the user's GTA-V minimum target.
No new performer/population, traffic, interiors, semantic editing of individual authored elements, or
connected inference provider is delivered in this pass. Those remain required for the actual product.

Source: https://blog.polyhaven.com/hidden-alley/ (CC0).
First durable conversion commit: 67ab5da726f9fa9501393caad1c2e6b9723de5a9.
