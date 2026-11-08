"""TactileLab carotid bifurcation lab: atherosclerotic plaque at the left carotid bulb, graded by NASCET, and its
two treatments, endarterectomy with patch closure and carotid stenting.

Reuses the vessel pipeline of tools/aorta_model.py. The plaque is built like the aneurysm sac of the abdominal
aorta lab: a shell between the outline of the bulb and the narrowed flow lumen, so removing it reveals the
lumen. Geometry is drawn in life-size millimetres and scaled by S = 2. Schematic and unreviewed; not from any
scan or print.

Frame (life-size mm before scaling): left neck, +X lateral, +Y superior, +Z anterior.
Usage: python tools/carotid_model.py out_dir [stage,stage,...]
"""
import os, sys, json
import numpy as np
import trimesh
sys.path.insert(0, os.path.dirname(__file__))
import aorta_model as A
import kidney_sdf as K
import beauty as B
from aorta_model import separate_contacts, check_stl, ZERO_MM3

S = 2.0
A.LO, A.HI = (-24, -84, -16), (24, 94, 40)
A.FILLET = 3.0
F = np.float32
GAP = 0.3

COLOURS = {'common_carotid': '#c8443a', 'internal_carotid': '#d0503f', 'external_carotid': '#d86450',
           'eca_branches': '#e07358', 'plaque': '#e2c46e', 'endarterectomy_patch': '#e9e4d8', 'carotid_stent': '#c5cbd2'}

CCA = [(0, -40, 2, 3.5), (0, -25, 1.5, 3.5), (0, -10, 1, 3.6), (0, -1, 0.5, 3.7)]
ICA_N = [(0, -1, 0.5, 3.7), (1.2, 4, -1, 4.3), (2, 9, -2.5, 3.9), (2.5, 15, -3, 2.9), (2.8, 25, -3, 2.6), (3, 44, -2, 2.5)]
ECA = [(0, -1, 0.5, 2.6), (-1, 4, 2.5, 2.4), (-1.5, 12, 5, 2.2), (-1.5, 25, 6, 2.0), (-1, 42, 5, 1.8)]
BR = [[(-1, 4, 2.5, 1.1), (-4, 1, 7, 1.0), (-6, -6, 10, 0.9)],           # superior thyroid
      [(-1.5, 12, 5, 1.0), (-5, 15, 11, 0.9), (-8, 16, 15, 0.85)],      # lingual
      [(-1.5, 18, 5.5, 1.0), (-5, 22, 11, 0.9), (-7, 26, 16, 0.85)]]    # facial
BULB = [(0, -9, 1, 3.75), (0, -1, 0.5, 3.85), (1.2, 4, -1, 4.35), (2, 9, -2.5, 3.95), (2.5, 15, -3, 3.0), (2.7, 19, -3, 2.75)]
DISTAL_R = 2.6     # normal distal cervical ICA radius: the NASCET denominator

def ica_lumen(pct):
    """ICA flow lumen narrowed to pct % (NASCET) at its tightest point, 7 mm above the flow divider."""
    rmin = DISTAL_R * (1 - pct / 100.0)
    return [(0, -1, 0.5, 3.3), (0.9, 3, -0.4, max(rmin * 1.9, 1.8)), (1.6, 7, -1.8, rmin), (2.2, 12, -2.8, max(rmin * 1.5, 1.6)),
            (2.6, 17, -3, 2.65), (2.8, 25, -3, 2.6), (3, 44, -2, 2.5)]

def sc(chains):
    return [[(x * S, y * S, z * S, r * S) for (x, y, z, r) in ch] for ch in chains]

def stage_vessels(st):
    V = {'common_carotid': [CCA], 'internal_carotid': [ICA_N], 'external_carotid': [ECA], 'eca_branches': BR}
    extra = {}
    if st in ('stenosis_moderate', 'stenosis_severe'):
        V['internal_carotid'] = [ica_lumen(60 if st == 'stenosis_moderate' else 80)]
        V['common_carotid'] = [CCA[:-1] + [(0, -1, 0.5, 3.4)]]
        extra['plaque'] = BULB
    if st == 'stent':
        # self-expanding stent from the distal CCA across the bulb into the ICA; plaque compressed, ~20% residual
        lum = [(0, -1, 0.5, 3.4), (0.9, 3, -0.4, 3.0), (1.6, 7, -1.8, 2.3), (2.2, 12, -2.8, 2.4), (2.6, 17, -3, 2.6), (2.8, 25, -3, 2.6), (3, 44, -2, 2.5)]
        V['internal_carotid'] = [lum]
        V['common_carotid'] = [CCA[:-1] + [(0, -1, 0.5, 3.4)]]
        extra['plaque'] = BULB
        extra['stent'] = [(0, -14, 1.2, 3.5 + 0.6), (0, -1, 0.5, 3.95)] + [(x, y, z, r + 0.55) for (x, y, z, r) in lum[1:5]] + [(2.8, 23, -3, 3.15)]
    if st == 'endarterectomy':
        # plaque removed through a longitudinal anterolateral arteriotomy closed with a patch; the bulb is slightly widened
        extra['patch'] = [(0, -14, 1.2, 4.3), (0, -1, 0.5, 4.4), (1.2, 4, -1, 4.9), (2, 9, -2.5, 4.5), (2.5, 15, -3, 3.6), (2.7, 19, -3, 3.3)]
    return {k: sc(v) for k, v in V.items()}, extra

def build(st):
    V, extra = stage_vessels(st)
    fld = A.Field()
    D = {k: fld.tube(v) for k, v in V.items()}
    vessels = list(D)
    tree = None
    for k in vessels: tree = D[k] if tree is None else K.smin(tree, D[k], A.FILLET)
    stack = np.stack([D[k] for k in vessels]); order = np.argsort(stack, axis=0)
    m1 = np.take_along_axis(stack, order[:1], 0)[0]; m2 = np.take_along_axis(stack, order[1:2], 0)[0]
    del stack
    P = fld.g.P.reshape(fld.shape + (3,))
    meshes = {}
    for i, k in enumerate(vessels):
        g = np.where(order[0] == i, D[k] - m2, D[k] - m1)
        m = K.mesh_from(fld.g, np.maximum(tree, g).ravel(), min_vol=4, target=30000)
        if m is not None: meshes[k] = m
    inner = tree
    if 'stent' in extra:
        st_out = fld.tube(sc([extra['stent']]))
        sf = np.maximum(st_out, -(tree - GAP))
        m = K.mesh_from(fld.g, sf.ravel(), min_vol=2, target=24000)
        if m is not None: meshes['carotid_stent'] = m
        inner = np.minimum(tree, st_out)
    if 'plaque' in extra:
        pl = np.maximum(fld.tube(sc([extra['plaque']])), -(inner - GAP))
        pl = np.maximum(pl, -(D['external_carotid'] - 2 * GAP))
        m = K.mesh_from(fld.g, pl.ravel(), min_vol=4, target=30000)
        if m is not None: meshes['plaque'] = m
    if 'patch' in extra:
        ch = sc([extra['patch']])[0]
        ys = np.array([p[1] for p in ch]); xs = np.array([p[0] for p in ch]); zs = np.array([p[2] for p in ch])
        y = P[..., 1]; ax = np.interp(y, ys, xs); az = np.interp(y, ys, zs)
        d = np.array([0.7, 0.0, 0.7], F)                                   # anterolateral
        band = -(((P[..., 0] - ax) * d[0] + (P[..., 2] - az) * d[2]) - 2.6 * S)   # keep the outer ~100 degrees
        pf = np.maximum(np.maximum(fld.tube([ch]), -(tree - GAP)), band.astype(F))
        pf = np.maximum(pf, -(D['external_carotid'] - 2 * GAP))
        m = K.mesh_from(fld.g, pf.ravel(), min_vol=4, target=16000)
        if m is not None: meshes['endarterectomy_patch'] = m
    whole = K.mesh_from(fld.g, tree.ravel(), min_vol=4, target=60000)
    return meshes, whole

def colour(name, V):
    if name == 'carotid_stent':       # closed-cell stent: diamond mesh of struts
        ang = np.arctan2(V[:, 0], V[:, 2]); u = V[:, 1] / 3.0
        a = np.abs(np.sin(np.pi * (u + ang * 1.6))); b = np.abs(np.sin(np.pi * (u - ang * 1.6)))
        wire = np.exp(-(np.minimum(a, b) / 0.18) ** 2)
        return (0.93 - 0.45 * wire)[:, None] * np.ones((len(V), 3))
    if name == 'plaque':              # yellow atheroma with paler calcified flecks
        return (0.86 + 0.14 * K.fbm(V, 0.6))[:, None] * np.ones((len(V), 3))
    if name == 'endarterectomy_patch':   # woven fabric
        return (0.9 + 0.08 * np.sin(V[:, 1] * 3.0) * np.sin(V[:, 0] * 3.0))[:, None] * np.ones((len(V), 3))
    return (0.9 + 0.1 * K.fbm(V, 0.25))[:, None] * np.ones((len(V), 3))

R_LAT = np.array([[0, 0, -1], [0, 1, 0], [1, 0, 0]], float)     # seen from the left side (+X toward camera), anterior to the right
DISPLAY = trimesh.transformations.rotation_matrix(np.radians(-35), [0, 1, 0])[:3, :3] @ R_LAT
STAGES_ALL = ['normal', 'stenosis_moderate', 'stenosis_severe', 'endarterectomy', 'stent']

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
        B.write_glb(os.path.join(OUT, f'carotid_{st}.glb'), B.export_parts(disp, colour, untextured=()))
        A.render(meshes, os.path.join(OUT, f'view_{st}_lat.jpg'), R_LAT, 420)
        A.render({k: v for k, v in meshes.items() if k not in ('plaque',)}, os.path.join(OUT, f'view_{st}_lumen.jpg'), R_LAT, 420)
        mp = os.path.join(OUT, 'print', 'manifest.json'); os.makedirs(os.path.dirname(mp), exist_ok=True)
        manifest = json.load(open(mp)) if os.path.exists(mp) else {}
        pdir = os.path.join(OUT, 'print', f'carotid_{st}_full'); os.makedirs(pdir, exist_ok=True)
        entries, failures = [], []
        for i, (k, m) in enumerate(meshes.items(), 1):
            pm = m.copy()
            comps = pm.split(only_watertight=False)
            if len(comps) > 1:
                keep = [q for q in comps if float(abs(q.volume)) >= max(ZERO_MM3, 3.0)]
                if len(keep) < len(comps): print(f'   {st}/{k}: dropped {len(comps) - len(keep)} tiny shells')
                pm = trimesh.util.concatenate(keep)
            pm, moved = separate_contacts(pm)
            pm.apply_translation([-pm.bounds[:, 0].mean(), -pm.bounds[:, 1].mean(), -pm.bounds[0, 2]])
            fn = f'{i:02d}_{k}.stl'; pm.export(os.path.join(pdir, fn))
            chk = check_stl(os.path.join(pdir, fn))
            if not chk['watertight']: failures.append(f'carotid_{st}_full/{fn}: {chk}')
            entries.append(dict(part=k, file=f'carotid_{st}_full/{fn}', supports=True, watertight=chk['watertight'],
                                non_manifold_edges=chk['non_manifold_edges'], open_edges=chk['open_edges'], bodies=chk['bodies'],
                                faces=int(len(pm.faces)), volume_cm3=round(float(abs(pm.volume)) / 1000, 2)))
        manifest[f'carotid_{st}_full'] = entries
        json.dump(manifest, open(mp, 'w'), indent=1)
        print(st, ' | '.join(f"{e['part']} {e['faces']}f {e['volume_cm3']}cm3 b{e['bodies']}{'' if e['watertight'] else ' OPEN'}" for e in entries), flush=True)
        if failures: print('Print check failed:\n  ' + '\n  '.join(failures), flush=True)
