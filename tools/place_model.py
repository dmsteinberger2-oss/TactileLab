"""Place a sourced kidney model into TactileLab.

Input: a GLB with separate watertight meshes named renal_cortex, renal_medulla, renal_sinus,
renal_pelvis, renal_artery, renal_vein, ureter (any units/orientation; fixed here).
Output (same layout the app already reads):
  <out>/kidney_<stage>.glb, <out>/kidney_<stage>_coronal.glb   (cm, named meshes, vertex colours)
  <out>/print/kidney_<stage>_<full|coronal>/*.stl + print/manifest.json   (mm, print-oriented)
  <out>/.mesh_<stage>_<form>.pkl   (for previews / the web viewer)

Usage: python tools/place_model.py source.glb out_dir [stages] [forms]
"""
import os, sys, json, math, pickle, zlib
import numpy as np
import trimesh
from manifold3d import Manifold, Mesh as MMesh
import fast_simplification
sys.path.insert(0, os.path.dirname(__file__))
import kidney_sdf as K   # SDF primitives, colours, meshing, orientation helpers
import beauty as B       # painted section, adrenal, textured GLB

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

# Print parts that are legitimately several separate bodies; everything else must be one solid.
MULTI_BODY = {'renal_medulla', 'renal_sinus', 'renal_pelvis'}
ZERO_MM3 = 1.0          # shells below this are degenerate leftovers of booleans/decimation
MIN_BODY_MM3 = 50.0     # 0.05 cm3: smallest separate body kept in a multi-body part

def clean_for_print(name, t):
    """Drop zero-volume shells; keep the largest body (single-body parts) or every body of at
    least MIN_BODY_MM3 (multi-body parts). Returns (mesh, [(volume_cm3, centroid_mm), ...] dropped)."""
    comps = t.split(only_watertight=False)
    if len(comps) <= 1: return t, []
    vols = [abs(float(c.volume)) for c in comps]
    keep = [i for i, v in enumerate(vols) if v >= ZERO_MM3]
    if name in MULTI_BODY: keep = [i for i in keep if vols[i] >= MIN_BODY_MM3]
    else: keep = [max(range(len(comps)), key=lambda i: vols[i])]
    dropped = [(round(vols[i] / 1000, 3), np.round(comps[i].centroid, 1).tolist()) for i in range(len(comps)) if i not in keep]
    return trimesh.util.concatenate([comps[i] for i in keep]), dropped

CONTACT_EPS_MM = 0.005   # 5 um: far below print resolution

def separate_contacts(t, eps=CONTACT_EPS_MM):
    """Manifold booleans leave surfaces that touch themselves as distinct vertices at identical
    positions: fine in memory, but an STL merges them by position into non-manifold edges.
    Pull each such vertex eps inward along its own normal so the touching sheets separate.
    Returns (mesh, number of vertices moved)."""
    v = np.asarray(t.vertices, np.float32)
    _, inv, counts = np.unique(v, axis=0, return_inverse=True, return_counts=True)
    dup = counts[inv.reshape(-1)] > 1
    if not dup.any(): return t, 0
    t = t.copy()
    t.vertices[dup] = t.vertices[dup] - t.vertex_normals[dup] * eps
    return t, int(dup.sum())

def check_stl(path):
    """Reload a written STL the way a slicer sees it (float32, vertices merged by position)."""
    m = trimesh.load(path, force='mesh')
    _, counts = np.unique(m.edges_sorted, axis=0, return_counts=True)
    nm, open_ = int((counts > 2).sum()), int((counts == 1).sum())
    return dict(watertight=bool(m.is_watertight) and nm == 0 and open_ == 0, non_manifold_edges=nm, open_edges=open_, bodies=int(m.body_count))

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
    rng = np.random.default_rng(zlib.crc32(stage.encode())); lobes = []
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
def build(stage, form, parts, kidney_m, kmesh, z0, centre, adr0=None, adr_n=None):
    """Returns (display meshes, print meshes, print specs, section polygons)."""
    T = tumor_spec(stage, kmesh, z0) if stage in TUMORS else None
    tumor = cavity = None
    if T: tumor, cavity = build_tumor(T, kidney_m)
    show, prn, specs, polys = {}, {}, {}, {}
    adr = None
    if adr0 is not None:
        adr = adr0
        if T:   # the adrenal stays in place, indented where the mass presses against it
            adr = adr0 - lobed(T, grow=0.8)
            if T['root']: adr = adr - tumor
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
        if adr is not None:
            show['adrenal_gland'] = prn['adrenal_gland'] = to_t(adr); specs['adrenal_gland'] = ('as_is', None, True)
        show['renal_artery'] = parts['renal_artery']; show['renal_vein'] = to_t(vein); show['ureter'] = parts['ureter']
        # print: vessels branch inside the sinus, so they print fused to the kidney; the tumour lifts out.
        # The ureter only meets the pelvis along an edge (fusing it made a second, non-manifold body),
        # so it prints as its own part, lying flat.
        fused = body + to_m(parts['renal_artery']) + vein
        if T: fused = (fused - cavity) + pegs
        prn['kidney_body'] = to_t(fused)
        specs['kidney_body'] = ('as_is', None, True)
        prn['ureter'] = parts['ureter']
        specs['ureter'] = ('flat_down', None, False)
        if T:
            tt = to_t(tumor); show['tumor'] = prn['tumor'] = tt
            along = (np.asarray(tt.vertices) - T['c']) @ T['d']
            specs['tumor'] = ('axis_down', -T['d'], bool(along.min() < -(T['trunc'] + 1.0)))
            for v in ('renal_artery', 'renal_vein'):
                hit = to_t(tumor ^ to_m(parts[v]))
                if len(hit.faces) and hit.volume > 1: print(f'   ! tumour intersects {v} ({hit.volume:.0f} mm3)')
    else:
        keep = halfspace(np.array([0, 0, z0]), [0, 0, 1])       # posterior half: z <= z0
        full = {n: to_m(parts[n]) for n in INTERNAL + ['renal_artery', 'renal_vein', 'ureter']}
        if adr is not None: full['adrenal_gland'] = adr
        for name in list(full):
            m = full[name]
            if cavity is not None and name in INTERNAL: m = m - cavity
            polys[name] = B.section_polys(to_t(m), z0)
            h = to_t(m ^ keep)
            if len(h.faces) and h.volume > 20:
                show[name] = prn[name] = h
                specs[name] = ('as_is', None, True) if name == 'renal_cortex' else ('cut_down', None, False)
        if T:
            show['tumor'] = prn['tumor'] = to_t(tumor ^ keep); specs['tumor'] = ('cut_down', None, False)
            polys['tumor'] = B.section_polys(to_t(tumor), z0)
    return show, prn, specs, polys

def densify(t, max_edge):
    v, f = trimesh.remesh.subdivide_to_size(t.vertices, t.faces, max_edge=max_edge)[:2]
    t2 = trimesh.Trimesh(v, f, process=True)
    return t2 if t2.is_watertight else t

DENSIFY = {'tumor': 1.5}

if __name__ == '__main__':
    parts = load_parts()
    for k, v in parts.items(): print(f'{k:14s} {len(v.faces):7d}f  watertight={v.is_watertight}  extents={np.round(v.extents, 1)}')
    z0 = 0.0
    kidney_m = to_m(parts['renal_cortex']) + to_m(parts['renal_medulla']) + to_m(parts['renal_sinus']) + to_m(parts['renal_pelvis'])
    kmesh = to_t(kidney_m); centre = kmesh.bounds.mean(0)
    print('kidney union', len(kmesh.faces), 'faces, watertight', kmesh.is_watertight, 'extents', np.round(kmesh.extents, 1))
    ctx = colour_ctx(parts, z0)
    adr0, adr_s, adr_n = B.adrenal(kmesh, z0, to_m, to_t, K.Grid, K.mesh_from, K.sd_ellipsoid, K.smin)
    adr0 = adr0 - kidney_m
    print('adrenal', round(adr0.volume() / 1000, 2), 'cm3')
    manifest_path = os.path.join(OUT, 'print', 'manifest.json'); os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    for stage in STAGES:
        for form in FORMS:
            show, meshes, specs, polys = build(stage, form, parts, kidney_m, kmesh, z0, centre, adr0, adr_n)
            K.Z0 = z0 if form == 'coronal' else 1e6
            key = f'{stage}_{"full" if form == "whole" else "coronal"}'
            # print files first (lighter meshes), then densify colour-carrying parts for the app
            pdir = os.path.join(OUT, 'print', f'kidney_{key}'); os.makedirs(pdir, exist_ok=True)
            entries, failures = [], []
            for i, (name, m) in enumerate(meshes.items(), 1):
                kind, axis, sup = specs[name]
                pm = decimate(m, {'kidney_body': 40000, 'renal_cortex': 40000, 'tumor': 24000}.get(name, 12000))
                pm, dropped = clean_for_print(name, pm)
                big = [d for d in dropped if d[0] >= 0.01]
                if dropped: print(f'   {key}/{name}: dropped {len(dropped)} stray bodies' + (f', incl. {big} (cm3, centroid mm)' if big else ' (all < 0.01 cm3)'))
                pm, moved = separate_contacts(pm)
                if moved: print(f'   {key}/{name}: separated {moved} self-touching vertices by {CONTACT_EPS_MM * 1000:.0f} um')
                om = pm.copy()
                if kind != 'as_is': om = K.orient(pm, kind, axis)
                else: om.apply_translation([-om.bounds[:, 0].mean(), -om.bounds[:, 1].mean(), -om.bounds[0, 2]])
                fn = f'{i:02d}_{name}.stl'; om.export(os.path.join(pdir, fn))
                chk = check_stl(os.path.join(pdir, fn))     # what was written, not the in-memory mesh
                if not chk['watertight']: failures.append(f"{key}/{fn}: {chk}")
                entries.append(dict(part=name, file=f'kidney_{key}/{fn}', supports=sup, watertight=chk['watertight'],
                                    non_manifold_edges=chk['non_manifold_edges'], open_edges=chk['open_edges'], bodies=chk['bodies'],
                                    faces=int(len(pm.faces)), volume_cm3=round(float(pm.volume) / 1000, 2)))
            manifest[key] = entries
            if failures:
                json.dump(manifest, open(manifest_path, 'w'), indent=1)
                sys.exit('Print check failed (STL not watertight or has non-manifold edges):\n  ' + '\n  '.join(failures))
            app = {n: (densify(decimate(m, 30000), DENSIFY[n]) if n in DENSIFY else decimate(m, {'kidney_body': 60000, 'renal_cortex': 50000}.get(n, 20000))) for n, m in show.items()}
            colour_fn = lambda n, V: K.vertex_colour(n, V, ctx)
            glb_path = os.path.join(OUT, f'kidney_{stage}{"" if form == "whole" else "_coronal"}.glb')
            if form == 'coronal':
                tex, tb = B.paint_section(polys)
                tex.save(os.path.join(OUT, f'section_{stage}.jpg'), quality=90)
                B.write_glb(glb_path, B.export_parts(app, colour_fn, z0, tb, tex), tex)
            else:
                B.write_glb(glb_path, B.export_parts(app, colour_fn))
            pk = {n: (m.vertices, m.faces, K.vertex_colour(n, np.asarray(m.vertices, np.float32), ctx)) for n, m in app.items()}
            pickle.dump(pk, open(os.path.join(OUT, f'.mesh_{key}.pkl'), 'wb'))
            json.dump(manifest, open(manifest_path, 'w'), indent=1)
            print(key, ' | '.join(f"{e['part']} {e['faces']}f {e['volume_cm3']}cm3{'' if e['watertight'] else ' OPEN'}{' sup' if e['supports'] else ''}" for e in entries))
