"""Place a sourced kidney model into TactileLab.

Input: a GLB with separate watertight meshes named renal_cortex, renal_medulla, renal_sinus,
renal_pelvis, renal_artery, renal_vein, ureter (any units/orientation; fixed here).
Output (same layout the app already reads):
  <out>/kidney_<stage>.glb, <out>/kidney_<stage>_coronal.glb   (cm, named meshes, vertex colours)
  <out>/print/kidney_<stage>_<full|coronal>/*.stl + print/manifest.json   (mm, print-oriented)
  <out>/.mesh_<stage>_<form>.pkl   (for previews / the web viewer)

Usage: python tools/place_model.py source.glb out_dir [stages] [forms]
"""
import os, sys, json, math, pickle
import numpy as np
import trimesh
from manifold3d import Manifold, Mesh as MMesh
import fast_simplification
sys.path.insert(0, os.path.dirname(__file__))
import kidney_sdf as K   # SDF primitives, colours, meshing, orientation helpers

SRC, OUT = sys.argv[1], sys.argv[2]
STAGES = sys.argv[3].split(',') if len(sys.argv) > 3 else ['normal', 't1a', 't1b', 't2a', 't3a']
FORMS = sys.argv[4].split(',') if len(sys.argv) > 4 else ['whole', 'coronal']
os.makedirs(OUT, exist_ok=True)
CLR = 0.25
INTERNAL = ['renal_cortex', 'renal_medulla', 'renal_sinus', 'renal_pelvis']

# ---------------------------------------------------------------- mesh <-> manifold
def to_m(tm):
    tm = tm.copy(); tm.merge_vertices()
    return Manifold(MMesh(vert_properties=np.asarray(tm.vertices, np.float32), tri_verts=np.asarray(tm.faces, np.uint32)))
def to_t(m):
    mm = m.to_mesh()
    # Manifold output is already manifold; trimesh 'process' would drop zero-area faces and open holes
    return trimesh.Trimesh(np.asarray(mm.vert_properties)[:, :3], np.asarray(mm.tri_verts), process=False)
def msimplify(t, cap):
    m = to_m(t)
    for tol in (0.03, 0.06, 0.1, 0.15, 0.22, 0.3):
        r = m.simplify(tol)
        if r.num_tri() <= cap: break
    return to_t(r)

def decimate(t, cap):
    if len(t.faces) <= cap: return t
    for c in (cap, int(cap * 1.4), int(cap * 2)):          # back off until the result stays watertight
        if c >= len(t.faces): break
        v, f = fast_simplification.simplify(t.vertices, t.faces, target_reduction=1 - c / len(t.faces))
        t2 = trimesh.Trimesh(v, f, process=False); t2.merge_vertices()
        if t2.is_watertight: return t2
    try:
        r = msimplify(t, cap)
        if r.is_watertight and len(r.faces) < len(t.faces): return r
    except Exception: pass
    return t
def halfspace(point, normal, size=400.0):
    """Manifold box filling the side of the plane the normal points AWAY from."""
    n = K.unit(normal); box = trimesh.creation.box(extents=[size, size, size])
    box.apply_translation([0, 0, -size / 2])                          # occupies z <= 0
    box.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], n))
    box.apply_translation(point)
    return to_m(box)

# ---------------------------------------------------------------- load + normalise
def load_parts():
    s = trimesh.load(SRC, force='scene'); parts = {}
    for node in s.graph.nodes_geometry:
        T, g = s.graph[node]; m = s.geometry[g].copy(); m.apply_transform(T)
        parts[node.replace('.', '_').split('_0')[0] if node not in s.geometry else node] = m
    parts = {k: v for k, v in parts.items()}
    ext = np.ptp(np.concatenate([p.vertices for p in parts.values()]), axis=0).max()
    scale = 1000.0 if ext < 1.0 else (10.0 if ext < 30 else 1.0)          # metres / cm / mm -> mm
    for p in parts.values(): p.apply_scale(scale)
    # lighten the source once; every later boolean and export gets faster and smaller
    caps = {'renal_cortex': 50000, 'renal_sinus': 24000, 'renal_medulla': 26000, 'renal_pelvis': 16000,
            'renal_artery': 9000, 'renal_vein': 7000, 'ureter': 4000}
    for k in list(parts): parts[k] = decimate(parts[k], caps.get(k, 10000))
    cx = parts['renal_cortex']
    long_axis = int(np.argmax(cx.extents))
    if long_axis != 1: raise SystemExit(f'expected long axis Y, got {"XYZ"[long_axis]}')
    # hilum side = where artery/vein sit relative to the kidney centre; app wants hilum toward -X
    centre = cx.bounds.mean(0)
    vessels = np.concatenate([parts[k].vertices for k in ('renal_artery', 'renal_vein') if k in parts])
    mirror = vessels[:, 0].mean() > centre[0]
    for p in parts.values():
        p.apply_translation(-centre)
        if mirror:
            p.apply_transform(np.diag([-1, 1, 1, 1])); p.invert()
        p.fix_normals()
    return parts

# ---------------------------------------------------------------- tumour
TUMORS = {
    't1a': dict(D=30.0, d=(0.62, 0.78, 0.0), e=1.00, root=False),
    't1b': dict(D=55.0, d=(0.58, 0.81, 0.0), e=0.92, root=False),
    't2a': dict(D=85.0, d=(0.33, 0.94, 0.0), e=0.80, root=False),
    't3a': dict(D=60.0, d=(-0.20, 0.98, 0.0), e=0.90, root=True),
}
TRUNC = 0.55

def surface_point(kmesh, origin, d):
    d = K.unit(d); loc, _, _ = kmesh.ray.intersects_location([origin + d * 300], [-d])
    return loc[np.argmax(loc @ d)]

def tumor_spec(stage, kmesh, z0):
    t = TUMORS[stage]; d = K.unit(t['d']).astype(np.float32); R = t['D'] / 2
    s = surface_point(kmesh, np.array([0.0, 0.0, z0]), d)
    c = (s + d * 1.0).astype(np.float32)
    rng = np.random.default_rng(abs(hash(stage)) % 2 ** 32); lobes = []
    while len(lobes) < 5:
        u = K.unit(rng.normal(size=3))
        if u @ d > 0.3: lobes.append((c + R * 0.60 * u.astype(np.float32), R * rng.uniform(0.38, 0.5)))
    trunc = TRUNC * R * t['e']; fc = (c - d * trunc).astype(np.float32)
    s_off = min(0.35 * R * math.sqrt(1 - TRUNC ** 2), 7.0)
    pegs = [fc + np.array([0, 0, s_off], np.float32), fc - np.array([0, 0, s_off], np.float32)]
    return dict(c=c, d=d, R=R, e=t['e'], lobes=lobes, trunc=trunc, fc=fc, pegs=pegs, root=t['root'])

def lobed(T, grow=0.0):
    """Lobed, slightly oblate tumour body as a manifold (grow = outward offset in mm)."""
    c, d, R, e = T['c'], T['d'], T['R'], T['e']
    lo, hi = c - R * 1.3 - 2, c + R * 1.3 + 2
    if T['root']: lo = np.minimum(lo, c - d * (T['trunc'] + 22) - 12); hi = np.maximum(hi, c - d * (T['trunc'] + 22) + 12)
    g = K.Grid(lo, hi, h=0.5); P = g.P
    p = P - c; along = p @ d
    q = p + d[None] * (along * (1 / e - 1))[:, None]
    f = (K.norm(q) - R) * e
    for lc, lr in T['lobes']: f = K.smin(f, K.sd_sphere(P, lc, lr), 0.18 * R)
    if T['root']: f = np.minimum(f, K.sd_round_cone(P, c - d * 0.4 * R, c - d * (T['trunc'] + 16.0), 0.3 * R, 3.5))
    m = K.mesh_from(g, f - grow, target=40000)
    return to_m(m)

def build_tumor(T, kidney_m):
    """Tumour piece and the cavity it needs in the kidney (with print clearance)."""
    S, Sc = lobed(T), lobed(T, grow=CLR)
    above = halfspace(T['fc'], T['d'])          # keeps the side beyond the truncation plane (points along -d removed)
    above = halfspace(T['fc'], -T['d'])         # box on the +d side of the base plane
    inside_base = halfspace(T['fc'] - T['d'] * CLR, -T['d'])
    root = Manifold()
    if T['root']:
        g = K.Grid(T['c'] - T['d'] * (T['trunc'] + 22) - 12, T['c'] + 12, h=0.5)
        rf = K.sd_round_cone(g.P, T['c'] - T['d'] * 0.4 * T['R'], T['c'] - T['d'] * (T['trunc'] + 16.0), 0.3 * T['R'], 3.5)
        root = to_m(K.mesh_from(g, rf, target=8000)); rootc = to_m(K.mesh_from(g, rf - CLR, target=8000))
    # flat base only inside the kidney; outside it the mass curves naturally into the surface
    tumor = (S ^ above) + (S - kidney_m) + root
    cavity = (Sc ^ inside_base) + (rootc if T['root'] else Manifold())
    return tumor, cavity

def peg_parts(T):
    pegs, holes = Manifold(), Manifold()
    for pg in T['pegs']:
        a = pg - T['d'] * 1.5; pegs += to_m(trimesh.creation.cylinder(radius=2.4, segment=[a, pg + T['d'] * 3.8], sections=40))
        holes += to_m(trimesh.creation.cylinder(radius=2.6, segment=[pg - T['d'] * 1.0, pg + T['d'] * 4.4], sections=40))
    return pegs, holes

# ---------------------------------------------------------------- vein lumen + thrombus (T3a)
def vein_axis(vein, centre):
    v = vein.vertices; c = v.mean(0)
    u = np.linalg.svd(v - c, full_matrices=False)[2][0]
    if (c - centre) @ u < 0: u = -u                       # point away from the kidney
    end = c + u * ((v - c) @ u).max()
    r = np.percentile(np.linalg.norm((v - c) - np.outer((v - c) @ u, u), axis=1), 50)
    return end, u, r

def thrombus(vein, centre):
    end, u, r = vein_axis(vein, centre)
    lumen = to_m(trimesh.creation.cylinder(radius=r * 0.72, segment=[end - u * 16, end + u * 2], sections=40))
    g = K.Grid(end - u * 16 - r * 2, end + u * 8 + r * 2)
    lo = np.minimum(end - u * 16, end + u * 7) - r * 2; hi = np.maximum(end - u * 16, end + u * 7) + r * 2
    g = K.Grid(lo, hi, h=0.4)
    f = K.sd_round_cone(g.P, (end - u * 15).astype(np.float32), (end + u * 6).astype(np.float32), r * 0.66, r * 0.55)
    f = f + 0.3 * (K.vnoise(g.P, 0.35) - 0.5)
    f = np.maximum(f, -K.plane(g.P, end - u * 15, u))
    th = to_m(K.mesh_from(g, f, target=5000))
    return lumen, th

# ---------------------------------------------------------------- colours
def medulla_pyramids(med, sinus_centre):
    """Per-pyramid apex and axis from the mesh components, for striation colouring."""
    pyrs = []
    for comp in med.split(only_watertight=False):
        v = comp.vertices; c = v.mean(0)
        u = np.linalg.svd(v - c, full_matrices=False)[2][0]
        if (c - sinus_centre) @ u < 0: u = -u
        proj = (v - c) @ u
        pyrs.append(dict(apex=(c + u * proj.min()).astype(np.float32), base=(c + u * proj.max()).astype(np.float32), u=u.astype(np.float32)))
    return pyrs

def colour_ctx(parts, z0):
    sc = parts['renal_sinus'].bounds.mean(0)
    pyrs = medulla_pyramids(parts['renal_medulla'], sc)
    return {'pyrs': pyrs}

# ---------------------------------------------------------------- build
def build(stage, form, parts, kidney_m, kmesh, z0, centre):
    """Returns (display meshes, print meshes, print specs)."""
    T = tumor_spec(stage, kmesh, z0) if stage in TUMORS else None
    tumor = cavity = None
    if T: tumor, cavity = build_tumor(T, kidney_m)
    show, prn, specs = {}, {}, {}
    if form == 'whole':
        body = kidney_m
        if T:
            pegs, holes = peg_parts(T)
            body = (body - cavity) + pegs
            tumor = tumor - holes
        vein = to_m(parts['renal_vein'])
        if stage == 't3a':
            lumen, th = thrombus(parts['renal_vein'], centre)
            vein = vein - lumen
            show['vein_thrombus'] = prn['vein_thrombus'] = to_t(th); specs['vein_thrombus'] = ('as_is', None, False)
        show['kidney_body'] = to_t(body)
        show['renal_artery'] = parts['renal_artery']; show['renal_vein'] = to_t(vein); show['ureter'] = parts['ureter']
        # print: vessels branch inside the sinus, so they print fused to the kidney; the tumour lifts out
        fused = body + to_m(parts['renal_artery']) + vein + to_m(parts['ureter'])
        if T: fused = (fused - cavity) + pegs
        prn['kidney_body'] = to_t(fused)
        specs['kidney_body'] = ('as_is', None, True)
        if T:
            tt = to_t(tumor); show['tumor'] = prn['tumor'] = tt
            along = (np.asarray(tt.vertices) - T['c']) @ T['d']
            specs['tumor'] = ('axis_down', -T['d'], bool(along.min() < -(T['trunc'] + 1.0)))
            for v in ('renal_artery', 'renal_vein'):
                hit = to_t(tumor ^ to_m(parts[v]))
                if len(hit.faces) and hit.volume > 1: print(f'   ! tumour intersects {v} ({hit.volume:.0f} mm3)')
    else:
        keep = halfspace(np.array([0, 0, z0]), [0, 0, 1])       # posterior half: z <= z0
        for name in INTERNAL + ['renal_artery', 'renal_vein', 'ureter']:
            m = to_m(parts[name])
            if cavity is not None and name in INTERNAL: m = m - cavity
            h = to_t(m ^ keep)
            if len(h.faces) and h.volume > 20:
                show[name] = prn[name] = h
                specs[name] = ('as_is', None, True) if name == 'renal_cortex' else ('cut_down', None, False)
        if T:
            show['tumor'] = prn['tumor'] = to_t(tumor ^ keep); specs['tumor'] = ('cut_down', None, False)
    return show, prn, specs

def densify(t, max_edge):
    v, f = trimesh.remesh.subdivide_to_size(t.vertices, t.faces, max_edge=max_edge)[:2]
    t2 = trimesh.Trimesh(v, f, process=True)
    return t2 if t2.is_watertight else t

DENSIFY = {'tumor': 1.5, 'renal_medulla': 1.0}

if __name__ == '__main__':
    parts = load_parts()
    for k, v in parts.items(): print(f'{k:14s} {len(v.faces):7d}f  watertight={v.is_watertight}  extents={np.round(v.extents, 1)}')
    z0 = 0.0
    kidney_m = to_m(parts['renal_cortex']) + to_m(parts['renal_medulla']) + to_m(parts['renal_sinus']) + to_m(parts['renal_pelvis'])
    kmesh = to_t(kidney_m); centre = kmesh.bounds.mean(0)
    print('kidney union', len(kmesh.faces), 'faces, watertight', kmesh.is_watertight, 'extents', np.round(kmesh.extents, 1))
    ctx = colour_ctx(parts, z0)
    manifest_path = os.path.join(OUT, 'print', 'manifest.json'); os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    for stage in STAGES:
        for form in FORMS:
            show, meshes, specs = build(stage, form, parts, kidney_m, kmesh, z0, centre)
            K.Z0 = z0 if form == 'coronal' else 1e6
            key = f'{stage}_{"full" if form == "whole" else "coronal"}'
            # print files first (lighter meshes), then densify colour-carrying parts for the app
            pdir = os.path.join(OUT, 'print', f'kidney_{key}'); os.makedirs(pdir, exist_ok=True)
            entries = []
            for i, (name, m) in enumerate(meshes.items(), 1):
                kind, axis, sup = specs[name]
                pm = decimate(m, {'kidney_body': 40000, 'renal_cortex': 40000, 'tumor': 24000}.get(name, 12000))
                om = pm.copy()
                if kind != 'as_is': om = K.orient(pm, kind, axis)
                else: om.apply_translation([-om.bounds[:, 0].mean(), -om.bounds[:, 1].mean(), -om.bounds[0, 2]])
                fn = f'{i:02d}_{name}.stl'; om.export(os.path.join(pdir, fn))
                entries.append(dict(part=name, file=f'kidney_{key}/{fn}', supports=sup, watertight=bool(pm.is_watertight),
                                    faces=int(len(pm.faces)), volume_cm3=round(float(pm.volume) / 1000, 2)))
            manifest[key] = entries
            app = {n: (densify(decimate(m, 30000), DENSIFY[n]) if n in DENSIFY else decimate(m, {'kidney_body': 60000, 'renal_cortex': 50000}.get(n, 20000))) for n, m in show.items()}
            K.to_glb(app, os.path.join(OUT, f'kidney_{stage}{"" if form == "whole" else "_coronal"}.glb'), ctx)
            pk = {n: (m.vertices, m.faces, K.vertex_colour(n, np.asarray(m.vertices, np.float32), ctx)) for n, m in app.items()}
            pickle.dump(pk, open(os.path.join(OUT, f'.mesh_{key}.pkl'), 'wb'))
            json.dump(manifest, open(manifest_path, 'w'), indent=1)
            print(key, ' | '.join(f"{e['part']} {e['faces']}f {e['volume_cm3']}cm3{'' if e['watertight'] else ' OPEN'}{' sup' if e['supports'] else ''}" for e in entries))
