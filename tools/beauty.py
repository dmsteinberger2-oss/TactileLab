"""Visual layer for the app models: painted coronal section, adrenal gland, textured GLB export.

The coronal cut face is painted as an anatomical illustration from the real section outlines of each part
(cortex, pyramids, sinus fat, collecting system, artery, tumour, adrenal), then mapped onto the flat cut faces.
Curved surfaces keep baked vertex colours. Everything here is visual only; print files are unaffected.
"""
import io, json, struct, math
import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFilter
import shapely.geometry as sg
import shapely.ops as so
from scipy.spatial import cKDTree

RNG = np.random.default_rng(42)

# ---------------------------------------------------------------- colours (sRGB 0-255)
C = dict(
    cortex=(156, 64, 52), cortex_dark=(122, 44, 37), glom=(110, 30, 28), capsule=(96, 34, 30),
    medulla=(112, 36, 32), stripe_lo=(86, 24, 22), stripe_hi=(142, 58, 50), papilla=(236, 212, 196),
    art=(200, 34, 30), art_hi=(232, 92, 80), vein=(44, 74, 150), vein_hi=(86, 120, 196),
    fat=(240, 214, 132), fat_lo=(222, 186, 96), fat_septa=(250, 236, 196),
    pelvis=(240, 234, 222), pelvis_lo=(210, 200, 186),
    tumor=(226, 172, 58), tumor_lo=(196, 138, 40), tumor_hi=(244, 206, 110), hem=(140, 40, 32), necro=(214, 206, 188), septa=(236, 214, 170),
    adr_cortex=(232, 182, 72), adr_medulla=(150, 78, 50),
)
DEFAULTS = {'kidney_body': '#8a3b32', 'renal_cortex': '#b0614f', 'renal_medulla': '#64271f', 'renal_sinus': '#efd57e',
            'renal_pelvis': '#ece7da', 'ureter': '#ece7da', 'renal_artery': '#c0392b', 'renal_vein': '#2e5c9e',
            'tumor': '#dda033', 'vein_thrombus': '#cf9233', 'adrenal_gland': '#d9a53c'}

def srgb2lin(c): c = np.asarray(c, float) / 255; return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def hex2rgb(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))

# ---------------------------------------------------------------- adrenal gland
def adrenal(kmesh, z0, to_m, to_t, grid_cls, mesh_from, sd_ellipsoid, smin):
    """Left adrenal: a crescent cap draped over the superomedial pole, thickest centrally, tapering at the edges."""
    from skimage.measure import marching_cubes
    d = np.array([-0.45, 0.89, 0.0]); d /= np.linalg.norm(d)
    loc, idx, _ = kmesh.ray.intersects_location([np.array([0, 0, z0]) + d * 300], [-d])
    k = np.argmax(loc @ d); s = loc[k]; n = kmesh.face_normals[idx[k]]; n = n / np.linalg.norm(n)
    t1 = np.cross([0, 0, 1.0], n); t1 /= np.linalg.norm(t1)          # along the kidney border, in the coronal plane
    if t1[1] > 0: t1 = -t1                                             # pointing down the medial border toward the hilum
    centre = s + t1 * 5.0
    pitch = 0.7; half = np.array([26.0, 26.0, 16.0])
    ax = [np.arange(centre[i] - half[i], centre[i] + half[i] + pitch, pitch) for i in range(3)]
    X, Y, Z = np.meshgrid(*ax, indexing='ij'); P = np.c_[X.ravel(), Y.ravel(), Z.ravel()]
    # only points near the surface matter; query in small batches against a lighter copy (memory)
    import fast_simplification
    v2, f2 = fast_simplification.simplify(kmesh.vertices, kmesh.faces, target_reduction=max(0.0, 1 - 20000 / len(kmesh.faces)))
    km = trimesh.Trimesh(v2, f2, process=True)
    dist = np.full(len(P), 50.0); sign = np.ones(len(P))
    near = np.abs(np.linalg.norm(P - s, axis=1)) < 40
    idxs = np.nonzero(near)[0]
    for i in range(0, len(idxs), 15000):
        b = idxs[i:i + 15000]
        cp, dd, tri = trimesh.proximity.closest_point(km, P[b])
        sg_ = np.sign(np.einsum('ij,ij->i', P[b] - cp, km.face_normals[tri])); sg_[sg_ == 0] = 1
        dist[b] = dd; sign[b] = sg_
    sdf = (dist * sign).reshape(X.shape)
    rel = (P - centre).reshape(X.shape + (3,))
    u = (rel @ t1) / 18.0; w = rel[..., 2] / 9.5
    r2 = u ** 2 + w ** 2
    thick = 0.6 + 3.4 * np.clip(1 - r2, 0, 1) ** 0.7
    f = np.maximum(sdf - thick, 0.6 - sdf)
    f = np.maximum(f, (np.sqrt(r2) - 1.0) * 8)
    f[0], f[-1], f[:, 0], f[:, -1], f[:, :, 0], f[:, :, -1] = 1, 1, 1, 1, 1, 1
    v, faces, _, _ = marching_cubes(f, 0.0, spacing=(pitch,) * 3)
    m = trimesh.Trimesh(v + np.array([a[0] for a in ax]), faces, process=True)
    m = trimesh.util.concatenate([c for c in m.split(only_watertight=False) if abs(c.volume) > 50])
    trimesh.smoothing.filter_taubin(m, iterations=12); m.fix_normals()
    if m.volume < 0: m.invert()
    return to_m(m), s, n

# ---------------------------------------------------------------- sections
def section_polys(mesh, z0):
    try:
        sec = mesh.section(plane_origin=[0, 0, z0], plane_normal=[0, 0, 1])
        if sec is None: return sg.MultiPolygon()
        planar, T = sec.to_planar(to_2D=np.eye(4) @ np.array([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, -z0], [0, 0, 0, 1]]))
        polys = [p for p in planar.polygons_full if p.area > 0.5]
        return so.unary_union(polys) if polys else sg.MultiPolygon()
    except Exception as e:
        print('section failed', e); return sg.MultiPolygon()

def as_list(g):
    if g.is_empty: return []
    return list(g.geoms) if hasattr(g, 'geoms') else [g]

# ---------------------------------------------------------------- canvas
class Canvas:
    def __init__(self, bounds, ppm, ss=2):
        x0, y0, x1, y1 = bounds
        self.x0, self.y0, self.x1, self.y1 = x0, y0, x1, y1
        self.ppm, self.ss = ppm, ss
        self.W, self.H = int(math.ceil((x1 - x0) * ppm)), int(math.ceil((y1 - y0) * ppm))
        self.w, self.h = self.W * ss, self.H * ss
        self.img = np.zeros((self.h, self.w, 3), np.float32)
    def px(self, pts):
        pts = np.asarray(pts, float)
        return np.c_[(pts[:, 0] - self.x0) * self.ppm * self.ss, (self.y1 - pts[:, 1]) * self.ppm * self.ss]
    def mm(self, v): return v * self.ppm * self.ss
    def mask(self, geom):
        im = Image.new('L', (self.w, self.h), 0); dr = ImageDraw.Draw(im)
        for p in as_list(geom):
            dr.polygon([tuple(q) for q in self.px(np.asarray(p.exterior.coords))], fill=255)
            for hole in p.interiors: dr.polygon([tuple(q) for q in self.px(np.asarray(hole.coords))], fill=0)
        return (np.asarray(im, np.float32) / 255).astype(np.float16)
    def layer(self): return Image.new('L', (self.w, self.h), 0)
    def paint(self, alpha, colour, clip=None):
        a = alpha if isinstance(alpha, np.ndarray) else np.asarray(alpha, np.float32) / 255
        if clip is not None: a = a * clip
        a = a.astype(np.float32)[..., None]
        self.img = self.img * (1 - a) + np.asarray(colour, np.float32)[None, None] * a
    def fill(self, mask, base): self.paint(mask, base)
    def noise(self, scale_mm, seed):
        r = np.random.default_rng(seed)
        sw, sh = max(2, int(self.W / (scale_mm * self.ppm)) + 2), max(2, int(self.H / (scale_mm * self.ppm)) + 2)
        small = Image.fromarray((r.random((sh, sw)) * 255).astype(np.uint8))
        return np.asarray(small.resize((self.w, self.h), Image.BICUBIC), np.float32) / 255
    def lines(self, polylines, width_mm, colour, clip=None, blur=0.0):
        L = self.layer(); dr = ImageDraw.Draw(L); wpx = max(1, int(round(self.mm(width_mm))))
        for pl in polylines:
            if len(pl) < 2: continue
            pts = [tuple(q) for q in self.px(pl)]
            dr.line(pts, fill=255, width=wpx, joint='curve')
            r = wpx / 2
            for q in (pts[0], pts[-1]): dr.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=255)
        if blur: L = L.filter(ImageFilter.GaussianBlur(self.mm(blur)))
        self.paint(np.asarray(L, np.float32) / 255, colour, clip)
    def dots(self, pts, r_mm, colour, clip=None):
        L = self.layer(); dr = ImageDraw.Draw(L); r = self.mm(r_mm)
        for q in self.px(pts): dr.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=255)
        self.paint(np.asarray(L, np.float32) / 255, colour, clip)
    def result(self):
        im = Image.fromarray(np.clip(self.img, 0, 255).astype(np.uint8))
        return im.resize((self.W, self.H), Image.LANCZOS)

def vessel(cv, polylines, width, kind, clip):
    """Painted vessel: darker body, lighter centre highlight."""
    body, hi = (C['art'], C['art_hi']) if kind == 'art' else (C['vein'], C['vein_hi'])
    cv.lines(polylines, width * 1.25, tuple(np.array(body) * 0.7), clip, blur=0.05)
    cv.lines(polylines, width, body, clip)
    cv.lines(polylines, width * 0.35, hi, clip, blur=0.05)

def wiggle(a, b, n=10, amp=0.35, seed=0):
    r = np.random.default_rng(seed); t = np.linspace(0, 1, n)[:, None]
    p = a + (b - a) * t
    perp = np.array([-(b - a)[1], (b - a)[0]]); perp = perp / (np.linalg.norm(perp) + 1e-9)
    p = p + perp * (np.sin(t * math.pi * r.uniform(1.5, 3)) * amp * r.uniform(0.5, 1))[:, :1] * np.sin(t * math.pi)
    return p

def voronoi_texture(cv, mask, cell_mm, base, lo, septa, seed, septa_w=0.25, var=1.0):
    r = np.random.default_rng(seed)
    ys, xs = np.nonzero(mask[::8, ::8] > 0.5)
    if len(xs) == 0: return
    n = max(8, int(len(xs) * 64 / (cv.mm(cell_mm) ** 2)))
    pick = r.choice(len(xs), size=min(n, len(xs)), replace=False)
    seeds = np.c_[xs[pick] * 8, ys[pick] * 8].astype(float) + r.random((len(pick), 2)) * 8
    step = 2
    gy, gx = np.mgrid[0:cv.h:step, 0:cv.w:step]
    lab = cKDTree(seeds).query(np.c_[gx.ravel(), gy.ravel()])[1].reshape(gx.shape)
    shade = r.random(len(seeds))
    col = np.array(base)[None] * (1 - var * 0.5 * shade[:, None]) + np.array(lo)[None] * (var * 0.5 * shade[:, None])
    img = col[lab]
    edge = (np.diff(lab, axis=0, prepend=lab[:1]) != 0) | (np.diff(lab, axis=1, prepend=lab[:, :1]) != 0)
    img = np.asarray(Image.fromarray(img.astype(np.uint8)).resize((cv.w, cv.h), Image.NEAREST).filter(ImageFilter.GaussianBlur(cv.mm(0.18))), np.float32)
    e = Image.fromarray((edge * 255).astype(np.uint8)).resize((cv.w, cv.h), Image.NEAREST)
    e = e.filter(ImageFilter.MaxFilter(max(1, int(cv.mm(septa_w)) | 1))).filter(ImageFilter.GaussianBlur(cv.mm(0.08)))
    a = mask[..., None]
    cv.img = cv.img * (1 - a) + img * a
    cv.paint(np.asarray(e, np.float32) / 255 * 0.55, septa, mask)

# ---------------------------------------------------------------- the painting
def paint_section(polys, ppm=16.0, max_px=2600):
    """polys: {part: shapely geometry at the cut plane}. Returns (PIL image, bounds)."""
    allg = so.unary_union([g for k, g in polys.items() if not g.is_empty and k != 'ureter'])
    x0, y0, x1, y1 = allg.bounds; m = 8.0
    x0, y0, x1, y1 = x0 - m, y0 - m, x1 + m, y1 + m
    ppm = min(ppm, max_px / max(x1 - x0, y1 - y0))
    cv = Canvas((x0, y0, x1, y1), ppm)
    get = lambda k: polys.get(k, sg.MultiPolygon())
    cortex, med, fat, pel, art, tum, adr, ure = (get(k) for k in ('renal_cortex', 'renal_medulla', 'renal_sinus', 'renal_pelvis', 'renal_artery', 'tumor', 'adrenal_gland', 'ureter'))
    kidney = so.unary_union([g for g in (cortex, med, fat, pel) if not g.is_empty])
    M = {k: cv.mask(g) for k, g in dict(cortex=cortex, med=med, fat=fat, pel=pel, art=art, tum=tum, adr=adr, ure=ure, kid=kidney).items()}
    tissue = np.clip(M['cortex'] + M['med'], 0, 1)

    # 1 cortex: granular parenchyma with glomeruli
    n1, n2 = cv.noise(0.6, 1), cv.noise(3.0, 2)
    base = np.array(C['cortex'])[None, None] * (0.9 + 0.12 * n1[..., None]) * (0.94 + 0.08 * n2[..., None])
    a = M['cortex'][..., None]; cv.img = cv.img * (1 - a) + base * a
    if not cortex.is_empty:
        minx, miny, maxx, maxy = cortex.bounds
        pts = np.c_[RNG.uniform(minx, maxx, 9000), RNG.uniform(miny, maxy, 9000)]
        inside = np.array([cortex.contains(sg.Point(p)) for p in pts[:3500]] + [False] * 0)
        pts = pts[:3500][inside]
        cv.dots(pts, 0.16, C['glom'], M['cortex'])
        cv.dots(pts[::2] + 0.05, 0.07, (190, 96, 84), M['cortex'])

    # 2 pyramids: striations radiating from the papilla, pale papillary tips
    pyr = []
    fat_c = np.array(fat.centroid.coords[0]) if not fat.is_empty else np.array(kidney.centroid.coords[0])
    for p in as_list(med):
        ext = np.asarray(p.exterior.coords)[:-1]
        apex = ext[np.argmin(np.linalg.norm(ext - fat_c, axis=1))]
        dist = np.linalg.norm(ext - apex, axis=1); dmax = dist.max()
        base_pts = ext[dist > 0.72 * dmax]
        axis = base_pts.mean(0) - apex; axis /= np.linalg.norm(axis) + 1e-9
        perp = np.array([-axis[1], axis[0]])
        side = base_pts @ perp; c1, c2 = base_pts[np.argmin(side)], base_pts[np.argmax(side)]
        ang = np.arctan2(*(base_pts - apex).T[::-1]); order = np.argsort(((ang - math.atan2(axis[1], axis[0]) + math.pi) % (2 * math.pi)))
        pyr.append(dict(poly=p, apex=apex, axis=axis, perp=perp, dmax=dmax, base=base_pts[order], c1=c1, c2=c2))
    a = M['med'][..., None]; cv.img = cv.img * (1 - a) + np.array(C['medulla'])[None, None] * (0.92 + 0.12 * cv.noise(1.5, 3)[..., None]) * a
    for i, P in enumerate(pyr):
        pm = cv.mask(P['poly'])
        fan_lo, fan_hi = [], []
        for k, t in enumerate(np.linspace(-0.62, 0.62, 46)):
            d = P['axis'] * math.cos(t) + P['perp'] * math.sin(t)
            end = P['apex'] + d * P['dmax'] * 1.25
            (fan_lo if k % 2 else fan_hi).append(np.array([P['apex'], end]))
        cv.lines(fan_lo, 0.42, C['stripe_lo'], pm, blur=0.12)
        cv.lines(fan_hi, 0.30, C['stripe_hi'], pm, blur=0.12)
        # papilla: pale tip fading upward
        tip = sg.Point(*P['apex']).buffer(P['dmax'] * 0.24).intersection(P['poly'])
        tm = np.asarray(Image.fromarray((cv.mask(tip) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(cv.mm(1.0))), np.float32) / 255
        cv.paint(tm * 0.85, C['papilla'], pm)

    # 3 interlobular arteries and veins fanning from the arcuates to the capsule
    solid = kidney.buffer(0.8).buffer(-0.8)           # close hairline gaps between parts so the outline is the true capsule
    outline = max(as_list(solid), key=lambda g: g.area).exterior
    il_a, il_v = [], []
    for i, P in enumerate(pyr):
        arc = P['base']
        if len(arc) < 3: continue
        seglen = np.r_[0, np.cumsum(np.linalg.norm(np.diff(arc, axis=0), axis=1))]
        for j, s in enumerate(np.arange(1.5, seglen[-1], 2.6)):
            q = np.array([np.interp(s, seglen, arc[:, 0]), np.interp(s, seglen, arc[:, 1])])
            d = q - P['apex']; d /= np.linalg.norm(d) + 1e-9
            far = q + d * 40; ray = sg.LineString([q, far]).intersection(outline)
            pts = as_list(ray) if not ray.is_empty else []
            if not pts: continue
            hit = min((np.array(pp.coords[0]) for pp in pts if hasattr(pp, 'coords')), key=lambda z: np.linalg.norm(z - q))
            L = np.linalg.norm(hit - q)
            if L < 2.5: continue
            start = q + d * 1.4; end = q + d * (L - 1.1)
            (il_a if j % 2 == 0 else il_v).append(wiggle(start, end, 12, amp=0.45, seed=i * 100 + j))
    vessel(cv, il_v, 0.40, 'vein', M['cortex'])
    vessel(cv, il_a, 0.34, 'art', M['cortex'])
    # stellate veins under the capsule
    caps = np.asarray(outline.coords)
    stl = [wiggle(caps[k], caps[k] + (caps[(k + 7) % len(caps)] - caps[k]) * 0.5, 6, amp=0.4, seed=k) for k in range(0, len(caps), max(1, len(caps) // 60))]
    cv.lines(stl, 0.18, C['vein'], M['cortex'] * (1 - cv.mask(kidney.buffer(-1.6))), blur=0.08)

    # 4 arcuate and interlobar vessels at the corticomedullary junction and in the columns
    arc_a, arc_v, lob_a, lob_v = [], [], [], []
    for P in pyr:
        base = P['base']; out = base - P['apex']; out /= np.linalg.norm(out, axis=1, keepdims=True) + 1e-9
        arc_a.append(base + out * 1.0); arc_v.append(base + out * 2.1)
        for c, sgn in ((P['c1'], -1), (P['c2'], 1)):
            off = P['perp'] * sgn
            a0 = P['apex'] + P['axis'] * 1.5 + off * 1.6
            lob_a.append(wiggle(a0, c + off * 1.2, 14, amp=0.4, seed=int(abs(c[0] * 10))))
            lob_v.append(wiggle(a0 + off * 1.2, c + off * 2.3, 14, amp=0.4, seed=int(abs(c[1] * 10))))
    clip_t = np.clip(tissue - M['tum'], 0, 1)
    vessel(cv, arc_v + lob_v, 0.62, 'vein', clip_t)
    vessel(cv, arc_a + lob_a, 0.5, 'art', clip_t)

    # 5 sinus fat: lobulated
    voronoi_texture(cv, M['fat'], 1.5, C['fat'], C['fat_lo'], C['fat_septa'], 7, septa_w=0.14, var=0.8)

    # 6 segmental vessels crossing the sinus fat to each interlobar origin
    hil = np.array(art.centroid.coords[0]) if not art.is_empty else np.array(pel.centroid.coords[0]) if not pel.is_empty else fat_c
    hil = np.array([hil[0] - 2, hil[1]])
    seg_a, seg_v = [], []
    for k, P in enumerate(pyr):
        tgt = P['apex'] + P['perp'] * 2.0
        mid = (hil + tgt) / 2 + np.array([-(tgt - hil)[1], (tgt - hil)[0]]) * 0.12
        curve = np.array([(1 - t) ** 2 * hil + 2 * (1 - t) * t * mid + t * t * tgt for t in np.linspace(0, 1, 16)])
        seg_a.append(curve); seg_v.append(curve + np.array([0.0, -2.2]))
    clip_f = np.clip(M['fat'] - M['pel'], 0, 1)
    vessel(cv, seg_v, 1.1, 'vein', clip_f)
    vessel(cv, seg_a, 0.9, 'art', clip_f)

    # 7 collecting system: pale urothelium with soft shading
    if not pel.is_empty:
        a = M['pel'][..., None]
        shade = np.asarray(Image.fromarray((cv.mask(pel.buffer(-1.0)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(cv.mm(1.2))), np.float32)[..., None] / 255
        col = np.array(C['pelvis_lo'])[None, None] * (1 - shade) + np.array(C['pelvis'])[None, None] * shade
        cv.img = cv.img * (1 - a) + col * a
    for g, base in ((art, C['art']), (ure, C['pelvis'])):
        if g.is_empty: continue
        mk = cv.mask(g); cv.fill(mk, base)
        core = cv.mask(g.buffer(-0.6)); cv.paint(core * 0.6, C['art_hi'] if base == C['art'] else (255, 250, 244))

    # 8 tumour: lobulated golden cut surface, fibrous septa, haemorrhage and necrosis, pseudocapsule
    if not tum.is_empty:
        voronoi_texture(cv, M['tum'], 2.2, C['tumor_hi'], C['tumor_lo'], C['septa'], 11, septa_w=0.18, var=1.0)
        hem = np.clip((cv.noise(9, 21) * 0.7 + cv.noise(3, 22) * 0.3 - 0.58) / 0.08, 0, 1)
        cv.paint(hem * 0.92, C['hem'], M['tum'])
        nec = np.clip((cv.noise(12, 31) * 0.8 + cv.noise(4, 32) * 0.2 - 0.66) / 0.06, 0, 1)
        cv.paint(nec * 0.85, C['necro'], M['tum'])
        rim = M['tum'] * (1 - cv.mask(tum.buffer(-0.9)))
        cv.paint(rim * 0.9, (176, 120, 60))

    # 9 adrenal: yellow cortex, brown medulla core
    if not adr.is_empty:
        cv.fill(M['adr'], C['adr_cortex'])
        core = adr.buffer(-1.15)
        if not core.is_empty: cv.paint(cv.mask(core) * 0.9, C['adr_medulla'])

    # 10 depth: soft darkening along every boundary, capsule line
    lab = (M['cortex'] * 1 + M['med'] * 2 + M['fat'] * 3 + M['pel'] * 4 + M['tum'] * 5 + M['art'] * 6 + M['adr'] * 7)
    edge = (np.abs(np.diff(lab, axis=0, prepend=lab[:1])) + np.abs(np.diff(lab, axis=1, prepend=lab[:, :1]))) > 0.5
    ao = np.asarray(Image.fromarray((edge * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(cv.mm(0.5))), np.float32) / 255
    cv.img *= (1 - 0.35 * np.clip(ao * 3, 0, 1))[..., None]
    cv.lines([np.asarray(outline.coords)], 0.45, C['capsule'], None)
    img = cv.result()
    px = np.asarray(img).copy(); px[-72:, -72:] = 255          # white block: UV target for non-cut faces
    return Image.fromarray(px), (x0, y0, x1, y1)

# ---------------------------------------------------------------- GLB writer (colours + optional texture)
def write_glb(path, parts, texture=None):
    """parts: list of dict(name, pos (N,3) float32 cm, nrm (N,3), col (N,3) uint8, uv (N,2) or None, idx (M,3))."""
    bin_chunks, views, accessors = [], [], []
    def add_view(data, target=None):
        off = sum(len(b) for b in bin_chunks); pad = (-len(data)) % 4
        bin_chunks.append(data + b'\0' * pad)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target: v['target'] = target
        views.append(v); return len(views) - 1
    def add_acc(arr, ctype, typ, target=None, normalized=False, minmax=False):
        vi = add_view(np.ascontiguousarray(arr).tobytes(), target)
        a = {'bufferView': vi, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if normalized: a['normalized'] = True
        if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        accessors.append(a); return len(accessors) - 1
    meshes, nodes = [], []
    for p in parts:
        n = len(p['pos'])
        for k in ('nrm', 'col', 'uv'):
            if p.get(k) is not None: assert len(p[k]) == n, f"{p['name']}: {k} has {len(p[k])} rows for {n} vertices"
        attrs = {'POSITION': add_acc(p['pos'].astype(np.float32), 5126, 'VEC3', 34962, minmax=True),
                 'NORMAL': add_acc(p['nrm'].astype(np.float32), 5126, 'VEC3', 34962),
                 'COLOR_0': add_acc(p['col'].astype(np.uint16), 5123, 'VEC3', 34962, normalized=True)}
        if p.get('uv') is not None: attrs['TEXCOORD_0'] = add_acc(p['uv'].astype(np.float32), 5126, 'VEC2', 34962)
        idx = add_acc(p['idx'].astype(np.uint32).reshape(-1), 5125, 'SCALAR', 34963)
        meshes.append({'name': p['name'], 'primitives': [{'attributes': attrs, 'indices': idx, 'material': 1 if p.get('uv') is not None else 0}]})
        nodes.append({'name': p['name'], 'mesh': len(meshes) - 1})
    gltf = {'asset': {'version': '2.0', 'generator': 'TactileLab'}, 'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}],
            'nodes': nodes, 'meshes': meshes, 'accessors': accessors, 'bufferViews': views,
            'materials': [{'name': 'tissue', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 0.5}}]}
    if texture is not None:
        buf = io.BytesIO(); texture.convert('RGB').save(buf, 'JPEG', quality=90, subsampling=0)
        iv = add_view(buf.getvalue())
        gltf['images'] = [{'bufferView': iv, 'mimeType': 'image/jpeg'}]
        gltf['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}]
        gltf['textures'] = [{'sampler': 0, 'source': 0}]
        gltf['materials'].append({'name': 'section', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 0.5}})
    else:
        gltf['materials'].append(gltf['materials'][0])
    binary = b''.join(bin_chunks)
    gltf['buffers'] = [{'byteLength': len(binary)}]
    js = json.dumps(gltf, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binary), 0x004E4942) + binary
    open(path, 'wb').write(out)

def export_parts(meshes, colour_fn, z0=None, tex_bounds=None, texture=None, untextured=('ureter',), cut_sign=1):
    """Bake full colours into vertices; flat cut faces get planar UVs into the painted section.
    cut_sign: +1 for pieces whose cut face looks toward +Z (posterior half), -1 for the anterior half."""
    out = []
    for name, m in meshes.items():
        g = trimesh.graph.smooth_shade(m, angle=np.radians(38), facet_minarea=None)
        V = np.asarray(g.vertices, np.float32); N = np.asarray(g.vertex_normals, np.float32)
        mult = colour_fn(name, V)
        base = srgb2lin(hex2rgb(DEFAULTS.get(name, '#999999')))
        # One colour per vertex even for flat-coloured parts (glTF needs COLOR_0.count == POSITION.count).
        lin = np.broadcast_to(base[None] * (mult if mult is not None else 1.0), (len(V), 3))
        uv = None
        if texture is not None:
            x0, y0, x1, y1 = tex_bounds
            cut = (np.abs(V[:, 2] - z0) < 0.08) & (N[:, 2] * cut_sign > 0.9) & (name not in untextured)
            uv = np.tile([1 - 24 / texture.width, 1 - 24 / texture.height], (len(V), 1)).astype(np.float32)
            uv[cut, 0] = (V[cut, 0] - x0) / (x1 - x0); uv[cut, 1] = (y1 - V[cut, 1]) / (y1 - y0)
            lin = np.where(cut[:, None], 1.0, lin)
        col = (np.clip(lin, 0, 1) * 65535).astype(np.uint16)
        out.append(dict(name=name, pos=V * 0.1, nrm=N, col=col, uv=uv, idx=np.asarray(g.faces)))
    return out

def combine(parts, name):
    """Concatenate export_parts entries into one part (one mesh in the GLB), offsetting indices."""
    off = np.cumsum([0] + [len(p['pos']) for p in parts[:-1]])
    has_uv = all(p.get('uv') is not None for p in parts)
    return dict(name=name, pos=np.concatenate([p['pos'] for p in parts]), nrm=np.concatenate([p['nrm'] for p in parts]),
                col=np.concatenate([p['col'] for p in parts]), uv=np.concatenate([p['uv'] for p in parts]) if has_uv else None,
                idx=np.concatenate([np.asarray(p['idx']) + o for p, o in zip(parts, off)]))
