"""Convert CodeWalker XML drawables (and peds/clips) to glTF with Blender + Sollumz, headless.

    blender --background --factory-startup --python tools/gta/blender/sollumz_to_gltf.py -- \
        --in <work>/xml --out <work>/gltf [--names a,b] [--peds <ped list>] [--clips <ycd names>]

Prerequisites (conversion environment only, never the end user's machine):
  * Blender >= 4.2 with the Sollumz extension installed and enabled (GPL-3.0, pinned in docs/gta-pipeline.md),
    and its required `szio` dependency (Sollumz installs it from its own index). The XML route is used, so the
    Windows-only PyMateria binary importer is not needed.
  * Input: CodeWalker XML written by `cw-extract extract` (ydr/ydd/yft/ybn/ycd .xml + their .dds textures).

Per drawable it writes <out>/<name>.glb (render geometry, highest LOD, materials bridged to glTF PBR) and,
when collisions exist, <out>/<name>.col.glb. It is resumable: files already converted are skipped, and a
<out>/convert-state.json lists done / failed items with the error text.

GTA shaders are not glTF materials: the bridge keeps the diffuse (base colour + alpha), the bump map (normal map),
emissive shaders (emission from the diffuse), vertex colours, and records the GTA shader name and its
parameters in the material extras. Specular maps are not PBR roughness; they are recorded, not converted.
"""
import json
import os
import sys
import traceback
from pathlib import Path

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opts = {argv[i][2:]: argv[i + 1] for i in range(0, len(argv) - 1, 2) if argv[i].startswith("--")}
IN = Path(opts["in"]).resolve()
OUT = Path(opts["out"]).resolve()
OUT.mkdir(parents=True, exist_ok=True)
STATE = OUT / "convert-state.json"
state = json.loads(STATE.read_text()) if STATE.exists() else {"done": [], "failed": {}}


def save_state():
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1))
    tmp.replace(STATE)


def enable_sollumz():
    import addon_utils
    for mod in addon_utils.modules():
        if mod.__name__.split(".")[-1] in ("sollumz", "sollumz_dev"):
            addon_utils.enable(mod.__name__, default_set=True)
            return mod.__name__
    raise RuntimeError("Sollumz is not installed in this Blender (needed to read CodeWalker XML drawables)")


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    enable_sollumz()


def sollum_type(obj):
    return getattr(obj, "sollum_type", "") or ""


def find_image(node_tree, names):
    for n in node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.name in names and n.image is not None:
            return n
    return None


def bridge_material(mat):
    """Rebuild a Sollumz shader material as a plain Principled BSDF the glTF exporter understands."""
    if not mat or not mat.use_nodes:
        return
    nt = mat.node_tree
    shader = getattr(mat, "shader_properties", None)
    shader_name = getattr(shader, "name", "") or mat.name
    params = {n.name: (list(n.image.size) if n.type == "TEX_IMAGE" and n.image else None) for n in nt.nodes if n.type == "TEX_IMAGE"}
    diffuse = find_image(nt, ("DiffuseSampler", "TextureSampler", "DiffuseSampler1", "diffusetexture"))
    bump = find_image(nt, ("BumpSampler", "NormalSampler", "BumpSampler1"))
    spec = find_image(nt, ("SpecSampler",))
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    # fresh, minimal graph: keep the image nodes, drop everything else
    keep = {n for n in (diffuse, bump) if n}
    for n in list(nt.nodes):
        if n not in keep:
            nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = 0.75
    alpha = any(k in shader_name.lower() for k in ("alpha", "cutout", "decal", "glass", "cloth", "leaves", "grass"))
    if diffuse:
        nt.links.new(diffuse.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha:
            nt.links.new(diffuse.outputs["Alpha"], bsdf.inputs["Alpha"])
            mat.blend_method = "BLEND" if "glass" in shader_name.lower() else "CLIP"
        if "emissive" in shader_name.lower():
            nt.links.new(diffuse.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 1.0
    if bump:
        bump.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(bump.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    # provenance for the studio (exported as glTF extras)
    mat["gta_shader"] = shader_name
    mat["gta_textures"] = json.dumps(params)
    mat["gta_spec_texture"] = spec.image.name if spec and spec.image else ""


def keep_highest_lod():
    """Sollumz keeps LOD meshes on each model object; select the highest available for export."""
    for obj in bpy.data.objects:
        lods = getattr(obj, "sz_lods", None)
        if lods is None:
            continue
        for level in ("sollumz_veryhigh", "sollumz_high", "sollumz_medium", "sollumz_low", "sollumz_verylow"):
            try:
                if lods.get_lod(level).mesh is not None:
                    lods.active_lod_level = level
                    break
            except Exception:
                continue


def export(path, objects, animations=False):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_extras=True, export_vertex_color="ACTIVE", export_animations=animations, export_skins=True,
        export_image_format="AUTO",
    )


def convert(xml_file: Path):
    name = xml_file.name.split(".")[0]
    reset_scene()
    bpy.ops.sollumz.import_assets(directory=str(xml_file.parent), files=[{"name": xml_file.name}])
    for mat in bpy.data.materials:
        bridge_material(mat)
    keep_highest_lod()
    objs = list(bpy.data.objects)
    bounds = [o for o in objs if sollum_type(o).startswith("sollumz_bound")]
    render = [o for o in objs if o not in bounds and o.type in ("MESH", "ARMATURE", "EMPTY")]
    clips = [p for p in (IN / "ycd").glob(f"{name}*.ycd.xml")] if (IN / "ycd").exists() else []
    for c in clips:  # peds: their clip dictionary, applied to the imported skeleton
        bpy.ops.sollumz.import_assets(directory=str(c.parent), files=[{"name": c.name}])
    export(OUT / f"{name}.glb", render, animations=bool(clips))
    if bounds:
        for b in bounds:
            b.hide_render = False
        export(OUT / f"{name}.col.glb", [b for b in bounds if b.type == "MESH"])


def main():
    enable_sollumz()
    names = set(opts["names"].split(",")) if "names" in opts else None
    todo = []
    for sub in ("ydr", "ydd", "yft"):
        d = IN / sub
        if d.exists():
            todo += [f for f in sorted(d.glob(f"*.{sub}.xml")) if names is None or f.name.split(".")[0] in names]
    cache = state.setdefault("sources", {})  # name -> sha256 of the original it was converted from
    for i, f in enumerate(todo):
        name = f.name.split(".")[0]
        src = f.parent / f"{name}.source.json"
        sha = json.loads(src.read_text()).get("sha256") if src.exists() else None
        # cache by source identity: same original bytes -> keep the glb; a changed original (patch, DLC) re-converts
        if name in state["done"] and (OUT / f"{name}.glb").exists() and cache.get(name) == sha:
            continue
        try:
            convert(f)
            if name not in state["done"]:
                state["done"].append(name)
            cache[name] = sha
            state["failed"].pop(name, None)
        except Exception as e:  # recorded, the batch goes on
            state["failed"][name] = f"{type(e).__name__}: {e}"
            traceback.print_exc()
        save_state()
        print(json.dumps({"step": "convert", "i": i + 1, "total": len(todo), "name": name}), flush=True)
    print(json.dumps({"step": "convert", "complete": True, "done": len(state["done"]), "failed": state["failed"]}), flush=True)


main()
