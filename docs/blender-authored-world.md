# Authored Blender environment trial

This branch converts the complete CC0 Poly Haven Hidden Alley scene into the existing browser studio.
Source: https://blog.polyhaven.com/hidden-alley/
Blender: 4.2.9 LTS.

This is a scenery conversion trial, not GTA integration or a populated city. No old performer is inserted.
It preserves the authored arrangement. Offline subdivisions and particle systems are removed; the heavy
vegetation receives a mesh LOD; image-based materials are bridged into glTF PBR. Procedural/parallax
materials are not guaranteed equivalent to the original rendering.

The GitHub preparation workflow downloads the source scene, runs Blender, batches geometry spatially,
compresses textures to WebP, applies meshopt and bakes collision/navigation. It builds the web app and
captures the scene before committing prepared content and review frames to this branch. The workflow
does not deploy Pages. Inspect those frames before promoting the branch.

Trial route once prepared content is available: ?world=hidden-alley
