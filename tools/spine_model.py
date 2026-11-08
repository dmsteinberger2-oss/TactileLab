"""TactileLab spine lab: L4-L5 left paracentral disc extrusion, microdiscectomy, and TLIF fusion.

Input: GLB with l4_vertebra, l5_vertebra, annulus_fibrosus, nucleus_pulposus, disc_herniation, thecal_sac,
l4/l5_nerve_root_left/right (any units). Source frame: +Y up, +Z anterior, +X patient left.
Output: <out>/spine_<stage>.glb, print STLs under <out>/print/spine_<stage>_full/, manifest entries, previews.
Screws are placed from the vertebra's own pedicles (found from axial sections), not hand-positioned.
Usage: python tools/spine_model.py source.glb out_dir [stages]
"""
import os, sys, json, math, pickle
import numpy as np
import trimesh
import shapely.geometry as sg, shapely.ops as so
sys.path.insert(0, os.path.dirname(__file__))
import kidney_sdf as K
import beauty as B
from place_model import to_m, to_t, decimate, separate_contacts, check_stl, ZERO_MM3, CONTACT_EPS_MM

SRC, OUT = sys.argv[1], sys.argv[2]
STAGES = sys.argv[3].split(',') if len(sys.argv) > 3 else ['preop', 'discectomy', 'tlif']
os.makedirs(OUT, exist_ok=True)
CLR = 0.25

COLOURS = {'l4_vertebra': '#e6d9bf', 'l5_vertebra': '#e2d4b8', 'annulus_fibrosus': '#cfd8dc', 'nucleus_pulposus': '#9fb8c8',
           'disc_herniation': '#7f9fbc', 'thecal_sac': '#e9d27a', 'nerve_roots': '#f0d060', 'l5_nerve_root_left': '#f5c040',
           'l4_nerve_root_left': '#f5c040', 'l4_posterior_arch': '#e6d9bf', 'bone_cement': '#f4f4f0', 'ligamentum_flavum': '#e8c8a0', 'pedicle_screws': '#b8bec6', 'rods': '#c5cbd2', 'interbody_cage': '#cdbfa4', 'bone_graft': '#e8d7b0'}
B.DEFAULTS.update(COLOURS)

def load():
    s = trimesh.load(SRC, force='scene'); P = {}
    for node in s.graph.nodes_geometry:
        T, g = s.graph[node]; m = s.geometry[g].copy(); m.apply_transform(T); P[node] = m
    ext = np.ptp(np.concatenate([p.vertices for p in P.values()]), axis=0).max()
    sc = 1000.0 if ext < 1 else (10.0 if ext < 30 else 1.0)
    for p in P.values(): p.apply_scale(sc)
    c = P['annulus_fibrosus'].bounds.mean(0)
    for p in P.values(): p.apply_translation(-c)
    # tidy the thecal sac ends (stray engraving on the caps)
    ts = P['thecal_sac']; lo, hi = ts.bounds[:, 1]
    slab = trimesh.creation.box(extents=[200, (hi - lo) - 2.0, 200]); slab.apply_translation([0, (hi + lo) / 2, 0])
    P['thecal_sac'] = to_t(to_m(ts) ^ to_m(slab))
    return P

# ---------------------------------------------------------------- pedicles from axial sections
def pedicle_axes(vert):
    """For each side, find the pedicle centre from axial sections where the canal ring is closed."""
    ys = np.linspace(vert.bounds[0, 1] + 3, vert.bounds[1, 1] - 3, 60)
    closed = []
    for y in ys:
        sec = vert.section(plane_origin=[0, y, 0], plane_normal=[0, 1, 0])
        if sec is None: continue
        pl, _ = sec.to_planar(to_2D=np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, -y], [0, 0, 0, 1.0]]))
        polys = [p for p in pl.polygons_full if p.area > 20]
        holes = [h for p in polys for h in p.interiors if sg.Polygon(h).area > 60]
        if holes: closed.append((y, polys, max(holes, key=lambda h: sg.Polygon(h).area)))
    if not closed: raise SystemExit('no closed canal ring found')
    y_mid = float(np.median([c[0] for c in closed]))
    y, polys, hole = min(closed, key=lambda c: abs(c[0] - y_mid))
    canal = sg.Polygon(hole); cx, cz = canal.centroid.x, canal.centroid.y
    bone = so.unary_union(polys)
    out = {}
    for side, sgn in (('left', 1), ('right', -1)):
        line = sg.LineString([(cx, cz), (cx + sgn * 60, cz)])
        segs = line.intersection(bone)
        segs = [g for g in (segs.geoms if hasattr(segs, 'geoms') else [segs]) if g.length > 2]
        if not segs: raise SystemExit(f'no pedicle on {side}')
        seg = min(segs, key=lambda g: abs(np.array(g.coords).mean(0)[0] - cx))
        xs = np.sort(np.array(seg.coords)[:, 0])
        wall = xs[0] if sgn > 0 else xs[1]
        width = min(float(xs[1] - xs[0]), 13.0)
        out[side] = np.array([wall + sgn * width / 2, y, cz]), width
    return out, (cx, cz), y

def ray_exit(mesh, origin, d, last=True):
    loc, _, _ = mesh.ray.intersects_location([origin], [d])
    if not len(loc): return None
    t = (loc - origin) @ d; loc = loc[t > 0]; t = t[t > 0]
    return loc[np.argmax(t)] if last else loc[np.argmin(t)]

def screw_plan(vert, sgn, centre, converge_deg=12):
    converge_deg = converge_deg
    d = np.array([-sgn * math.sin(math.radians(converge_deg)), 0, math.cos(math.radians(converge_deg))])
    entry = ray_exit(vert, centre, -d)                 # posterior cortex
    front = ray_exit(vert, centre, d)                  # anterior cortex of the body
    tip = front - d * 5.0
    return entry, tip, d

# ---------------------------------------------------------------- implants (SDF)
def threaded_screw(entry, tip, d, core=2.6, major=3.25, pitch=2.75):
    """Pedicle screw: threaded shank, tapered tip, polyaxial tulip head with saddle slot and set screw."""
    head_top = entry - d * 14.0
    lo = np.minimum(head_top, tip) - 8; hi = np.maximum(head_top, tip) + 8
    g = K.Grid(lo, hi, h=0.18); P = g.P
    rel = P - entry; t = rel @ d
    radial = rel - np.outer(t, d); r = np.linalg.norm(radial, axis=1)
    e1 = np.cross(d, [0, 1, 0]); e1 /= np.linalg.norm(e1); e2 = np.cross(d, e1)
    th = np.arctan2(radial @ e2, radial @ e1)
    L = float(np.linalg.norm(tip - entry))
    frac = (t / pitch - th / (2 * math.pi)) % 1.0
    tooth = np.clip(1 - np.abs(frac - 0.5) * 2.6, 0, 1)
    taper = np.clip((L - t) / 8.0, 0, 1)                                 # thread runs out into the tip
    r_eff = core + (major - core) * tooth * taper
    shank = np.maximum(r - (r_eff * np.where(t > L - 4, np.clip((L - t) / 4, 0.35, 1), 1)), np.maximum(-t - 1.5, t - L))
    # tulip: cylinder above the entry, with a U-shaped rod saddle and a set screw
    tl = -t                                                                # distance behind the entry
    tulip = np.maximum(r - 5.6, np.maximum(1.0 - tl, tl - 14.0))
    up = np.array([0, 1.0, 0]) - d * d[1]; up /= np.linalg.norm(up); lat = np.cross(d, up)
    slot = np.maximum(np.abs(radial @ lat) - 2.9, np.maximum(6.0 - tl, tl - 15.0))
    tulip = np.maximum(tulip, -slot)
    ball = np.linalg.norm(P - (entry - d * 2.5), axis=1) - 3.8
    set_screw = np.maximum(r - 3.6, np.maximum(11.5 - tl, tl - 14.0))
    f = np.minimum(np.minimum(shank, tulip), np.minimum(ball, set_screw))
    return K.mesh_from(g, f.astype(np.float32), target=60000, smooth=False), head_top, entry - d * 9.0

def rod(points, r=2.75):
    pts = np.array(points, float)
    lo, hi = pts.min(0) - 6, pts.max(0) + 6
    g = K.Grid(lo, hi, h=0.25)
    f = K.sd_tube(g.P, [p.astype(np.float32) for p in pts], [r] * len(pts))
    return K.mesh_from(g, f, target=20000)

def cage(annulus, disc_h, centre_z):
    """Curved (banana) TLIF cage in the anterior disc space: serrated faces, graft window, rounded nose."""
    R0, width, length = 22.0, 10.0, 30.0
    g = K.Grid((-26, -disc_h / 2 - 2, centre_z - 30), (26, disc_h / 2 + 2, centre_z + 10), h=0.25); P = g.P
    c = np.array([0.0, 0.0, centre_z - R0])                               # arc centre posterior to the cage
    rel = P - c; rad = np.hypot(rel[:, 0], rel[:, 2]); ang = np.arctan2(rel[:, 0], rel[:, 2])
    half = (length / 2) / R0
    teeth = 0.55 * np.clip(1 - np.abs(((ang * R0) / 1.6) % 1.0 - 0.5) * 2.4, 0, 1)
    hh = disc_h / 2 - 0.6 + teeth * (np.abs(P[:, 1]) > 0)
    body = np.maximum(np.maximum(np.abs(rad - R0) - width / 2, np.abs(P[:, 1]) - hh), (np.abs(ang) - half) * R0)
    window = np.maximum(np.maximum(np.abs(rad - R0) - width / 2 + 2.6, (np.abs(ang) - half * 0.6) * R0), -100)
    f = np.maximum(body, -window)
    graft = np.maximum(np.maximum(np.abs(rad - R0) - width / 2 + 2.9, np.abs(P[:, 1]) - disc_h / 2 + 1.0), (np.abs(ang) - half * 0.55) * R0)
    graft = graft + 0.25 * (K.vnoise(P, 1.2) - 0.5)
    # envelope: the cage with its graft window filled, i.e. all disc space the implant occupies
    return (K.mesh_from(g, f.astype(np.float32), target=40000), K.mesh_from(g, graft.astype(np.float32), target=12000),
            K.mesh_from(g, body.astype(np.float32), target=20000))

# ---------------------------------------------------------------- stages
def build(stage, P):
    show = {}
    l4, l5 = to_m(P['l4_vertebra']), to_m(P['l5_vertebra'])
    ann, nuc = to_m(P['annulus_fibrosus']), to_m(P['nucleus_pulposus'])
    roots = to_m(P['l4_nerve_root_left']) + to_m(P['l4_nerve_root_right']) + to_m(P['l5_nerve_root_right'])
    l5l = P['l5_nerve_root_left']
    hern = P['disc_herniation']; hc = hern.bounds.mean(0)
    if stage == 'preop':
        show['disc_herniation'] = hern; show['nucleus_pulposus'] = to_t(nuc)
    elif stage == 'discectomy':
        # left hemilaminotomy window over the fragment, small annulotomy, fragment removed
        back = ray_exit(P['l4_vertebra'], np.array([hc[0], hc[1] + 3.5, 60.0]), np.array([0, 0, -1.0]), last=False)
        win = trimesh.creation.cylinder(radius=6.5, segment=[[hc[0], hc[1] + 3.0, -70], [hc[0], hc[1] + 3.0, hc[2] - 1.0]], sections=48)
        l4 = l4 - to_m(win); l5 = l5 - to_m(win)
        ann = ann - to_m(trimesh.creation.cylinder(radius=2.6, segment=[[hc[0], hc[1], hc[2] - 4], [hc[0] * 0.6, hc[1], 8]], sections=32))
        show['nucleus_pulposus'] = to_t(nuc)
    elif stage == 'tlif':
        # left facetectomy, discectomy, cage + graft, bilateral pedicle screws and rods
        sec = P['l4_vertebra'].section(plane_origin=[0, -2.0, 0], plane_normal=[0, 1, 0])
        facet_c = np.array([14.0, 0.0, -30.0])
        if sec is not None:
            pl, _ = sec.to_planar(to_2D=np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 2.0], [0, 0, 0, 1.0]]))
            blobs = [p for p in pl.polygons_full if p.centroid.x > 5 and p.centroid.y < -12]
            if blobs:
                b = max(blobs, key=lambda p: p.area); facet_c = np.array([b.centroid.x, -2.0, b.centroid.y])
        fac = trimesh.creation.icosphere(subdivisions=3, radius=9.5); fac.apply_translation(facet_c)
        l4 = l4 - to_m(fac); l5 = l5 - to_m(fac)
        disc_h = float(P['annulus_fibrosus'].extents[1])
        cg, graft, env = cage(P['annulus_fibrosus'], disc_h, float(P['annulus_fibrosus'].bounds[1, 2] - 8))
        # clear the whole cage envelope: disc left inside the graft window sealed a void in the annulus
        ann = ann - to_m(env) - to_m(graft)
        ann = ann - to_m(trimesh.creation.box(extents=[16, disc_h + 4, 30], transform=trimesh.transformations.translation_matrix([12, 0, -14])))
        show['interbody_cage'] = cg; show['bone_graft'] = graft
        screws, heads = [], {}
        for name, vert_t in (('l4', P['l4_vertebra']), ('l5', P['l5_vertebra'])):
            ped, canal_c, y = pedicle_axes(vert_t)
            for side, sgn in (('left', 1), ('right', -1)):
                centre, width = ped[side]
                entry, tip, d = screw_plan(vert_t, sgn, centre, 10 if name == 'l4' else 15)
                sm, top, saddle = threaded_screw(entry, tip, d)
                screws.append(sm); heads[(name, side)] = saddle
                hole = trimesh.creation.cylinder(radius=2.6 + 0.1, segment=[entry - d * 1.0, tip + d * 0.5], sections=32)
                if name == 'l4': l4 = l4 - to_m(hole)
                else: l5 = l5 - to_m(hole)
                print(f'   screw {name} {side}: pedicle width {width:.1f} mm, length {np.linalg.norm(tip - entry):.0f} mm')
        show['pedicle_screws'] = trimesh.util.concatenate(screws)
        rods = []
        for side in ('left', 'right'):
            a, b = heads[('l4', side)], heads[('l5', side)]
            v = (a - b) / np.linalg.norm(a - b); mid = (a + b) / 2 + np.array([0, 0, -1.5])
            rods.append(rod([a + v * 6, mid, b - v * 6]))
        show['rods'] = trimesh.util.concatenate(rods)
    elif stage in VARIANTS:
        return build_variant(stage, P)
    show['l4_vertebra'] = to_t(l4); show['l5_vertebra'] = to_t(l5)
    show['annulus_fibrosus'] = to_t(ann); show['thecal_sac'] = P['thecal_sac']
    show['nerve_roots'] = to_t(roots); show['l5_nerve_root_left'] = l5l
    return show

# ---------------------------------------------------------------- VARIANTS_V1: pathology library (schematic)
LISTHESIS = {'listhesis_1': 0.15, 'listhesis_2': 0.37, 'listhesis_3': 0.62, 'listhesis_4': 0.87}
VARIANTS = ['far_lateral', 'central_herniation', 'spondylolysis', 'degen_listhesis'] + list(LISTHESIS) + ['compression_fracture', 'kyphoplasty', 'recurrent_herniation', 'stenosis', 'laminectomy']  # VARIANTS_V2 VARIANTS_V3

def blob(spheres, k=3.0, grow=0.0, noise=0.35):
    """Soft disc fragment from a chain of spheres; grow>0 returns the dilated copy used to indent soft tissue."""
    c = np.array([s[0] for s in spheres], float); r = max(s[1] for s in spheres) + 3 + grow
    g = K.Grid(c.min(0) - r, c.max(0) + r, h=0.3); P = g.P
    f = None
    for cc, rr in spheres:
        d = K.sd_sphere(P, cc, rr)
        f = d if f is None else K.smin(f, d, k)
    f = f + noise * (K.vnoise(P, 0.6) - 0.5) - grow
    return K.mesh_from(g, f.astype(np.float32), target=20000)

def pars_cut(P, z6=-28.0, slope=0.25, xa=7.0, gap=1.6):
    """Bilateral L4 pars interarticularis defect: an oblique slab each side, lateral to the lamina (|x| > xa),
    passing behind the pedicle (z = z6 at y = 6, tilting posteriorly as it rises). Parameters were chosen by
    search so the cut splits L4 into exactly two bodies: body/pedicles/superior facets and the posterior arch."""
    t = np.array([0, 1.0, -slope]); t /= np.linalg.norm(t); n = np.array([0, slope, 1.0]); n /= np.linalg.norm(n)
    cut = None
    for sgn in (1, -1):
        b = trimesh.creation.box(extents=[32 - xa, gap, 60])
        M = np.eye(4); M[:3, 0] = [1, 0, 0]; M[:3, 1] = n; M[:3, 2] = t
        b.apply_transform(M); b.apply_translation([sgn * (xa + 32) / 2, 6 + t[1] * 17, z6 + t[2] * 17])
        cut = to_m(b) if cut is None else cut + to_m(b)
    return cut

def shear(mesh, d, y0, y1, xw=None):
    """Forward (+Z) displacement ramping from 0 at y0 to d at y1 (optionally faded in from the midline by |x|)."""
    v = np.asarray(mesh.vertices, float).copy()
    w = np.clip((v[:, 1] - y0) / (y1 - y0), 0, 1); w = w * w * (3 - 2 * w)
    if xw is not None:
        u = np.clip((np.abs(v[:, 0]) - xw[0]) / (xw[1] - xw[0]), 0, 1); w = w * (u * u * (3 - 2 * u))
    v[:, 2] += d * w
    return trimesh.Trimesh(v, mesh.faces, process=False)

def wedge(mesh, frac, y_inf=7.5, y_sup=34.0, z_post=-16.0, z_ant=13.0):
    """Anterior wedge compression of the L4 body: the superior endplate drops by frac of body height at the
    anterior cortex, tapering to nothing at the posterior wall; the inferior endplate and the arch stay put."""
    v = np.asarray(mesh.vertices, float).copy()
    wz = np.clip((v[:, 2] - z_post) / (z_ant - z_post), 0, 1); wz = wz * wz * (3 - 2 * wz)
    wy = np.clip((v[:, 1] - y_inf) / (y_sup - y_inf), 0, 1)
    v[:, 1] -= frac * (y_sup - y_inf) * wz * wy
    return trimesh.Trimesh(v, mesh.faces, process=False)

def build_variant(stage, P):
    show = {}
    if stage == 'recurrent_herniation':
        # microdiscectomy anatomy (laminotomy window, annulotomy) with a new fragment through the same tear
        show = build('discectomy', P); show['disc_herniation'] = P['disc_herniation']
        return show
    l4, l5 = to_m(P['l4_vertebra']), to_m(P['l5_vertebra'])
    ann, nuc = to_m(P['annulus_fibrosus']), to_m(P['nucleus_pulposus'])
    sac = to_m(P['thecal_sac'])
    r4l = to_m(P['l4_nerve_root_left']); l5l = to_m(P['l5_nerve_root_left'])
    others = to_m(P['l4_nerve_root_right']) + to_m(P['l5_nerve_root_right'])
    bones = l4 + l5
    if stage in ('far_lateral', 'central_herniation'):
        if stage == 'far_lateral':
            # extraforaminal fragment from the left lateral annulus, lying ventral to the exiting L4 root
            sph = [((19.5, 0.0, -8.5), 4.2), ((23.5, 1.0, -13.0), 4.4), ((22.0, 4.0, -15.0), 3.4)]
        else:
            # large central extrusion with slight caudal migration, filling the ventral canal
            sph = [((0.0, 0.0, -13.0), 5.0), ((0.0, -1.0, -18.5), 5.6), ((0.0, -3.0, -22.0), 4.6)]
        frag = to_m(blob(sph)) - ann - nuc - bones
        big = to_m(blob(sph, grow=CLR))
        sac = sac - big; r4l = r4l - big; l5l = l5l - big; others = others - big
        show['disc_herniation'] = to_t(frag)
    elif stage == 'spondylolysis':
        l4 = l4 - pars_cut(P)
    elif stage in ('stenosis', 'laminectomy'):
        # degenerative central stenosis: thickened ligamentum flavum behind, broad disc bulge in front
        lf_sph = [((sg_ * 5.0, 1.0, -33.0), 5.0) for sg_ in (1, -1)] + [((sg_ * 10.5, 2.0, -31.0), 3.8) for sg_ in (1, -1)] + [((0.0, 0.0, -36.0), 3.0)]
        bul_sph = [((x_, 0.0, -16.0), 4.6) for x_ in (-11.0, -5.5, 0.0, 5.5, 11.0)]
        bulge = to_m(blob(bul_sph, k=4.0, noise=0.2)) - bones
        ann = (ann + bulge) - nuc
        sac = sac - to_m(blob(bul_sph, k=4.0, noise=0.2, grow=CLR))
        if stage == 'stenosis':
            lf = to_m(blob(lf_sph, k=3.0, noise=0.3)) - bones - ann
            big = to_m(blob(lf_sph, k=3.0, noise=0.3, grow=CLR))
            sac = sac - big; others = others - big; l5l = l5l - big; r4l = r4l - big
            show['ligamentum_flavum'] = to_t(lf)
        else:
            # central laminectomy: lower L4 lamina and spinous process, upper L5 lamina, ligamentum flavum removed
            box = trimesh.creation.box(extents=[19, 34, 50]); box.apply_translation([0, 2.0, -55.0])
            l4 = l4 - to_m(box); l5 = l5 - to_m(box)
    elif stage in ('compression_fracture', 'kyphoplasty'):
        frac = 0.40 if stage == 'compression_fracture' else 0.15
        l4 = to_m(wedge(P['l4_vertebra'], frac))
        if stage == 'kyphoplasty':
            # balloon-tamp cavity filled with cement: one central bolus, reached through both pedicles
            sph = [((-4.0, 19.0, -2.0), 7.0), ((4.0, 19.0, -2.0), 7.0), ((0.0, 18.0, 3.5), 6.0)]
            cem = to_m(blob(sph, k=4.0, noise=0.6)) ^ l4.offset(-1.2) if hasattr(l4, 'offset') else to_m(blob(sph, k=4.0, noise=0.6))
            l4 = l4 - cem
            show['bone_cement'] = to_t(cem)
    elif stage == 'degen_listhesis' or stage in LISTHESIS:
        ep = P['l5_vertebra'].section(plane_origin=[0, P['annulus_fibrosus'].bounds[0, 1] - 1.5, 0], plane_normal=[0, 1, 0])
        ap = float(np.ptp(max(ep.discrete, key=len)[:, 2])) if ep is not None else 30.0
        y0, y1 = float(P['annulus_fibrosus'].bounds[0, 1]), float(P['annulus_fibrosus'].bounds[1, 1])
        if stage == 'degen_listhesis':
            d = 0.15 * ap
            l4 = l4.translate([0, 0, d]); post = None
        else:
            d = LISTHESIS[stage] * ap
            parts = sorted(to_t(l4 - pars_cut(P)).split(only_watertight=False), key=lambda m: -abs(m.volume))
            if len(parts) < 2: raise SystemExit('pars cut did not separate the posterior arch')
            front = [m for m in parts if m.contains([[0, 20.0, 0]])[0]]
            front = front[0] if front else parts[0]
            rest = [m for m in parts if m is not front and abs(m.volume) > 50]
            l4 = to_m(front).translate([0, 0, d]); post = to_m(trimesh.util.concatenate(rest))
        print(f'   {stage}: L5 endplate AP {ap:.1f} mm, slip {d:.1f} mm')
        ann = to_m(shear(P['annulus_fibrosus'], d, y0, y1)); nuc = to_m(shear(P['nucleus_pulposus'], d, y0, y1))
        # roots stay where the dura holds them; the slipped body is cut away from them (no stretched copies)
        moved = l4 if post is None else l4 + post
        l5 = l5 - moved.offset(CLR) if hasattr(moved, 'offset') else l5 - moved
        ann = ann - moved - l5; nuc = nuc - moved - l5
        sac = sac - moved; r4l = r4l - moved - l5; l5l = l5l - moved - l5; others = others - moved - l5
        if post is not None: show['l4_posterior_arch'] = to_t(post)
    show['nucleus_pulposus'] = to_t(nuc)
    show['l4_vertebra'] = to_t(l4); show['l5_vertebra'] = to_t(l5)
    show['annulus_fibrosus'] = to_t(ann); show['thecal_sac'] = to_t(sac)
    show['nerve_roots'] = to_t(others); show['l4_nerve_root_left'] = to_t(r4l); show['l5_nerve_root_left'] = to_t(l5l)
    return show

def bone_colour(name, V):
    if 'vertebra' in name or 'arch' in name: return (0.93 + 0.07 * K.fbm(V, 0.25))[:, None] * np.ones((len(V), 3))
    if name == 'bone_graft': return (0.85 + 0.15 * K.fbm(V, 1.0))[:, None] * np.ones((len(V), 3))
    return None

if __name__ == '__main__':
    P = load()
    for k, v in P.items(): print(f'{k:22s} {len(v.faces):6d}f wt={v.is_watertight}')
    # display frame: posterior-left oblique faces the default camera (+Z)
    R = trimesh.geometry.align_vectors(np.array([0.45, 0.0, -0.89]), [0, 0, 1])
    mp = os.path.join(OUT, 'print', 'manifest.json'); os.makedirs(os.path.dirname(mp), exist_ok=True)
    manifest = json.load(open(mp)) if os.path.exists(mp) else {}
    for st in STAGES:
        show = build(st, P)
        show = {k: decimate(v, 60000 if 'vertebra' in k else 40000) for k, v in show.items()}
        disp = {}
        for k, v in show.items():
            m = v.copy(); m.apply_transform(R); disp[k] = m
        B.write_glb(os.path.join(OUT, f'spine_{st}.glb'), B.export_parts(disp, bone_colour))
        pickle.dump({k: (m.vertices, m.faces, None) for k, m in disp.items()}, open(os.path.join(OUT, f'.mesh_spine_{st}.pkl'), 'wb'))
        pdir = os.path.join(OUT, 'print', f'spine_{st}_full'); os.makedirs(pdir, exist_ok=True)
        entries, failures = [], []
        for i, (k, m) in enumerate(show.items(), 1):
            pm = decimate(m, 30000)
            # same print standard as the kidney: drop degenerate shells and voids, separate touching sheets,
            # then reload the written STL as a slicer would and fail the build if it is not manifold
            comps = pm.split(only_watertight=False)
            if len(comps) > 1:
                keep = [c for c in comps if float(c.volume) >= ZERO_MM3]
                if len(keep) < len(comps): print(f'   {st}/{k}: dropped {len(comps) - len(keep)} degenerate/void shells')
                pm = trimesh.util.concatenate(keep)
            pm, moved = separate_contacts(pm)
            if moved: print(f'   {st}/{k}: separated {moved} self-touching vertices by {CONTACT_EPS_MM * 1000:.0f} um')
            pm = pm.copy(); pm.apply_translation([-pm.bounds[:, 0].mean(), -pm.bounds[:, 1].mean(), -pm.bounds[0, 2]])
            fn = f'{i:02d}_{k}.stl'; pm.export(os.path.join(pdir, fn))
            chk = check_stl(os.path.join(pdir, fn))
            if not chk['watertight']: failures.append(f'spine_{st}_full/{fn}: {chk}')
            entries.append(dict(part=k, file=f'spine_{st}_full/{fn}', supports=('vertebra' in k or k in ('rods', 'pedicle_screws')),
                                watertight=chk['watertight'], non_manifold_edges=chk['non_manifold_edges'], open_edges=chk['open_edges'],
                                bodies=chk['bodies'], faces=int(len(pm.faces)), volume_cm3=round(float(abs(pm.volume)) / 1000, 2)))
        manifest[f'{st}_full'] = entries
        json.dump(manifest, open(mp, 'w'), indent=1)
        if failures: sys.exit('Print check failed (STL not watertight or has non-manifold edges):\n  ' + '\n  '.join(failures))
        print(st, ' | '.join(f"{e['part']} {e['faces']}f{'' if e['watertight'] else ' OPEN'}" for e in entries))
