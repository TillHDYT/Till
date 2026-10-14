# Vorschau-Render der Statue (wird aus guardian.py heraus ausgeführt).
import math as _m

import bpy as _bpy
from mathutils import Vector as _V


def render_preview(path, yaw=-0.45, pitch=0.42, dist=17.0, res=(560, 720), samples=24):
    sc = _bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.resolution_x, sc.render.resolution_y = res
    w = _bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.06, 0.07, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    sc.world = w
    target = _V((0, 0, 4.6))
    cam_d = _bpy.data.cameras.new("cam")
    cam_d.lens = 50
    cam = _bpy.data.objects.new("cam", cam_d)
    sc.collection.objects.link(cam)
    cam.location = target + _V((_m.sin(yaw) * _m.cos(pitch), -_m.cos(yaw) * _m.cos(pitch), _m.sin(pitch))) * dist
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    for nm, loc, en, col in (("key", (-6, -8, 12), 2200, (1, 0.93, 0.82)), ("fill", (8, -4, 6), 700, (0.7, 0.8, 1.0)), ("rim", (2, 9, 9), 1300, (1, 0.6, 0.45))):
        ld = _bpy.data.lights.new(nm, "AREA")
        ld.energy = en
        ld.size = 6
        ld.color = col
        lo = _bpy.data.objects.new(nm, ld)
        sc.collection.objects.link(lo)
        lo.location = loc
        lo.rotation_euler = (target - _V(loc)).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = path
    _bpy.ops.render.render(write_still=True)


if PREVIEW:
    render_preview(PREVIEW)
