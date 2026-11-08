import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLabStore } from '@/store/labStore'
import { labs } from '@/data/labs'
import ModelCanvas from '@/scenes/ModelCanvas'
import { downloadKit, getPrintReport } from '@/lib/kit'
import { learnUrl, shareIsLocalOnly } from '@/lib/share'
import KitQR from '@/components/KitQR'
import { Header, Icon, Segment, Toggle, theme } from '@/components/LabUI'

function SelectField({ label, value, onChange, options }) {
  return <label className="block"><span className="mb-2 block text-sm font-bold">{label}</span><select value={value ?? ''} onChange={event => onChange(event.target.value)} className="w-full rounded-lg border border-[#d8e1da] bg-[#ffffff] px-3 py-2.5 text-sm text-[#365347] outline-none focus:border-[#176b61] focus:ring-2 focus:ring-[#d8eadd]">{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
}
function formatMinutes(value) {
  if (!Number.isFinite(value)) return '—'
  const hours = Math.floor(value / 60), minutes = Math.round(value % 60)
  return hours ? `${hours} hr ${minutes} min` : `${minutes} min`
}
function PrintSummary({ report }) {
  if (!report) return <p className="text-sm text-[#6a7970]">Print estimates are unavailable right now.</p>
  return <div className="space-y-3"><dl className="grid grid-cols-3 gap-2 text-sm"><div><dt className="text-xs text-[#817a73]">Print time</dt><dd className="mt-1 font-semibold">{formatMinutes(report.totalMinutes)}</dd></div><div><dt className="text-xs text-[#817a73]">Material</dt><dd className="mt-1 font-semibold">{Number.isFinite(report.totalGrams) ? `${report.totalGrams} g` : '—'}</dd></div><div><dt className="text-xs text-[#817a73]">Est. cost</dt><dd className="mt-1 font-semibold">{Number.isFinite(report.costUsd) ? `$${report.costUsd.toFixed(2)}` : '—'}</dd></div></dl>{report.parts?.length > 0 && <details className="text-xs text-[#706a66]"><summary className="cursor-pointer font-semibold text-[#176b61]">View parts</summary><ul className="mt-2 space-y-1.5">{report.parts.map(part => <li key={part.id} className="flex justify-between gap-2"><span>{part.name}</span><span>{part.grams} g · {formatMinutes(part.minutes)}</span></li>)}</ul></details>}</div>
}
export default function Lab() {
  const { labId } = useParams()
  const lab = labs[labId]
  const stageId = useLabStore(s => s.stageId), setStage = useLabStore(s => s.setStage)
  const cutaway = useLabStore(s => s.cutaway), setCutaway = useLabStore(s => s.setCutaway)
  const partColors = useLabStore(s => s.partColors), setPartColor = useLabStore(s => s.setPartColor)
  const labelsOn = useLabStore(s => s.labelsOn), setLabelsOn = useLabStore(s => s.setLabelsOn)
  const goal = useLabStore(s => s.goal), setGoal = useLabStore(s => s.setGoal)
  const audience = useLabStore(s => s.audience), setAudience = useLabStore(s => s.setAudience)
  const exploded = useLabStore(s => s.exploded), setExploded = useLabStore(s => s.setExploded)
  const [downloadState, setDownloadState] = useState('idle')
  const [downloadError, setDownloadError] = useState('')
  // Report comes from the print-ready STLs (or, without them, the scene once it has loaded); refresh on stage/view change.
  const [report, setReport] = useState(null)
  useEffect(() => {
    let tries = 0, timer, alive = true
    const tick = async () => {
      try { const r = await getPrintReport(); if (!alive) return; setReport(r); if (r.parts.length === 0 && tries++ < 40) timer = setTimeout(tick, 250) }
      catch { if (alive && tries++ < 40) timer = setTimeout(tick, 250) }
    }
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [stageId, cutaway])
  if (!lab || lab.comingSoon) return <div className={theme.page}><Header/><main className="mx-auto max-w-2xl px-6 py-20"><h1 className="text-3xl font-bold">Lab unavailable</h1><p className="mt-3 text-[#716b67]">This lab is not available yet.</p><Link to="/" className={`${theme.secondary} mt-6`}>Back to labs</Link></main></div>
  const stage = lab.stages.find(item => item.id === stageId) || lab.stages[0]
  const studentUrl = learnUrl()
  async function handleDownload() {
    if (downloadState === 'pending') return
    setDownloadError(''); setDownloadState('pending')
    try { await downloadKit(); setDownloadState('done') }
    catch (error) { setDownloadState('error'); setDownloadError(error?.message || 'Please try again.') }
  }
  return <div className={theme.page}><Header/><main className="mx-auto max-w-[1600px] px-4 pb-10 pt-5 sm:px-6 lg:px-8">
    <div className="mb-4 flex flex-wrap items-center gap-3 text-sm"><Link to="/" className="inline-flex items-center gap-1 font-semibold text-[#176b61] hover:underline"><Icon name="back" className="h-4 w-4"/>All labs</Link><span className="text-[#d1cac5]">/</span><span className={`${theme.eyebrow} text-[#6a7970]`}>{lab.name}{lab.condition ? ` / ${lab.condition}` : ''}</span></div>
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className={`${theme.eyebrow} mb-2 !text-[#176b61]`}>The anatomy studio</p><h1 className="font-serif text-4xl tracking-[-0.04em] text-[#173f38] sm:text-5xl">{lab.name}<span className="ml-3 font-sans text-sm font-medium tracking-normal text-[#6a7970]">/ Model builder</span></h1></div><p className="max-w-md text-sm leading-relaxed text-[#6a7970]">{lab.description}</p></div>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_430px]">
      <section aria-label="Interactive anatomy model" className={`${theme.card} overflow-hidden p-2 sm:p-3 lg:sticky lg:top-5`}><div className="relative overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_center,#f4f6ed_0%,#e3ebdc_100%)]"><span aria-hidden="true" className="pointer-events-none absolute right-5 top-6 hidden xl:block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#63765e]">3D / Interactive</span><div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2 sm:left-4 sm:top-4"><Toggle label="Labels" icon="tag" checked={labelsOn} onChange={setLabelsOn}/><Toggle label="Explode" icon="layers" checked={exploded} onChange={setExploded}/></div><p className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full bg-[#ffffff]/90 px-3 py-1.5 text-xs font-medium text-[#5c7164] sm:bottom-4 sm:left-4">Drag to rotate · Click a part to lift</p><div className="h-[420px] w-full sm:h-[540px] lg:h-[calc(100vh-220px)] lg:min-h-[560px]"><ModelCanvas/></div></div></section>
      <aside className={`${theme.card} p-5 sm:p-6`}><div className="mb-6"><p className={`${theme.eyebrow} mb-1 text-[#176b61]`}>01 / Configure</p><h2 className="font-serif text-3xl tracking-[-0.04em]">Customize model</h2></div>
        <div className="space-y-7"><Segment label="Tumor stage" options={lab.stages} value={stageId} onChange={setStage}/><Segment label="View" options={lab.cutaways} value={cutaway} onChange={setCutaway}/>
          <div><h2 className="mb-3 text-sm font-bold">Part colors</h2><div className="space-y-2">{lab.parts.filter(part => part.removable).map(part => <label key={part.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[#e4eae3] bg-[#f7f9f4] px-3 py-2"><span className="text-sm font-medium">{part.name}</span><input type="color" aria-label={`${part.name} color`} value={partColors?.[part.id] || part.defaultColor || '#c87970'} onChange={event => setPartColor(part.id, event.target.value)} className="h-8 w-9 cursor-pointer rounded border-0 bg-transparent p-0"/></label>)}</div></div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"><SelectField label="Teaching goal" value={goal} onChange={setGoal} options={lab.goals}/><SelectField label="Audience" value={audience} onChange={setAudience} options={lab.audiences}/></div>
          {stage?.readout && <div className="rounded-xl bg-[#e8eee5] p-4"><p className="mb-1 text-sm font-bold text-[#385b4a]">Stage readout</p><p className="text-sm leading-relaxed text-[#374c41]">{stage.readout}</p></div>}
          <div><button type="button" onClick={handleDownload} disabled={downloadState === 'pending'} className={`${theme.primary} w-full`}><Icon name="download" className="h-4 w-4"/>{downloadState === 'pending' ? 'Preparing kit…' : downloadState === 'done' ? 'Download again' : 'Download kit'}</button><div aria-live="polite">{downloadState === 'done' && <p className="mt-2 text-xs text-[#49705a]">Your kit is ready.</p>}{downloadState === 'error' && <p role="alert" className="mt-2 text-xs text-[#b34235]">Could not download kit. {downloadError}</p>}</div></div>
          <div className="border-t border-[#e0e7df] pt-5"><div className="mb-4 flex items-center gap-2"><Icon name="print" className="h-4 w-4 text-[#176b61]"/><h2 className="text-sm font-bold">Print summary</h2></div><PrintSummary report={report}/></div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#e0e7df] pt-5"><div className="min-w-0 flex-1 basis-40"><p className="text-sm font-bold">Share the student view</p><p className="mt-1 text-xs leading-relaxed text-[#6a7970]">Open this model and lesson on another device.</p>{shareIsLocalOnly() && <p className="mt-1 text-xs leading-relaxed text-[#b34235]">This QR points to localhost. Set VITE_PUBLIC_ORIGIN so phones can open it.</p>}<a href={studentUrl} className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-[#176b61] hover:underline">Open student view <Icon name="arrow" className="h-4 w-4"/></a></div><div className="shrink-0 rounded-lg bg-white p-1" aria-label="QR code for student view"><KitQR/></div></div>
        </div>
      </aside>
    </div>
  </main></div>
}
