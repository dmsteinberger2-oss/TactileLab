import * as THREE from 'three'
import { STLExporter } from 'three-stdlib'
import JSZip from 'jszip'
import { jsPDF } from 'jspdf'
import { useLabStore } from '@/store/labStore'
import { getLab, getStage, getPart, ajccTable } from '@/data/labs'
import { getSceneRoot } from '@/lib/sceneRegistry'
import { learnUrl } from '@/lib/share'
import { partReport, volumeReport, stlVolumeCm3, summarise, PRINT_ASSUMPTIONS } from '@/lib/printReport'
import { generateLesson } from '@/ai/gemini'

const CM_TO_MM = 10

// ---- geometry collection ----
// Collects the live part meshes by name, baking world transforms (minus any lift/explode
// offset, which lives on the spring group) so exports match the assembled configuration.
function collectParts() {
  const root = getSceneRoot()
  const { labId, stageId } = useLabStore.getState()
  const lab = getLab(labId)
  const stage = getStage(labId, stageId)
  if (!root || !lab) return []
  const wanted = new Set(lab.parts.map((p) => p.id))
  const out = []
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    if (!o.isMesh || !wanted.has(o.name)) return
    if (stage && stage.parts && !stage.parts.includes(o.name) && getPart(labId, o.name)?.removable && ['tumor', 'vein_thrombus'].includes(o.name)) return
    out.push(o)
  })
  return out
}

function bakedClone(mesh) {
  const g = mesh.geometry.clone()
  g.applyMatrix4(mesh.matrixWorld)
  g.scale(CM_TO_MM, CM_TO_MM, CM_TO_MM)
  const m = new THREE.Mesh(g)
  m.name = mesh.name
  return m
}

export function exportPartSTL(mesh) {
  const exporter = new STLExporter()
  return exporter.parse(bakedClone(mesh), { binary: true }).buffer   // DataView -> ArrayBuffer for JSZip
}

// ---- label tiles ----
// Flat plaque with the stage/part text as a raised rectangle outline; text itself is on the kit card.
// Full TextGeometry needs a font JSON; keep this a simple 40x14x2 mm tile with an index notch so parts match their card entries.
function labelTile(index) {
  const g = new THREE.BoxGeometry(40, 14, 2)
  const notch = new THREE.BoxGeometry(2, 2, 2.2)
  notch.translate(-16 + index * 4, 6, 0)
  const merged = mergeGeometries([g, notch])
  const m = new THREE.Mesh(merged); m.name = `label_${index}`
  return new STLExporter().parse(m, { binary: true }).buffer
}
function mergeGeometries(list) {
  const total = list.reduce((s, g) => s + (g.index ? g.toNonIndexed() : g).attributes.position.count, 0)
  const pos = new Float32Array(total * 3); let off = 0
  for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; pos.set(g.attributes.position.array, off); off += g.attributes.position.array.length }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.computeVertexNormals(); return out
}

// ---- report ----
// Prefer the print-ready STLs (what actually goes in the kit: e.g. whole kits print the vessels fused
// to the kidney body); fall back to the live scene meshes only when there are no print files.
export async function getPrintReport(ready) {
  const { labId, stageId, cutaway } = useLabStore.getState()
  if (ready === undefined) ready = await printReadyParts(labId, stageId, cutaway).catch(() => null)
  const parts = ready
    ? ready.map((e) => volumeReport(e.part, getPart(labId, e.part)?.name ?? e.part, stlVolumeCm3(e.data)))
    : collectParts().map((m) => partReport(m, getPart(labId, m.name)?.name ?? m.name))
  return summarise(parts)
}

// ---- kit card PDF ----
async function kitCardPDF({ lab, stage, cfg, report, lesson, qrDataUrl, listed = [] }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, margin = 16
  let y = 20
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text(`TactileLab kit: ${lab.name}`, margin, y); y += 8
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text(`${lab.condition} — ${stage.label}`, margin, y); y += 10
  if (qrDataUrl) { doc.addImage(qrDataUrl, 'PNG', W - margin - 40, 14, 40, 40); doc.setFontSize(8); doc.text('Scan for the interactive model', W - margin - 40, 58) }
  doc.setFontSize(11); y = wrap(doc, stage.readout, margin, y, W - 2 * margin - 48) + 4
  y = wrap(doc, stage.teaching, margin, y, W - 2 * margin - 48) + 8

  doc.setFont('helvetica', 'bold'); doc.text('Parts in this kit', margin, y); y += 6; doc.setFont('helvetica', 'normal')
  report.parts.forEach((p, i) => { doc.text(`${i + 1}. ${p.name}  —  ${p.grams} g, ~${p.minutes} min`, margin, y); y += 5.5 })
  doc.text(`Total: ${report.totalGrams} g PLA, ~${fmtMin(report.totalMinutes)}, about $${report.costUsd} of filament`, margin, y); y += 9

  doc.setFont('helvetica', 'bold'); doc.text('How to print', margin, y); y += 6; doc.setFont('helvetica', 'normal')
  const supported = listed.filter((p) => p.supports).map((p) => getPart(lab.id, p.name)?.name ?? p.name)
  const how = [
    `Material: ${PRINT_ASSUMPTIONS.material}. Layer height ${PRINT_ASSUMPTIONS.layerMm} mm. Infill ${PRINT_ASSUMPTIONS.infillPct}%. 3 perimeters.`,
    'Every STL is already oriented for printing. Load it as-is; do not rotate or rescale (millimetres, 1:1).',
    supported.length ? `Supports touching the build plate: ${supported.join(', ')}. Everything else prints without supports.` : 'No supports needed.',
    cfg.cutaway === 'coronal'
      ? 'Coronal kit: the cortex prints cut-face up; each inlay (pyramids, sinus fat, collecting system, artery, ureter, tumour) prints cut-face down and drops into its pocket.'
      : 'The renal artery and vein print fused to the kidney body; the ureter prints as a separate part, lying flat. Removable parts (the tumour, plus the vein thrombus at T3a) press-fit by hand; the tumour lifts out along its keyed pegs.',
    'Mating clearance is 0.25 mm. Print each part in a different colour for the clearest model. Label tiles: notch count = part number.',
  ]
  for (const line of how) y = wrap(doc, '• ' + line, margin, y, W - 2 * margin) + 1
  y += 6
  doc.setFont('helvetica', 'bold'); doc.text('Assembly', margin, y); y += 6; doc.setFont('helvetica', 'normal')
  y = wrap(doc, cfg.cutaway === 'coronal'
    ? 'Seat the collecting system and artery first, then the sinus fat around them, then the pyramids and the tumour. Pull each inlay straight up to remove it.'
    : 'Seat removable parts into their sockets; they press-fit by hand. The ureter has no socket: lay it at the lower hilum, where it leaves the renal pelvis. Hilar order front to back: renal vein, renal artery, renal pelvis; top to bottom: artery, vein, pelvis.', margin, y, W - 2 * margin) + 6

  doc.setFont('helvetica', 'bold'); doc.text('AJCC 8th edition T stage', margin, y); y += 6; doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  for (const [t, d] of ajccTable) { y = wrap(doc, `${t}: ${d}`, margin, y, W - 2 * margin) + 0.5; if (y > 270) { doc.addPage(); y = 20 } }

  if (lesson) {
    doc.addPage(); y = 20; doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text('Learning material', margin, y); y += 8
    doc.setFontSize(11); doc.setFont('helvetica', 'normal')
    y = wrap(doc, lesson.caseStudy, margin, y, W - 2 * margin) + 6
    doc.setFont('helvetica', 'bold'); doc.text('Vocabulary', margin, y); y += 6; doc.setFont('helvetica', 'normal')
    for (const v of lesson.vocab ?? []) { y = wrap(doc, `${v.term}: ${v.definition}`, margin, y, W - 2 * margin) + 1; if (y > 270) { doc.addPage(); y = 20 } }
    y += 5; doc.setFont('helvetica', 'bold'); doc.text('Exercises', margin, y); y += 6; doc.setFont('helvetica', 'normal')
    ;(lesson.exercises ?? []).forEach((e, i) => { y = wrap(doc, `${i + 1}. ${e}`, margin, y, W - 2 * margin) + 1; if (y > 270) { doc.addPage(); y = 20 } })
  }
  doc.addPage(); y = 20; doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.text('Sources', margin, y); y += 5
  for (const s of lab.sources ?? []) y = wrap(doc, '• ' + s, margin, y, W - 2 * margin) + 1
  y += 4; y = wrap(doc, 'Model geometry derived from openly licensed anatomy (attribution in README). Kit licensed CC BY 4.0. Print estimates are approximate and depend on your printer and slicer settings.', margin, y, W - 2 * margin)
  return doc.output('arraybuffer')
}
function wrap(doc, text, x, y, w) { const lines = doc.splitTextToSize(text ?? '', w); doc.text(lines, x, y); return y + lines.length * 5 }
function fmtMin(m) { return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min` }

// ---- print-ready parts from the generator ----
let manifestPromise = null
function printManifest() {
  if (!manifestPromise) manifestPromise = fetch('/models/print/manifest.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
  return manifestPromise
}
const readyCache = new Map()
function printReadyParts(labId, stageId, cutaway) {
  const key = `${labId}_${stageId}_${cutaway}`
  if (!readyCache.has(key)) {
    const p = loadPrintReadyParts(labId, stageId, cutaway)
    p.catch(() => readyCache.delete(key))
    readyCache.set(key, p)
  }
  return readyCache.get(key)
}
async function loadPrintReadyParts(labId, stageId, cutaway) {
  const manifest = await printManifest()
  const entries = manifest?.[`${stageId}_${cutaway === 'coronal' ? 'coronal' : 'full'}`]
  if (!entries || labId !== 'kidney') return null
  const files = await Promise.all(entries.map(async (e) => {
    const r = await fetch(`/models/print/${e.file}`)
    if (!r.ok) throw new Error(`Missing print file ${e.file}`)
    return { ...e, data: await r.arrayBuffer() }
  }))
  return files
}

// ---- main entry ----
export async function downloadKit({ includeLesson = true } = {}) {
  const state = useLabStore.getState()
  const cfg = state.config()
  const lab = getLab(cfg.labId)
  const stage = getStage(cfg.labId, cfg.stageId)
  const meshes = collectParts()
  const ready = await printReadyParts(cfg.labId, cfg.stageId, cfg.cutaway).catch(() => null)
  if (!ready && !meshes.length) throw new Error('Scene not ready: no parts found to export')

  const zip = new JSZip()
  const folder = zip.folder(`tactilelab_${lab.id}_${stage.id}${cfg.cutaway === 'coronal' ? '_coronal' : ''}`)
  const stl = folder.folder('stl')
  const listed = ready
    ? ready.map((e) => ({ name: e.part, data: e.data, supports: e.supports }))
    : meshes.map((m) => ({ name: m.name, data: exportPartSTL(m), supports: m.name === 'kidney_body' || m.name === 'renal_cortex' }))
  listed.forEach((p, i) => stl.file(`${String(i + 1).padStart(2, '0')}_${p.name}.stl`, p.data))
  listed.forEach((p, i) => stl.file(`label_${String(i + 1).padStart(2, '0')}_${p.name}.stl`, labelTile(i)))

  const report = await getPrintReport(ready)
  let lesson = null
  if (includeLesson) { try { lesson = await generateLesson() } catch (e) { console.warn('Lesson generation skipped:', e) } }

  const qrCanvas = document.getElementById('kit-qr')
  const qrDataUrl = qrCanvas?.toDataURL?.('image/png') ?? null
  folder.file('kit_card.pdf', await kitCardPDF({ lab, stage, cfg, report, lesson, qrDataUrl, listed }))
  folder.file('config.json', JSON.stringify({ ...cfg, learnUrl: learnUrl(cfg), report, generatedAt: new Date().toISOString() }, null, 2))
  folder.file('README.txt', [
    `TactileLab kit — ${lab.name}, ${lab.condition}, ${stage.label}`,
    '', 'stl/            one STL per part, millimetres, 1:1 scale, oriented for printing (see kit_card.pdf for supports)',
    'stl/label_*.stl  label tiles; notch count = part number', 'kit_card.pdf    print settings, assembly, staging reference, learning material, QR to the interactive model',
    'config.json     the exact configuration that produced this kit', '', `Interactive model: ${learnUrl(cfg)}`,
  ].join('\n'))

  const blob = await zip.generateAsync({ type: 'blob' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `tactilelab_${lab.id}_${stage.id}${cfg.cutaway === 'coronal' ? '_coronal' : ''}.zip`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
