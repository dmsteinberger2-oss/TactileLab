"""TactileLab abdominal aorta lab: parametric infrarenal aneurysm, its two repairs, and renal artery stenosis.

Reuses the aortic arch vessel pipeline (tools/aorta_model.py): every vessel is a tapered tube swept along a
Catmull-Rom centreline, smooth-unioned into one tree and split back into named parts. Two parts are built by
boolean on the fields instead of by partition: the aneurysm sac (wall plus mural thrombus, a shell around the
flow lumen) and the stent rings drawn on the grafts by colour. All geometry is schematic and unreviewed; it is
drawn from textbook anatomy, not from any scan or print.

Frame: mm, +X patient left, +Y superior, +Z anterior. GLBs are written in cm in a slight left anterior oblique.
Usage: python tools/artery_model.py out_dir [stage,stage,...]
"""
import os, sys, json
import numpy as np
import trimesh
sys.path.insert(0, os.path.dirname(__file__))
import aorta_model as A
import kidney_sdf as K
import beauty as B
from aorta_model import decimate, separate_contacts, check_stl, ZERO_MM3, CONTACT_EPS_MM

A.LO, A.HI = (-92, -140, -46), (92, 132, 50)
F = np.float32
GAP = 0.3   # print clearance between the sac shell and the lumen or graft inside it

COLOURS = {'aorta': '#c8443a', 'celiac_trunk': '#d0503f', 'superior_mesenteric': '#d0503f', 'renal_arteries': '#d86450',
           'inferior_mesenteric': '#e07358', 'common_iliacs': '#d0503f', 'external_iliacs': '#d86450', 'internal_iliacs': '#e07358',
           'aneurysm_sac': '#9c4a3c', 'stent_graft': '#d9dde2', 'tube_graft': '#e9e4d8', 'renal_stent': '#c5cbd2',
           'kidneys': '#8a3b32'}
CONTEXT = ('kidneys',)
NECK_Y, BIF_Y = 72.0, 0.0

def lumen(dilate=0.0):
    """Infrarenal aorta centreline: diaphragm to bifurcation, gently anterior over the lumbar lordosis."""
    return [(0, 128, -6, 10.5), (0, 108, -2, 10.2), (0, 88, 1, 9.8), (0, NECK_Y, 3, 9.4), (0, 50, 6, 9.0 + dilate),
            (0, 30, 6, 8.8 + dilate * 0.6), (0, 12, 4, 8.6), (0, BIF_Y, 2, 8.4)]

def sac(rmax):
    """Fusiform infrarenal aneurysm: starts below a ~15 mm neck, widest in its lower middle, ends above the bifurcation."""
    return [(0, NECK_Y - 12, 3, 9.6), (0.5, 56, 6, rmax * 0.72), (1.5, 40, 9, rmax), (1, 24, 7, rmax * 0.82), (0, 12, 4, 9.0)]

def stage_vessels(st):
    V = {}
    V['aorta'] = [lumen()]
    V['celiac_trunk'] = [[(0, 112, 6, 3.8), (0, 114, 18, 3.6), (0, 116, 26, 3.4)],
                         [(0, 116, 26, 3.0), (-16, 114, 28, 2.6), (-34, 110, 24, 2.3)],          # common hepatic
                         [(0, 116, 26, 3.0), (18, 118, 22, 2.8), (40, 116, 10, 2.5)]]           # splenic
    V['superior_mesenteric'] = [[(0, 98, 8, 3.8), (0, 96, 22, 3.6), (-2, 82, 30, 3.4), (-4, 50, 32, 3.0), (-8, 20, 30, 2.6)]]
    V['renal_arteries'] = [[(-2, 82, 0, 3.0), (-22, 80, -4, 2.9), (-40, 78, -10, 2.7), (-50, 78, -14, 2.4)],
                           [(2, 84, 0, 3.0), (20, 84, -4, 2.9), (38, 84, -10, 2.7), (48, 84, -14, 2.4)]]
    V['inferior_mesenteric'] = [[(3, 36, 7, 2.0), (8, 32, 16, 1.9), (18, 18, 20, 1.7), (24, -4, 18, 1.5)]]
    V['common_iliacs'] = [[(-2, 4, 2, 6.0), (-16, -24, 2, 5.6), (-28, -52, 0, 5.4)], [(2, 4, 2, 6.0), (16, -24, 2, 5.6), (28, -52, 0, 5.4)]]
    V['external_iliacs'] = [[(-28, -52, 0, 4.8), (-40, -80, 6, 4.5), (-50, -110, 16, 4.3), (-56, -132, 24, 4.2)],
                            [(28, -52, 0, 4.8), (40, -80, 6, 4.5), (50, -110, 16, 4.3), (56, -132, 24, 4.2)]]
    V['internal_iliacs'] = [[(-28, -52, 0, 3.8), (-33, -70, -12, 3.4), (-36, -88, -20, 3.0)],
                            [(28, -52, 0, 3.8), (33, -70, -12, 3.4), (36, -88, -20, 3.0)]]
    V['kidneys'] = []      # built as ellipsoids below
    extra = {}
    if st in ('aaa_small', 'aaa_large', 'evar'):
        extra['sac'] = sac(21.0 if st == 'aaa_small' else 29.0)
        V['aorta'] = [lumen(dilate=3.0)]
    if st == 'evar':
        # bifurcated stent-graft: main body sealed in the infrarenal neck, limbs landing in both common iliacs
        V['aorta'] = [lumen()[:4]]
        V['stent_graft'] = [[(0, NECK_Y + 2, 3, 10.0), (0, 50, 6, 10.0), (0, 30, 6, 9.6), (0, 22, 5, 9.4)],
                            [(0, 22, 5, 6.2), (-6, 8, 3, 6.1), (-14, -18, 2, 6.0), (-22, -40, 1, 5.9)],
                            [(0, 22, 5, 6.2), (6, 8, 3, 6.1), (14, -18, 2, 6.0), (22, -40, 1, 5.9)]]
        V.pop('inferior_mesenteric')     # its origin is covered by the graft and it thromboses from the excluded sac
        V['common_iliacs'] = [[(-22, -40, 1, 5.5), (-28, -52, 0, 5.4)], [(22, -40, 1, 5.5), (28, -52, 0, 5.4)]]
    if st == 'open_repair':
        # sac opened and replaced by a straight tube graft sewn end to end below the renals and above the bifurcation
        V['aorta'] = [lumen()[:4], [(0, 10, 4, 8.6), (0, BIF_Y, 2, 8.4)]]
        V['tube_graft'] = [[(0, NECK_Y + 1, 3, 9.6), (0, 50, 6, 9.6), (0, 30, 6, 9.6), (0, 9, 4, 9.2)]]
    if st in ('ras', 'renal_stent'):
        # atherosclerotic ostial stenosis of the left renal artery (about 70% diameter), post-stenotic dilatation
        r = 0.9 if st == 'ras' else 2.9
        V['renal_arteries'][1] = [(2, 84, 0, 3.0), (8, 84, -1, r), (14, 84, -2, r), (20, 84, -4, 3.0 if st == 'renal_stent' else 3.3),
                                  (38, 84, -10, 2.8), (48, 84, -14, 2.4)]
        if st == 'renal_stent':
            extra['renal_stent'] = [(5, 84, -0.5, 4.1), (11, 84, -1.5, 4.1), (17, 84, -3, 4.1)]
    return V, extra

def build(st):
    V, extra = stage_vessels(st)
    fld = A.Field()
    D = {k: fld.tube(v) for k, v in V.items() if v}
    vessels = [k for k in D if k not in CONTEXT]
    tree = None
    for k in vessels: tree = D[k] if tree is None else K.smin(tree, D[k], A.FILLET)
    stack = np.stack([D[k] for k in vessels]); order = np.argsort(stack, axis=0)
    m1 = np.take_along_axis(stack, order[:1], 0)[0]; m2 = np.take_along_axis(stack, order[1:2], 0)[0]
    meshes = {}
    P = fld.g.P.reshape(fld.shape + (3,))
    for i, k in enumerate(vessels):
        g = np.where(order[0] == i, D[k] - m2, D[k] - m1)
        m = K.mesh_from(fld.g, np.maximum(tree, g).ravel(), min_vol=8, target=60000 if k in ('aorta', 'stent_graft') else 24000)
        if m is not None: meshes[k] = m
    if 'sac' in extra:
        S = np.maximum(fld.tube([extra['sac']]), -(tree - GAP))     # shell around the lumen (or graft) and any branch crossing it
        m = K.mesh_from(fld.g, S.ravel(), min_vol=8, target=50000)
        if m is not None: meshes['aneurysm_sac'] = m
    if 'renal_stent' in extra:
        outer = fld.tube([extra['renal_stent']], margin=3)
        S = np.maximum(outer, -(D['renal_arteries'] - GAP))       # thin sleeve hugging the treated segment
        m = K.mesh_from(fld.g, S.ravel(), min_vol=2, target=12000)
        if m is not None: meshes['renal_stent'] = m
    # schematic kidneys: hilum faces medially, renal arteries end at the hilum
    kd = None
    for sgn, y in ((-1, 76.0), (1, 82.0)):
        c = np.array([sgn * 72.0, y, -22.0], F); q = (P - c) / np.array([20.0, 50.0, 16.0], F)
        e = (np.sqrt((q ** 2).sum(-1)) - 1.0) * 16.0
        hil = K.sd_sphere(P.reshape(-1, 3), (sgn * 52.0, y, -16.0), 10.0).reshape(fld.shape)
        f = np.maximum(e, -hil)
        kd = f if kd is None else np.minimum(kd, f)
    kd = np.maximum(kd, -(tree - GAP))
    m = K.mesh_from(fld.g, kd.astype(F).ravel(), min_vol=8, target=30000)
    if m is not None: meshes['kidneys'] = m
    whole = K.mesh_from(fld.g, tree.ravel(), min_vol=8, target=90000)
    return meshes, whole

def colour(name, V):
    if name in ('stent_graft', 'renal_stent'):      # stent rings: zig-zag wire bands every 8 mm (3 mm for the renal stent)
        per = 3.0 if name == 'renal_stent' else 8.0
        ang = np.arctan2(V[:, 0], V[:, 2]) if name == 'stent_graft' else np.arctan2(V[:, 1] - 84.0, V[:, 2])
        axis = V[:, 1] if name == 'stent_graft' else V[:, 0]
        u = (axis + 1.2 * np.sin(ang * 6)) / per
        wire = np.exp(-((u - np.round(u)) * per / 0.9) ** 2)
        return (0.92 - 0.42 * wire)[:, None] * np.ones((len(V), 3))
    if name == 'tube_graft':                           # crimped Dacron
        return (0.88 + 0.12 * np.cos(V[:, 1] * 2 * np.pi / 2.2))[:, None] * np.ones((len(V), 3))
    return (0.9 + 0.1 * K.fbm(V, 0.18))[:, None] * np.ones((len(V), 3))

DISPLAY = trimesh.geometry.align_vectors(np.array([0.34, 0.0, 0.94]), [0, 0, 1])[:3, :3]
STAGES_ALL = ['normal', 'aaa_small', 'aaa_large', 'evar', 'open_repair', 'ras', 'renal_stent']

if __name__ == '__main__':
    OUT = sys.argv[1]
    STAGES = sys.argv[2].split(',') if len(sys.argv) > 2 else STAGES_ALL
    os.makedirs(OUT, exist_ok=True)
    B.DEFAULTS.update(COLOURS); A.COLOURS.update(COLOURS)
    for st in STAGES:
        meshes, whole = build(st)
        c = whole.bounds.mean(0)
        disp = {}
        for k, m in meshes.items():
            d = m.copy(); d.apply_translation(-c); T4 = np.eye(4); T4[:3, :3] = DISPLAY; d.apply_transform(T4); disp[k] = d
        B.write_glb(os.path.join(OUT, f'artery_{st}.glb'), B.export_parts(disp, colour, untextured=()))
        A.render(meshes, os.path.join(OUT, f'view_{st}_ant.jpg'), np.eye(3), 420)
        A.render(meshes, os.path.join(OUT, f'view_{st}_lat.jpg'), trimesh.transformations.rotation_matrix(-np.pi / 2, [0, 1, 0])[:3, :3], 420)
        mp = os.path.join(OUT, 'print', 'manifest.json'); os.makedirs(os.path.dirname(mp), exist_ok=True)
        manifest = json.load(open(mp)) if os.path.exists(mp) else {}
        pdir = os.path.join(OUT, 'print', f'artery_{st}_full'); os.makedirs(pdir, exist_ok=True)
        entries, failures = [], []
        for i, (k, m) in enumerate(meshes.items(), 1):
            pm = m.copy()
            comps = pm.split(only_watertight=False)
            if len(comps) > 1:
                keep = [q for q in comps if float(abs(q.volume)) >= max(ZERO_MM3, 5.0)]
                if len(keep) < len(comps): print(f'   {st}/{k}: dropped {len(comps) - len(keep)} tiny shells')
                pm = trimesh.util.concatenate(keep)
            pm, moved = separate_contacts(pm)
            pm.apply_translation([-pm.bounds[:, 0].mean(), -pm.bounds[:, 1].mean(), -pm.bounds[0, 2]])
            fn = f'{i:02d}_{k}.stl'; pm.export(os.path.join(pdir, fn))
            chk = check_stl(os.path.join(pdir, fn))
            if not chk['watertight']: failures.append(f'artery_{st}_full/{fn}: {chk}')
            entries.append(dict(part=k, file=f'artery_{st}_full/{fn}', supports=True, watertight=chk['watertight'],
                                non_manifold_edges=chk['non_manifold_edges'], open_edges=chk['open_edges'], bodies=chk['bodies'],
                                faces=int(len(pm.faces)), volume_cm3=round(float(abs(pm.volume)) / 1000, 2)))
        manifest[f'artery_{st}_full'] = entries
        json.dump(manifest, open(mp, 'w'), indent=1)
        print(st, ' | '.join(f"{e['part']} {e['faces']}f {e['volume_cm3']}cm3{'' if e['watertight'] else ' OPEN'}" for e in entries), flush=True)
        if failures: print('Print check failed:\n  ' + '\n  '.join(failures), flush=True)
