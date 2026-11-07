"""Pack all variants into one gzipped, quantized binary + manifest for the standalone web viewer."""
import pickle, os, sys, json, gzip, hashlib, numpy as np, trimesh, fast_simplification
OUT = sys.argv[1] if len(sys.argv) > 1 else 'generated'
KEYS = [f'{s}_{f}' for s in ['normal', 't1a', 't1b', 't2a', 't3a'] for f in ['full', 'coronal']]
CAP = {'kidney_body': 40000, 'renal_cortex': 50000, 'renal_medulla': 45000, 'tumor': 36000, 'renal_sinus': 20000, 'renal_pelvis': 22000}
meshes, variants, blobs, seen = [], {}, [], {}
allv = np.concatenate([pickle.load(open(f'{OUT}/.mesh_{k}.pkl', 'rb'))[p][0] for k in KEYS for p in pickle.load(open(f'{OUT}/.mesh_{k}.pkl', 'rb'))])
lo, hi = allv.min(0) - 1, allv.max(0) + 1
offset = 0
for k in KEYS:
    data = pickle.load(open(f'{OUT}/.mesh_{k}.pkl', 'rb'))
    variants[k] = []
    for part, (v, f, c) in data.items():
        h = hashlib.md5(np.ascontiguousarray(v).tobytes() + np.ascontiguousarray(f).tobytes()).hexdigest()
        if h in seen: variants[k].append(seen[h]); continue
        cap = CAP.get(part, 7000)
        if len(f) > cap:
            # decimate, then re-sample colour at new vertices from nearest original vertex
            v2, f2 = fast_simplification.simplify(v, f, target_reduction=1 - cap / len(f))
            if c is not None:
                from scipy.spatial import cKDTree
                c = c[cKDTree(v).query(v2)[1]]
            v, f = v2, f2
        q = np.round((v - lo) / (hi - lo) * 65535).astype('<u2')
        idx = f.astype('<u2' if len(v) < 65536 else '<u4')
        col = (np.clip(c, 0, 1) * 255).astype(np.uint8) if c is not None else None
        rec = dict(id=len(meshes), part=part, vcount=int(len(v)), icount=int(idx.size), i32=bool(idx.dtype.itemsize == 4))
        for name, arr in (('pos', q), ('col', col), ('idx', idx)):
            if arr is None: continue
            b = arr.tobytes(); pad = (-len(b)) % 4
            rec[name] = offset; blobs.append(b + b'\0' * pad); offset += len(b) + pad
        meshes.append(rec); seen[h] = rec['id']; variants[k].append(rec['id'])
raw = b''.join(blobs)
gz = gzip.compress(raw, 9)
manifest = dict(lo=lo.tolist(), hi=hi.tolist(), meshes=meshes, variants=variants)
open(f'{OUT}/web.bin.gz', 'wb').write(gz); json.dump(manifest, open(f'{OUT}/web.json', 'w'))
print('meshes', len(meshes), 'raw MB', round(len(raw) / 1e6, 2), 'gz MB', round(len(gz) / 1e6, 2), 'base64 MB', round(len(gz) * 4 / 3 / 1e6, 2))
