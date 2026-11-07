import { create } from 'zustand'
import { labs } from '@/data/labs'

const defaultColors = (labId) =>
  Object.fromEntries((labs[labId]?.parts ?? []).map((p) => [p.id, p.defaultColor]))

export const useLabStore = create((set, get) => ({
  labId: 'kidney',
  stageId: 't1b',
  cutaway: 'full',
  partColors: defaultColors('kidney'),
  labelsOn: true,
  goal: 'staging',
  audience: 'clinical',
  selectedPartId: null,
  exploded: false,
  compareNormal: false,
  liftedParts: {},

  setLab: (labId) => set({ labId, stageId: labs[labId]?.stages?.[0]?.id ?? null, partColors: defaultColors(labId), selectedPartId: null, exploded: false, liftedParts: {} }),
  setStage: (stageId) => set({ stageId, selectedPartId: null, liftedParts: {} }),
  setCutaway: (cutaway) => set({ cutaway }),
  setPartColor: (partId, hex) => set((s) => ({ partColors: { ...s.partColors, [partId]: hex } })),
  resetColors: () => set((s) => ({ partColors: defaultColors(s.labId) })),
  setLabelsOn: (labelsOn) => set({ labelsOn }),
  setGoal: (goal) => set({ goal }),
  setAudience: (audience) => set({ audience }),
  selectPart: (selectedPartId) => set({ selectedPartId }),
  setExploded: (exploded) => set({ exploded, liftedParts: {} }),
  setCompareNormal: (compareNormal) => set({ compareNormal }),
  toggleLift: (partId) => set((s) => ({ liftedParts: { ...s.liftedParts, [partId]: !s.liftedParts[partId] } })),

  config: () => {
    const { labId, stageId, cutaway, partColors, labelsOn, goal, audience } = get()
    return { labId, stageId, cutaway, partColors, labelsOn, goal, audience }
  },

  hydrateFromSearchParams: (params) => {
    const p = typeof params?.get === 'function' ? params : new URLSearchParams(params)
    const labId = p.get('lab') && labs[p.get('lab')] ? p.get('lab') : 'kidney'
    const patch = { labId, partColors: defaultColors(labId) }
    const stageId = p.get('stage')
    if (stageId && labs[labId].stages?.some((s) => s.id === stageId)) patch.stageId = stageId
    for (const k of ['cutaway', 'goal', 'audience']) if (p.get(k)) patch[k] = p.get(k)
    if (p.get('labels')) patch.labelsOn = p.get('labels') !== '0'
    const colors = p.get('colors')
    if (colors) { try { patch.partColors = { ...patch.partColors, ...JSON.parse(atob(colors)) } } catch {} }
    set(patch)
  },
}))
