"""Export the complete authored CC0 Hidden Alley scene; run from repo root in Blender 4.2.
Source: https://blog.polyhaven.com/hidden-alley/
This exports a visual environment. It does not import GTA or supply population/AI.
"""
import bpy,json
from pathlib import Path
ROOT=Path('tools/work/hidden-alley')
SOURCE=ROOT/'source'
OUT=ROOT/'export'
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
with bpy.data.libraries.load(str(SOURCE/'ph_hidden_alley.blend'),link=False) as (a,b):
    b.collections=['ph_hidden_alley']
for collection in b.collections:
    if collection:bpy.context.scene.collection.children.link(collection)
excluded=[]
for o in list(bpy.context.scene.objects):
    if o.type not in {'MESH','EMPTY'} or o.hide_render or any(c.name in {'Fog','Light Blockers','Sky'} for c in o.users_collection):
        excluded.append(o.name)
        bpy.data.objects.remove(o,do_unlink=True)
        continue
    for m in list(o.modifiers):
        if m.type in {'SUBSURF','NODES','PARTICLE_SYSTEM'}:o.modifiers.remove(m)
        elif m.type=='BEVEL':m.segments=min(m.segments,2)
    if o.type=='MESH' and len(o.data.vertices)>100000:
        m=o.modifiers.new('Web vegetation LOD','DECIMATE')
        m.ratio=0.18
texfiles={p.name:p for p in (SOURCE/'textures').rglob('*') if p.is_file()}
used={n.image for o in bpy.context.scene.objects if o.type=='MESH' for m in o.data.materials if m and m.use_nodes for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image}
for image in bpy.data.images:
    if image not in used:continue
    cached=OUT/(image.name.replace('/','_')+'.png')
    if cached.exists():
        image.filepath=str(cached.resolve())
        image.buffers_free()
        continue
    print('IMAGE',image.name,flush=True)
    p=texfiles.get(Path(image.filepath).name) or texfiles.get(image.name)
    if p:
        image.filepath=str(p.resolve())
        image.reload()
    if image.size[0]>1024 or image.size[1]>1024:
        k=min(1024/image.size[0],1024/image.size[1])
        image.scale(max(1,int(image.size[0]*k)),max(1,int(image.size[1]*k)))
    if image.size[0] and image.type not in {'RENDER_RESULT','COMPOSITING'}:
        image.filepath_raw=str(cached.resolve())
        image.file_format='PNG'
        image.save()
        image.buffers_free()
converted=[]
for mat in bpy.data.materials:
    if not mat.use_nodes:continue
    nodes=mat.node_tree.nodes
    images=[n.image for n in nodes if n.type=='TEX_IMAGE' and n.image]
    if not images:continue
    original=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None)
    base=list(original.inputs['Base Color'].default_value) if original else [0.5,0.5,0.5,1]
    rough=original.inputs['Roughness'].default_value if original else 0.8
    metal=original.inputs['Metallic'].default_value if original else 0
    def pick(words):return next((i for i in images if any(w in i.name.lower() for w in words)),None)
    diffuse=pick(['_diff','albedo','basecolor','base_color'])
    if not diffuse:continue
    normal=pick(['_nor','normal'])
    roughness=pick(['_rough'])
    metallic=pick(['_metal'])
    alpha=pick(['_alpha','opacity'])
    nodes.clear()
    out=nodes.new('ShaderNodeOutputMaterial')
    p=nodes.new('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value=base
    p.inputs['Roughness'].default_value=rough
    p.inputs['Metallic'].default_value=metal
    mat.node_tree.links.new(p.outputs['BSDF'],out.inputs['Surface'])
    def link(image,socket):
        if not image:return
        t=nodes.new('ShaderNodeTexImage')
        t.image=image
        mat.node_tree.links.new(t.outputs['Color'],p.inputs[socket])
        return t
    link(diffuse,'Base Color')
    link(roughness,'Roughness')
    link(metallic,'Metallic')
    if normal:
        t=nodes.new('ShaderNodeTexImage')
        t.image=normal
        n=nodes.new('ShaderNodeNormalMap')
        mat.node_tree.links.new(t.outputs['Color'],n.inputs['Color'])
        mat.node_tree.links.new(n.outputs['Normal'],p.inputs['Normal'])
    if alpha:
        link(alpha,'Alpha')
        mat.surface_render_method='DITHERED'
    converted.append(mat.name)
bpy.context.view_layer.update()
with open(OUT/'report.json','w') as f:
    json.dump({'objects':len(bpy.context.scene.objects),'excluded':excluded,'materialBridge':converted},f,indent=2)
print('EXPORT',len(bpy.context.scene.objects),flush=True)
bpy.ops.export_scene.gltf(filepath=str((OUT/'scene.gltf').resolve()),export_format='GLTF_SEPARATE',export_apply=True,export_cameras=False,export_lights=False,export_animations=False,export_materials='EXPORT',export_extras=True)
print('EXPORTED',flush=True)
