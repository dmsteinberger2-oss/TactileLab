import * as THREE from 'three'
import { STLExporter, GLTFLoader } from 'three-stdlib'
import JSZip from 'jszip'
import { jsPDF } from 'jspdf'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { useLabStore } from '@/store/labStore'
import { getLab, getStage, getPart, ajccTable } from '@/data/labs'
import { getSceneRoot } from '@/lib/sceneRegistry'
import { viewUrl } from '@/lib/share'
import { meshVolumeCm3, stlVolumeCm3, volumeReport, summarise, PRINT_ASSUMPTIONS } from '@/lib/printReport'
import { readStl, writeStl, scalePositions, transformPositions, inflatePositions, concatPositions, boundsOf } from '@/lib/stl'
import { registerPart, composePoses, surfaceIndex, contactFraction } from '@/lib/align'

const CM_TO_MM = 10
// A fixed part is grown this much (mm, before print scaling) so it overlaps the base part across the
// 0.25 mm mating clearance; the slicer then merges the two shells into one solid.
export const FUSE_INFLATE_MM = 0.35
const CLEARANCE_MM = 0.25
// Registration quality needed to fuse (trimmed RMS, mm). Measured: 0.04-0.32 mm on the kidney parts.
const MAX_ALIGN_RMS_MM = 0.75
// The openable front half of the coronal kidney: fusing it would close the section, so it is never fixed.
const NEVER_FIXED = new Set(['anterior_half'])
const BASE_FALLBACK = ['kidney_body', 'renal_cortex', 'l5_vertebra']

// ---- part settings ----
const modeOf = (cfg, id) => cfg.partModes?.[id] ?? 'removable'
const visOf = (cfg, id) => cfg.partVisibility?.[id] ?? 'show'
const partName = (labId, id) => getPart(labId, id)?.name ?? id
const listText = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const fmtScale = (s) => `${s}×`
const fmtMm = (x) => `${Math.round(x * 100) / 100} mm`

// The part everything else fuses into: labs[labId].basePart[cutaway], else the first known base present.
export function basePartFor(labId, cutaway, ids) {
  const want = getLab(labId)?.basePart?.[cutaway]
  if (want && ids.includes(want)) return want
  return BASE_FALLBACK.find((id) => ids.includes(id)) ?? null
}
export const canFixPart = (id, base) => !!base && id !== base && !NEVER_FIXED.has(id)

// ---- live scene fallback (labs or views with no print files) ----
// Collects the live part meshes by name with world transforms baked, so exports match the screen.
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

// Scene entries share one (assembled) frame, so fusing them needs no registration.
function sceneEntries() {
  return collectParts().map((m) => ({ part: m.name, supports: false, cm3: meshVolumeCm3(m), mesh: m, sameFrame: true, get data() { return (this._data ??= exportPartSTL(m)) } }))
}

// ---- print-ready parts from the generator (public/models/print/manifest.json) ----
let manifestPromise = null
function printManifest() {
  if (!manifestPromise) manifestPromise = fetch('/models/print/manifest.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
  return manifestPromise
}
// Keys are `${stageId}_${cutaway}` (e.g. t1b_coronal, tlif_full); a `${labId}_` prefixed key wins if present.
// Entries must belong to this lab (files live in `${labId}_<key>/`), so labs sharing a stage id can't collide.
function variantEntries(manifest, labId, stageId, cutaway) {
  for (const key of [`${labId}_${stageId}_${cutaway}`, `${stageId}_${cutaway}`]) {
    const entries = manifest?.[key]
    if (entries?.length && entries.every((e) => !e.file.includes('/') || e.file.startsWith(`${labId}_`))) return entries
  }
  return null
}
const readyCache = new Map()
function printReadyParts(labId, stageId, cutaway) {
  const key = `${labId}_${stageId}_${cutaway}`
  if (!readyCache.has(key)) {
    const p = loadPrintReadyParts(labId, stageId, cutaway)
    p.then((r) => { if (!r) readyCache.delete(key) }, () => readyCache.delete(key))
    readyCache.set(key, p)
  }
  return readyCache.get(key)
}
async function loadPrintReadyParts(labId, stageId, cutaway) {
  const entries = variantEntries(await printManifest(), labId, stageId, cutaway)
  if (!entries) return null
  return Promise.all(entries.map(async (e) => {
    const r = await fetch(`/models/print/${e.file}`)
    if (!r.ok) throw new Error(`Missing print file ${e.file}`)
    const data = await r.arrayBuffer()
    return { part: e.part, file: e.file, supports: !!e.supports, data, cm3: stlVolumeCm3(data) }
  }))
}

async function kitEntries(cfg) {
  const ready = await printReadyParts(cfg.labId, cfg.stageId, cfg.cutaway).catch(() => null)
  return ready ?? sceneEntries()
}

// ---- plan: which parts print separately, which fuse into the base, which are left out ----
function planKit(cfg, entries) {
  const base = basePartFor(cfg.labId, cfg.cutaway, entries.map((e) => e.part))
  const parts = [], fused = [], excluded = []
  for (const e of entries) {
    if (e.part !== base && visOf(cfg, e.part) === 'hide') excluded.push(e)
    else if (canFixPart(e.part, base) && modeOf(cfg, e.part) === 'fixed') fused.push(e)
    else parts.push(e)
  }
  if (!parts.some((e) => e.part === base)) { parts.push(...fused); fused.length = 0 }   // nothing to fuse into
  parts.sort((a, b) => entries.indexOf(a) - entries.indexOf(b))
  return { base, parts, fused, excluded, notFused: [], notFusedReason: {} }
}

// ---- report ----
// A common hobby printer bed (Ender 3 / Prusa MK-class). Parts larger than this on any axis get a warning.
export const BED_MM = 220
const sizes = new WeakMap()
// Print-pose extent of one part, mm at 1:1 (STLs are millimetres, oriented for printing).
function sizeOf(e) {
  if (!sizes.has(e)) {
    try { const { lo, hi } = boundsOf(readStl(e.data)); sizes.set(e, [0, 1, 2].map((i) => hi[i] - lo[i])) }
    catch { sizes.set(e, [0, 0, 0]) }
  }
  return sizes.get(e)
}
function reportFor(cfg, plan) {
  const scale = cfg.printScale ?? 1, k = scale ** 3
  const name = (id) => partName(cfg.labId, id)
  const fusedCm3 = plan.fused.reduce((s, e) => s + e.cm3, 0)
  const rows = plan.parts.map((e) => {
    const withFused = e.part === plan.base && plan.fused.length > 0
    const label = withFused ? `${name(e.part)} with ${listText(plan.fused.map((f) => name(f.part)))} fused` : name(e.part)
    const sizeMm = sizeOf(e).map((d) => Math.round(d * scale))
    return { ...volumeReport(e.part, label, (e.cm3 + (withFused ? fusedCm3 : 0)) * k), sizeMm, supports: !!e.supports, ...(withFused ? { fused: plan.fused.map((f) => f.part) } : {}) }
  })
  return {
    ...summarise(rows), scale, base: plan.base, bedMm: BED_MM,
    oversize: rows.filter((r) => r.sizeMm.some((d) => d > BED_MM)).map((r) => r.id),
    fused: plan.fused.map((e) => e.part), excluded: plan.excluded.map((e) => e.part), notFused: plan.notFused.map((e) => e.part),
  }
}

// Print estimate for the current configuration: print-ready STLs when the manifest has this stage and
// view (else the loaded scene), with fixed parts fused into the base, hidden parts left out and every
// part scaled by printScale (mass and time x scale^3). Depends on labId, stageId, cutaway, partModes,
// partVisibility and printScale; see usePrintReport for a hook that refreshes on all of them.
export async function getPrintReport() {
  const cfg = useLabStore.getState().config()
  return reportFor(cfg, await planFor(cfg, await kitEntries(cfg)))
}

// Parts that can be configured for the current lab, stage and view (what the kit would contain),
// base part first, then in labs.js order. Used by PartControls.
export async function getKitParts(state = useLabStore.getState()) {
  const { labId, stageId, cutaway } = state
  const lab = getLab(labId)
  if (!lab?.parts) return []
  const ready = await printReadyParts(labId, stageId, cutaway).catch(() => null)
  let ids = ready?.map((e) => e.part) ?? collectParts().map((m) => m.name)
  if (!ids.length) {
    const stageSpecific = new Set((lab.stages ?? []).flatMap((s) => s.parts ?? []))
    const stageParts = getStage(labId, stageId)?.parts ?? []
    ids = lab.parts.map((p) => p.id).filter((id) => !stageSpecific.has(id) || stageParts.includes(id))
  }
  ids = [...new Set(ids)]
  const base = basePartFor(labId, cutaway, ids)
  const order = (id) => (id === base ? -1 : lab.parts.findIndex((p) => p.id === id) + 1 || 1e3)
  return ids.sort((a, b) => order(a) - order(b)).map((id) => ({
    id, name: partName(labId, id), isBase: id === base, canFix: canFixPart(id, base), canHide: id !== base,
  }))
}

// ---- fusing: recover each print STL's pose from the assembled model (GLB) ----
const glbCache = new Map()
function assembledParts(labId, stageId, cutaway) {
  const url = `/models/${labId}_${stageId}${cutaway === 'full' ? '' : `_${cutaway}`}.glb`
  if (!glbCache.has(url)) {
    const p = new GLTFLoader().loadAsync(url).then((gltf) => {
      const out = new Map()
      gltf.scene.updateMatrixWorld(true)
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return
        const id = o.name.replace(/\.\d+$/, '')
        const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld)
        const pos = g.attributes.position.array
        const mm = new Float32Array(pos.length)
        for (let i = 0; i < pos.length; i++) mm[i] = pos[i] * CM_TO_MM
        out.set(id, out.has(id) ? concatPositions([out.get(id), mm]) : mm)
      })
      return out
    })
    p.catch(() => glbCache.delete(url))
    glbCache.set(url, p)
  }
  return glbCache.get(url)
}
const poseCache = new Map()
async function printPose(cfg, entry, assembled) {
  const key = `${cfg.labId}_${cfg.stageId}_${cfg.cutaway}_${entry.part}`
  if (!poseCache.has(key)) {
    const geo = assembled.get(entry.part)
    await new Promise((r) => setTimeout(r, 0))   // let the "Preparing kit" state paint between registrations
    poseCache.set(key, geo ? registerPart(geo, readStl(entry.data)) : null)
  }
  return poseCache.get(key)
}

// For each fused part: { R, t } carrying it from its own print frame into the base part's, or { error }.
async function fusePoses(cfg, plan) {
  const out = {}
  const base = plan.parts.find((e) => e.part === plan.base)
  if (base.sameFrame) { for (const f of plan.fused) out[f.part] = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], rms: 0 }; return out }
  const assembled = await assembledParts(cfg.labId, cfg.stageId, cfg.cutaway).catch(() => null)
  const pb = assembled && await printPose(cfg, base, assembled)
  for (const f of plan.fused) {
    const pf = assembled && await printPose(cfg, f, assembled)
    if (!pb || !pf) out[f.part] = { error: 'no assembled geometry' }
    else if (Math.max(pb.rms, pf.rms) > MAX_ALIGN_RMS_MM) out[f.part] = { error: 'alignment', rms: pf.rms, baseRms: pb.rms }
    else out[f.part] = { ...composePoses(pb, pf), rms: pf.rms, baseRms: pb.rms }
  }
  return out
}

// ---- contact: which parts touch which, from the assembled model ----
// A fixed part only fuses if it touches the base, or touches another fixed part that does; otherwise it
// would be a floating shell in the base STL, so it prints separately. Assembled parts that have no print
// file of their own (e.g. the renal artery and vein, already fused into the whole-kidney body) count as base.
const TOUCH_MIN = 0.02   // share of the smaller part's surface within 0.6 mm of the other
const contactCache = new Map()
function variantContacts(cfg, ids, base) {
  const key = `${cfg.labId}_${cfg.stageId}_${cfg.cutaway}`
  if (!contactCache.has(key)) {
    const p = assembledParts(cfg.labId, cfg.stageId, cfg.cutaway).then(async (asm) => {
      if (!asm.has(base)) return null
      const node = (id) => (id === base || !ids.includes(id) ? base : id)
      const geo = new Map()
      for (const [id, tri] of asm) { const n = node(id); geo.set(n, geo.has(n) ? concatPositions([geo.get(n), tri]) : tri) }
      const names = [...geo.keys()], index = new Map(), touches = new Map(names.map((n) => [n, new Set()]))
      for (const n of names) { index.set(n, surfaceIndex(geo.get(n))); await new Promise((r) => setTimeout(r, 0)) }
      for (const a of names) for (const b of names) {
        if (a >= b) continue
        if (Math.max(contactFraction(index.get(b), geo.get(a)), contactFraction(index.get(a), geo.get(b))) >= TOUCH_MIN) { touches.get(a).add(b); touches.get(b).add(a) }
      }
      return touches
    })
    p.catch(() => contactCache.delete(key))
    contactCache.set(key, p)
  }
  return contactCache.get(key).catch(() => null)
}
// Splits fixed part ids into those connected to the base through touching fixed parts, and the rest.
export function attachable(base, fixedIds, touches) {
  if (!touches) return { attached: [...fixedIds], detached: [] }
  const attached = new Set(), frontier = [base]
  while (frontier.length) { const a = frontier.pop(); for (const id of fixedIds) if (!attached.has(id) && touches.get(a)?.has(id)) { attached.add(id); frontier.push(id) } }
  return { attached: fixedIds.filter((id) => attached.has(id)), detached: fixedIds.filter((id) => !attached.has(id)) }
}
function unfuse(plan, entries, list, reason) {
  if (!list.length) return
  plan.fused = plan.fused.filter((e) => !list.includes(e))
  plan.notFused.push(...list)
  for (const e of list) plan.notFusedReason[e.part] = reason
  plan.parts = entries.filter((e) => plan.parts.includes(e) || list.includes(e))
}
async function planFor(cfg, entries) {
  const plan = planKit(cfg, entries)
  if (plan.fused.length && !entries[0]?.sameFrame) {
    const touches = await variantContacts(cfg, entries.map((e) => e.part), plan.base)
    const { detached } = attachable(plan.base, plan.fused.map((e) => e.part), touches)
    unfuse(plan, entries, plan.fused.filter((e) => detached.includes(e.part)), 'touch')
  }
  return plan
}

// ---- label tiles ----
// Flat 40 x 14 x 2 mm plaque; notch count = part number (rows of ten). Text is on the kit card.
function labelTile(number) {
  const parts = [new THREE.BoxGeometry(40, 14, 2)]
  for (let i = 0; i < number; i++) {
    const notch = new THREE.BoxGeometry(2, 2, 2.2)
    notch.translate(-17 + (i % 10) * 3.6, 5.5 - Math.floor(i / 10) * 3.5, 0)
    parts.push(notch)
  }
  const m = new THREE.Mesh(mergeGeometries(parts)); m.name = `label_${number}`
  return new STLExporter().parse(m, { binary: true }).buffer
}
function mergeGeometries(list) {
  const total = list.reduce((s, g) => s + (g.index ? g.toNonIndexed() : g).attributes.position.count, 0)
  const pos = new Float32Array(total * 3); let off = 0
  for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; pos.set(g.attributes.position.array, off); off += g.attributes.position.array.length }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.computeVertexNormals(); return out
}

// ---- QR for the kit card, rendered off-screen from the exact config (the on-page #kit-qr is the fallback) ----
async function qrPng(url) {
  try {
    const host = document.createElement('div')
    const root = createRoot(host)
    flushSync(() => root.render(createElement(QRCodeCanvas, { value: url, size: 320, level: 'M', marginSize: 4 })))
    await new Promise((r) => setTimeout(r, 0))
    const png = host.querySelector('canvas')?.toDataURL('image/png') ?? null
    root.unmount()
    if (png) return png
  } catch { /* fall through */ }
  return document.getElementById('kit-qr')?.toDataURL?.('image/png') ?? null
}

// ---- kit card text: print notes and assembly for this lab, view and part selection ----
function kitNotes({ lab, stage, cfg, plan }) {
  const name = (id) => partName(lab.id, id)
  const scale = cfg.printScale ?? 1
  const sep = plan.parts.map((e) => e.part)
  const has = (id) => sep.includes(id)
  const baseName = plan.base ? name(plan.base) : 'base part'
  const removable = (stage.parts ?? []).filter(has).map(name)
  const supported = plan.parts.filter((p) => p.supports || (p.part === plan.base && plan.raisedMm)).map((p) => name(p.part))
  const how = [
    `Material: ${PRINT_ASSUMPTIONS.material}. Layer height ${PRINT_ASSUMPTIONS.layerMm} mm. Infill ${PRINT_ASSUMPTIONS.infillPct}%. 3 perimeters.`,
    scale === 1
      ? 'Every STL is already oriented for printing. Load it as-is; do not rotate or rescale (millimetres, 1:1).'
      : `Every STL is already oriented for printing and scaled to ${fmtScale(scale)} life size. Load it as-is; do not rotate or rescale (millimetres).`,
    supported.length ? `Supports touching the build plate: ${supported.join(', ')}. Everything else prints without supports.` : 'No supports needed.',
  ]
  let assembly
  if (lab.id === 'kidney' && cfg.cutaway === 'coronal') {
    const inlays = sep.filter((id) => id !== plan.base && id !== 'anterior_half').map(name)
    how.push(`Coronal kit: the cortex prints cut-face up${inlays.length ? `; each inlay (${inlays.join(', ')}) prints cut-face down and drops into its pocket` : ''}.${has('anterior_half') ? ' The front half prints cut-face down.' : ''}`)
    assembly = 'Seat the collecting system and artery first, then the sinus fat around them, then the pyramids and the tumour. Pull each inlay straight up to remove it.'
    if (has('anterior_half')) assembly += ' Close the front half over the section to show the whole kidney; lift it off to see inside.'
  } else if (lab.id === 'kidney') {
    how.push(`The renal artery and vein print fused to the kidney body.${has('ureter') ? ' The ureter prints as a separate part, lying flat.' : ''}${removable.length ? ` Removable parts (${removable.join(', ')}) press-fit by hand${has('tumor') ? '; the tumour lifts out along its keyed pegs' : ''}.` : ''}`)
    assembly = `Seat removable parts into their sockets; they press-fit by hand.${has('ureter') ? ' The ureter has no socket: lay it at the lower hilum, where it leaves the renal pelvis.' : ''} Hilar order front to back: renal vein, renal artery, renal pelvis; top to bottom: artery, vein, pelvis.`
  } else {
    how.push(`The ${baseName} is the base part; every other part prints separately.`)
    assembly = `Assemble the parts on the ${baseName}, using the interactive model (scan the QR code) as the reference.`
  }
  if (plan.fused.length) {
    const names = listText(plan.fused.map((e) => name(e.part)))
    how.push(`Fused into the ${baseName}: ${names}. Each was grown ${FUSE_INFLATE_MM} mm (at life size) and added to the ${baseName} STL as an overlapping shell, so it prints as one piece with it. Slicers merge overlapping shells; a warning about intersecting or overlapping shells is expected.`)
    assembly += ` ${names} ${plan.fused.length > 1 ? 'are' : 'is'} already fused in place.`
    if (plan.raisedMm) how.push(`Fused parts reach ${fmtMm(plan.raisedMm * scale)} below the bottom of the ${baseName}, so the fused STL rests on them: print it with supports (tree supports work well).`)
  }
  const apart = (reason) => plan.notFused.filter((e) => plan.notFusedReason[e.part] === reason).map((e) => name(e.part))
  const loose = apart('touch'), unaligned = apart('align')
  if (loose.length) how.push(`${listText(loose)} ${loose.length > 1 ? "don't" : "doesn't"} touch the ${baseName} (or a part fused to it), so ${loose.length > 1 ? 'they print as separate parts' : 'it prints as a separate part'} although set to Fixed.`)
  if (unaligned.length) how.push(`Could not line up ${listText(unaligned)} with the ${baseName}; ${unaligned.length > 1 ? 'they print' : 'it prints'} as a separate part.`)
  if (plan.excluded.length) how.push(`Left out of this kit (hidden in the builder): ${listText(plan.excluded.map((e) => name(e.part)))}.`)
  how.push(`Mating clearance is ${fmtMm(CLEARANCE_MM * scale)}. Print each part in a different colour for the clearest model. Label tiles: notch count = part number.`)
  return { how, assembly }
}

// ---- kit card PDF ----
async function kitCardPDF({ lab, stage, cfg, report, qrDataUrl, plan }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210, margin = 16, bottom = 282
  let y = 20
  // jsPDF's built-in Helvetica has no ≤ / ≥ glyphs (they print as a spaced-out "d"); write them as <= / >=.
  const pdfText = (t) => String(t ?? '').replace(/≤/g, '<=').replace(/≥/g, '>=')
  const wrap = (text, x, w, lh = 5) => {
    const lines = doc.splitTextToSize(pdfText(text), w)
    if (y + lines.length * lh > bottom) { doc.addPage(); y = 20 }
    doc.text(lines, x, y); y += lines.length * lh
  }
  const heading = (text) => { if (y + 12 > bottom) { doc.addPage(); y = 20 } doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(text, margin, y); y += 6; doc.setFont('helvetica', 'normal') }
  const scale = cfg.printScale ?? 1
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text(pdfText(`TactileLab kit: ${lab.name}`), margin, y); y += 8
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11)
  doc.text(pdfText(`${lab.condition} — ${stage.label}${cfg.cutaway !== 'full' ? ` (${lab.cutaways?.find((c) => c.id === cfg.cutaway)?.label ?? cfg.cutaway})` : ''}${scale !== 1 ? ` — ${fmtScale(scale)} life size` : ''}`), margin, y); y += 10
  if (qrDataUrl) { doc.addImage(qrDataUrl, 'PNG', W - margin - 40, 14, 40, 40, 'kit-qr', 'FAST'); doc.setFontSize(8); doc.text('Scan for the interactive model', W - margin - 40, 58); doc.setFontSize(11) }
  wrap(stage.readout, margin, W - 2 * margin - 48); y += 4
  wrap(stage.teaching, margin, W - 2 * margin - 48); y = Math.max(y + 8, 64)

  heading('Parts in this kit')
  report.parts.forEach((p, i) => wrap(`${i + 1}. ${p.name}  —  ${p.grams} g, ~${p.minutes} min`, margin, W - 2 * margin, 5.5))
  wrap(`Total: ${report.totalGrams} g PLA, ~${fmtMin(report.totalMinutes)}, about $${report.costUsd} of filament${scale !== 1 ? ` (at ${fmtScale(scale)} size)` : ''}`, margin, W - 2 * margin); y += 4

  const { how, assembly } = kitNotes({ lab, stage, cfg, plan })
  heading('How to print')
  for (const line of how) { wrap('• ' + line, margin, W - 2 * margin); y += 1 }
  y += 5
  heading('Assembly')
  wrap(assembly, margin, W - 2 * margin); y += 6

  if (lab.id === 'kidney') {
    heading('AJCC 8th edition T stage'); doc.setFontSize(9)
    for (const [t, d] of ajccTable) { wrap(`${t}: ${d}`, margin, W - 2 * margin); y += 0.5 }
  }

  doc.addPage(); y = 20; doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.text('Sources', margin, y); y += 5
  for (const s of lab.sources ?? []) { wrap('• ' + s, margin, W - 2 * margin); y += 1 }
  y += 4; wrap('Model geometry derived from openly licensed anatomy (attribution in README). Kit licensed CC BY 4.0. Print estimates are approximate and depend on your printer and slicer settings.', margin, W - 2 * margin)
  return doc.output('arraybuffer')
}
function fmtMin(m) { return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min` }

// ---- build the STL files ----
async function buildKit(cfg) {
  const entries = await kitEntries(cfg)
  if (!entries.length) throw new Error('Scene not ready: no parts found to export')
  const plan = await planFor(cfg, entries)
  const poses = plan.fused.length ? await fusePoses(cfg, plan) : {}
  unfuse(plan, entries, plan.fused.filter((f) => !poses[f.part] || poses[f.part].error), 'align')
  const scale = cfg.printScale ?? 1
  const files = plan.parts.map((e) => {
    let tri = null
    if (e.part === plan.base && plan.fused.length) {
      tri = concatPositions([readStl(e.data), ...plan.fused.map((f) => {
        const { R, t } = poses[f.part]
        return transformPositions(inflatePositions(readStl(f.data), FUSE_INFLATE_MM), R, t)
      })])
      // A fused part can reach past the base's flat print face (a tumour bulging out of the back of the
      // kidney). Re-seat on the plate, centred like every generator STL, and say so on the kit card.
      const { lo, hi } = boundsOf(tri)
      if (lo[2] < -0.01) plan.raisedMm = -lo[2]
      tri = transformPositions(tri, [1, 0, 0, 0, 1, 0, 0, 0, 1], [-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]])
    }
    if (scale !== 1) tri = scalePositions(tri ?? readStl(e.data), scale)
    const stem = e.part === plan.base && plan.fused.length ? `${e.part}_with_${plan.fused.map((f) => f.part).join('_')}` : e.part
    return {
      part: e.part, stem, supports: e.part === plan.base ? e.supports || !!e.sameFrame || !!plan.raisedMm : e.supports,
      fused: e.part === plan.base ? plan.fused.map((f) => f.part) : [],
      data: tri ? writeStl(tri, `TactileLab ${cfg.labId} ${cfg.stageId} ${stem} x${scale}`) : e.data,
    }
  })
  // Registration residuals (trimmed RMS, mm) of each fused part and of the base it was placed into.
  const mm = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : undefined)
  const alignment = Object.fromEntries(Object.entries(poses).map(([k, v]) => [k, { ...(v.error ? { error: v.error } : {}), rmsMm: mm(v.rms), baseRmsMm: mm(v.baseRms) }]))
  return { plan, files, alignment }
}

// ---- main entry ----
export async function downloadKit() {
  const cfg = useLabStore.getState().config()
  const lab = getLab(cfg.labId)
  const stage = getStage(cfg.labId, cfg.stageId)
  if (!lab || !stage) throw new Error('Unknown lab or stage')
  const { plan, files, alignment } = await buildKit(cfg)
  const scale = cfg.printScale ?? 1
  const name = (id) => partName(lab.id, id)

  const zip = new JSZip()
  const stem = `tactilelab_${lab.id}_${stage.id}${cfg.cutaway !== 'full' ? `_${cfg.cutaway}` : ''}${scale !== 1 ? `_${String(scale).replace('.', '-')}x` : ''}`
  const folder = zip.folder(stem)
  const stl = folder.folder('stl')
  const fileName = (f, i) => `${String(i + 1).padStart(2, '0')}_${f.stem}.stl`
  files.forEach((f, i) => stl.file(fileName(f, i), f.data))
  files.forEach((f, i) => stl.file(`label_${String(i + 1).padStart(2, '0')}_${f.stem}.stl`, labelTile(i + 1)))

  const report = reportFor(cfg, plan)
  const url = viewUrl(cfg)
  folder.file('kit_card.pdf', await kitCardPDF({ lab, stage, cfg, report, qrDataUrl: await qrPng(url), plan }))
  folder.file('config.json', JSON.stringify({
    ...cfg, viewUrl: url, report,
    kit: {
      scale, base: plan.base, inflateMm: plan.fused.length ? FUSE_INFLATE_MM : undefined,
      files: files.map((f, i) => ({ file: `stl/${fileName(f, i)}`, part: f.part, fused: f.fused.length ? f.fused : undefined, supports: f.supports })),
      fused: plan.fused.map((e) => e.part), excluded: plan.excluded.map((e) => e.part), notFused: plan.notFused.map((e) => ({ part: e.part, reason: plan.notFusedReason[e.part] })), alignment, raisedMm: plan.raisedMm,
    },
    generatedAt: new Date().toISOString(),
  }, null, 2))
  folder.file('README.txt', [
    `TactileLab kit — ${lab.name}, ${lab.condition}, ${stage.label}${cfg.cutaway !== 'full' ? ` (${cfg.cutaway})` : ''}${scale !== 1 ? `, ${fmtScale(scale)} life size` : ''}`,
    '',
    `stl/            one STL per part, millimetres, ${scale === 1 ? '1:1 scale' : `already scaled to ${fmtScale(scale)}`}, oriented for printing (see kit_card.pdf for supports)`,
    ...files.map((f, i) => `  ${fileName(f, i)}  ${name(f.part)}${f.fused.length ? ` with ${listText(f.fused.map(name))} fused` : ''}`),
    'stl/label_*.stl  label tiles; notch count = part number',
    ...(plan.fused.length ? ['', `Fused parts were grown ${FUSE_INFLATE_MM} mm (at life size) and added to the ${name(plan.base)} STL as overlapping shells.`,
      'Slicers merge overlapping shells into one solid; a warning about intersecting or overlapping shells is expected.'] : []),
    ...(plan.notFused.length ? ['', `Set to Fixed but printed separately: ${plan.notFused.map((e) => `${name(e.part)} (${plan.notFusedReason[e.part] === 'touch' ? `does not touch the ${name(plan.base)}` : 'could not be lined up'})`).join(', ')}`] : []),
    ...(plan.excluded.length ? ['', `Left out (hidden in the builder): ${listText(plan.excluded.map((e) => name(e.part)))}`] : []),
    '',
    'kit_card.pdf    print settings, assembly, staging reference, QR to the interactive model',
    'config.json     the exact configuration that produced this kit', '', `Interactive model: ${url}`,
  ].join('\n'))

  const blob = await zip.generateAsync({ type: 'blob' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${stem}.zip`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
