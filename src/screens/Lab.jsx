import { useEffect, useLayoutEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLabStore } from '@/store/labStore'
import { labs } from '@/data/labs'
import ModelCanvas from '@/scenes/ModelCanvas'
import { downloadKit } from '@/lib/kit'
import { usePrintReport } from '@/lib/usePrintReport'
import { PRINT_ASSUMPTIONS } from '@/lib/printReport'
import { viewUrl, shareIsLocalOnly } from '@/lib/share'
import KitQR from '@/components/KitQR'
import PartControls from '@/components/PartControls'
import { Chip, Header, Hint, Icon, LesionDot, Panel, Segmented, Spinner, Toggle, ViewerFrame, StagePicker, isLesion, theme } from '@/components/LabUI'

function formatMinutes(value) {
  if (!Number.isFinite(value)) return '—'
  const h = Math.floor(value / 60), m = Math.round(value % 60)
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}


function PrintSummary({ report }) {
  if (report === null) return <p className="flex items-center gap-2 text-sm text-ink-soft"><Spinner/>Calculating print estimate…</p>
  if (!report?.parts?.length) return <p className="text-sm text-ink-soft">Print estimates appear once the model has loaded.</p>
  const a = PRINT_ASSUMPTIONS
  return <div>
    <dl className="print-totals grid grid-cols-3 divide-x divide-line rounded-xl border border-line">
      {[['Print time', formatMinutes(report.totalMinutes)], ['Filament', Number.isFinite(report.totalGrams) ? `${report.totalGrams} g` : '—'], ['Est. cost', Number.isFinite(report.costUsd) ? `$${report.costUsd.toFixed(2)}` : '—']].map(([k, v]) =>
        <div key={k} className="min-w-0 px-2.5 py-3 sm:px-3"><dt className="text-[11px] font-medium text-ink-soft">{k}</dt><dd className="mt-1 whitespace-nowrap font-mono text-[13px] font-semibold tracking-tight sm:text-[15px]">{v}</dd></div>)}
    </dl>
    <table className="mt-4 w-full text-sm">
      <caption className="sr-only">Parts in this kit</caption>
      <thead><tr className="text-left text-[11px] text-ink-soft"><th scope="col" className="pb-1.5 font-medium">Part</th><th scope="col" className="pb-1.5 text-right font-medium">Filament</th><th scope="col" className="pb-1.5 text-right font-medium">Time</th></tr></thead>
      <tbody className="divide-y divide-line border-t border-line">
        {report.parts.map((p, i) => <tr key={`${p.id}-${i}`}>
          <td className="py-2 pr-2"><span className="mr-2 font-mono text-[11px] text-ink-soft">{String(i + 1).padStart(2, '0')}</span>{p.name}</td>
          <td className="whitespace-nowrap py-2 text-right font-mono text-[13px]">{p.grams} g</td>
          <td className="whitespace-nowrap py-2 pl-3 text-right font-mono text-[13px]">{formatMinutes(p.minutes)}</td>
        </tr>)}
      </tbody>
    </table>
    <PrintNotes report={report}/>
    <p className="mt-3 text-xs text-ink-soft">Estimate for {a.material}, {a.layerMm} mm layers, {a.infillPct}% infill. Your slicer will differ.</p>
  </div>
}

// Supports and bed-size notes under the estimate. The kit card has the full instructions; this only
// flags what changes the print (supports, or a part too big for a common bed at this scale).
function PrintNotes({ report }) {
  const big = report.parts.filter((p) => report.oversize?.includes(p.id))
  const supported = report.parts.filter((p) => p.supports).map((p) => p.name)
  const fused = report.fused?.length > 0
  if (!big.length && !supported.length && !fused) return null
  return <ul className="mt-3 space-y-1.5 text-xs leading-relaxed">
    {big.map((p) => <li key={`big-${p.id}`} className="rounded-md border border-ink/25 bg-bench px-2.5 py-1.5 text-ink"><span className="font-semibold">Larger than a {report.bedMm} mm bed:</span> {p.name} is {p.sizeMm.join(' × ')} mm at this scale. Use a smaller scale or a larger printer.</li>)}
    {supported.length > 0 && <li className="text-ink-soft"><span className="font-semibold text-ink">Supports:</span> {supported.join(', ')}.</li>}
    {fused && <li className="text-ink-soft"><span className="font-semibold text-ink">Fused parts:</span> if they reach below the base, the fused STL rests on them and needs supports. The kit card says when.</li>}
  </ul>
}

function DownloadKit({ stageId, cutaway }) {
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  useEffect(() => { setState((s) => (s === 'pending' ? s : 'idle')); setError('') }, [stageId, cutaway])
  async function run() {
    if (state === 'pending') return
    setError(''); setState('pending')
    try { await downloadKit(); setState('done') }
    catch (e) { setState('error'); setError(e?.message || 'Please try again.') }
  }
  return <div>
    <button type="button" onClick={run} disabled={state === 'pending'} aria-busy={state === 'pending'} className={`${theme.primary} w-full`}>
      {state === 'pending' ? <><Spinner/>Preparing kit…</> : state === 'done' ? <><Icon name="download" className="h-4 w-4"/>Download again</> : <><Icon name="download" className="h-4 w-4"/>Download kit</>}
    </button>
    <div aria-live="polite" className="mt-2.5 min-h-5 text-sm">
      {state === 'idle' && <p className="text-ink-soft">STL for every part, label tiles and a kit card PDF, in one zip.</p>}
      {state === 'pending' && <p className="text-ink-soft">Packing STLs and writing the kit card…</p>}
      {state === 'done' && <p className="flex items-center gap-1.5 font-medium text-teal"><Icon name="check" className="h-4 w-4"/>Kit downloaded. Check your downloads folder.</p>}
    </div>
    {state === 'error' && <div role="alert" className="mt-1 flex gap-2.5 rounded-xl border border-ink/25 bg-bench px-3.5 py-3 text-sm text-ink">
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0"/><div><p className="font-semibold">The kit could not be built.</p><p className="mt-0.5 break-words">{error}</p><button type="button" onClick={run} className="mt-1.5 font-semibold underline underline-offset-4">Try again</button></div>
    </div>}
  </div>
}

export default function Lab() {
  const { labId } = useParams()
  const lab = labs[labId]
  const stageId = useLabStore((s) => s.stageId), setStage = useLabStore((s) => s.setStage)
  const cutaway = useLabStore((s) => s.cutaway), setCutaway = useLabStore((s) => s.setCutaway)
  const partColors = useLabStore((s) => s.partColors), setPartColor = useLabStore((s) => s.setPartColor), resetColors = useLabStore((s) => s.resetColors)
  const labelsOn = useLabStore((s) => s.labelsOn), setLabelsOn = useLabStore((s) => s.setLabelsOn)
  const exploded = useLabStore((s) => s.exploded), setExploded = useLabStore((s) => s.setExploded)
  const setLab = useLabStore((s) => s.setLab), storeLabId = useLabStore((s) => s.labId)
  // The share link and QR carry part settings, so re-render when they change.
  useLabStore((s) => s.partModes); useLabStore((s) => s.partVisibility)
  // The route picks the lab (setLab is a no-op when it's already current, so settings survive remounts).
  useLayoutEffect(() => { if (lab && !lab.comingSoon) setLab(labId) }, [labId, lab, setLab])
  // Print estimate follows stage, view, part modes, visibility and print scale.
  const report = usePrintReport()

  if (!lab || lab.comingSoon) return <div className={theme.page}><Header/>
    <main className={`${theme.wrap} py-20`}><p className={`${theme.tag} text-ink-soft`}>{lab ? 'In development' : 'Not found'}</p><h1 className="mt-2 text-3xl font-bold tracking-[-0.03em]">{lab ? `The ${lab.name.toLowerCase()} lab isn’t ready yet` : 'Lab unavailable'}</h1><p className="mt-3 text-ink-soft">Choose an available lab to build a model.</p><Link to="/" className={`${theme.primary} mt-6`}><Icon name="back" className="h-4 w-4"/>Back to labs</Link></main>
  </div>

  if (storeLabId !== labId) return <div className={theme.page}><Header badge="Model builder"/><main className={`${theme.wrap} py-16`}><p role="status" className="flex items-center gap-2 text-sm text-ink-soft"><Spinner/>Loading {lab.name.toLowerCase()} lab…</p></main></div>
  const stage = lab.stages.find((s) => s.id === stageId) || lab.stages[0]
  const view = lab.cutaways?.find((c) => c.id === cutaway) ?? lab.cutaways?.[0]
  const shareUrl = viewUrl()
  const localOnly = shareIsLocalOnly()
  const colourParts = lab.parts.filter((p) => p.removable && !p.noColour)   // the front half is shown in the colours of what it holds
  const coloursChanged = colourParts.some((p) => partColors?.[p.id] && partColors[p.id].toLowerCase() !== p.defaultColor.toLowerCase())

  return <div className={theme.page}><Header badge="Model builder"/>
    <main className={`${theme.wrap} workspace-main pb-16 pt-6`}>
      <nav aria-label="Breadcrumb" className="workspace-breadcrumb mb-5 text-xs"><ol className="flex items-center gap-2 text-ink-soft"><li><Link to="/" className={theme.link}>Labs</Link></li><li aria-hidden="true">/</li><li aria-current="page" className="font-medium text-ink">{lab.name}</li></ol></nav>
      <div className="workspace-heading mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0"><h1 className="lab-page-title font-semibold tracking-[-0.04em]">{lab.name}</h1>{lab.condition && <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-ink-soft"><LesionDot className="mt-2"/>{lab.condition}</p>}</div>
        {lab.description && <p className="max-w-[30rem] text-sm leading-[1.7] text-ink-soft">{lab.description}</p>}
      </div>

      <div className="workspace-grid grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px] xl:gap-6">
        <section aria-label="Interactive 3D model" className="workspace-viewer min-w-0">
          <ViewerFrame className="h-[58vh] max-h-[560px] min-h-[340px] lg:h-[calc(100vh-120px)] lg:max-h-[820px]"
            topLeft={<><Toggle label="Labels" icon="tag" checked={labelsOn} onChange={setLabelsOn}/><Toggle label="Explode" icon="layers" checked={exploded} onChange={setExploded}/></>}
            topRight={<div className="hidden flex-col items-end gap-1.5 sm:flex"><Chip tone={isLesion(stage) ? 'lesion' : 'plain'}>{isLesion(stage) && <LesionDot/>}{stage.ajcc ?? stage.label}</Chip><Chip>{view?.label}</Chip></div>}
            bottom={<Hint>Drag to rotate · tap a part to lift it</Hint>}>
            <ModelCanvas/>
          </ViewerFrame>
        </section>

        <div className="workspace-sidebar space-y-4">
          <Panel step="01" title="Configure" id="configure">
            <div className="space-y-5">
              <StagePicker stages={lab.stages} value={stage.id} onChange={setStage}/>
              {lab.cutaways?.length > 1 && <Segmented label="View" options={lab.cutaways} value={cutaway} onChange={setCutaway}/>}
            </div>
          </Panel>

          <Panel step="02" title="Readout" id="readout" aside={<Chip tone={isLesion(stage) ? 'lesion' : 'plain'}>{stage.ajcc ? `AJCC ${stage.ajcc}` : stage.label}</Chip>}>
            <div aria-live="polite">
              {stage.readout && <p className={theme.prose}>{stage.readout}</p>}
              {stage.teaching && <div className="teaching-note mt-5"><p className="text-xs font-semibold uppercase tracking-[0.06em] text-teal">Teaching note</p><p className="mt-2 text-sm leading-[1.7] text-ink-soft">{stage.teaching}</p></div>}
            </div>
          </Panel>

          <Panel step="03" title="Part colours" id="colours" aside={coloursChanged && <button type="button" onClick={resetColors} className={`${theme.link} text-xs`}><Icon name="reset" className="h-3.5 w-3.5"/>Reset</button>}>
            <p className="-mt-2 mb-3 text-xs text-ink-soft">Match these to your filament so the screen and the printed kit agree.</p>
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-x-3 lg:grid-cols-1">
              {colourParts.map((p) => {
                const value = partColors?.[p.id] || p.defaultColor
                return <li key={p.id}><label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 transition hover:border-line hover:bg-bench focus-within:border-teal">
                  <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md shadow-[inset_0_0_0_1px_rgba(22,33,43,0.15)]" style={{ background: value }}>
                    <input type="color" aria-label={`${p.name} colour`} value={value} onChange={(e) => setPartColor(p.id, e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"/>
                  </span>
                  <span className="min-w-0 flex-1 text-sm leading-tight">{p.name}</span>
                  <span className="font-mono text-[10.5px] uppercase text-ink-soft">{value.replace('#', '')}</span>
                </label></li>
              })}
            </ul>
          </Panel>

          <PartControls step="04"/>

          <Panel step="05" title="Print kit" id="print" aside={<Icon name="print" className="h-4 w-4 text-ink-soft"/>}>
            <DownloadKit stageId={stageId} cutaway={cutaway}/>
            <div className="mt-5 border-t border-line pt-5"><h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-ink-soft">Print summary</h3><PrintSummary report={report}/></div>
          </Panel>

          <Panel step="06" title="Share with students" id="share" aside={<Icon name="phone" className="h-4 w-4 text-ink-soft"/>}>
            <div className="flex flex-wrap items-start gap-5">
              <div className="share-qr shrink-0 rounded-xl border border-line bg-white p-1.5" role="img" aria-label="QR code that opens this model on a phone"><KitQR size={132}/></div>
              <div className="min-w-0 flex-1 basis-44">
                <p className="text-sm leading-relaxed text-ink-soft">The same QR is printed on the kit card. It opens this exact configuration on a phone, with no sign-in.</p>
                <a href={shareUrl} className={`${theme.link} mt-3 text-sm`}>Open shareable view<Icon name="external" className="h-4 w-4"/></a>
                <p className="mt-2 break-all font-mono text-[11px] leading-snug text-ink-soft">{shareUrl}</p>
              </div>
            </div>
            {localOnly && <div role="note" className="mt-4 flex gap-2.5 rounded-xl border border-[#e9c46a] bg-[#fdf6e3] px-3.5 py-3 text-sm text-[#7a5a00]">
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0"/><p><span className="font-semibold">This QR points to localhost,</span> which phones can’t open. Set <code className="font-mono text-[12px]">VITE_PUBLIC_ORIGIN</code> to your LAN or deployed address.</p>
            </div>}
          </Panel>
        </div>
      </div>
    </main>
  </div>
}
