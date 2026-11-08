# TactileLab

Medical educators make the physical teaching models they need themselves. Pick an organ and condition,
customize a template with a live 3D preview, download a print-ready kit. HackRPI 2026.

## Run
```
npm install
cp .env.example .env.local   # set VITE_PUBLIC_ORIGIN
npm run dev                  # LAN-exposed; set VITE_PUBLIC_ORIGIN to the Network URL so QR codes work on phones
```

## Ownership
- `src/screens/*`, `src/components/*` (except `KitQR.jsx`): frontend. Replace the placeholders freely.
- Everything else: contract side. Do not edit without updating the contract in the frontend prompt.

## Contract
See `src/store/labStore.js`, `src/data/labs.js`, `src/scenes/ModelCanvas.jsx`, `src/lib/kit.js`,
`src/lib/share.js`, `src/components/KitQR.jsx`.

## Models
Base anatomy: `tools/source_kidney.glb`, a normal kidney with separate watertight meshes (cortex with renal
columns, pyramids, sinus fat, calyces and pelvis, renal artery, renal vein, ureter), generated with ChatGPT
during the hackathon.

`tools/place_model.py` turns it into everything the app reads:
- normalises units and orientation (cm in the app, long axis +Y, hilum -X, anterior +Z)
- builds the tumour for each stage (T1a 3 cm, T1b 5.5 cm, T2a 8.5 cm, T3a 6 cm with sinus root and renal vein thrombus)
  into the real cortex, with a keyed flat-floored socket and 0.25 mm clearance
- cuts the coronal section through the hilum, with every internal structure as a separate inlay
- writes `public/models/kidney_<stage>.glb`, `kidney_<stage>_coronal.glb` and print-oriented STLs in
  `public/models/print/` with `manifest.json` (support flags per part)

Rebuild after changing the source or tumour placement:
```
pip install trimesh manifold3d scikit-image fast-simplification scipy shapely rtree pillow
python3 tools/place_model.py tools/source_kidney.glb generated_v2
rm -f public/models/*.glb && rm -rf public/models/print
cp generated_v2/kidney_*.glb public/models/ && cp -r generated_v2/print public/models/print
```
Previews: `python3 tools/preview.py generated_v2 t1b_full:front t1b_coronal:cut` writes `generated_v2/sheet.png`.
`tools/kidney_sdf.py` is the earlier fully procedural generator; its SDF and colour helpers are reused.

## Clinical content
Staging wording follows AJCC Cancer Staging Manual 8th ed. (2017). Anatomy from Gray's / Moore.
Management from AUA 2021 / EAU. Full source list in `labs.js` and on every kit card.
Verify label text against primary sources before printing.


## License
Kits, models and app content: CC BY 4.0.
