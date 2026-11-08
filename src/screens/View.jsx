import { useLayoutEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLabStore } from '@/store/labStore'
import { labs } from '@/data/labs'
import ModelCanvas from '@/scenes/ModelCanvas'
import { Chip, Header, Hint, Icon, LesionDot, Segmented, Spinner, Toggle, ViewerFrame, hasSizes, stageOptions, theme } from '@/components/LabUI'

// What the kit's QR opens, usually on a phone: the model, stage and view, explode, and the tapped part.
export default function View() {
  const [searchParams] = useSearchParams()
  const hydrate = useLabStore((s) => s.hydrateFromSearchParams)
  const labId = useLabStore((s) => s.labId)
  const stageId = useLabStore((s) => s.stageId), setStage = useLabStore((s) => s.setStage)
  const cutaway = useLabStore((s) => s.cutaway), setCutaway = useLabStore((s) => s.setCutaway)
  const selectedPartId = useLabStore((s) => s.selectedPartId), selectPart = useLabStore((s) => s.selectPart)
  const exploded = useLabStore((s) => s.exploded), setExploded = useLabStore((s) => s.setExploded)
  const partColors = useLabStore((s) => s.partColors)
  const search = searchParams.toString()
  const [hydratedSearch, setHydratedSearch] = useState(null)
  useLayoutEffect(() => { hydrate(new URLSearchParams(search)); setHydratedSearch(search) }, [hydrate, search])

  const lab = labs[labId]
  const stage = lab?.stages?.find((s) => s.id === stageId) ?? lab?.stages?.[0]
  const view = lab?.cutaways?.find((c) => c.id === cutaway) ?? lab?.cutaways?.[0]
  const part = lab?.parts?.find((p) => p.id === selectedPartId)

  return <div className={theme.page}><Header badge="Shared model"/>
    <main className={`${theme.wrap} pb-14 pt-4 sm:pt-6`}>
      {hydratedSearch !== search ? <p role="status" className="flex items-center gap-2 py-16 text-sm text-ink-soft"><Spinner/>Loading model…</p>
      : !lab || lab.comingSoon ? <div className="py-16"><h1 className="text-2xl font-bold">Model unavailable</h1><p className="mt-2 text-sm text-ink-soft">This shared model could not be found.</p><Link to="/" className={`${theme.primary} mt-6`}>Browse labs</Link></div>
      : <>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className={`${theme.tag} text-teal`}>Shared model</p>
            <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-[-0.03em] sm:text-4xl">{lab.name}</h1>
            {lab.condition && <p className="mt-0.5 flex items-center gap-2 text-sm text-ink-soft"><LesionDot/>{lab.condition}</p>}
          </div>
          <div className="flex gap-1.5"><Chip tone={stage?.sizeCm > 0 ? 'lesion' : 'plain'}>{stage?.sizeCm > 0 && <LesionDot/>}{stage?.ajcc ?? stage?.label}</Chip>{view && <Chip>{view.label}</Chip>}</div>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5">
          <section aria-label="Interactive 3D model" className="lg:sticky lg:top-20">
            <ViewerFrame className="h-[56vh] max-h-[620px] min-h-[320px] lg:h-[calc(100vh-170px)] lg:max-h-none"
              topLeft={<Toggle label="Explode" icon="layers" checked={exploded} onChange={setExploded}/>}
              bottom={<Hint>Drag to rotate · tap a part</Hint>}>
              <ModelCanvas/>
            </ViewerFrame>
          </section>

          <div className="space-y-4">
            <section aria-label="Structure" aria-live="polite" className={`${theme.panel} p-5`}>
              {part ? <>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5"><span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgba(22,33,43,0.15)]" style={{ background: partColors?.[part.id] ?? part.defaultColor }}/><h2 className="text-lg font-bold leading-tight tracking-[-0.02em]">{part.name}</h2></div>
                  <button type="button" onClick={() => selectPart(null)} className={`${theme.link} shrink-0 text-xs`}>Clear</button>
                </div>
                <p className={`${theme.prose} mt-2.5`}>{part.tooltip}</p>
              </> : <div className="flex items-center gap-3 text-ink-soft"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bench text-teal"><Icon name="cube" className="h-5 w-5"/></span><p className="text-sm"><span className="font-semibold text-ink">Tap any structure</span> on the model to see what it is.</p></div>}
            </section>

            <section aria-label="Model controls" className={`${theme.panel} space-y-5 p-5`}>
              <Segmented label={hasSizes(lab.stages) ? 'Tumour stage' : 'Stage'} options={stageOptions(lab.stages)} value={stage.id} onChange={setStage} columns={lab.stages.length > 3 ? undefined : lab.stages.length}/>
              {lab.cutaways?.length > 1 && <Segmented label="View" options={lab.cutaways} value={cutaway} onChange={setCutaway}/>}
            </section>

            {stage?.readout && <section aria-labelledby="readout-title" className={`${theme.panel} p-5`}>
              <h2 id="readout-title" className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-soft">About this stage</h2>
              <p className={theme.prose}>{stage.readout}</p>
            </section>}
          </div>
        </div>
      </>}
    </main>
  </div>
}
