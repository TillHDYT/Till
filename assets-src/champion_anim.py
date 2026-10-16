# Holt eine einzelne Mixamo-Animation (FBX) als kleines GLB nur mit Skelett und Animation heraus:
#   python champion_anim.py <animation.fbx> <ausgabe.glb> <Name> [--treffer] [--von s --bis s] [--auf-der-stelle]
# Das Skelett muss dasselbe sein wie beim Champion-Modell (gleiche Knochennamen), dann spielt das
# Spiel die Animation direkt auf dem Modell ab (siehe loadChampionModels in models.ts).
# Mit --treffer wird zusätzlich gemessen, wann die Faust am weitesten vorne ist (Treffermoment eines Schlags);
# Clip-Länge und Trefferzeit gehören dann in `swing` beim Champion in src/game/champions.ts.
import os
import sys

import bpy  # noqa: I001

args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
HIT = "--treffer" in args
# --auf-der-stelle: Hüfte bleibt waagerecht am Platz (Vorwärts- und Seitbewegung raus); die Bewegung macht das Spiel
INPLACE = "--auf-der-stelle" in args
# --von/--bis: nur diesen Ausschnitt (Sekunden ab Clipbeginn) exportieren, z. B. Ausholen und Nachlauf kürzen
CUT = [float(args[args.index(k) + 1]) if k in args else None for k in ("--von", "--bis")]
plain = [a for i, a in enumerate(args) if a not in ("--treffer", "--auf-der-stelle") and a not in ("--von", "--bis") and (i == 0 or args[i - 1] not in ("--von", "--bis"))]
SRC, OUT, NAME = plain[-3:]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
act = arm.animation_data.action
act.name = NAME
sc = bpy.context.scene
f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
fps = sc.render.fps / sc.render.fps_base
mw = arm.matrix_world


def pos(bone, frame):
    sc.frame_set(int(frame), subframe=frame - int(frame))
    return mw @ arm.pose.bones[bone].head


# Kontrolle: bleibt die Figur an ihrem Platz, schließt die Schleife sauber?
h0, h1 = pos("mixamorig:Hips", f0), pos("mixamorig:Hips", f1)
far = max(((pos("mixamorig:Hips", f) - h0).xy.length for f in range(f0, f1 + 1)))
print(f"Dauer {(f1 - f0) / fps:.3f} s ({f1 - f0} Bilder bei {fps:g} fps)")
print(f"Hüfte: Ende - Anfang {(h1 - h0).length * 100:.1f} cm, weiteste Auslenkung {far * 100:.1f} cm")

if HIT:
    # Treffer = die Faust ist am weitesten vorne, während sie schnell schwingt (Haken und Geraden gleichermaßen).
    # vorne ist bei Mixamo -y (Blender), im Spiel +z; gemessen wird die Fingerwurzel, sonst das Handgelenk.
    best = None
    for hand in ("Right", "Left"):
        names = [f"mixamorig:{hand}HandMiddle1", f"mixamorig:{hand}HandIndex1", f"mixamorig:{hand}Hand"]
        bone = next(n for n in names if n in arm.pose.bones)
        steps = [f0 + i * 0.05 for i in range(int((f1 - f0) / 0.05) + 1)]
        pts = [pos(bone, f).copy() for f in steps]
        speed = [(pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).xy.length for i in range(len(pts))]
        vmax = max(speed)
        for f, pt, v in zip(steps, pts, speed):
            fwd = -(pt.y - h0.y)
            if v > 0.5 * vmax and (best is None or fwd > best[0]):
                best = (fwd, f, hand)
    reach, frame, hand = best
    t = (frame - f0) / fps
    dur = (f1 - f0) / fps
    print(f"TREFFER: {hand} Faust am weitesten vorne im Schwung bei Bild {frame:.2f} = {t:.3f} s von {dur:.3f} s ({t / dur:.3f}), {reach * 100:.0f} cm vor der Hüfte")

def fcurves_of(action):
    """F-Kurven einer Aktion (Blender 4.4+ mit Ebenen/Slots oder ältere Form)."""
    if hasattr(action, "layers") and action.layers:
        return [fc for layer in action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
    return list(action.fcurves)


if INPLACE:
    # Hüft-Position: lokale Achsen 0 (seitlich) und 2 (vorwärts) auf den Anfangswert, die Höhe (1) bleibt
    for fc in fcurves_of(act):
        if fc.data_path == 'pose.bones["mixamorig:Hips"].location' and fc.array_index in (0, 2) and len(fc.keyframe_points):
            v0 = fc.keyframe_points[0].co.y
            for k in fc.keyframe_points:
                d = k.co.y - v0
                k.co.y -= d
                k.handle_left.y -= d
                k.handle_right.y -= d
            fc.update()
    print("auf der Stelle: Hüfte waagerecht festgehalten")

# nur Skelett und Animation exportieren, Mesh und Texturen bringt schon das Champion-Modell mit
for o in list(bpy.context.scene.objects):
    if o.type == "MESH":
        bpy.data.objects.remove(o)
if CUT[0] is not None or CUT[1] is not None:
    f0, f1 = (f0 + round(CUT[0] * fps) if CUT[0] is not None else f0), (f0 + round(CUT[1] * fps) if CUT[1] is not None else f1)
    print(f"Ausschnitt Bild {f0}-{f1} = {(f1 - f0) / fps:.3f} s")
sc.frame_start, sc.frame_end = f0, f1
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_frame_range=CUT != [None, None],
    export_skins=True,
    export_yup=True,
)
print("EXPORTED", NAME, act.frame_range[:], os.path.getsize(OUT))
