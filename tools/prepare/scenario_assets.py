"""Prepare acquired assets with Scenario's unmodified MIT Blender toolkit.

blender -b --factory-startup --python-exit-code 1 -P tools/prepare/scenario_assets.py -- INPUT OUTPUT
No Scenario cloud generation or account is involved in this offline lane.
"""
import bpy
import json
import os
import sys
import bmesh
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools/vendor/scenario-blender'))
import bx_materials as M
import bx_audit
from bpy_extras.anim_utils import action_get_channelbag_for_slot


def export(path, objects, animations=False):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
        export_animations=animations, export_animation_mode='ACTIONS',
        export_force_sampling=True, export_yup=True, export_image_format='AUTO')


def main():
    inp, out = sys.argv[sys.argv.index('--') + 1:]
    os.makedirs(out, exist_ok=True)
    report = {'blender': bpy.app.version_string, 'toolkit': 'scenario-labs/skills', 'materials': {}, 'assets': {}}

    # Reuse two authored rigs sharing the Mixamo skeleton. Copy rotation channels
    # into the recipient's own rig; retain its rest translations and mesh weights.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(inp, 'Soldier.glb'))
    source = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    source.name = 'MotionSource'
    source_objects = list(bpy.context.scene.objects)
    motions = {name: bpy.data.actions.get(name) for name in ['Idle', 'Walk', 'Run']}
    bpy.ops.import_scene.gltf(filepath=os.path.join(inp, 'Michelle.glb'))
    target = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE' and o != source)
    target.name = 'Performer'
    target.animation_data_clear()
    for old in list(bpy.data.actions):
        if old.name.startswith(('Samba', 'TPose')):
            bpy.data.actions.remove(old)
    # The source scale and the target scale agree (Mixamo centimetres). Keep the
    # target's limb translations instead of importing the source's proportions.
    new_actions = []
    for name, action in motions.items():
        slot = next(s for s in action.slots if 'Character' in s.identifier)
        source.animation_data_create()
        source.animation_data.action = action
        source.animation_data.action_slot = slot
        new = bpy.data.actions.new(name + '.civilian')
        target.animation_data_create()
        target.animation_data.action = new
        new_slot = new.slots.new(id_type='OBJECT', name=target.name)
        target.animation_data.action_slot = new_slot
        for frame in range(int(action.frame_range[0]), int(action.frame_range[1]) + 1):
            bpy.context.scene.frame_set(frame)
            desired = {}
            for bone in target.pose.bones:
                src = source.pose.bones.get(bone.name)
                if not src:
                    continue
                # Transfer world rotation deltas between the two actual rest
                # bases. Copying local quaternion values left the arms raised.
                rest = bone.bone.matrix_local.to_quaternion()
                delta = src.matrix.to_quaternion() @ src.bone.matrix_local.to_quaternion().inverted()
                desired[bone.name] = delta @ rest
            for bone in target.pose.bones:
                if bone.name not in desired:
                    continue
                rest = bone.bone.matrix_local.to_quaternion()
                parent = bone.parent
                base = (desired.get(parent.name, parent.matrix.to_quaternion()) @ parent.bone.matrix_local.to_quaternion().inverted() @ rest) if parent else rest
                bone.rotation_mode = 'QUATERNION'
                bone.rotation_quaternion = base.inverted() @ desired[bone.name]
                bone.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=bone.name)
        new.use_fake_user = True
        new_actions.append(new)
    target.animation_data.action = new_actions[0]
    target.animation_data.action_slot = new_actions[0].slots[0]
    bpy.context.scene.frame_set(0)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' and m.object == target for m in o.modifiers)]
    keep = {target, *meshes}
    for o in list(bpy.context.scene.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a not in new_actions:
            bpy.data.actions.remove(a)
    for mesh in meshes:
        report['assets'][mesh.name] = {'vertices': len(mesh.data.vertices), 'bones': len(target.data.bones), 'clips': [a.name for a in new_actions]}
        # Adapt the authored character into an ordinary civilian: remove the
        # disconnected headset/lenses and the oversized hair puffs. Keep eyes,
        # face, central hair, skin weights and the actual authored clothing.
        data = mesh.data
        adj = [[] for _ in data.vertices]
        for edge in data.edges:
            a, b = edge.vertices
            adj[a].append(b); adj[b].append(a)
        seen, remove, pants, tops = set(), set(), set(), set()
        for start in range(len(adj)):
            if start in seen:
                continue
            todo, ids = [start], []
            seen.add(start)
            while todo:
                k = todo.pop(); ids.append(k)
                for nxt in adj[k]:
                    if nxt not in seen:
                        seen.add(nxt); todo.append(nxt)
            points = [data.vertices[k].co for k in ids]
            lo = [min(p[i] for p in points) for i in range(3)]
            hi = [max(p[i] for p in points) for i in range(3)]
            lenses = lo[1] > 141 and hi[1] < 149 and lo[2] > 8.1 and (lo[0] > .7 or hi[0] < -.7)
            headset = lo[1] > 139 and hi[1] < 161 and hi[2] < 4.6 and len(ids) > 400
            puffs = lo[1] > 138 and max(abs(lo[0]), abs(hi[0])) > 20 and len(ids) < 150
            if lenses or headset or puffs:
                remove.update(ids)
            elif lo[1] > 20 and hi[1] < 105 and len(ids) > 200:
                pants.update(ids)
            elif lo[1] > 110 and hi[1] < 133 and len(ids) > 200 and max(abs(lo[0]), abs(hi[0])) < 20:
                tops.update(ids)
        cloth = M.pbr_from_textures('Civilian.trousers', {}, uv_map='UVMap', ao_mode='gltf')
        shirt = M.pbr_from_textures('Civilian.shirt', {}, uv_map='UVMap', ao_mode='gltf')
        for mat, color in [(cloth, (.035, .045, .06, 1)), (shirt, (.36, .25, .16, 1))]:
            M.principled(mat).inputs['Base Color'].default_value = color
            M.principled(mat).inputs['Roughness'].default_value = .85
        data.materials.append(cloth); data.materials.append(shirt)
        for face in data.polygons:
            if all(v in pants for v in face.vertices): face.material_index = len(data.materials) - 2
            elif all(v in tops for v in face.vertices): face.material_index = len(data.materials) - 1
        bm = bmesh.new(); bm.from_mesh(data); bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in remove], context='VERTS')
        bm.to_mesh(data); bm.free()
        report['assets'][mesh.name]['removed_accessory_vertices'] = len(remove)
    export(os.path.join(out, 'civilian.glb'), list(keep), True)
    for variant, trouser_color, shirt_color in [('olive', (.12,.16,.08,1),(.5,.44,.32,1)),('rust',(.23,.08,.04,1),(.035,.1,.09,1))]:
        M.principled(cloth).inputs['Base Color'].default_value = trouser_color
        M.principled(shirt).inputs['Base Color'].default_value = shirt_color
        export(os.path.join(out, 'civilian-' + variant + '.glb'), list(keep), True)

    # Adapt the acquired food stall instead of rebuilding a stall from boxes.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(inp, 'stall.glb'))
    removed = []
    for o in list(bpy.context.scene.objects):
        if any(s in o.name for s in ['LETTER_', 'POSTER', 'BANNER', 'LANTERN', 'BOARD_', 'LONG_POSTER']):
            removed.append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
    for mat in list(bpy.data.materials):
        if not mat.use_nodes:
            continue
        # Imported glTF carries independent PBR maps; preserve them and correct
        # data-map colour spaces by their actual socket connections.
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                consumers = [link.to_socket.name for link in node.outputs['Color'].links]
                if consumers and all(c not in ['Base Color', 'Emission Color'] for c in consumers):
                    node.image.colorspace_settings.name = 'Non-Color'
        report['materials'][mat.name] = M.audit_material(mat)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    # The source's small baked atlas contains constant dark patches. Adapt the
    # actual timber parts with the acquired scanned wood set, using the upstream
    # PBR builder (explicit UV map, ORM data and OpenGL normals).
    maps = {'base_color': os.path.join(inp, 'textures/wooden_table_02_diff_1k.jpg'),
            'normal': os.path.join(inp, 'textures/wooden_table_02_nor_gl_1k.jpg'),
            'orm': os.path.join(inp, 'textures/wooden_table_02_arm_1k.jpg')}
    wood = M.pbr_from_textures('Market.scanned_timber', maps, uv_map='UVMap', ao_mode='gltf')
    metal = M.pbr_from_textures('Market.painted_metal', {}, uv_map='UVMap', ao_mode='gltf')
    M.principled(metal).inputs['Base Color'].default_value = (0.07, 0.19, 0.15, 1)
    M.principled(metal).inputs['Roughness'].default_value = 0.78
    for obj in meshes:
        obj.data.materials.clear()
        obj.data.materials.append(metal if any(s in obj.name for s in ['CHAIN', 'RING', 'ROOF', 'HOLDER', 'SHED']) else wood)
    report['materials']['Market.scanned_timber'] = M.audit_material(wood)
    bpy.context.view_layer.update()
    bounds = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector(tuple(min(p[i] for p in bounds) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in bounds) for i in range(3)))
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    # glTF import is Z-up in Blender. A 3.5 m stall leaves the central route open.
    scale = 3.5 / (hi.x - lo.x)
    holder = bpy.data.objects.new('MarketStall', None)
    bpy.context.scene.collection.objects.link(holder)
    for o in list(bpy.context.scene.objects):
        if o != holder and o.parent is None:
            o.parent = holder
    holder.location = -centre * scale
    holder.scale = (scale,) * 3
    export(os.path.join(out, 'market-stall.glb'), list(bpy.context.scene.objects))
    report['assets']['market-stall'] = {'removed_regional_signs': removed, 'source_width': hi.x - lo.x, 'target_width': 3.5}

    # A product-specific sign is a small adaptation. Scenario's material builder
    # makes its exportable PBR graph; the text is real geometry in the GLB.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mat = M.pbr_from_textures('KOVA.market.paint', {}, uv_map='UVMap', ao_mode='gltf')
    M.principled(mat).inputs['Base Color'].default_value = (0.035, 0.16, 0.12, 1)
    M.principled(mat).inputs['Roughness'].default_value = 0.75
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.25))
    board = bpy.context.object
    board.name = 'SignBoard'
    board.scale = (3.4, 0.06, 0.5)
    board.data.materials.append(mat)
    paint = M.pbr_from_textures('KOVA.market.lettering', {}, uv_map='UVMap', ao_mode='gltf')
    M.principled(paint).inputs['Base Color'].default_value = (0.82, 0.65, 0.26, 1)
    M.principled(paint).inputs['Roughness'].default_value = 0.7
    for text, size, z in [('LAGOS  •  MARKET', 0.23, 0.31), ('FRESH FOOD  /  EVERY DAY', 0.105, 0.12)]:
        curve = bpy.data.curves.new('Lettering', 'FONT')
        curve.body = text
        curve.align_x = 'CENTER'
        curve.size = size
        curve.extrude = 0.001
        obj = bpy.data.objects.new(text, curve)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = (0, -0.035, z)
        obj.rotation_euler = (1.57079632679, 0, 0)
        obj.data.materials.append(paint)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.convert(target='MESH')
        obj.select_set(False)
    report['materials']['KOVA.market.paint'] = M.audit_material(mat, board)
    report['assets']['sign'] = {'audit': bx_audit.audit(board)}
    export(os.path.join(out, 'market-sign.glb'), list(bpy.context.scene.objects))
    with open(os.path.join(out, 'blender-report.json'), 'w') as f:
        json.dump(report, f, indent=2, default=str)
    print('RESULT ' + json.dumps({'assets': list(report['assets']), 'blender': report['blender']}))


if __name__ == '__main__':
    main()
