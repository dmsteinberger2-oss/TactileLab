"""Extra kidney conditions for place_model.py: T3b (IVC thrombus), T4 (adrenal invasion), Bosniak cysts
and angiomyolipoma. Geometry is schematic and unreviewed; clinical wording lives in src/data/labs.js.

Every lesion reuses place_model's tumour machinery (seated in a cavity with clearance, keyed pegs in the
whole kidney, cut with the coronal section). This module adds the shapes and colours that differ.
Units: mm, kidney centred at the origin, long axis +Y, hilum -X (left kidney), anterior +Z.
"""
import numpy as np
import kidney_sdf as K

F = np.float32

# ---------------------------------------------------------------- lesion specs (merged into place_model.TUMORS)
# part: mesh / part id of the lesion. lobes: number of lobulations (0 = smooth). cyst: internal structure.
CYST_D, CYST_DIR = 34.0, (1.0, -0.18, 0.0)          # 3.4 cm, lateral mid-pole, half exophytic
LESIONS = {
    't3b': dict(D=70.0, d=(-0.10, 0.99, 0.0), e=0.90, root=True),
    't4': dict(D=80.0, d=(0.45, 0.89, 0.0), out=10.0, e=0.88, root=False, invade='adrenal'),
    'bosniak_1': dict(D=CYST_D, d=CYST_DIR, e=1.0, root=False, part='cyst', lobes=0,
                      cyst=dict(wall=1.2, septa=[], nodules=[], rough=0.0)),
    'bosniak_2': dict(D=CYST_D, d=CYST_DIR, e=1.0, root=False, part='cyst', lobes=0,
                      cyst=dict(wall=1.2, septa=[((0.35, 1.0, 0.0), 2.0, 1.0), ((1.0, -0.55, 0.0), -3.0, 1.0)], nodules=[], rough=0.0)),
    'bosniak_2f': dict(D=CYST_D, d=CYST_DIR, e=1.0, root=False, part='cyst', lobes=0,
                       cyst=dict(wall=2.8, septa=[((0.35, 1.0, 0.0), 3.5, 1.3), ((0.4, 1.0, 0.0), -5.0, 1.3),
                                                  ((1.0, -0.5, 0.0), 1.0, 1.3), ((1.0, 0.7, 0.0), -6.5, 1.3)], nodules=[], rough=0.0)),
    'bosniak_3': dict(D=CYST_D, d=CYST_DIR, e=1.0, root=False, part='cyst', lobes=0,
                      cyst=dict(wall=4.2, septa=[((0.35, 1.0, 0.0), 1.5, 4.0), ((1.0, -0.6, 0.0), -2.5, 4.0)], nodules=[], rough=1.4)),
    'bosniak_4': dict(D=CYST_D, d=CYST_DIR, e=1.0, root=False, part='cyst', lobes=0,
                      cyst=dict(wall=2.0, septa=[((0.35, 1.0, 0.0), 4.0, 1.6)], nodules=[((-0.2, -1.0, 0.0), 7.0), ((0.9, 0.5, 0.0), 4.5)], rough=0.6)),
    'aml': dict(D=45.0, d=(0.55, -0.83, 0.0), e=0.95, root=False, part='aml'),
}

# ---------------------------------------------------------------- cyst interior
def cyst_fluid(P, T):
    """SDF of the fluid-filled locule(s) of a cyst: inside the wall, minus septa and nodules."""
    c, R, cy = T['c'], T['R'], T['cyst']
    f = K.norm(P - c) - (R - cy['wall'])
    if cy['rough']: f = f + cy['rough'] * (K.fbm(P, 0.22) - 0.5) * 2.0
    for n, off, th in cy['septa']:
        n = K.unit(n).astype(F)
        sd = np.abs(K.plane(P, c + n * off, n)) - th / 2
        if cy['rough']: sd = sd + cy['rough'] * 0.6 * (K.fbm(P + 50, 0.3) - 0.5)
        f = np.maximum(f, -sd)
    for d, r in cy['nodules']:
        d = K.unit(d).astype(F)
        f = np.maximum(f, -K.sd_sphere(P, c + d * (R - cy['wall']), r))
    return f

def cyst_nodule_field(P, T):
    c, R, cy = T['c'], T['R'], T['cyst']
    f = np.full(len(P), 1e3, F)
    for d, r in cy['nodules']:
        d = K.unit(d).astype(F)
        f = np.minimum(f, K.sd_sphere(P, c + d * (R - cy['wall']), r))
    return f

RECESS_MM = 1.4     # fluid locules are recessed this deep in the coronal cut face (tactile and visible)

def cyst_recess(T, z0, to_m):
    """Fluid locules as a slab-limited solid at the cut plane, to subtract from the posterior cyst half."""
    c, R = T['c'], T['R']
    g = K.Grid(c - R - 1, c + R + 1, h=0.3)
    f = np.maximum(cyst_fluid(g.P, T), np.abs(g.P[:, 2] - z0) - RECESS_MM)
    m = K.mesh_from(g, f, target=30000, min_vol=2.0)
    return to_m(m) if m is not None else None

def cyst_fluid_mesh(T, to_t_fn=None):
    c, R = T['c'], T['R']
    g = K.Grid(c - R - 1, c + R + 1, h=0.3)
    return K.mesh_from(g, cyst_fluid(g.P, T), target=30000, min_vol=2.0)

def nodule_mesh(T):
    if not T['cyst']['nodules']: return None
    c, R = T['c'], T['R']
    g = K.Grid(c - R - 1, c + R + 1, h=0.3)
    return K.mesh_from(g, cyst_nodule_field(g.P, T), target=8000, min_vol=2.0)

# ---------------------------------------------------------------- IVC + tumour thrombus (T3b)
IVC_R, IVC_WALL = 11.0, 1.6
def ivc_frame(end, u):
    y = np.array([0.0, 1.0, 0.0]); y = y - u * (u @ y); y /= np.linalg.norm(y)
    z = np.cross(u, y)
    if z[2] < 0: z = -z
    C = end + u * (IVC_R - 0.6)
    return C.astype(F), y.astype(F), z.astype(F)

def ivc_parts(vein_axis_fn, vein, centre, to_m):
    """Schematic, shortened IVC segment at the renal vein's end (the left renal vein is really 6-10 cm long,
    crossing in front of the aorta), opened by an anterior window, with the vein thrombus continuing into it.
    Returns (ivc, ivc_thrombus, vein_thrombus, vein_lumen) as manifolds."""
    end, u, r = vein_axis_fn(vein, centre)
    end = end.astype(F); u = u.astype(F)
    C, ay, az = ivc_frame(end, u)
    lo = C - IVC_R * 1.6 - np.abs(ay) * 50; hi = C + IVC_R * 1.6 + np.abs(ay) * 50
    g = K.Grid(lo, hi, h=0.4); P = g.P
    q = P - C; along_y = q @ ay; zc = q @ az
    rad = K.norm(q - np.outer(along_y, ay))
    y0, y1 = -42.0, 40.0
    cap = np.maximum(y0 - along_y, along_y - y1)
    outer = np.maximum(rad - IVC_R, cap)
    inner = np.maximum(rad - (IVC_R - IVC_WALL), cap - 0.01)
    wall = np.maximum(outer, -inner)
    # opening where the renal vein enters (vein lumen radius)
    lumen_r = r * 0.72
    qa = P - end; a = qa @ u; perp = K.norm(qa - np.outer(a, u))
    hole = np.maximum(perp - lumen_r, np.maximum(-3.0 - a, a - IVC_R))
    wall = np.maximum(wall, -hole)
    # anterior window (as at cavotomy) so the thrombus shows and lifts out
    win = np.maximum(np.maximum(-(zc - IVC_R * 0.30), -14.0 - along_y), along_y - 34.0)
    wall = np.maximum(wall, -win)
    wall = np.maximum(wall, -(zc + IVC_R - 1.4))       # flat posterior strip to print on
    ivc = K.mesh_from(g, wall, target=20000, min_vol=50)
    # vein thrombus: fills the renal vein lumen and the hole in the IVC wall, flush with its inner surface
    a_in = (IVC_R - 0.6) - (IVC_R - IVC_WALL) * np.sqrt(max(0.0, 1 - (lumen_r / (IVC_R - IVC_WALL)) ** 2))
    a_in = float(a_in) + 0.4
    gv = K.Grid(np.minimum(end - u * 16, end + u * (a_in + 1)) - r * 2, np.maximum(end - u * 16, end + u * (a_in + 1)) + r * 2, h=0.35)
    fv = K.sd_round_cone(gv.P, end - u * 15, end + u * a_in, r * 0.66, r * 0.60)
    fv = fv + 0.3 * (K.vnoise(gv.P, 0.35) - 0.5)
    fv = np.maximum(fv, -K.plane(gv.P, end - u * 15, u))
    fv = np.maximum(fv, K.plane(gv.P, end + u * a_in, u))
    vth = K.mesh_from(gv, fv, target=5000)
    lumen = to_m(__import__('trimesh').creation.cylinder(radius=lumen_r, segment=[end - u * 16, end + u * 2], sections=40))
    # IVC thrombus: a tongue rising in the lumen from the renal vein ostium (Mayo level II: >2 cm above it)
    li = IVC_R - IVC_WALL
    base = C - u * (li * 0.25) - ay * 6.0
    tip = C - u * (li * 0.05) + ay * 30.0
    ft = K.sd_round_cone(P, base, tip, li * 0.62, 3.2)
    ft = K.smin(ft, K.sd_sphere(P, C + u * (li * 0.25), li * 0.55), 3.0)
    ft = ft + 0.35 * (K.vnoise(P, 0.3) - 0.5)
    ft = np.maximum(ft, rad - (li - 0.45))                     # clear of the wall
    ft = np.maximum(ft, -K.plane(P, end + u * (a_in + 0.25), u))  # starts beyond the vein thrombus, 0.25 mm gap
    ith = K.mesh_from(g, ft, target=8000)
    return to_m(ivc), to_m(ith), to_m(vth), lumen

# ---------------------------------------------------------------- colours (vertex multipliers on DEFAULTS)
DEFAULTS = {'cyst': '#cdd7d5', 'aml': '#e2c05a', 'ivc': '#2e5c9e', 'ivc_thrombus': '#cf9233'}

def col_cyst(V, T, z0):
    if T is None or 'cyst' not in T: return np.ones((len(V), 3))
    n1 = K.fbm(V, 0.18); n2 = K.fbm(V + 30, 0.6)
    ext = (0.92 + 0.08 * n1)[:, None] * np.array([1.0, 1.0, 1.0])
    # faint vessels on the dome
    ves = np.clip((n2 - 0.68) / 0.06, 0, 1)[:, None]
    ext = ext * (1 - ves) + ves * np.array([0.82, 0.62, 0.62])
    floor = (V[:, 2] < z0 - 0.4) & (V[:, 2] > z0 - RECESS_MM - 0.4) & (cyst_fluid(V.astype(F), T) < 0.6)
    fluid = np.array([0.62, 0.66, 0.60]) * (0.94 + 0.06 * n1)[:, None]
    out = np.where(floor[:, None], fluid, ext)
    if T['cyst']['nodules']:
        nod = cyst_nodule_field(V.astype(F), T) < 0.5
        out = np.where(nod[:, None], np.array([1.12, 0.82, 0.62]) * (0.9 + 0.1 * n2)[:, None], out)
    return out

def col_aml(V, ctx=None):
    n1 = K.fbm(V, 0.12); n2 = K.fbm(V + 60, 0.45)
    fat = (0.88 + 0.12 * n1)[:, None] * np.array([1.0, 0.98, 0.92])
    muscle = np.clip((n1 - 0.58) / 0.08, 0, 1)[:, None]               # pink-tan smooth-muscle areas
    out = fat * (1 - muscle) + muscle * np.array([0.92, 0.66, 0.56])
    ves = np.clip((n2 - 0.70) / 0.05, 0, 1)[:, None]                  # thick-walled vessels
    return out * (1 - ves) + ves * np.array([0.78, 0.34, 0.30])
