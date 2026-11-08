"""Collecting-system conditions for place_model.py: hydronephrosis (SFU grades 1-4) and staghorn calculus.
Geometry is schematic and unreviewed; clinical wording lives in src/data/labs.js.

Both work on a signed distance field of the source renal pelvis (pelvis + calyces), sampled on a grid:
  hydronephrosis: the pelvis (grade 1), then calyces (2-3), then the parenchyma (4) are displaced by a
                  dilated collecting system; medulla, sinus fat and cortex are cut back around it.
  staghorn:       a branched stone casting the pelvis and calyces, inside a thin-walled collecting system.
Units mm, kidney centred at the origin, long axis +Y, hilum -X.
"""
import numpy as np
import trimesh
from scipy import ndimage
import kidney_sdf as K

F = np.float32
H = 0.5   # grid spacing, mm

# grade: (pelvis growth mm, calyx growth mm, parenchyma rim kept mm)
HYDRO = {'hydro_1': (3.5, 0.0, 6.0), 'hydro_2': (6.0, 1.2, 5.0), 'hydro_3': (8.0, 3.0, 4.0), 'hydro_4': (10.0, 6.5, 2.0)}
STONE = {'staghorn': dict(wall=0.9)}
STAGES = set(HYDRO) | set(STONE)

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

def sdf(mask, h=H):
    d = (ndimage.distance_transform_edt(~mask) - ndimage.distance_transform_edt(mask)) * h
    return ndimage.gaussian_filter(d, 0.9).astype(F)      # soften the voxel staircase

def field_grid(parts):
    lo = parts['renal_cortex'].bounds[0] - 14; hi = parts['renal_cortex'].bounds[1] + 14
    return K.Grid(lo, hi, h=H)

def pelvis_fields(parts):
    g = field_grid(parts)
    pel = inside_mask(parts['renal_pelvis'], g)
    kid = np.zeros_like(pel)
    for k in ('renal_cortex', 'renal_medulla', 'renal_sinus', 'renal_pelvis'): kid |= inside_mask(parts[k], g)
    kid = ndimage.binary_closing(kid, iterations=2)
    return g, sdf(pel), sdf(kid)

def hydro_pelvis(g, p, kd, grade):
    """Dilated collecting system SDF. Growth is largest in the thick pelvis and tapers into the calyces."""
    A, B, rim = HYDRO[grade]
    core = p < -2.6                                         # the thick pelvis (calyces and infundibula are thinner)
    dcore = ndimage.distance_transform_edt(~core) * H
    w = np.exp(-(dcore / 9.0) ** 2)                         # 1 in the pelvis, falling off along the infundibula
    grow = A * w + B * (1 - w)
    f = p - grow
    f = K.smin(f.ravel(), p.ravel(), 1.0).reshape(f.shape)   # never thinner than the source
    # stay inside the kidney with a parenchymal rim, except where the pelvis leaves through the hilum
    f = np.maximum(f, -(kd + rim))
    f = np.minimum(f, p)                                    # keep the source pelvis (incl. its extrarenal part)
    return f

def apply(parts, stage, to_m, to_t, clr=0.25):
    """Returns a copy of parts with the collecting-system change applied (plus 'calculus' for staghorn)."""
    g, p, kd = pelvis_fields(parts)
    out = dict(parts)
    if stage in HYDRO:
        f = hydro_pelvis(g, p, kd, stage)
        pel = K.mesh_from(g, f.ravel(), target=24000)
        pm = to_m(pel)
        cut = to_m(K.mesh_from(g, f.ravel() - clr, target=24000))
        for k in ('renal_medulla', 'renal_sinus', 'renal_cortex'):
            out[k] = to_t(to_m(parts[k]) - cut)
        out['renal_pelvis'] = to_t(pm)
    else:
        wall = STONE[stage]['wall']
        # the stone fills the collecting system to within `wall` of its surface, slightly knobbly
        P = g.P
        fs = p.ravel() + wall + 0.35 * (K.fbm(P, 0.9) - 0.5)
        fs = np.maximum(fs, kd.ravel() + 1.0)                # only the intrarenal part (not down the ureter)
        stone = K.mesh_from(g, fs, target=16000, min_vol=40)
        st = to_m(stone)
        out['renal_pelvis'] = to_t(to_m(parts['renal_pelvis']) - to_m(K.mesh_from(g, fs - clr, target=16000, min_vol=40)))
        out['calculus'] = to_t(st)
    return out
