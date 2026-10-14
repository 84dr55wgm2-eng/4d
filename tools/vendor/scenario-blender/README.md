# Reused Scenario Blender toolkit

Unmodified `bx_materials.py` and `bx_audit.py` from scenario-labs/skills,
commit `907764d4490920a913b60947f9b673359b7a002e` (MIT, licence alongside).

Sources:
- skills/dcc/blender/scenario-blender-texturing-shading/scripts/bx_materials.py
- skills/dcc/blender/scenario-blender-expert/scripts/bx_audit.py

`tools/prepare/scenario_assets.py` executes the actual material builder and
material/mesh checks under Blender 5.2.1. This is the offline skills lane, not
the GPL Scenario Blender cloud-generation extension. It does not request paid
generations, need Scenario credentials, or install software on the user's device.

Output and limitations are recorded in the world's Blender report and provenance.
