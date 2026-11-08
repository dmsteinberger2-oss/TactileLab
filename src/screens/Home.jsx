import { Link } from 'react-router-dom'
import { useProgress } from '@react-three/drei'
import { useLabStore } from '@/store/labStore'
import { labs } from '@/data/labs'
import ModelCanvas from '@/scenes/ModelCanvas'
import { Chip, Header, Icon, LesionDot, ViewerFrame, theme } from '@/components/LabUI'

const STEPS = [
  ['01', 'Configure', 'Choose the stage and view, recolour parts, and check it in 3D.'],
  ['02', 'Print', 'Download print-ready STLs and a kit card with settings and assembly.'],
  ['03', 'Share', 'A QR on the card opens the same model on any phone.'],
]

// Presentation-only loading state; the existing scene owns all model loading.
function HeroLoading({ lab }) {
  const { active, total } = useProgress()
  if (!active && total > 0) return null
  return <div className="hero-loading">
    <span className="hero-loading-ring"><Icon name="layers"/></span>
    <div>
      <p className="hero-loading-label">Preparing {lab.name.toLowerCase()} model</p>
      <p className="hero-loading-detail mt-2">Anatomy you can explore, then hold.</p>
    </div>
  </div>
}

function LabCard({ lab, index }) {
  const n = String(index + 1).padStart(2, '0')
  if (lab.comingSoon) {
    return <article aria-label={`${lab.name}, in development`} className="lab-card flex flex-col border border-dashed border-line bg-bench">
      <div className="flex items-center justify-between"><span className={`${theme.tag} text-ink-soft`}>{n}</span><Chip><Icon name="lock" className="h-3 w-3"/>In development</Chip></div>
      <h3 className="mt-8 text-xl font-bold tracking-[-0.02em] text-ink-soft">{lab.name}</h3>
      {lab.condition && <p className="mt-1 text-sm text-ink-soft">{lab.condition}</p>}
    </article>
  }
  return <Link to={`/lab/${encodeURIComponent(lab.id)}`} className={`${theme.panel} lab-card group flex flex-col transition hover:border-teal/50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal`}>
    <div className="flex items-center justify-between"><span className={`${theme.tag} text-teal`}>{n}</span><Chip tone="teal">Available</Chip></div>
    <h3 className="lab-card-title mt-7 font-semibold">{lab.name}</h3>
    {lab.condition && <p className="mt-2 flex items-start gap-2 text-sm font-medium leading-relaxed text-ink"><LesionDot className="mt-2"/>{lab.condition}</p>}
    {lab.description && <p className="lab-card-description mt-4 text-sm text-ink-soft">{lab.description}</p>}
    {lab.stages && <ul aria-label="Stages" className="lab-card-stages mt-5 flex flex-wrap gap-1.5">{stageChips(lab.stages).map((c) => <li key={c.key}><Chip className={c.dim ? 'opacity-80' : ''}>{c.label}</Chip></li>)}</ul>}
    <dl className="lab-card-stats mt-auto grid grid-cols-3 gap-3 pt-2 text-xs">
      <div><dt className="text-ink-soft">Stages</dt><dd className="mt-0.5 font-mono text-sm font-semibold">{lab.stages?.length ?? 0}</dd></div>
      <div><dt className="text-ink-soft">Views</dt><dd className="mt-0.5 font-mono text-sm font-semibold">{lab.cutaways?.length ?? 1}</dd></div>
      <div><dt className="text-ink-soft">Parts</dt><dd className="mt-0.5 font-mono text-sm font-semibold">{lab.parts?.length ?? 0}</dd></div>
    </dl>
    <span className="lab-card-action inline-flex items-center gap-1.5 text-sm font-semibold text-teal">Open lab<Icon name="arrow" className="h-4 w-4 transition group-hover:translate-x-0.5"/></span>
  </Link>
}


// Card chips: one per stage, or one per group ("Bosniak cysts · 5") once a lab groups its stages.
function stageChips(stages) {
  if (!stages.some((s) => s.group)) return stages.map((s) => ({ key: s.id, label: s.label, dim: !(s.lesion ?? s.sizeCm > 0) }))
  const out = []
  for (const s of stages) {
    const g = s.group ?? 'Other'
    const c = out.find((x) => x.key === g)
    if (c) c.n++; else out.push({ key: g, n: 1 })
  }
  return out.map((c) => ({ key: c.key, label: `${c.key} · ${c.n}` }))
}

export default function Home() {
  const all = Object.values(labs).sort((a, b) => Number(!!a.comingSoon) - Number(!!b.comingSoon))   // available labs first
  const featured = all.find((l) => !l.comingSoon)
  // The hero canvas shows whatever lab the store holds (the last one opened), so label it from the store.
  const shownId = useLabStore((s) => s.labId)
  const shown = labs[shownId] && !labs[shownId].comingSoon ? labs[shownId] : featured
  return <div className={theme.page}><Header/>
    <main>
      <section className={`${theme.wrap} hero-section grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14`}>
        <div>
          <p className={`${theme.tag} text-teal`}>Anatomy teaching models · print-ready</p>
          <h1 className="hero-title mt-5 font-semibold">TactileLab</h1>
          <p className="hero-copy mt-6 text-lg leading-[1.65] text-ink-soft">Build the anatomical teaching model your session needs in 3D, then print it as a kit your students can hold.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            {featured && <Link to={`/lab/${featured.id}`} className={theme.primary}>Open the {featured.name.toLowerCase()} lab<Icon name="arrow" className="h-4 w-4"/></Link>}
            <a href="#labs" className={`${theme.secondary} min-h-12 px-5`}>All labs</a>
          </div>
          <ol className="hero-steps mt-10 grid border-t border-line pt-6 sm:grid-cols-3">
            {STEPS.map(([n, t, d]) => <li key={n}><span className={`${theme.tag} text-teal`}>{n}</span><p className="mt-1 text-sm font-bold">{t}</p><p className="mt-1 text-[13px] leading-snug text-ink-soft">{d}</p></li>)}
          </ol>
        </div>
        {featured && <div className="hero-preview pointer-events-none rounded-[20px]" aria-hidden="true">
          <ViewerFrame className="h-[340px] sm:h-[440px] lg:h-[500px]"
            topLeft={<span className="rounded-md bg-[#14232c]/70 px-2.5 py-1.5 text-xs font-medium tracking-wide text-[#e2eceb] backdrop-blur">Anatomical preview</span>}
            topRight={<span className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-[#14232c]/70 px-2.5 py-1.5 text-xs font-medium text-[#e2eceb] backdrop-blur"><span className="h-1.5 w-1.5 rounded-full bg-[#9ac1b7]"/>Live model</span>}
            bottom={<><Chip><LesionDot/>{shown.name} · {shown.condition}</Chip></>}>
            <ModelCanvas/>
            <HeroLoading lab={shown}/>
          </ViewerFrame>
        </div>}
      </section>

      <section id="labs" aria-labelledby="labs-title" className="collection-section border-t border-line py-10 sm:py-14">
        <div className={theme.wrap}>
          <div className="collection-heading mb-7 flex items-end justify-between gap-4">
            <div><p className={`${theme.tag} text-teal`}>Collection</p><h2 id="labs-title" className="mt-2 text-[28px] font-semibold tracking-[-0.035em]">Labs</h2></div>
            <p className="text-sm text-ink-soft">{all.filter((l) => !l.comingSoon).length} available · {all.filter((l) => l.comingSoon).length} in development</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{all.map((lab, i) => <LabCard key={lab.id} lab={lab} index={i}/>)}</div>
        </div>
      </section>

      <footer className={`${theme.wrap} flex flex-wrap items-center justify-between gap-3 py-8 text-xs text-ink-soft`}>
        <span>TactileLab · HackRPI 2026</span><span>Kits, models and app content: CC BY 4.0</span>
      </footer>
    </main>
  </div>
}
