# TactileLab

Medical educators make the physical teaching models they need themselves. Pick an organ and condition,
customize a template with a live 3D preview, download a print-ready kit. HackRPI 2026.

## Run
```
npm install
cp .env.example .env.local   # set VITE_PUBLIC_ORIGIN
npm run dev                  # LAN-exposed; set VITE_PUBLIC_ORIGIN to the Network URL so QR codes work on phones
```

## Deploy (Vercel)
`vercel.json` builds with Vite into `dist/` and rewrites the client routes `/lab/*`, `/view` and `/learn` to
`index.html` (static files such as `/models/...` are served first, so GLBs and STLs are unaffected).

Environment variable (build time; Vite inlines it, so redeploy after changing it):
- `VITE_PUBLIC_ORIGIN`: origin the QR codes and share links point to, e.g. `https://tactilelab.example`.
  Optional on Vercel: when unset, links use the address the page was opened on. Set it when educators use the
  `*.vercel.app` URL but students should land on the custom domain. No other variables are read.

```
npm run build                                          # must pass locally first
npx vercel login
npx vercel link                                        # create or pick the project (framework: Vite)
npx vercel env add VITE_PUBLIC_ORIGIN production       # paste e.g. https://tactilelab.example (optional)
npx vercel --prod                                      # build on Vercel and deploy to production
npx vercel domains add tactilelab.example              # custom domain (GoDaddy): then add the DNS records it prints
```
Preview deploy without touching production: `npx vercel`. Check after deploying: open `/lab/kidney`, reload it
(tests the rewrite), download a kit, and scan the kit-card QR with a phone (opens `/view?...`).

## Download kit
`src/lib/kit.js` builds the zip from the print-ready STLs in `public/models/print/manifest.json`
(key `${stageId}_${cutaway}`), or from the live scene when a stage/view has none. Store settings it reads:
- `partVisibility[id] === 'hide'`: the part is left out of the kit (STL, label tile, README, kit card).
- `partModes[id] === 'fixed'`: the part is grown 0.35 mm along its vertex normals and appended to the base
  part's STL (`labs[labId].basePart[cutaway]`) as an overlapping shell; slicers merge overlapping shells into
  one solid. The generator orients each print STL on its own, so `src/lib/align.js` recovers each STL's pose by
  registering the assembled GLB part onto it (multi-start ICP, then point-to-plane), and the fixed part is moved
  into the base part's frame. A fixed part that doesn't touch the base (or another fused part that does) prints
  separately and the kit card says why. If fused parts reach below the base, the STL is re-seated on the plate.
- `printScale` (1, 1.5, 2): every part STL is scaled; the print estimate scales mass and time by scale³.
`usePrintReport()` (`src/lib/usePrintReport.js`) keeps the on-screen estimate in step with all of these.

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
