"""Build one Kenney GLB; export each animation in isolation to avoid NLA blending."""
import bpy, json, os, struct, tempfile
base = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
source = os.path.join(base, 'assets', 'source', 'kenney', 'animated-characters-protagonists')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=os.path.join(source, 'Model', 'characterMedium.fbx'))
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
rig.animation_data_create()
actions = {}
for name in ('idle', 'run', 'jump'):
    old_objects, old_actions = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=os.path.join(source, 'Animations', name + '.fbx'))
    source_rig = next(o for o in set(bpy.data.objects) - old_objects if o.type == 'ARMATURE')
    source_action = next(a for a in set(bpy.data.actions) - old_actions if a.name.lower().endswith('|' + name))
    source_rig.animation_data.action = source_action
    source_rig.animation_data.action_slot = source_action.slots[0]
    # FBX animation rigs are already posed at rest. Copy their global bone
    # orientations, then bake them relative to the model's own bind pose.
    for bone in rig.pose.bones:
        if bone.name not in source_rig.pose.bones:
            continue
        constraint = bone.constraints.new('COPY_ROTATION')
        constraint.target = source_rig
        constraint.subtarget = bone.name
        constraint.owner_space = 'WORLD'
        constraint.target_space = 'WORLD'
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.ops.nla.bake(frame_start=int(source_action.frame_range[0]), frame_end=int(source_action.frame_range[1]),
                     only_selected=False, visual_keying=True, clear_constraints=True,
                     use_current_action=False, bake_types={'POSE'})
    action = rig.animation_data.action
    action.name = name
    actions[name] = action
    rig.animation_data.action = None
    for obj in set(bpy.data.objects) - old_objects:
        bpy.data.objects.remove(obj, do_unlink=True)

def read_glb(path):
    with open(path, 'rb') as stream:
        magic, version, _ = struct.unpack('<4sII', stream.read(12))
        assert magic == b'glTF' and version == 2
        length, chunk = struct.unpack('<I4s', stream.read(8))
        assert chunk == b'JSON'
        document = json.loads(stream.read(length))
        length, chunk = struct.unpack('<I4s', stream.read(8))
        assert chunk == b'BIN\0'
        return document, stream.read(length)

out = os.path.join(base, 'client', 'public', 'assets', 'glb', 'characters', 'protagonist.glb')
with tempfile.TemporaryDirectory(dir=os.path.dirname(out)) as tmp:
    exports = []
    for name, action in actions.items():
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, int(action.frame_range[0]), action)
        path = os.path.join(tmp, name + '.glb')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_animations=True, export_animation_mode='NLA_TRACKS')
        exports.append(read_glb(path))
        rig.animation_data.nla_tracks.remove(track)
    document, data = exports[0]
    data = bytearray(data)
    for extra, blob in exports[1:]:
        assert extra['nodes'] == document['nodes'], 'GLB node order differs between exports'
        view_offset, accessor_offset = len(document['bufferViews']), len(document['accessors'])
        while len(data) % 4: data.append(0)
        offset = len(data)
        data.extend(blob)
        for view in extra['bufferViews']:
            view['byteOffset'] = view.get('byteOffset', 0) + offset
            document['bufferViews'].append(view)
        for accessor in extra['accessors']:
            accessor['bufferView'] += view_offset
            document['accessors'].append(accessor)
        for anim in extra['animations']:
            for sampler in anim['samplers']:
                sampler['input'] += accessor_offset
                sampler['output'] += accessor_offset
            document['animations'].append(anim)
    document['buffers'][0]['byteLength'] = len(data)
    # The FBX material imports with alpha 0 although all four skin atlases
    # are opaque. Export a safe material even before a client applies a skin.
    for material in document.get('materials', []):
        material['alphaMode'] = 'OPAQUE'
        material['doubleSided'] = True
        pbr = material.get('pbrMetallicRoughness', {})
        if 'baseColorFactor' in pbr:
            pbr['baseColorFactor'][3] = 1.0
    encoded = json.dumps(document, separators=(',', ':')).encode('utf-8')
    encoded += b' ' * (-len(encoded) % 4)
    data.extend(b'\0' * (-len(data) % 4))
    with open(out, 'wb') as stream:
        stream.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(encoded) + 8 + len(data)))
        stream.write(struct.pack('<I4s', len(encoded), b'JSON')); stream.write(encoded)
        stream.write(struct.pack('<I4s', len(data), b'BIN\0')); stream.write(data)
