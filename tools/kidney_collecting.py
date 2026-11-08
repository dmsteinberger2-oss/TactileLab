"""Collecting-system conditions for place_model.py: hydronephrosis (SFU grades 1-4) and staghorn calculus.
Geometry is schematic and unreviewed; clinical wording lives in src/data/labs.js.

The source renal pelvis is a thin wall (~1.3 mm) around an empty lumen that opens at the hilum. The lumen is
recovered on a grid as the gap the wall encloses (morphological closing of the kidney union), then:
  hydronephrosis: the lumen is dilated (pelvis first, then calyces, then into the parenchyma), a new wall is
                  grown around it, and medulla, sinus fat and cortex are cut back around the wall.
  staghorn:       a branched stone fills the lumen (with print clearance), inside the unchanged wall.
Units mm, kidney centred at the origin, long axis +Y, hilum -X.
"""
import numpy as np
from scipy import ndimage
import kidney_sdf as K

F = np.float32
H = 0.5      # grid spacing, mm
WALL = 1.2   # wall of the dilated collecting system, mm

# grade: (pelvis growth, calyx growth, calyx-tip clubbing, parenchymal rim kept), mm
HYDRO = {'hydro_1': (3.0, 0.0, 0.0, 7.0), 'hydro_2': (5.5, 1.0, 0.0, 6.0),
         'hydro_3': (7.0, 2.5, 3.0, 4.5), 'hydro_4': (8.5, 4.0, 7.0, 2.2)}
STAGES = set(HYDRO) | {'staghorn'}

def inside_mask(mesh, g):
    """Grid points inside a closed mesh, by ray parity along +Y (one ray per (x, z) column)."""
    xs, ys, zs = g.axes
    X, Z = np.meshgrid(xs, zs, indexing='ij')
    org = np.stack([X.ravel(), np.full(X.size, ys[0] - 1.0, F), Z.ravel()], 1).astype(float)
    org[:, 0] += 1.1e-3; org[:, 2] += 0.7e-3            # avoid hitting edges exactly
    loc, ri, _ = mesh.ray.intersects_location(org, np.tile([0.0, 1.0, 0.0], (len(org), 1)), multiple_hits=True)
    ins = np.zeros((len(xs), len(ys), len(zs)), bool)
    order = np.lexsort((loc[:, 1], ri)); loc, ri = loc[order], ri[order]
    starts = np.searchsorted(ri, np.arange(len(org))); ends = np.searchsorted(ri, np.arange(len(org)), 'right')
    for r in np.nonzero(ends - starts >= 2)[0]:
        hy = loc[starts[r]:ends[r], 1]
        if len(hy) % 2: hy = hy[:-1]
        i, k = divmod(r, len(zs))
        for a, b in hy.reshape(-1, 2):
            ins[i, (ys > a) & (ys < b), k] = True
    return ins

def sdf(mask, h=H, blur=0.9):
    d = (ndimage.distance_transform_edt(~mask) - ndimage.distance_transform_edt(mask)) * h
    return ndimage.gaussian_filter(d, blur).astype(F) if blur else d.astype(F)   # soften the voxel staircase

def fields(parts):
    """Grid, pelvis-wall SDF, lumen SDF, closed-kidney SDF."""
    lo = parts['renal_cortex'].bounds[0] - 10; hi = parts['renal_cortex'].bounds[1] + 10
    g = K.Grid(lo, hi, h=H)
    pel = inside_mask(parts['renal_pelvis'], g)
    raw = pel.copy()
    for k in ('renal_cortex', 'renal_medulla', 'renal_sinus'): raw |= inside_mask(parts[k], g)
    solid = ndimage.binary_fill_holes(ndimage.binary_closing(raw, iterations=8, border_value=0))
    gap = solid & ~raw
    lab, n = ndimage.label(gap)
    lumen = lab == (np.argmax(np.bincount(lab.ravel())[1:]) + 1)
    return g, sdf(pel, blur=0), sdf(lumen), sdf(solid)

def hydro(g, p, L, kd, stage):
    A, B, C, rim = HYDRO[stage]
    core = L < -1.6                                        # the wide pelvis; infundibula and calyces are narrower
    dcore = ndimage.distance_transform_edt(~core) * H
    w = np.exp(-(dcore / 8.0) ** 2)                        # 1 in the pelvis, falling off along the infundibula
    tip = np.clip((dcore - 8.0) / 10.0, 0, 1)              # calyx ends: clubbing at higher grades
    fl = L - (A * w + B * (1 - w) + C * tip)
    fl = np.maximum(fl, -(kd + rim + WALL))                # keep a parenchymal rim
    fl = np.minimum(fl, L)                                 # never smaller than the source lumen
    return fl, f_wall_of(fl)

def f_wall_of(fl): return np.maximum(fl - WALL, -fl)

def apply(parts, stage, to_m, to_t, clr=0.25):
    """Copy of parts with the collecting-system change applied (plus 'calculus' for staghorn)."""
    g, p, L, kd = fields(parts)
    out = dict(parts)
    if stage in HYDRO:
        fl, f_pel = hydro(g, p, L, kd, stage)
        wall = to_m(K.mesh_from(g, f_wall_of(fl).ravel(), target=30000, min_vol=5))
        lum = to_m(K.mesh_from(g, fl.ravel(), target=30000, min_vol=5))
        out['renal_pelvis'] = to_t((to_m(parts['renal_pelvis']) + wall) - lum)   # source wall kept at the hilum and UPJ
        cut = to_m(K.mesh_from(g, (fl - WALL - clr).ravel(), target=30000, min_vol=5))
        for k in ('renal_medulla', 'renal_sinus', 'renal_cortex'):
            out[k] = to_t(to_m(parts[k]) - cut)
    else:
        P = g.P
        fs = L.ravel() + clr + 0.3 * (K.fbm(P, 0.8) - 0.5)
        fs = np.maximum(fs, kd.ravel() + 1.0)              # intrarenal only: stops at the hilar mouth
        out['calculus'] = K.mesh_from(g, fs, target=16000, min_vol=40)
    return out
