"""Check exported character poses in Blender (including frames between keys).

Run: blender -b --python-exit-code 1 --python scripts/verify_character.py
Checks intersections between left/right legs and between forearms/hands and the
central torso. It intentionally does not count adjoining joints as collisions.
"""
import os
import bpy
from mathutils.bvhtree import BVHTree

base = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
path = os.path.join(base, 'client', 'public', 'assets', 'glb', 'characters', 'protagonist.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=path)
rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
mesh = next(obj for obj in bpy.context.scene.objects if obj.type == 'MESH')
groups = {group.index: group.name for group in mesh.vertex_groups}
regions = {
    'leftleg': {'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToes'},
    'rightleg': {'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToes'},
    'leftarm': {'LeftForeArm', 'LeftHand'},
    'rightarm': {'RightForeArm', 'RightHand'},
    'torso': {'Hips', 'Spine', 'Spine1', 'Spine2', 'Chest', 'UpperChest'},
}
dominant = []
for vertex in mesh.data.vertices:
    weight = max(vertex.groups, key=lambda item: item.weight, default=None)
    dominant.append(groups.get(weight.group, '') if weight else '')
mesh.data.calc_loop_triangles()
faces = {name: [tuple(face.vertices) for face in mesh.data.loop_triangles
                if sum(dominant[index] in bones for index in face.vertices) >= 2]
         for name, bones in regions.items()}
assert all(faces.values()), 'Missing skinned body regions'
for name in ('idle', 'run'):
    action = bpy.data.actions[name]
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]
    start, end = map(int, action.frame_range)
    for sample in range(start * 2, end * 2 + 1):
        bpy.context.scene.frame_set(sample // 2, subframe=(sample % 2) / 2)
        evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        deformed = evaluated.to_mesh()
        vertices = [vertex.co for vertex in deformed.vertices]
        trees = {key: BVHTree.FromPolygons(vertices, triangles, all_triangles=True) for key, triangles in faces.items()}
        for left, right in (('leftleg', 'rightleg'), ('leftarm', 'torso'), ('rightarm', 'torso')):
            overlap = trees[left].overlap(trees[right])
            if overlap:
                raise AssertionError(f'{name} frame {sample / 2}: {left}/{right} intersect ({len(overlap)} faces)')
        evaluated.to_mesh_clear()
print('Character idle/run: no intersections in checked limb/torso regions at half-frame intervals')
