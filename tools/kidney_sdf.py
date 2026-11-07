"""TactileLab kidney generator (signed-distance modelling).

Builds a textbook adult left kidney and five clinical configurations (normal, T1a, T1b, T2a, T3a),
each in two forms:
  whole    kidney with removable tumour and hilar structures (vein, artery, pelvis, ureter)
  coronal  posterior half in coronal section: cortex shell with removable inlays (pyramids,
           sinus fat, hollow collecting system, artery with segmental branches, ureter, tumour)

Conventions: millimetres while modelling; scene axes are long axis +Y, hilum (medial) -X,
anterior +Z. GLBs are exported in centimetres with one named mesh per part (the app's part ids).
STLs are exported in millimetres, pre-oriented for printing.

Usage: python tools/kidney_sdf.py <out_dir>
"""
import os, sys, json, math
import numpy as np
import trimesh
from skimage.measure import marching_cubes
import fast_simplification

OUT = sys.argv[1] if (__name__ == '__main__' and len(sys.argv) > 1) else 'generated'
if __name__ == '__main__': os.makedirs(OUT, exist_ok=True)
F = np.float32
H = 0.5          # voxel size, mm
Z0 = -1.0        # coronal section plane
CLR = 0.25       # print clearance between mating parts
RNG = np.random.default_rng(7)

# ============================================================ SDF primitives
def norm(v): return np.sqrt(np.sum(v * v, axis=-1))

def sd_sphere(P, c, r): return norm(P - np.asarray(c, F)) - r

def sd_ellipsoid(P, c, r):
    p = P - np.asarray(c, F); r = np.asarray(r, F)
    k0 = norm(p / r); k1 = norm(p / (r * r))
    return k0 * (k0 - 1) / np.maximum(k1, 1e-6)

def sd_capped_cyl(P, a, b, r):
    a = np.asarray(a, F); b = np.asarray(b, F)
    ba = b - a; pa = P - a; baba = float(ba @ ba); paba = pa @ ba
    x = norm(pa * baba - ba[None] * paba[:, None]) - r * baba
    y = np.abs(paba - baba * 0.5) - baba * 0.5
    x2 = x * x; y2 = y * y * baba
    d = np.where(np.maximum(x, y) < 0, -np.minimum(x2, y2), np.where(x > 0, x2, 0) + np.where(y > 0, y2, 0))
    return np.sign(d) * np.sqrt(np.abs(d)) / baba

def sd_round_cone(P, a, b, r1, r2):
    a = np.asarray(a, F); b = np.asarray(b, F)
    ba = b - a; l2 = float(ba @ ba); rr = r1 - r2; a2 = l2 - rr * rr; il2 = 1.0 / l2
    pa = P - a; y = pa @ ba; z = y - l2
    q = pa * l2 - ba[None] * y[:, None]; x2 = np.sum(q * q, axis=1)
    y2 = y * y * l2; z2 = z * z * l2; k = np.sign(rr) * rr * rr * x2
    d1 = np.sqrt(x2 + z2) * il2 - r2
    d2 = np.sqrt(x2 + y2) * il2 - r1
    d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
    return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))

def sd_tube(P, pts, rads):
    d = None
    for i in range(len(pts) - 1):
        di = sd_round_cone(P, pts[i], pts[i + 1], rads[i], rads[i + 1])
        d = di if d is None else np.minimum(d, di)
    return d

def plane(P, point, n):            # <=0 on the side opposite n
    n = np.asarray(n, F); n = n / np.linalg.norm(n)
    return (P - np.asarray(point, F)) @ n

def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1); return b * (1 - h) + a * h - k * h * (1 - h)
def smax(a, b, k): return -smin(-a, -b, k)
def unit(v): v = np.asarray(v, float); return v / np.linalg.norm(v)

# ============================================================ value noise (for colour)
_LAT = RNG.random((32, 32, 32)).astype(F)
def vnoise(P, freq):
    q = P * freq; i = np.floor(q).astype(int); f = q - i; f = f * f * (3 - 2 * f)
    def L(dx, dy, dz): return _LAT[(i[:, 0] + dx) % 32, (i[:, 1] + dy) % 32, (i[:, 2] + dz) % 32]
    x00 = L(0, 0, 0) * (1 - f[:, 0]) + L(1, 0, 0) * f[:, 0]; x10 = L(0, 1, 0) * (1 - f[:, 0]) + L(1, 1, 0) * f[:, 0]
    x01 = L(0, 0, 1) * (1 - f[:, 0]) + L(1, 0, 1) * f[:, 0]; x11 = L(0, 1, 1) * (1 - f[:, 0]) + L(1, 1, 1) * f[:, 0]
    y0 = x00 * (1 - f[:, 1]) + x10 * f[:, 1]; y1 = x01 * (1 - f[:, 1]) + x11 * f[:, 1]
    return y0 * (1 - f[:, 2]) + y1 * f[:, 2]
_ROT = [np.linalg.qr(np.random.default_rng(11 + i).normal(size=(3, 3)))[0].astype(F) for i in range(4)]
def fbm(P, freq, oct=3):
    s, a, t = 0, 0.5, 0
    for o in range(oct): s += a * vnoise(P @ _ROT[o] + 17.3 * o, freq * 2 ** o); t += a; a *= 0.5
    return s / t

# ============================================================ grids & meshing
class Grid:
    def __init__(self, lo, hi, h=H):
        self.lo = np.asarray(lo, F); self.h = h
        self.axes = [np.arange(lo[i], hi[i] + h * 0.5, h, dtype=F) for i in range(3)]
        self.shape = tuple(len(a) for a in self.axes)
        X, Y, Z = np.meshgrid(*self.axes, indexing='ij')
        self.P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
    def normalize(self, f):
        g = np.gradient(f.reshape(self.shape), self.h)
        m = np.sqrt(g[0] ** 2 + g[1] ** 2 + g[2] ** 2).ravel()
        return f / np.maximum(m, 0.25)

def mesh_from(grid, field, min_vol=20.0, target=None, smooth=True, max_edge=None):
    vol = field.reshape(grid.shape).copy()
    vol += 1.37e-3  # avoid exact zeros on grid points (degenerate MC triangles)
    vol[0], vol[-1], vol[:, 0], vol[:, -1], vol[:, :, 0], vol[:, :, -1] = 1, 1, 1, 1, 1, 1
    if vol.min() >= 0: return None
    v, f, _, _ = marching_cubes(vol, 0.0, spacing=(grid.h,) * 3)
    m = trimesh.Trimesh(v + grid.lo, f, process=True)
    parts = [p for p in m.split(only_watertight=False) if abs(p.volume) > min_vol]
    if not parts: return None
    m = trimesh.util.concatenate(parts)
    if smooth: trimesh.smoothing.filter_taubin(m, lamb=0.5, nu=-0.53, iterations=6)
    if target and len(m.faces) > target:
        v2, f2 = fast_simplification.simplify(m.vertices, m.faces, target_reduction=1 - target / len(m.faces))
        m2 = trimesh.Trimesh(v2, f2, process=True)
        if m2.is_watertight: m = m2
    print_copy = m.copy()
    if max_edge:
        v3, f3 = trimesh.remesh.subdivide_to_size(m.vertices, m.faces, max_edge=max_edge)[:2]
        m3 = trimesh.Trimesh(v3, f3, process=True)
        if m3.is_watertight: m = m3
    print_copy.fix_normals()
    if print_copy.volume < 0: print_copy.invert()
    m.metadata['print'] = print_copy
    m.fix_normals()
    if m.volume < 0: m.invert()
    return m

# ============================================================ anatomy: body
BEND, YH = 7.0, 29.0
SPINE_T = np.linspace(-1, 1, 7)
SPINE = np.array([[BEND * (1 - t * t), t * YH, 0] for t in SPINE_T], F)
SPINE_R = [28.5 - (2.5 if t > 0 else 3.5) * t * t for t in SPINE_T]

def body_raw(P):
    sz = np.where(P[:, 2] > 0, 16.0 / 28.5, 14.5 / 28.5).astype(F)
    Q = np.stack([P[:, 0], P[:, 1], P[:, 2] / sz], 1)
    return sd_tube(Q, SPINE, SPINE_R)

POST_FLAT = -13.3   # posterior print flat (anatomically the posterior surface is the flatter one)
X_FLOOR = -4.5
RECESS = dict(c=(-16.5, -1.0, 0.0), r=(12.0, 21.0, 9.5))
SINUS = dict(c=(-7.0, -1.0, Z0), r=(16.0, 30.0, 8.5))

def ray_surface(origin, d, f=body_raw, tmax=120):
    o = np.asarray(origin, F); d = unit(d).astype(F)
    lo, hi = 0.0, tmax
    for _ in range(60):
        m = 0.5 * (lo + hi)
        if f((o + d * m)[None])[0] < 0: lo = m
        else: hi = m
    return o + d * lo

# ============================================================ hilar structures
ART = dict(y=12.0, z=-0.5, r=3.0)
VEIN = dict(y=2.0, z=3.5, r=4.5)
PELV = dict(y=-11.0, z=-1.5, r=6.2)
UPJ = np.array([-27.0, -23.0, -1.2], F)
URETER_PTS = [UPJ, np.array([-29.0, -41.0, -1.0], F), np.array([-27.5, -61.0, -1.0], F), np.array([-22.5, -81.0, -1.0], F)]
N_UP = unit(URETER_PTS[1] - UPJ).astype(F)

ART_PATH = [(X_FLOOR - 0.5, ART['y'], ART['z']), (-20.0, 12.6, 0.0), (-34.0, 14.2, 1.0)]
VEIN_PATH = [(X_FLOOR - 0.5, VEIN['y'], VEIN['z']), (-22.0, 2.6, 5.0), (-38.0, 4.2, 7.0)]
PELV_PATH = [(X_FLOOR - 0.5, PELV['y'], PELV['z']), (-20.0, -15.0, -1.5), tuple(UPJ)]
PELV_R = [PELV['r'], 5.6, 4.3]

def end_cut(P, d, path):
    a, b = np.asarray(path[-2], F), np.asarray(path[-1], F)
    return np.maximum(d, plane(P, b, b - a)), b, unit(b - a).astype(F)

def insert_seg(s):   # straight insertion segment into the body (socket axis along -X)
    return (X_FLOOR + 8.0, s['y'], s['z']), (X_FLOOR - 0.5, s['y'], s['z'])

def stub(P, s, path, rads, lumen_r, lumen_d):
    a, b = insert_seg(s)
    d = np.minimum(sd_capped_cyl(P, a, b, s['r']), sd_tube(P, [np.asarray(p, F) for p in path], rads))
    d, end, n = end_cut(P, d, path)
    lumen = sd_capped_cyl(P, end - n * lumen_d, end + n * 2, lumen_r)
    return np.maximum(d, -lumen)

def stub_socket(P, s):
    a, b = insert_seg(s)
    return sd_capped_cyl(P, (a[0] + 0.3, a[1], a[2]), (X_FLOOR - 3.0, b[1], b[2]), s['r'] + CLR)

def stub_outer(P, s, path, rads):
    a, b = insert_seg(s)
    d = np.minimum(sd_capped_cyl(P, a, b, s['r']), sd_tube(P, [np.asarray(p, F) for p in path], rads))
    return end_cut(P, d, path)[0]
def f_artery_whole(P): return stub(P, ART, ART_PATH, [3.0, 3.0, 3.0], 1.5, 5.0)
def f_vein_whole(P, deep=False):
    return stub(P, VEIN, VEIN_PATH, [4.5, 4.5, 4.5], 3.35 if deep else 3.0, 16.0 if deep else 6.0)
def f_pelvis_whole(P):
    a, b = insert_seg(PELV)
    d = np.minimum(sd_capped_cyl(P, a, b, PELV['r']), sd_tube(P, [np.asarray(p, F) for p in PELV_PATH], PELV_R))
    d = np.maximum(d, plane(P, UPJ, N_UP))
    hole = sd_capped_cyl(P, UPJ - N_UP * 1.0, UPJ - N_UP * -1.0 + N_UP * 0, 2.8 + CLR)  # placeholder, replaced below
    hole = sd_capped_cyl(P, UPJ + N_UP * 1.0, UPJ - N_UP * 6.0, 2.8 + CLR)
    return np.maximum(d, -hole)
def f_ureter_whole(P):
    pts = [UPJ - N_UP * 5.5] + URETER_PTS
    d = sd_tube(P, pts, [2.8, 2.8, 2.8, 2.7, 2.6])
    d = np.maximum(d, -plane(P, UPJ - N_UP * 5.5, N_UP))  # flat top inside the pelvis hole
    d, end, n = end_cut(P, d, pts)
    return np.maximum(d, -sd_capped_cyl(P, end - n * 4, end + n * 2, 1.1))
def f_thrombus(P):
    a, b = np.asarray(VEIN_PATH[-2], F), np.asarray(VEIN_PATH[-1], F); n = unit(b - a).astype(F)
    base, tip = b - n * 15.0, b + n * 6.5
    d = sd_round_cone(P, base, tip, 3.0, 2.5)
    d = d + 0.35 * (vnoise(P, 0.35) - 0.5)
    return np.maximum(d, -plane(P, base, n))

# ============================================================ tumours
TUMORS = {   # diameter mm, outward direction (in coronal plane), oblateness along d, root into sinus
    't1a': dict(D=30.0, d=(0.95, 0.30, 0.0), e=1.00, root=False),
    't1b': dict(D=55.0, d=(0.70, 0.71, 0.0), e=0.92, root=False),
    't2a': dict(D=85.0, d=(0.33, 0.94, 0.0), e=0.80, root=False),
    't3a': dict(D=60.0, d=(-0.25, 0.97, 0.0), e=0.90, root=True),
}
TRUNC = 0.55

def tumor_spec(stage):
    t = dict(TUMORS[stage]); d = unit(t['d']).astype(F); R = t['D'] / 2
    s = ray_surface((3.0, 0.0, Z0), d)
    c = (s + d * 1.0).astype(F)
    rng = np.random.default_rng(hash(stage) % 2 ** 32)
    lobes = []
    while len(lobes) < 5:
        u = unit(rng.normal(size=3))
        if u @ d > 0.3: lobes.append((c + R * 0.60 * u.astype(F), R * rng.uniform(0.38, 0.5)))
    trunc = TRUNC * R * t['e']
    fc = (c - d * trunc).astype(F)
    rf = R * math.sqrt(1 - TRUNC ** 2)
    s_off = min(0.35 * rf, 7.0)
    pegs = [fc + np.array([0, 0, s_off], F), fc - np.array([0, 0, s_off], F)]
    return dict(c=c, d=d, R=R, e=t['e'], lobes=lobes, trunc=trunc, fc=fc, pegs=pegs, root=t['root'])

def f_tumor(P, T, holes=True):
    c, d, R, e = T['c'], T['d'], T['R'], T['e']
    p = P - c; along = p @ d
    q = p + d[None] * (along * (1 / e - 1))[:, None]      # oblate along d
    f = (norm(q) - R) * e
    for lc, lr in T['lobes']: f = smin(f, sd_sphere(P, lc, lr), 0.18 * R)
    f = np.maximum(f, np.minimum(-(along + T['trunc']), -body_raw(P)))   # flat base only inside the kidney
    if T['root']:
        f = np.minimum(f, sd_round_cone(P, c - d * 0.4 * R, c - d * (T['trunc'] + 16.0), 0.3 * R, 3.5))
    if holes:
        for pg in T['pegs']: f = np.maximum(f, -sd_capped_cyl(P, pg - d * 1.0, pg + d * 4.4, 2.4 + 0.2))
    return f

def f_pegs(P, T):
    return np.minimum(*[sd_capped_cyl(P, pg - T['d'] * 1.5, pg + T['d'] * 3.8, 2.4) for pg in T['pegs']])

def tumor_bbox(T, extra=0):
    r = T['R'] * 1.25 + extra
    return T['c'] - r, T['c'] + r

# ============================================================ internal anatomy (coronal)
PYR_ANG = [116, 84, 52, 20, -12, -44, -76, -108]
def pyramid_specs():
    c = np.asarray(SINUS['c'], F); rx, ry = SINUS['r'][0], SINUS['r'][1]
    gap = math.radians(32)
    out = []
    for a in PYR_ANG:
        t = math.radians(a)
        apex = c + np.array([rx * 0.84 * math.cos(t), ry * 0.84 * math.sin(t), 0], F)
        u = unit(apex - c).astype(F)
        surf = ray_surface(apex, u)
        h = float(np.linalg.norm(surf - apex)) - 6.0          # cortex ~6 mm under the capsule
        if h < 6: continue
        dist_base = float(np.linalg.norm(apex - c)) + h
        r2 = float(min(0.47 * h, 0.27 * gap * dist_base, 10.5))
        out.append(dict(apex=apex, base=apex + u * h, h=h, r2=r2, u=u))
    return out

PELVIS_C = np.array([-15.0, -8.0, Z0 - 0.4], F)
MAJ_U, MAJ_L, MAJ_M = np.array([-6.0, 12.0, Z0], F), np.array([-6.0, -20.0, Z0], F), np.array([-1.0, -4.0, Z0], F)
WALL = 1.4

def f_collecting_outer(P, pyrs):
    f = sd_ellipsoid(P, PELVIS_C, (8.5, 7.5, 5.2))
    f = smin(f, sd_round_cone(P, PELVIS_C, MAJ_U, 4.2, 3.4), 2.0)
    f = smin(f, sd_round_cone(P, PELVIS_C, MAJ_L, 4.2, 3.4), 2.0)
    f = smin(f, sd_round_cone(P, PELVIS_C, MAJ_M, 3.6, 3.0), 2.0)
    for p in pyrs:
        cup = p['apex'] - p['u'] * 1.6
        hub = MAJ_U if cup[1] > 5 else (MAJ_L if cup[1] < -9 else MAJ_M)
        f = smin(f, sd_round_cone(P, hub, cup, 2.7, 4.5), 1.6)
    f = smin(f, sd_tube(P, [PELVIS_C, np.asarray(PELV_PATH[1], F), UPJ], [5.6, 5.2, 4.2]), 2.0)
    return np.maximum(f, plane(P, UPJ, N_UP))

def f_collecting(P, pyrs):
    f = f_collecting_outer(P, pyrs)
    return np.maximum(f, -(f + WALL))

def f_pyramids(P, pyrs):
    f = None
    for p in pyrs:
        cone = sd_round_cone(P, p['apex'], p['base'], 2.0, p['r2'])
        d = smax(cone, sd_sphere(P, p['apex'], p['h']), 1.2)    # base follows the cortex arc
        f = d if f is None else np.minimum(f, d)
    return f

SEG_ART = [(np.array([-12.0, 11.5, -0.8], F), np.array([-1.0, 20.0, Z0], F)),
           (np.array([-12.0, 11.5, -0.8], F), np.array([-2.0, 3.0, Z0], F)),
           (np.array([-12.0, 11.5, -0.8], F), np.array([4.0, 9.0, Z0], F))]
def f_artery_coronal(P):
    path = [np.array([-12.0, 11.5, -0.6], F)] + [np.asarray(p, F) for p in ART_PATH[1:]]
    d = sd_tube(P, path, [3.0, 3.0, 3.0])
    d, end, n = end_cut(P, d, path)
    for a, b in SEG_ART: d = smin(d, sd_round_cone(P, a, b, 2.0, 1.3), 1.2)
    lumen = sd_tube(P, path, [1.5, 1.5, 1.5])
    lumen = np.maximum(lumen, plane(P, end + n * 2, n))
    return np.maximum(d, -lumen)

def f_ureter_coronal(P):
    d = sd_tube(P, URETER_PTS, [2.8, 2.8, 2.7, 2.6])
    d = np.maximum(d, -plane(P, UPJ, N_UP))
    d, end, n = end_cut(P, d, URETER_PTS)
    lumen = sd_tube(P, URETER_PTS, [1.3, 1.3, 1.25, 1.2])
    return np.maximum(d, -lumen)

# ============================================================ colour (vertex multipliers)
def ones(V, k=1.0): return np.ones((len(V), 3)) * k
def on_cut(V): return np.abs(V[:, 2] - Z0) < 0.35

def col_tumor(V, ctx=None):
    n1 = fbm(V, 0.07); n2 = fbm(V + 40, 0.25); n3 = fbm(V + 90, 0.5)
    # exterior: golden-tan with fine darker vascular mottling
    ext = (0.84 + 0.12 * n2 + 0.04 * n3)[:, None] * np.array([1.0, 0.97, 0.92])
    ext = ext * (1 - 0.18 * np.clip((n3 - 0.6) / 0.15, 0, 1))[:, None]
    # cut surface: variegated, haemorrhagic red-brown areas and fibrous streaks
    hem = np.clip((n1 - 0.52) / 0.10, 0, 1)[:, None]
    fib = np.clip((n2 - 0.66) / 0.08, 0, 1)[:, None]
    cut = (0.88 + 0.12 * n3)[:, None] * np.ones((len(V), 3))
    cut = cut * (1 - hem) + hem * np.array([0.58, 0.28, 0.22])
    cut = cut * (1 - fib) + fib * np.array([0.78, 0.66, 0.55])
    return np.where(on_cut(V)[:, None], cut, ext)

def col_medulla(V, ctx):
    best = np.full(len(V), 1e9); stripe = np.zeros(len(V))
    for p in ctx['pyrs']:
        rel = V - p['apex']; along = rel @ p['u']
        perp = np.linalg.norm(rel - np.outer(along, p['u']), axis=1)
        dist = perp / np.maximum(along, 1.0)
        ang = np.arctan2(perp * np.sign(np.cross(np.tile(p['u'], (len(V), 1)), rel)[:, 2] + 1e-9), np.maximum(along, 0.1))
        sel = dist + 0.02 * np.abs(along) < best
        stripe = np.where(sel, 0.5 + 0.5 * np.sin(ang * 44.0), stripe); best = np.where(sel, dist + 0.02 * np.abs(along), best)
    k = np.where(on_cut(V), 0.78 + 0.22 * stripe, 0.9)
    return k[:, None] * np.ones((len(V), 3))

def col_fat(V, ctx=None): return (0.86 + 0.14 * fbm(V, 0.4))[:, None] * np.array([1.0, 0.98, 0.94])
def col_cortex(V, ctx=None): return (0.94 + 0.06 * fbm(V, 0.15))[:, None] * np.ones((len(V), 3))

def lumen_tint(V, outer_fn, tint, thresh=-0.6, cut_only=False):
    inside = outer_fn(V.astype(F)) < thresh
    if cut_only: inside &= ~on_cut(V)
    return np.where(inside[:, None], np.array(tint)[None], 1.0) * np.ones((len(V), 3))

COLOURS = {'tumor': col_tumor, 'vein_thrombus': col_tumor, 'renal_sinus': col_fat, 'renal_cortex': col_cortex,
           'kidney_body': col_cortex, 'renal_medulla': col_medulla}

# ============================================================ export
def vertex_colour(name, V, ctx):
    if name in ctx.get('tints', {}): return ctx['tints'][name](V)
    if name in COLOURS: return COLOURS[name](V, ctx)
    return None

def to_glb(meshes, path, colour_ctx):
    scene = trimesh.Scene()
    for name, m in meshes.items():
        g = trimesh.graph.smooth_shade(m, angle=np.radians(38), facet_minarea=None)
        V = np.asarray(g.vertices)
        c = vertex_colour(name, V, colour_ctx)
        g.apply_scale(0.1)
        if c is not None:
            rgba = np.c_[np.clip(c, 0, 1) * 255, np.full(len(V), 255)].astype(np.uint8)
            g.visual = trimesh.visual.ColorVisuals(g, vertex_colors=rgba)
        scene.add_geometry(g, node_name=name, geom_name=name)
    with open(path, 'wb') as f:
        f.write(trimesh.exchange.gltf.export_glb(scene, include_normals=True))

def orient(m, kind, T=None):
    m = m.copy()
    if kind == 'flat_down': pass
    elif kind == 'cut_down': m.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [1, 0, 0]))
    elif kind == 'insert_down': m.apply_transform(trimesh.geometry.align_vectors([1, 0, 0], [0, 0, -1]))
    elif kind == 'axis_down': m.apply_transform(trimesh.geometry.align_vectors(T, [0, 0, -1]))
    m.apply_translation([-m.bounds[:, 0].mean(), -m.bounds[:, 1].mean(), -m.bounds[0, 2]])
    return m

# ============================================================ build
BODY_LO, BODY_HI = (-37.0, -60.0, -17.0), (40.0, 60.0, 18.0)

def build_whole(stage):
    T = tumor_spec(stage) if stage in TUMORS else None
    g = Grid(BODY_LO, BODY_HI)
    P = g.P
    body = g.normalize(body_raw(P))
    body = smax(body, -sd_ellipsoid(P, RECESS['c'], RECESS['r']), 2.5)
    body = np.maximum(body, POST_FLAT - P[:, 2])
    for s in (ART, VEIN, PELV): body = np.maximum(body, -stub_socket(P, s))
    if T:
        body = np.maximum(body, -(f_tumor(P, T, holes=False) - CLR))
        body = np.minimum(body, np.where(norm(P - T['fc']) < 12, f_pegs(P, T), 1e3))
    meshes = {'kidney_body': mesh_from(g, body, min_vol=500, target=48000)}
    def part(fn, lo, hi, target, **kw):
        gg = Grid(lo, hi); return mesh_from(gg, fn(gg.P, **kw) if kw else fn(gg.P), target=target)
    meshes['renal_artery'] = part(f_artery_whole, (-38, 7, -6), (5, 19, 6), 8000)
    meshes['renal_vein'] = part(lambda Q: f_vein_whole(Q, deep=(stage == 't3a')), (-44, -4, -3), (5, 10, 14), 10000)
    meshes['renal_pelvis'] = part(f_pelvis_whole, (-34, -30, -10), (5, -3, 7), 10000)
    meshes['ureter'] = part(f_ureter_whole, (-34, -86, -6), (-16, -14, 4), 8000)
    if T:
        lo, hi = tumor_bbox(T, extra=20 if T['root'] else 0)
        gg = Grid(lo, hi); meshes['tumor'] = mesh_from(gg, f_tumor(gg.P, T), target=30000, max_edge=1.3)
    if stage == 't3a':
        meshes['vein_thrombus'] = part(f_thrombus, (-48, -6, -2), (-14, 12, 14), 4000)
    print_specs = {'kidney_body': ('flat_down', None, True), 'renal_artery': ('insert_down', None, False),
                   'renal_vein': ('insert_down', None, False), 'renal_pelvis': ('insert_down', None, False),
                   'ureter': ('axis_down', -N_UP, False), 'tumor': ('axis_down', -T['d'] if T else None, False),
                   'vein_thrombus': ('axis_down', unit(np.asarray(VEIN_PATH[-2]) - np.asarray(VEIN_PATH[-1])), False)}
    tints = {
        'renal_artery': lambda V: lumen_tint(V, lambda Q: stub_outer(Q, ART, ART_PATH, [3, 3, 3]), (0.45, 0.22, 0.22)),
        'renal_vein': lambda V: lumen_tint(V, lambda Q: stub_outer(Q, VEIN, VEIN_PATH, [4.5, 4.5, 4.5]), (0.35, 0.35, 0.5)),
        'ureter': lambda V: lumen_tint(V, lambda Q: np.maximum(sd_tube(Q, URETER_PTS, [2.8, 2.8, 2.7, 2.6]), plane(Q, URETER_PTS[-1], URETER_PTS[-1] - URETER_PTS[-2])), (0.6, 0.6, 0.62), thresh=-0.5),
    }
    return meshes, print_specs, {'tints': tints}

def build_coronal(stage):
    T = tumor_spec(stage) if stage in TUMORS else None
    pyrs = pyramid_specs()
    g = Grid(BODY_LO, (BODY_HI[0], BODY_HI[1], Z0 + 1.5))
    P = g.P
    half = P[:, 2] - Z0
    outer = g.normalize(body_raw(P))
    outer = np.maximum(outer, POST_FLAT - P[:, 2])
    sinus = sd_ellipsoid(P, SINUS['c'], SINUS['r'])
    tum = f_tumor(P, T, holes=False) if T else np.full(len(P), 1e3, F)
    pyr = np.maximum(f_pyramids(P, pyrs), -(tum - CLR))
    pyr = np.maximum(pyr, outer)                                   # never outside the kidney
    col_outer = np.maximum(np.maximum(f_collecting_outer(P, pyrs), -(pyr - CLR)), -(tum - CLR))
    col = np.maximum(col_outer, -(col_outer + WALL))
    col = np.maximum(col, -(pyr - CLR))           # papillae sit inside the minor calyx cups
    art = f_artery_coronal(P)
    fat = np.maximum(sinus, outer)
    for other in (col_outer, pyr, tum, art): fat = np.maximum(fat, -(other - CLR))   # lumens stay empty
    cortex = smax(outer, -sinus, 2.5)
    for other in (pyr, tum): cortex = np.maximum(cortex, -(other - CLR))
    meshes = {}
    meshes['renal_cortex'] = mesh_from(g, np.maximum(cortex, half), min_vol=500, target=40000, max_edge=1.4)
    meshes['renal_medulla'] = mesh_from(g, np.maximum(pyr, half), min_vol=15, target=16000, max_edge=0.9)
    meshes['renal_sinus'] = mesh_from(g, np.maximum(fat, half), min_vol=15, target=24000, max_edge=1.4)
    meshes['renal_pelvis'] = mesh_from(g, np.maximum(col, half), min_vol=15, target=20000, max_edge=1.2)
    meshes['renal_artery'] = mesh_from(g, np.maximum(art, half), min_vol=5, target=8000)
    gu = Grid((-34, -86, -6), (-16, -20, Z0 + 1.5))
    meshes['ureter'] = mesh_from(gu, np.maximum(f_ureter_coronal(gu.P), gu.P[:, 2] - Z0), min_vol=5, target=6000)
    if T:
        lo, hi = tumor_bbox(T, extra=20 if T['root'] else 0); hi = hi.copy(); hi[2] = Z0 + 1.5
        gt = Grid(lo, hi)
        meshes['tumor'] = mesh_from(gt, np.maximum(f_tumor(gt.P, T, holes=False), gt.P[:, 2] - Z0), target=24000, max_edge=1.1)
    meshes = {k: v for k, v in meshes.items() if v is not None}
    specs = {k: ('cut_down', None, False) for k in meshes}
    specs['renal_cortex'] = ('flat_down', None, True)
    tints = {
        'renal_pelvis': lambda V: lumen_tint(V, lambda Q: f_collecting_outer(Q, pyrs), (0.80, 0.86, 0.95), thresh=-0.7, cut_only=True),
        'ureter': lambda V: lumen_tint(V, lambda Q: sd_tube(Q, URETER_PTS, [2.8, 2.8, 2.7, 2.6]), (0.80, 0.86, 0.95), thresh=-0.7, cut_only=True),
        'renal_artery': lambda V: lumen_tint(V, lambda Q: sd_tube(Q, [np.array([-12.0, 11.5, -0.6], F)] + [np.asarray(p, F) for p in ART_PATH[1:]], [3, 3, 3]), (0.5, 0.2, 0.2), thresh=-0.6, cut_only=True),
    }
    return meshes, specs, {'pyrs': pyrs, 'tints': tints}

def clearance_report(meshes):
    names = list(meshes); out = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = meshes[names[i]], meshes[names[j]]
            if not (np.all(a.bounds[0] <= b.bounds[1]) and np.all(b.bounds[0] <= a.bounds[1])): continue
            sample = b.vertices[::max(1, len(b.vertices) // 4000)]
            inside = a.contains(sample) if a.is_watertight else np.zeros(len(sample), bool)
            if inside.mean() > 0.002: out.append(f'{names[j]} penetrates {names[i]} ({inside.mean()*100:.1f}% of sampled verts)')
    return out

if __name__ == '__main__':
    stages = sys.argv[2].split(',') if len(sys.argv) > 2 else ['normal', 't1a', 't1b', 't2a', 't3a']
    forms = sys.argv[3].split(',') if len(sys.argv) > 3 else ['whole', 'coronal']
    manifest_path = os.path.join(OUT, 'print', 'manifest.json')
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    for stage in stages:
        for form in forms:
            meshes, specs, ctx = (build_whole if form == 'whole' else build_coronal)(stage)
            meshes = {k: v for k, v in meshes.items() if v is not None}
            key = f'{stage}_{"full" if form == "whole" else "coronal"}'
            glb = os.path.join(OUT, f'kidney_{stage}{"" if form == "whole" else "_coronal"}.glb')
            to_glb(meshes, glb, ctx)
            pdir = os.path.join(OUT, 'print', f'kidney_{key}'); os.makedirs(pdir, exist_ok=True)
            entries = []
            for i, (name, m) in enumerate(meshes.items(), 1):
                kind, axis, sup = specs[name]
                if name == 'tumor' and form == 'whole':
                    T = tumor_spec(stage); along = (np.asarray(m.vertices) - T['c']) @ T['d']
                    sup = bool(along.min() < -(T['trunc'] + 1.0))
                fn = f'{i:02d}_{name}.stl'
                pm = m.metadata.get('print', m)
                cap = {'kidney_body': 26000, 'renal_cortex': 26000, 'tumor': 20000}.get(name, 7000)
                if len(pm.faces) > cap:   # densified only for colour detail; slicers don't need it
                    v2, f2 = fast_simplification.simplify(pm.vertices, pm.faces, target_reduction=1 - cap / len(pm.faces))
                    t2 = trimesh.Trimesh(v2, f2, process=True)
                    if t2.is_watertight: pm = t2
                orient(pm, kind, axis).export(os.path.join(pdir, fn))
                entries.append(dict(part=name, file=f'kidney_{key}/{fn}', supports=sup, watertight=bool(m.is_watertight),
                                    faces=int(len(m.faces)), volume_cm3=round(float(m.volume) / 1000, 2)))
            manifest[key] = entries
            print(key, ' | '.join(f"{e['part']} {e['faces']}f {e['volume_cm3']}cm3{'' if e['watertight'] else ' NOT-WATERTIGHT'}" for e in entries))
            json.dump(manifest, open(manifest_path, 'w'), indent=1)
            import pickle
            pk = {}
            for k, m in meshes.items():
                c = vertex_colour(k, np.asarray(m.vertices, F), ctx)
                pk[k] = (m.vertices, m.faces, c)
            pickle.dump(pk, open(os.path.join(OUT, f'.mesh_{key}.pkl'), 'wb'))
