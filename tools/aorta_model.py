"""TactileLab aortic arch lab: parametric vessel models of arch branching and position variants.

Every vessel is a tapered tube swept along a Catmull-Rom centreline (signed distance field). Vessels are smooth-unioned
into one tree, then the tree is split back into named parts along the bisectors between vessels, so each branch can be
coloured, hidden and printed on its own while the junctions stay filleted. A schematic trachea and oesophagus sit in
every model so vascular rings can be felt around them. All geometry is schematic and unreviewed; it is drawn from
textbook topology, not from any scan or print.

Frame: mm, +X patient left, +Y superior, +Z anterior. GLBs are written in cm in a left anterior oblique display frame.
Usage: python tools/aorta_model.py out_dir [stage,stage,...]
"""
import os, sys, json
import numpy as np
import trimesh
sys.path.insert(0, os.path.dirname(__file__))
import kidney_sdf as K
import beauty as B
_argv = sys.argv; sys.argv = [_argv[0], 'tools/source_kidney.glb', os.path.join(os.path.dirname(__file__), '__pycache__')]
from place_model import decimate, separate_contacts, check_stl, ZERO_MM3, CONTACT_EPS_MM   # place_model reads argv at import
sys.argv = _argv

F = np.float32
H = 0.8                     # grid spacing, mm
FILLET = 4.0                # smooth-union radius at branch origins, mm
LO, HI = (-78, -102, -52), (78, 126, 52)

# ---------------------------------------------------------------- normal left arch (control points: x, y, z, radius)
AORTA = [(4, -58, 22, 14.5), (4, -40, 26, 14.5), (-2, -15, 26, 14), (-2, 8, 22, 13.5), (6, 20, 14, 13),
         (18, 20, 4, 12.5), (25, 10, -10, 12), (24, -10, -22, 11.5), (22, -40, -26, 11), (20, -98, -26, 10.5)]
BCT = [(-1, 18, 21, 7.5), (-6, 36, 20, 7), (-12, 50, 17, 6.5)]
RSA = [(-12, 50, 17, 5), (-26, 58, 12, 4.6), (-42, 60, 6, 4.3), (-64, 52, 2, 4)]
RCC = [(-12, 50, 17, 4.6), (-15, 70, 16, 4.2), (-18, 100, 14, 4), (-19, 122, 12, 3.8)]
LCC = [(9, 22, 15, 4.8), (11, 45, 15, 4.5), (15, 80, 13, 4.1), (17, 122, 11, 3.8)]
LSA = [(18, 20, 5, 5.5), (22, 40, 4, 5), (30, 56, 1, 4.6), (46, 61, -2, 4.3), (66, 53, -4, 4)]
RVA = [(-30, 59, 10, 2.3), (-24, 72, -2, 2.2), (-21, 122, -10, 2.2)]
LVA = [(30, 57, 1, 2.3), (24, 72, -6, 2.2), (21, 122, -10, 2.2)]
PT = [(34, -76, 30, 12), (34, -58, 30, 12), (31, -40, 20, 11.5)]
LPA = [(31, -40, 20, 10), (40, -36, 4, 9), (58, -40, -6, 8)]
LIG = [(31, -34, 17, 1.6), (29, -20, 4, 1.6), (25, -4, -16, 1.6)]           # ligamentum arteriosum
TRACHEA = [(0, -18, -4, 8), (0, 30, -4, 8), (0, 124, -4, 8)]
BRONCH_R = [(0, -18, -4, 7), (-12, -32, -5, 6.3), (-24, -46, -6, 6)]
BRONCH_L = [(0, -18, -4, 6.5), (14, -32, -5, 5.6), (30, -48, -6, 5.4)]
OESOPH = [(0, -100, -20, 6.5), (0, 0, -20, 6.5), (0, 124, -20, 6.5)]

COLOURS = {'aorta': '#c8443a', 'left_arch': '#cf5544', 'brachiocephalic_trunk': '#d0503f', 'right_subclavian': '#d86450',
           'right_common_carotid': '#e07358', 'left_common_carotid': '#e07358', 'left_subclavian': '#d86450',
           'right_vertebral': '#e98b6c', 'left_vertebral': '#e98b6c', 'kommerell_diverticulum': '#b8362e',
           'pulmonary_trunk': '#4a6fa5', 'ligamentum_arteriosum': '#d9b7a0', 'patent_ductus': '#8e5aa8',
           'coarctation': '#c8443a', 'trachea': '#e2dccd', 'oesophagus': '#c98d7f'}
# parts that are context, not vessels: never smooth-unioned into the arterial tree
CONTEXT = ('trachea', 'oesophagus')

def mirror(v): return [(-x, y, z, r) for x, y, z, r in v]

def stage_vessels(st):
    """name -> list of control-point chains (several chains per part are allowed)."""
    V = {'aorta': [AORTA], 'brachiocephalic_trunk': [BCT], 'right_subclavian': [RSA], 'right_common_carotid': [RCC],
         'left_common_carotid': [LCC], 'left_subclavian': [LSA], 'right_vertebral': [RVA], 'left_vertebral': [LVA],
         'pulmonary_trunk': [PT, LPA], 'ligamentum_arteriosum': [LIG]}
    if st == 'bovine':
        V['left_common_carotid'] = [[(-5, 31, 20, 4.8), (2, 45, 17, 4.6), (10, 62, 15, 4.4), (15, 82, 13, 4.1), (17, 122, 11, 3.8)]]
    elif st == 'direct_lva':
        V['left_vertebral'] = [[(13, 23, 9, 2.7), (15, 45, 1, 2.4), (19, 72, -6, 2.2), (21, 122, -10, 2.2)]]
    elif st == 'arsa':
        del V['brachiocephalic_trunk']
        V['right_common_carotid'] = [[(-1, 18, 21, 5), (-8, 40, 19, 4.7), (-15, 70, 16, 4.2), (-18, 100, 14, 4), (-19, 122, 12, 3.8)]]
        V['right_subclavian'] = [[(20, 4, -18, 5.6), (10, 16, -32, 5.1), (0, 25, -35, 4.9), (-14, 36, -29, 4.7),
                                  (-27, 50, -10, 4.5), (-44, 60, 0, 4.3), (-64, 52, 2, 4)]]
        V['right_vertebral'] = [[(-30, 55, -6, 2.3), (-24, 72, -6, 2.2), (-21, 122, -10, 2.2)]]
    elif st == 'right_mirror':
        V = {k: [mirror(c) for c in v] for k, v in V.items() if k not in ('pulmonary_trunk', 'ligamentum_arteriosum')}
        V = {{'brachiocephalic_trunk': 'brachiocephalic_trunk', 'right_subclavian': 'left_subclavian', 'left_subclavian': 'right_subclavian',
              'right_common_carotid': 'left_common_carotid', 'left_common_carotid': 'right_common_carotid',
              'right_vertebral': 'left_vertebral', 'left_vertebral': 'right_vertebral'}.get(k, k): v for k, v in V.items()}
        V['pulmonary_trunk'] = [PT, LPA]
    elif st == 'right_alsa':
        A = stage_vessels('arsa')
        V = {k: [mirror(c) for c in v] for k, v in A.items() if k not in ('pulmonary_trunk', 'ligamentum_arteriosum')}
        V = {{'right_subclavian': 'left_subclavian', 'left_subclavian': 'right_subclavian', 'right_common_carotid': 'left_common_carotid',
              'left_common_carotid': 'right_common_carotid', 'right_vertebral': 'left_vertebral', 'left_vertebral': 'right_vertebral'}.get(k, k): v
             for k, v in V.items()}
        V['kommerell_diverticulum'] = [[(-20, 4, -18, 9.5), (-13, 12, -27, 8.5), (-7, 18, -32, 6.5)]]
        V['pulmonary_trunk'] = [PT, LPA]
        V['ligamentum_arteriosum'] = [[(-4, 16, -33, 1.7), (14, 6, -24, 1.7), (28, -18, 4, 1.7), (31, -34, 16, 1.7)]]
    elif st == 'double':
        asc = AORTA[:4]
        V['aorta'] = [asc + [(-14, 20, 12, 11), (-23, 18, -6, 10.5), (-18, 10, -30, 10), (-2, 2, -41, 10), (16, -10, -34, 10.5),
                             (20, -32, -30, 11), (20, -98, -28, 10.5)]]
        V['left_arch'] = [[(-2, 8, 22, 9), (8, 20, 16, 8.5), (18, 20, 4, 8.5), (24, 10, -12, 8.5), (21, -10, -28, 9), (20, -32, -30, 10)]]
        del V['brachiocephalic_trunk']
        V['right_common_carotid'] = [[(-14, 24, 13, 4.6), (-16, 50, 15, 4.4), (-18, 100, 14, 4), (-19, 122, 12, 3.8)]]
        V['right_subclavian'] = [[(-22, 22, -2, 5), (-34, 48, 3, 4.6), (-46, 60, 4, 4.3), (-64, 52, 2, 4)]]
        V['right_vertebral'] = [[(-38, 55, 4, 2.3), (-26, 72, -4, 2.2), (-21, 122, -10, 2.2)]]
        V['left_common_carotid'] = [[(8, 22, 15, 4.6)] + LCC[1:]]
        V['left_subclavian'] = [[(18, 21, 5, 5.2)] + LSA[1:]]
        V['ligamentum_arteriosum'] = [[(22, -4, -20, 1.6), (28, -20, 2, 1.6), (31, -34, 16, 1.6)]]
    elif st == 'coarctation':
        V['aorta'] = [AORTA[:6] + [(25, 9, -11, 11.5), (25, 2, -16, 5.0), (24.5, -4, -19, 5.0), (24, -14, -23, 13), (22, -40, -26, 11.5), (20, -98, -26, 10.5)]]
    elif st == 'pda':
        del V['ligamentum_arteriosum']
        V['patent_ductus'] = [[(31, -36, 17, 4.6), (29, -20, 3, 4.6), (26, -6, -12, 5.6), (25, -2, -15, 6.5)]]
    elif st.startswith('iaa_'):
        del V['ligamentum_arteriosum']
        V['patent_ductus'] = [[(31, -36, 17, 7.5), (29, -22, 2, 7.5), (25, -10, -16, 8.5)]]
        asc = [(4, -58, 22, 10), (4, -40, 25, 9.5), (-2, -15, 25, 9), (-2, 8, 22, 8.5)]
        if st == 'iaa_a':      # interruption beyond the left subclavian
            V['aorta'] = [asc + [(6, 20, 14, 8), (18, 20, 4, 7.5), (22, 14, -4, 7)],
                          [(24, -8, -22, 9), (23, -20, -24, 11), (22, -40, -26, 11), (20, -98, -26, 10.5)]]
        elif st == 'iaa_b':    # between the left common carotid and the left subclavian (commonest)
            V['aorta'] = [asc + [(4, 20, 17, 8), (6, 23, 14, 7.5)],
                          [(22, 16, -1, 7.5), (25, 6, -12, 9), (24, -10, -22, 11), (22, -40, -26, 11), (20, -98, -26, 10.5)]]
        else:                  # iaa_c: between the brachiocephalic trunk and the left common carotid
            V['aorta'] = [asc[:3] + [(-3, 8, 23, 8.5), (-3, 13, 23, 8)],
                          [(10, 22, 10, 7.5), (18, 20, 4, 8), (25, 8, -12, 9), (24, -10, -22, 11), (22, -40, -26, 11), (20, -98, -26, 10.5)]]
            V['left_common_carotid'] = [[(10, 24, 12, 4.6)] + LCC[1:]]
        V['brachiocephalic_trunk'] = [[(-2, 10, 22, 6.5)] + BCT[1:]]
    V['trachea'] = [TRACHEA, BRONCH_R, BRONCH_L]
    V['oesophagus'] = [OESOPH]
    return V

# ---------------------------------------------------------------- fields
def spline(cp, step=2.5):
    """Catmull-Rom through control points (x, y, z, r); returns dense points and radii."""
    c = np.asarray(cp, float)
    if len(c) == 2:
        n = max(2, int(np.linalg.norm(c[1, :3] - c[0, :3]) / step))
        t = np.linspace(0, 1, n + 1)[:, None]; s = c[0] * (1 - t) + c[1] * t
        return s[:, :3], s[:, 3]
    ext = np.vstack([2 * c[0] - c[1], c, 2 * c[-1] - c[-2]])
    out = [c[0]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        n = max(2, int(np.linalg.norm(p2[:3] - p1[:3]) / step))
        for t in np.linspace(0, 1, n + 1)[1:]:
            t2, t3 = t * t, t * t * t
            q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            q[3] = p1[3] + (p2[3] - p1[3]) * t          # radius: linear, so narrowings stay where they are put
            out.append(q)
    s = np.asarray(out)
    return s[:, :3], s[:, 3]

class Field:
    def __init__(self):
        self.ax = [np.arange(LO[i], HI[i] + H * 0.5, H, dtype=F) for i in range(3)]
        self.shape = tuple(len(a) for a in self.ax)
        self.g = K.Grid(LO, HI, h=H)
    def tube(self, chains, margin=FILLET + 3):
        d = np.full(self.shape, 1e3, F)
        for cp in chains:
            pts, rad = spline(cp)
            for i in range(len(pts) - 1):
                a, b, r1, r2 = pts[i], pts[i + 1], rad[i], rad[i + 1]
                lo = np.minimum(a, b) - max(r1, r2) - margin; hi = np.maximum(a, b) + max(r1, r2) + margin
                sl = []
                for k in range(3):
                    i0 = int(np.searchsorted(self.ax[k], lo[k])); i1 = int(np.searchsorted(self.ax[k], hi[k]))
                    sl.append(slice(max(i0, 0), min(i1, self.shape[k])))
                X, Y, Z = np.meshgrid(self.ax[0][sl[0]], self.ax[1][sl[1]], self.ax[2][sl[2]], indexing='ij')
                if X.size == 0: continue
                P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
                v = K.sd_round_cone(P, a.astype(F), b.astype(F), float(r1), float(r2)).reshape(X.shape).astype(F)
                d[tuple(sl)] = np.minimum(d[tuple(sl)], v)
        return d

def build(st):
    V = stage_vessels(st)
    fld = Field()
    D = {k: fld.tube(v) for k, v in V.items()}
    vessels = [k for k in D if k not in CONTEXT]
    tree = None
    for k in vessels: tree = D[k] if tree is None else K.smin(tree, D[k], FILLET)
    # bisector partition of the tree: each voxel belongs to the nearest vessel
    stack = np.stack([D[k] for k in vessels]); order = np.argsort(stack, axis=0)
    m1 = np.take_along_axis(stack, order[:1], 0)[0]; m2 = np.take_along_axis(stack, order[1:2], 0)[0] if len(vessels) > 1 else np.full_like(m1, 1e3)
    meshes = {}
    for i, k in enumerate(vessels):
        g = np.where(order[0] == i, D[k] - m2, D[k] - m1)
        m = K.mesh_from(fld.g, np.maximum(tree, g).ravel(), min_vol=8, target=60000 if k in ('aorta', 'left_arch') else 24000)
        if m is not None: meshes[k] = m
    for k in CONTEXT:
        m = K.mesh_from(fld.g, D[k].ravel(), min_vol=8, target=30000)
        if m is not None: meshes[k] = m
    whole = K.mesh_from(fld.g, tree.ravel(), min_vol=8, target=90000)
    return meshes, whole

def colour(name, V):
    if name == 'trachea':        # cartilage rings
        ring = 0.5 + 0.5 * np.cos(V[:, 1] * 2 * np.pi / 4.2)
        return (0.86 + 0.14 * ring)[:, None] * np.ones((len(V), 3))
    return (0.9 + 0.1 * K.fbm(V, 0.18))[:, None] * np.ones((len(V), 3))

# ---------------------------------------------------------------- QA render (no GPU, no matplotlib)
def render(meshes, path, R, size=560):
    from PIL import Image
    tris, cols = [], []
    for k, m in meshes.items():
        mm = decimate(m, 9000); v = mm.vertices @ R.T
        tris.append(v[mm.faces]); cols.append(np.tile(B.hex2rgb(COLOURS.get(k, '#999999')), (len(mm.faces), 1)))
    T = np.concatenate(tris); C = np.concatenate(cols).astype(float)
    lo = T.reshape(-1, 3).min(0); hi = T.reshape(-1, 3).max(0); s = (size - 20) / max(hi[0] - lo[0], hi[1] - lo[1])
    W = int((hi[0] - lo[0]) * s) + 20; Hh = int((hi[1] - lo[1]) * s) + 20
    xy = np.empty(T.shape[:2] + (2,)); xy[..., 0] = (T[..., 0] - lo[0]) * s + 10; xy[..., 1] = (hi[1] - T[..., 1]) * s + 10
    zb = np.full((Hh, W), -1e9); img = np.full((Hh, W, 3), 245.0)
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    L = np.array([-0.35, 0.55, 0.76]); L /= np.linalg.norm(L)
    shade = 0.28 + 0.72 * np.clip(n @ L, 0, 1) + 0.18 * np.clip(n[:, 2], 0, 1) ** 8
    for t in range(len(T)):
        if n[t, 2] <= 0: continue
        p = xy[t]; x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int)
        if x1 <= x0 or y1 <= y0: continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        (ax, ay), (bx, by), (cx, cy) = p
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-9: continue
        w0 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / den; w1 = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / den; w2 = 1 - w0 - w1
        ins = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not ins.any(): continue
        z = w0 * T[t, 0, 2] + w1 * T[t, 1, 2] + w2 * T[t, 2, 2]
        Xi, Yi, zi = X[ins], Y[ins], z[ins]
        ok = (Xi >= 0) & (Xi < W) & (Yi >= 0) & (Yi < Hh); Xi, Yi, zi = Xi[ok], Yi[ok], zi[ok]
        upd = zi > zb[Yi, Xi]
        zb[Yi[upd], Xi[upd]] = zi[upd]; img[Yi[upd], Xi[upd]] = C[t] * min(shade[t], 1.15)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(path, quality=88)

# ---------------------------------------------------------------- main
DISPLAY = trimesh.geometry.align_vectors(np.array([0.5, 0.0, 0.866]), [0, 0, 1])[:3, :3]   # LAO 30 degrees
STAGES_ALL = ['normal', 'bovine', 'direct_lva', 'arsa', 'right_mirror', 'right_alsa', 'double', 'coarctation', 'pda',
              'iaa_a', 'iaa_b', 'iaa_c']

if __name__ == '__main__':
    OUT = sys.argv[1]
    STAGES = sys.argv[2].split(',') if len(sys.argv) > 2 else STAGES_ALL
    os.makedirs(OUT, exist_ok=True)
    B.DEFAULTS.update(COLOURS)
    for st in STAGES:
        meshes, whole = build(st)
        # display: LAO frame, centred, cm
        c = whole.bounds.mean(0)
        disp = {}
        for k, m in meshes.items():
            d = m.copy(); d.apply_translation(-c); T4 = np.eye(4); T4[:3, :3] = DISPLAY; d.apply_transform(T4); disp[k] = d
        B.write_glb(os.path.join(OUT, f'aorta_{st}.glb'), B.export_parts(disp, colour, untextured=()))
        render(meshes, os.path.join(OUT, f'view_{st}_ant.jpg'), np.eye(3))
        render(meshes, os.path.join(OUT, f'view_{st}_lao.jpg'), DISPLAY)
        Rsup = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])[:3, :3]     # from above: +Y toward viewer
        render(meshes, os.path.join(OUT, f'view_{st}_sup.jpg'), Rsup)
        # print: same standard as the kidney and spine (manifold STLs, re-read from disk)
        mp = os.path.join(OUT, 'print', 'manifest.json'); os.makedirs(os.path.dirname(mp), exist_ok=True)
        manifest = json.load(open(mp)) if os.path.exists(mp) else {}
        pdir = os.path.join(OUT, 'print', f'aorta_{st}_full'); os.makedirs(pdir, exist_ok=True)
        entries, failures = [], []
        for i, (k, m) in enumerate(meshes.items(), 1):
            pm = m.metadata.get('print', m).copy()
            comps = pm.split(only_watertight=False)
            if len(comps) > 1:
                keep = [q for q in comps if float(abs(q.volume)) >= max(ZERO_MM3, 5.0)]
                if len(keep) < len(comps): print(f'   {st}/{k}: dropped {len(comps) - len(keep)} tiny shells')
                pm = trimesh.util.concatenate(keep)
            pm, moved = separate_contacts(pm)
            if moved: print(f'   {st}/{k}: separated {moved} self-touching vertices by {CONTACT_EPS_MM * 1000:.0f} um')
            pm.apply_translation([-pm.bounds[:, 0].mean(), -pm.bounds[:, 1].mean(), -pm.bounds[0, 2]])
            fn = f'{i:02d}_{k}.stl'; pm.export(os.path.join(pdir, fn))
            chk = check_stl(os.path.join(pdir, fn))
            if not chk['watertight']: failures.append(f'aorta_{st}_full/{fn}: {chk}')
            entries.append(dict(part=k, file=f'aorta_{st}_full/{fn}', supports=True, watertight=chk['watertight'],
                                non_manifold_edges=chk['non_manifold_edges'], open_edges=chk['open_edges'], bodies=chk['bodies'],
                                faces=int(len(pm.faces)), volume_cm3=round(float(abs(pm.volume)) / 1000, 2)))
        manifest[f'aorta_{st}_full'] = entries
        json.dump(manifest, open(mp, 'w'), indent=1)
        print(st, ' | '.join(f"{e['part']} {e['faces']}f {e['volume_cm3']}cm3{'' if e['watertight'] else ' OPEN'}" for e in entries), flush=True)
        if failures: print('Print check failed:\n  ' + '\n  '.join(failures), flush=True)
