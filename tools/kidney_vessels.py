"""Renal vessel variants for place_model.py: accessory (lower polar) renal artery.

Schematic and unreviewed; clinical wording lives in src/data/labs.js. Frame as place_model: mm, kidney centred,
long axis +Y, hilum -X, anterior +Z. The extra artery is a separate part that enters the lower pole directly,
outside the hilum, and ends where the main artery stub ends (as if cut near the aorta).
"""
import numpy as np
import kidney_sdf as K
import beauty as B
B.DEFAULTS.setdefault('accessory_renal_artery', '#c0392b')

F = np.float32
STAGES = {'accessory_artery'}
ACC_R = 2.1          # mm: smaller than the main artery stub (3.0)

def apply(parts, stage, to_m, to_t, kidney_m):
    out = dict(parts)
    art = np.asarray(parts['renal_artery'].vertices)
    za = float(np.median(art[:, 2]))
    cx = np.asarray(parts['renal_cortex'].vertices)
    y0, y1 = cx[:, 1].min(), cx[:, 1].max(); L = y1 - y0
    band = cx[(cx[:, 1] > y0 + 0.14 * L) & (cx[:, 1] < y0 + 0.22 * L) & (np.abs(cx[:, 2] - za) < 4)]
    E = band[np.argmin(band[:, 0])]                        # medial surface of the lower pole
    xe = float(art[:, 0].min())                            # main stub's free end
    # lower polar arteries cross in front of the ureter on their way to the lower pole
    pts = [E + (3.0, 0, 0), E, E + (-8.0, -1.0, 4.0), np.array([xe + 6.0, E[1] + 1.5, za + 7.5]), np.array([xe, E[1] + 4.0, za + 7.0])]
    pts = [np.asarray(p, F) for p in pts]
    lo = np.min(pts, 0) - 6; hi = np.max(pts, 0) + 6
    g = K.Grid(lo, hi, h=0.3)
    P = g.P
    d = K.sd_tube(P, pts, [ACC_R] * len(pts))
    d, end, n = K.end_cut(P, d, pts)
    d = np.maximum(d, -K.sd_capped_cyl(P, end - n * 4.0, end + n * 2, 0.9))   # open lumen at the cut end
    tube = K.mesh_from(g, d, target=9000, min_vol=5)
    out['accessory_renal_artery'] = to_t(to_m(tube) - kidney_m)
    print('accessory artery: entry', np.round(E, 1), 'end x', round(xe, 1), 'vol', round(float(out['accessory_renal_artery'].volume) / 1000, 2), 'cm3')
    return out
