"""TactileLab Circle of Willis lab: the arterial ring at the base of the brain, its common variants, saccular
aneurysms at the four classic sites, and an anterior communicating aneurysm after clipping and after coiling.

Reuses the vessel pipeline of tools/aorta_model.py (tapered tubes on Catmull-Rom centrelines, smooth-unioned
and split back into named parts). Geometry is drawn in life-size millimetres from textbook topology and then
scaled by S = 2, so the smallest vessels stay printable. Schematic and unreviewed; not from any scan or print.

Frame (life-size mm before scaling): +X patient left, +Y superior, +Z anterior. GLBs are written in cm and
turned so the default camera looks at the base of the brain from below, anterior at the top.
Usage: python tools/willis_model.py out_dir [stage,stage,...]
"""
import os, sys, json
import numpy as np
import trimesh
sys.path.insert(0, os.path.dirname(__file__))
import aorta_model as A
import kidney_sdf as K
import beauty as B
from aorta_model import decimate, separate_contacts, check_stl, ZERO_MM3, CONTACT_EPS_MM

S = 2.0                     # model scale: twice life size
A.LO, A.HI = (-100, -110, -84), (100, 52, 76)
A.FILLET = 2.4
F = np.float32
CLIP_AT = 2.6              # clip blades cross the AComm aneurysm neck this far (life-size mm) from the parent
GAP = 0.3                   # print clearance (final mm) between separately printed parts

COLOURS = {'internal_carotids': '#c8443a', 'anterior_cerebrals': '#d0503f', 'anterior_communicating': '#e07358',
           'middle_cerebrals': '#d86450', 'posterior_communicatings': '#e98b6c', 'posterior_cerebrals': '#d0503f',
           'basilar_artery': '#c8443a', 'vertebral_arteries': '#c8443a', 'aneurysm': '#a83a32',
           'aneurysm_clip': '#c9ced6', 'coil_mass': '#b9b4ac'}

def mir(ch):
    return [(-x, y, z, r) for (x, y, z, r) in ch]

# right-sided chains (x < 0); the left side is the mirror image
ICA = [(-14, -30, 4, 2.2), (-13, -18, 1, 2.1), (-12, -8, 3, 2.0), (-12, 0, 5, 2.0)]
A1 = [(-12, 0, 5, 1.2), (-8, 1, 12, 1.15), (-4, 2, 19, 1.1), (-1.5, 2.5, 22, 1.1)]
A2 = [(-1.5, 2.5, 22, 1.05), (-2, 8, 26, 1.0), (-2.5, 15, 30, 1.0), (-2.5, 22, 30, 0.95)]
M1 = [(-12, 0, 5, 1.5), (-20, 0.5, 6, 1.45), (-28, 1, 5, 1.4), (-34, 1.5, 4, 1.35)]
M2S = [(-34, 1.5, 4, 1.1), (-40, 5, 6, 1.0), (-44, 10, 4, 0.95)]
M2I = [(-34, 1.5, 4, 1.1), (-40, -2, 0, 1.0), (-44, -4, -6, 0.95)]
P1 = [(0, -2, -9, 1.1), (-5, -1.5, -10, 1.1), (-9, -1, -10, 1.1)]
P2 = [(-9, -1, -10, 1.05), (-16, 0, -16, 1.0), (-21, 1, -26, 1.0), (-20, 2, -36, 0.95)]
PCOM = [(-11.6, -1.5, 3.5, 0.65), (-11, -1.5, -2, 0.65), (-10, -1.2, -7, 0.65), (-9, -1, -10, 0.65)]
BA = [(0, -34, -12, 1.6), (0, -22, -10, 1.6), (0, -10, -9, 1.55), (0, -2, -9, 1.5)]
VA = [(-9, -52, -18, 1.5), (-6, -44, -16, 1.5), (-2, -37, -13, 1.55), (0, -34, -12, 1.6)]

def rad(ch, r):
    return [(x, y, z, r) for (x, y, z, _) in ch]

def unit(v):
    v = np.asarray(v, float); return v / np.linalg.norm(v)

# saccular aneurysms: parent point, projection direction, dome radius (life-size mm)
SITES = {'acom': ((0, 2.5, 22), unit((0, 0.2, 0.98)), 3.5),
         'pcom': ((-11.8, -1.5, 3.5), unit((-0.8, -0.2, -0.55)), 3.0),
         'mca': ((34, 1.5, 4), unit((0.6, 0, 0.8)), 3.0),
         'basilar': ((0, -2, -9), unit((0, 1, 0.1)), 3.5)}

def dome_centre(site):
    p0, n, r = SITES[site]
    return np.asarray(p0, float) + n * (7.0 if site == 'acom' else 5.5)   # AComm: longer neck, room for a clip

def sac_chain(site, clipped=False):
    p0, n, r = SITES[site]; p0 = np.asarray(p0, float)
    c = dome_centre(site)
    if clipped:                      # neck pinched flat by the clip blades
        return [tuple(p0 + n * 0.5) + (0.85,), tuple(p0 + n * CLIP_AT) + (0.55,), tuple(p0 + n * (CLIP_AT + 0.9)) + (0.8,), tuple(c) + (r,)]
    a = 0.5 if site == 'acom' else 0.0   # the AComm is thinner than the neck: start the sac on its surface
    return [tuple(p0 + n * a) + (1.0 if a else 1.3,), tuple(p0 + n * 1.6) + (1.4,), tuple(c) + (r,)]

def stage_vessels(st):
    V = {'internal_carotids': [ICA, mir(ICA)],
         'anterior_cerebrals': [A1, mir(A1), A2, mir(A2)],
         'anterior_communicating': [[(-1.5, 2.5, 22, 0.75), (1.5, 2.5, 22, 0.75)]],
         'middle_cerebrals': [M1, M2S, M2I, mir(M1), mir(M2S), mir(M2I)],
         'posterior_communicatings': [PCOM, mir(PCOM)],
         'posterior_cerebrals': [P1, P2, mir(P1), mir(P2)],
         'basilar_artery': [BA],
         'vertebral_arteries': [VA, mir(VA)]}
    extra = {}
    if st == 'pcom_hypoplasia':          # left posterior communicating artery thread-like
        V['posterior_communicatings'] = [PCOM, rad(mir(PCOM), 0.42)]
    elif st == 'fetal_pca':              # right PCA fed mainly from the ICA: large PComm, hypoplastic right P1
        V['posterior_communicatings'] = [rad(PCOM, 1.15), mir(PCOM)]
        V['posterior_cerebrals'] = [rad(P1, 0.5), P2, mir(P1), mir(P2)]
    elif st == 'a1_hypoplasia':          # left A1 hypoplastic; both A2s fed from the right A1 across a larger AComm
        V['anterior_cerebrals'] = [rad(A1, 1.35), rad(mir(A1), 0.5), A2, mir(A2)]
        V['anterior_communicating'] = [[(-1.5, 2.5, 22, 1.0), (1.5, 2.5, 22, 1.0)]]
    elif st == 'azygos_aca':             # both A1s join one midline A2 trunk; no anterior communicating artery
        a1r = A1[:-1] + [(0, 3, 22.5, 1.2)]
        V['anterior_cerebrals'] = [a1r, mir(a1r), [(0, 3, 22.5, 1.3), (0, 9, 26, 1.25), (0, 16, 30, 1.2), (0, 22, 30, 1.15)]]
        V.pop('anterior_communicating')
    site = {'acom_aneurysm': 'acom', 'pcom_aneurysm': 'pcom', 'mca_aneurysm': 'mca', 'basilar_aneurysm': 'basilar',
            'acom_clipped': 'acom', 'acom_coiled': 'acom'}.get(st)
    if site:
        V['aneurysm'] = [sac_chain(site, clipped=(st == 'acom_clipped'))]
        extra['site'] = site
    if st == 'acom_clipped': extra['clip'] = True
    if st == 'acom_coiled': extra['coil'] = True
    # scale to model millimetres
    V = {k: [[(x * S, y * S, z * S, r * S) for (x, y, z, r) in ch] for ch in v] for k, v in V.items()}
    return V, extra

def clip_chains():
    """Schematic aneurysm clip on the AComm aneurysm neck: two straight blades either side of the neck, closing
    across it, joined by a looped spring head in front of the anterior communicating artery."""
    p0, n, r = SITES['acom']; p0 = np.asarray(p0, float)
    q = p0 + n * CLIP_AT
    t = np.array([1.0, 0, 0]); w = np.cross(n, t); w /= np.linalg.norm(w)   # blades run left-right, either side of the neck
    d, rb, L = 0.55 + 0.42 + 0.22, 0.42, 2.6
    blades = [[tuple(q + s * w * d - t * L) + (rb,), tuple(q + s * w * d + t * L) + (rb * 0.9,)] for s in (-1, 1)]
    e = q - t * L
    arc = [tuple(e + w * d * np.cos(a) - t * d * 1.2 * np.sin(a)) + (rb,) for a in np.linspace(0, np.pi, 9)]
    ring = [tuple(e - t * d * 1.2 + n * np.cos(a) * 0.9 - t * 0.9 * (1 - np.cos(0)) + w * np.sin(a) * 0.9 - t * 0.9) + (rb * 0.8,)
            for a in np.linspace(0, 2 * np.pi, 13)]
    ch = blades + [arc, ring]
    return [[(x * S, y * S, z * S, rr * S) for (x, y, z, rr) in c] for c in ch]

def build(st):
    V, extra = stage_vessels(st)
    fld = A.Field()
    D = {k: fld.tube(v) for k, v in V.items() if v}
    vessels = list(D)
    tree = None
    for k in vessels: tree = D[k] if tree is None else K.smin(tree, D[k], A.FILLET)
    stack = np.stack([D[k] for k in vessels]); order = np.argsort(stack, axis=0)
    m1 = np.take_along_axis(stack, order[:1], 0)[0]; m2 = np.take_along_axis(stack, order[1:2], 0)[0]
    del stack
    P = fld.g.P.reshape(fld.shape + (3,))
    coil = None
    if extra.get('coil'):
        r = SITES['acom'][2]; c = dome_centre('acom') * S
        coil = K.sd_sphere(P.reshape(-1, 3), tuple(c), (r - 0.55) * S).reshape(fld.shape).astype(F)
        others = None
        for k in vessels:
            if k != 'aneurysm': others = D[k] if others is None else np.minimum(others, D[k])
        coil = np.maximum(coil, -(others - 2 * GAP))
    meshes = {}
    for i, k in enumerate(vessels):
        g = np.where(order[0] == i, D[k] - m2, D[k] - m1)
        f = np.maximum(tree, g)
        if k == 'aneurysm' and coil is not None:
            f = np.maximum(f, -(coil - GAP))          # sac wall as a shell around the coil mass
        m = K.mesh_from(fld.g, f.ravel(), min_vol=4, target=40000 if k in ('middle_cerebrals', 'anterior_cerebrals', 'posterior_cerebrals') else 24000)
        if m is not None: meshes[k] = m
    if coil is not None:
        m = K.mesh_from(fld.g, coil.ravel(), min_vol=4, target=20000)
        if m is not None: meshes['coil_mass'] = m
    if extra.get('clip'):
        cl = fld.tube(clip_chains(), margin=3)
        cl = np.maximum(cl, -(tree - GAP))
        m = K.mesh_from(fld.g, cl.ravel(), min_vol=2, target=16000)
        if m is not None: meshes['aneurysm_clip'] = m
    whole = K.mesh_from(fld.g, tree.ravel(), min_vol=4, target=90000)
    return meshes, whole

def colour(name, V):
    if name == 'coil_mass':          # wound platinum coil: a tight squiggle of bright wire
        u = np.sin(K.fbm(V, 0.9) * 40.0)
        return (0.78 + 0.2 * u)[:, None] * np.ones((len(V), 3))
    if name == 'aneurysm_clip':
        return np.full((len(V), 3), 0.95)
    return (0.9 + 0.1 * K.fbm(V, 0.25))[:, None] * np.ones((len(V), 3))

R_INF = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)      # inferior view, anterior at top
R_SUP = np.array([[-1, 0, 0], [0, 0, 1], [0, 1, 0]], float)      # superior view, anterior at top
R_PRINT = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)    # superior up on the print bed
TILT = trimesh.transformations.rotation_matrix(np.radians(-28), [1, 0, 0])[:3, :3]
DISPLAY = TILT @ R_INF
STAGES_ALL = ['normal', 'pcom_hypoplasia', 'fetal_pca', 'a1_hypoplasia', 'azygos_aca', 'acom_aneurysm', 'pcom_aneurysm',
              'mca_aneurysm', 'basilar_aneurysm', 'acom_clipped', 'acom_coiled']

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
        B.write_glb(os.path.join(OUT, f'willis_{st}.glb'), B.export_parts(disp, colour, untextured=()))
        A.render(meshes, os.path.join(OUT, f'view_{st}_inf.jpg'), R_INF, 420)
        A.render(meshes, os.path.join(OUT, f'view_{st}_obl.jpg'), DISPLAY, 420)
        mp = os.path.join(OUT, 'print', 'manifest.json'); os.makedirs(os.path.dirname(mp), exist_ok=True)
        manifest = json.load(open(mp)) if os.path.exists(mp) else {}
        pdir = os.path.join(OUT, 'print', f'willis_{st}_full'); os.makedirs(pdir, exist_ok=True)
        entries, failures = [], []
        for i, (k, m) in enumerate(meshes.items(), 1):
            pm = m.copy(); T4 = np.eye(4); T4[:3, :3] = R_PRINT; pm.apply_transform(T4)
            comps = pm.split(only_watertight=False)
            if len(comps) > 1:
                keep = [q for q in comps if float(abs(q.volume)) >= max(ZERO_MM3, 3.0)]
                if len(keep) < len(comps): print(f'   {st}/{k}: dropped {len(comps) - len(keep)} tiny shells')
                pm = trimesh.util.concatenate(keep)
            pm, moved = separate_contacts(pm)
            pm.apply_translation([-pm.bounds[:, 0].mean(), -pm.bounds[:, 1].mean(), -pm.bounds[0, 2]])
            fn = f'{i:02d}_{k}.stl'; pm.export(os.path.join(pdir, fn))
            chk = check_stl(os.path.join(pdir, fn))
            if not chk['watertight']: failures.append(f'willis_{st}_full/{fn}: {chk}')
            entries.append(dict(part=k, file=f'willis_{st}_full/{fn}', supports=True, watertight=chk['watertight'],
                                non_manifold_edges=chk['non_manifold_edges'], open_edges=chk['open_edges'], bodies=chk['bodies'],
                                faces=int(len(pm.faces)), volume_cm3=round(float(abs(pm.volume)) / 1000, 2)))
        manifest[f'willis_{st}_full'] = entries
        json.dump(manifest, open(mp, 'w'), indent=1)
        print(st, ' | '.join(f"{e['part']} {e['faces']}f {e['volume_cm3']}cm3{'' if e['watertight'] else ' OPEN'}" for e in entries), flush=True)
        if failures: print('Print check failed:\n  ' + '\n  '.join(failures), flush=True)
