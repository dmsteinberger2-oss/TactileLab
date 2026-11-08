import { create } from 'zustand'
import { labs } from '@/data/labs'

const defaultColors = (labId) =>
  Object.fromEntries((labs[labId]?.parts ?? []).map((p) => [p.id, p.defaultColor]))

const PART_MODES = ['removable', 'fixed']
const PART_VISIBILITY = ['show', 'hide', 'xray']
export const PRINT_SCALES = [1, 1.5, 2]

// Per-part settings are stored sparsely: a part missing from partModes is 'removable', a part missing
// from partVisibility is 'show'. Readers use `partModes[id] ?? 'removable'` and `partVisibility[id] ?? 'show'`.
const setSparse = (map, id, value, fallback) => {
  const next = { ...map }
  if (value === fallback) delete next[id]; else next[id] = value
  return next
}

// Share-URL lists: comma-separated part ids, validated against the lab.
const idList = (p, key, labId) => {
  const ids = new Set((labs[labId]?.parts ?? []).map((x) => x.id))
  return (p.get(key) ?? '').split(',').filter((id) => ids.has(id))
}

export const useLabStore = create((set, get) => ({
  labId: 'kidney',
  stageId: 't1b',
  cutaway: 'full',
  partColors: defaultColors('kidney'),
  labelsOn: true,
  selectedPartId: null,
  exploded: false,
  compareNormal: false,
  liftedParts: {},
  partModes: {},        // { [partId]: 'fixed' }   fixed parts print fused to the base part and never lift
  partVisibility: {},   // { [partId]: 'hide' | 'xray' }   hidden parts are left out of the kit too
  printScale: 1,        // 1 | 1.5 | 2, applied to every STL in the kit
  open: true,           // section view: front half opened

  // Same lab: no-op, so a route effect calling setLab(labId) on every mount keeps the educator's settings.
  setLab: (labId) => get().labId === labId ? undefined : set({ labId, stageId: labs[labId]?.stages?.[0]?.id ?? null, cutaway: labs[labId]?.cutaways?.[0]?.id ?? 'full', partColors: defaultColors(labId), selectedPartId: null, exploded: false, liftedParts: {}, partModes: {}, partVisibility: {} }),
  setStage: (stageId) => set({ stageId, selectedPartId: null, liftedParts: {} }),
  setCutaway: (cutaway) => set({ cutaway }),
  setPartColor: (partId, hex) => set((s) => ({ partColors: { ...s.partColors, [partId]: hex } })),
  resetColors: () => set((s) => ({ partColors: defaultColors(s.labId) })),
  setLabelsOn: (labelsOn) => set({ labelsOn }),
  selectPart: (selectedPartId) => set({ selectedPartId }),
  setExploded: (exploded) => set({ exploded, liftedParts: {} }),
  setCompareNormal: (compareNormal) => set({ compareNormal }),
  toggleLift: (partId) => set((s) => (s.partModes[partId] === 'fixed' ? {} : { liftedParts: { ...s.liftedParts, [partId]: !s.liftedParts[partId] } })),
  setPartMode: (partId, mode) => {
    if (!PART_MODES.includes(mode)) return
    set((s) => ({
      partModes: setSparse(s.partModes, partId, mode, 'removable'),
      liftedParts: mode === 'fixed' ? { ...s.liftedParts, [partId]: false } : s.liftedParts,
    }))
  },
  setPartVisibility: (partId, v) => {
    if (!PART_VISIBILITY.includes(v)) return
    set((s) => ({ partVisibility: setSparse(s.partVisibility, partId, v, 'show') }))
  },
  resetParts: () => set({ partModes: {}, partVisibility: {} }),
  setPrintScale: (n) => { const v = Number(n); if (PRINT_SCALES.includes(v)) set({ printScale: v }) },
  setOpen: (open) => set({ open: !!open }),

  config: () => {
    const { labId, stageId, cutaway, partColors, labelsOn, partModes, partVisibility, printScale } = get()
    return { labId, stageId, cutaway, partColors, labelsOn, partModes, partVisibility, printScale }
  },

  hydrateFromSearchParams: (params) => {
    const p = typeof params?.get === 'function' ? params : new URLSearchParams(params)
    const labId = p.get('lab') && labs[p.get('lab')] ? p.get('lab') : 'kidney'
    const patch = { labId, partColors: defaultColors(labId), partModes: {}, partVisibility: {} }
    const stageId = p.get('stage')
    if (stageId && labs[labId].stages?.some((s) => s.id === stageId)) patch.stageId = stageId
    else if (!labs[labId].stages?.some((s) => s.id === get().stageId)) patch.stageId = labs[labId].stages?.[0]?.id ?? null
    // Old /learn QR codes also carry goal and audience; they are ignored.
    const views = labs[labId].cutaways?.map((c) => c.id) ?? ['full']
    patch.cutaway = views.includes(p.get('cutaway')) ? p.get('cutaway') : views[0]   // share URLs omit the default view
    if (p.get('labels')) patch.labelsOn = p.get('labels') !== '0'
    const colors = p.get('colors')
    if (colors) { try { patch.partColors = { ...patch.partColors, ...JSON.parse(atob(colors)) } } catch {} }
    // Part settings (all optional, so older QR codes still work): fixed=a,b  hide=c  xray=d
    for (const id of idList(p, 'fixed', labId)) patch.partModes[id] = 'fixed'
    for (const id of idList(p, 'xray', labId)) patch.partVisibility[id] = 'xray'
    for (const id of idList(p, 'hide', labId)) patch.partVisibility[id] = 'hide'
    set(patch)
  },
}))
