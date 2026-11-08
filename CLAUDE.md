# TactileLab: notes for Claude Code

HackRPI 2026 (theme "In The Clouds"; tracks entered: Hardware, Healthcare, AI, MLH Gemini, GoDaddy domain).
Hacking ends 11:00 Sunday Nov 8. Devpost due 9:00. Judging is a science-fair table demo.

## What it is
Medical educators make the physical teaching models they need. Pick an organ and condition, customise it with a
live 3D preview, download a print-ready kit. A QR on the kit opens the same model on a phone (/view).
Prototype: one kidney-tumour kit (renal cell carcinoma, Normal / T1a / T1b / T2a / T3a), whole and coronal views.

## Layout
- `src/screens`, `src/components/LabUI.jsx`: UI (Home, Lab, View; /learn redirects to /view). Change freely, keep the look.
- `src/store/labStore.js`: single Zustand config that drives the canvas, kit export and share URL.
- `src/data/labs.js`: all clinical text (AJCC 8th wording). Don't rewrite clinical wording without a source.
- `src/scenes/ModelCanvas.jsx`: R3F viewer. Loads `/models/kidney_<stage>.glb` or `_coronal.glb`, one mesh per part id.
- `src/lib/kit.js`: Download kit (print-ready STLs from `public/models/print/manifest.json`, kit_card.pdf, QR).
- `src/lib/share.js`: student URL; uses `VITE_PUBLIC_ORIGIN` so QR codes work on phones.
- `tools/place_model.py`: builds every model and print file from `tools/source_kidney.glb`. See README.

## Rules
- Don't add dependencies. Don't restyle. Don't change part ids (they link labs.js, GLBs, STLs, colours).
- Keep the R3F canvas separate from UI components.
- After changing models: rerun place_model.py and copy outputs to public/models (README has the commands).
- Everything must be created during the hacking window; don't import pre-hackathon files or assets.
- Commit after each working change; the history is our provenance.

## Run
npm install; cp .env.example .env.local (set VITE_PUBLIC_ORIGIN); npm run dev
