# Start here

1. Unzip this folder anywhere (e.g. your home folder) and open it in VS Code.
2. In the VS Code terminal:
   git init && git add -A && git commit -m "TactileLab"
   npm install
   cp .env.example .env.local
3. Edit `.env.local`:
   VITE_GEMINI_API_KEY=your Gemini key
   VITE_PUBLIC_ORIGIN=http://<the Network address npm run dev prints>:5173
4. npm run dev, then open http://localhost:5173/lab/kidney
5. Start Claude Code in this folder. It reads CLAUDE.md automatically. First prompt:

   Start the dev server, open /lab/kidney and /learn?lab=kidney&stage=t1b, and fix anything that errors.
   Then check Download kit produces a zip with STLs and kit_card.pdf for both Whole kidney and Coronal section.
   Report what you fixed.

To rebuild the 3D models (only if you change them):
   pip install trimesh manifold3d scikit-image fast-simplification scipy shapely
   then follow "Models" in README.md
