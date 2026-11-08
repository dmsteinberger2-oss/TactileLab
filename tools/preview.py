"""Software preview of generated variants (no GPU). python tools/preview.py generated t1b_full [view...]"""
import sys, os, pickle, numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from PIL import Image

COL = {'kidney_body': '#8a3b32', 'renal_cortex': '#b0614f', 'renal_medulla': '#64271f', 'renal_sinus': '#efd57e',
       'renal_pelvis': '#ece7da', 'ureter': '#ece7da', 'renal_artery': '#c0392b', 'renal_vein': '#2e5c9e',
       'tumor': '#dda033', 'vein_thrombus': '#cf9233', 'ivc': '#2e5c9e', 'ivc_thrombus': '#cf9233', 'cyst': '#cdd7d5', 'aml': '#e2c05a', 'adrenal_gland': '#d9a441'}
VIEWS = {'back': (-0.12, 0.08, -1.0), 'front': (0.12, 0.08, 1.0), 'three': (0.55, 0.35, 0.75), 'medial': (-0.9, 0.15, 0.45), 'cut': (0.0, 0.0, 1.0), 'tilt': (0.25, -0.35, 0.9)}
def hex2rgb(h): return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])

def render(meshes, path, view, size=900, title=None):
    eye = np.asarray(view, float); eye /= np.linalg.norm(eye)
    up = np.array([0, 1, 0.0]); right = np.cross(up, eye); right /= np.linalg.norm(right); up = np.cross(eye, right)
    L1 = np.array([0.35, 0.75, 0.55]); L1 /= np.linalg.norm(L1); Hh = (L1 + eye) / np.linalg.norm(L1 + eye)
    polys, depth, cols = [], [], []
    for name, (v, f, vc) in meshes.items():
        tri = v[f]; n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        keep = (n @ eye) > 0.0
        tri, n = tri[keep], n[keep]; fcol = vc[f][keep].mean(axis=1) if vc is not None else np.ones((len(tri), 3))
        c = hex2rgb(COL.get(name, '#999999'))[None] * fcol * (0.30 + 0.70 * np.clip(n @ L1, 0, 1))[:, None] + 0.22 * np.clip(n @ Hh, 0, 1)[:, None] ** 30
        polys.append(np.stack([tri @ right, tri @ up], axis=-1)); depth.append(tri.mean(axis=1) @ eye); cols.append(np.clip(c, 0, 1))
    P = np.concatenate(polys); D = np.concatenate(depth); C = np.concatenate(cols); o = np.argsort(D)
    fig = plt.figure(figsize=(6, 6), dpi=size / 6); ax = fig.add_subplot(111); ax.set_aspect('equal'); ax.axis('off')
    ax.add_collection(PolyCollection(P[o], facecolors=C[o], edgecolors=C[o], linewidths=0.2))
    pts = P.reshape(-1, 2); c = (pts.min(0) + pts.max(0)) / 2; r = (pts.max(0) - pts.min(0)).max() / 2 * 1.06
    ax.set_xlim(c[0] - r, c[0] + r); ax.set_ylim(c[1] - r, c[1] + r); fig.patch.set_facecolor('#eef1f3')
    if title: ax.set_title(title, fontsize=9, color='#333')
    fig.savefig(path, bbox_inches='tight', pad_inches=0.04); plt.close(fig)

def sheet(paths, out, cols=2):
    ims = [Image.open(p) for p in paths]; w = max(i.width for i in ims); h = max(i.height for i in ims)
    rows = (len(ims) + cols - 1) // cols; s = Image.new('RGB', (w * cols, h * rows), '#eef1f3')
    for k, i in enumerate(ims): s.paste(i, ((k % cols) * w, (k // cols) * h))
    s.save(out)

if __name__ == '__main__':
    out = sys.argv[1]; jobs = sys.argv[2:]
    paths = []
    for job in jobs:
        key, view = job.split(':')
        meshes = pickle.load(open(os.path.join(out, f'.mesh_{key}.pkl'), 'rb'))
        p = os.path.join(out, f'preview_{key}_{view}.png'); render(meshes, p, VIEWS[view], title=f'{key} ({view})'); paths.append(p)
    sheet(paths, os.path.join(out, 'sheet.png'))
    print('sheet ok')
