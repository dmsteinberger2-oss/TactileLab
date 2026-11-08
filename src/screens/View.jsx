import { useLayoutEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLabStore } from '@/store/labStore'
import { labs } from '@/data/labs'
import ModelCanvas from '@/scenes/ModelCanvas'
import { Header, Segment, Toggle, theme } from '@/components/LabUI'

export default function View() {
  const [searchParams] = useSearchParams()
  const hydrate = useLabStore(s => s.hydrateFromSearchParams)
  const labId = useLabStore(s => s.labId), stageId = useLabStore(s => s.stageId), setStage = useLabStore(s => s.setStage)
  const selectedPartId = useLabStore(s => s.selectedPartId), exploded = useLabStore(s => s.exploded), setExploded = useLabStore(s => s.setExploded)
  const search = searchParams.toString()
  const [hydratedSearch, setHydratedSearch] = useState(null)
  useLayoutEffect(() => { hydrate(new URLSearchParams(search)); setHydratedSearch(search) }, [hydrate, search])
  const lab = labs[labId]
  const selectedPart = lab?.parts?.find(part => part.id === selectedPartId)
  return <div className={theme.page}><Header student/><main className="mx-auto max-w-[1500px] px-4 pb-12 pt-8 sm:px-8 lg:px-10">
    {hydratedSearch !== search ? <p role="status" className="py-12 text-sm text-[#6a7970]">Loading model…</p> : !lab ? <div className="py-12"><h1 className="text-2xl font-bold">Lab unavailable</h1><p className="mt-2 text-sm text-[#6a7970]">This shared model could not be found.</p></div> : <>
      <div className="mb-8 border-b border-[#d8e1da] pb-7"><p className={`${theme.eyebrow} mb-2 text-[#176b61]`}>Student workspace</p><h1 className="font-serif text-4xl tracking-[-0.045em] text-[#173f38] sm:text-5xl">Explore the {lab.name.toLowerCase()}</h1>{lab.condition && <p className="mt-2 text-sm text-[#6a7970]">{lab.condition} · Student workspace</p>}</div>
      <div className="mx-auto max-w-4xl"><div className="space-y-4"><section aria-label="Interactive anatomy model" className={`${theme.card} overflow-hidden p-3 sm:p-4`}><div className="flex flex-wrap items-end justify-between gap-3"><div className="min-w-0 basis-full sm:flex-1 sm:basis-0"><Segment label="Stage" options={lab.stages} value={stageId} onChange={setStage}/></div><Toggle label="Explode" icon="layers" checked={exploded} onChange={setExploded}/></div><div className="relative mt-3 overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_center,#f4f6ed_0%,#e3ebdc_100%)]"><div className="h-[360px] sm:h-[470px] lg:h-[520px]"><ModelCanvas/></div><p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-[#ffffff]/90 px-3 py-1.5 text-xs text-[#5c7164]">Drag to rotate · Tap a part to explore</p></div>{!selectedPart && <div className="mt-4 rounded-xl border border-dashed border-[#cbd8c3] p-5"><p className="text-sm font-semibold text-[#3f614a]">Every structure has a story.</p><p className="mt-1 text-sm text-[#6a7970]">Select a part of the model to explore its anatomy.</p></div>}{selectedPart && <div className="mt-3 rounded-xl bg-[#e6eee1] p-4"><p className={`${theme.eyebrow} text-[#176b61]`}>Selected structure</p><h2 className="mt-1 text-lg font-bold tracking-[-0.025em]">{selectedPart.name}</h2><p className="mt-1 text-sm leading-relaxed text-[#4f6556]">{selectedPart.tooltip}</p></div>}</section></div></div>
    </>}
  </main></div>
}
