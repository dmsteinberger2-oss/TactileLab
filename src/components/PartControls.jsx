import { useEffect, useState } from 'react'
import { useLabStore, PRINT_SCALES } from '@/store/labStore'
import { getKitParts } from '@/lib/kit'
import { usePrintReport } from '@/lib/usePrintReport'
import { Chip, Icon, Panel, Segmented, Spinner, theme } from '@/components/LabUI'

// Per-part kit settings for the current lab, stage and view, plus the print size.
// Self-contained: reads and writes the store; drop it into the Lab screen's control column, e.g.
//   <PartControls step="04"/>   (props: step, title, id, className — all optional)
// Lists the parts the kit would contain (the print manifest for this stage and view, else the scene).
// The base part can't be fixed or hidden; the coronal front half can't be fixed (it would close the section).

const PRINT_SIZES = { 1: 'life size', 1.5: '3.4× filament', 2: '8× filament' }

// Compact single-choice control, styled like LabUI's Segmented.
function Choice({ label, options, value, onChange, disabled }) {
  return <div role="radiogroup" aria-label={label} className="part-choices grid gap-1 rounded-lg bg-bench p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map((o) => {
      const on = value === o.id, off = disabled || o.disabled
      return <button key={o.id} type="button" role="radio" aria-checked={on} disabled={off} title={o.title} onClick={() => onChange(o.id)}
        className={`part-choice min-w-0 break-words rounded-md px-1 py-1.5 text-xs font-semibold leading-snug transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal disabled:cursor-not-allowed ${on ? 'bg-paper text-teal shadow-[0_1px_3px_rgba(22,33,43,0.08),0_0_0_1px_rgba(15,118,110,0.35)]' : 'text-ink-soft hover:bg-paper/60 hover:text-ink disabled:hover:bg-transparent disabled:hover:text-ink-soft'} ${off && !on ? 'opacity-45' : ''}`}>
        {o.label}
      </button>
    })}
  </div>
}

export default function PartControls({ step, title = 'Parts', id = 'parts', className = '' }) {
  const labId = useLabStore((s) => s.labId), stageId = useLabStore((s) => s.stageId), cutaway = useLabStore((s) => s.cutaway)
  const partModes = useLabStore((s) => s.partModes), setPartMode = useLabStore((s) => s.setPartMode)
  const partVisibility = useLabStore((s) => s.partVisibility), setPartVisibility = useLabStore((s) => s.setPartVisibility)
  const printScale = useLabStore((s) => s.printScale), setPrintScale = useLabStore((s) => s.setPrintScale)
  const resetParts = useLabStore((s) => s.resetParts)
  const report = usePrintReport()
  const [parts, setParts] = useState(null)

  useEffect(() => {
    let alive = true, tries = 0, timer
    setParts(null)
    const load = async () => {
      const list = await getKitParts({ labId, stageId, cutaway }).catch(() => [])
      if (!alive) return
      if (list.length || tries++ > 20) setParts(list); else timer = setTimeout(load, 300)   // scene still loading
    }
    load()
    return () => { alive = false; clearTimeout(timer) }
  }, [labId, stageId, cutaway])

  const base = parts?.find((p) => p.isBase)
  const baseName = base?.name ?? 'base part'
  const changed = parts?.some((p) => partModes[p.id] || partVisibility[p.id])
  const separate = new Set(report?.notFused ?? [])

  return <Panel step={step} title={title} id={id} className={className}
    aside={changed && <button type="button" onClick={resetParts} className={`${theme.link} text-xs`}><Icon name="reset" className="h-3.5 w-3.5"/>Reset</button>}>
    <p className="-mt-2 mb-3 text-xs text-ink-soft">Fixed parts print fused to the {baseName.toLowerCase()}. Hidden parts are left out of the kit and the student view. X-ray only changes the screen.</p>

    {parts === null && <p className="flex items-center gap-2 text-sm text-ink-soft"><Spinner/>Loading parts…</p>}
    {parts?.length === 0 && <p className="text-sm text-ink-soft">Parts appear once the model has loaded.</p>}
    {!!parts?.length && <>
      <div aria-hidden="true" className="hidden grid-cols-2 gap-2 border-b border-line pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft min-[400px]:grid">
        <span>Attachment</span><span>Visibility</span>
      </div>
      <ul className="divide-y divide-line">
        {parts.map((p) => {
          const mode = partModes[p.id] ?? 'removable', vis = partVisibility[p.id] ?? 'show'
          const hidden = vis === 'hide'
          const note = p.isBase ? `Fixed parts fuse into the ${baseName.toLowerCase()}.`
            : hidden ? 'Left out of the kit.'
            : mode === 'fixed' && separate.has(p.id) ? `Doesn’t touch the ${baseName.toLowerCase()}, so it still prints separately.`
            : !p.canFix ? 'Always prints separately so the section stays visible.'
            : null
          return <li key={p.id} className="part-row">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className={`min-w-0 text-sm font-medium leading-tight ${hidden ? 'text-ink-soft line-through decoration-ink-soft/50' : ''}`}>{p.name}</span>
              {p.isBase && <Chip tone="teal">Base</Chip>}
              {!p.isBase && mode === 'fixed' && !hidden && <Chip>{separate.has(p.id) ? 'Separate' : 'Fused'}</Chip>}
            </div>
            <div className="grid grid-cols-1 gap-1.5 min-[400px]:grid-cols-2 min-[400px]:gap-2">
              <Choice label={`${p.name}: attachment`} value={p.isBase ? 'fixed' : mode} onChange={(m) => setPartMode(p.id, m)} disabled={p.isBase || hidden}
                options={[{ id: 'removable', label: 'Removable', disabled: p.isBase }, { id: 'fixed', label: 'Fixed', disabled: !p.canFix, title: p.canFix ? undefined : p.isBase ? 'This is the base part' : 'This part always prints separately' }]}/>
              <Choice label={`${p.name}: visibility`} value={vis} onChange={(v) => setPartVisibility(p.id, v)}
                options={[{ id: 'show', label: 'Show' }, { id: 'hide', label: 'Hide', disabled: !p.canHide, title: p.canHide ? undefined : 'The base part is always shown' }, { id: 'xray', label: 'X-ray' }]}/>
            </div>
            {note && <p className="mt-1.5 text-xs text-ink-soft">{note}</p>}
          </li>
        })}
      </ul>
    </>}

    <div className="mt-4 border-t border-line pt-4">
      <Segmented label="Print size" value={printScale} onChange={setPrintScale}
        options={PRINT_SCALES.map((s) => ({ id: s, label: `${s}×`, sub: PRINT_SIZES[s] }))}/>
      <p className="mt-2 text-xs text-ink-soft">Scales every STL in the kit; filament and print time grow with the cube of the size.</p>
    </div>
  </Panel>
}
