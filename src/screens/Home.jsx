import { Link } from 'react-router-dom'
import { useLabStore } from '@/store/labStore'
import { labs } from '@/data/labs'
import ModelCanvas from '@/scenes/ModelCanvas'
import { Chip, Header, Icon, LesionDot, ViewerFrame, theme } from '@/components/LabUI'

const STEPS = [
  ['01', 'Configure', 'Choose the stage and view, recolour parts, and check it in 3D.'],
  ['02', 'Print', 'Download print-ready STLs and a kit card with settings and assembly.'],
  ['03', 'Share', 'A QR on the card opens the same model on any phone.'],
]

function LabCard({ lab, index }) {
  const n = String(index + 1).padStart(2, '0')
  if (lab.comingSoon) {
    return <article aria-label={`${lab.name}, in development`} className="flex flex-col rounded-2xl border border-dashed border-line bg-bench p-5">
      <div className="flex items-center justify-between"><span className={`${theme.tag} text-ink-soft`}>{n}</span><Chip><Icon name="lock" className="h-3 w-3"/>In development</Chip></div>
      <h3 className="mt-8 text-xl font-bold tracking-[-0.02em] text-ink-soft">{lab.name}</h3>
      {lab.condition && <p className="mt-1 text-sm text-ink-soft">{lab.condition}</p>}
    </article>
  }
  return <Link to={`/lab/${encodeURIComponent(lab.id)}`} className={`${theme.panel} group flex flex-col p-5 transition hover:-translate-y-0.5 hover:border-teal hover:shadow-[0_10px_30px_-12px_rgba(15,118,110,0.35)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal`}>
    <div className="flex items-center justify-between"><span className={`${theme.tag} text-teal`}>{n}</span><Chip tone="teal">Available</Chip></div>
    <h3 className="mt-8 text-3xl font-bold tracking-[-0.03em]">{lab.name}</h3>
    {lab.condition && <p className="mt-1 flex items-center gap-2 text-sm font-medium text-ink"><LesionDot/>{lab.condition}</p>}
    {lab.description && <p className="mt-4 text-sm leading-relaxed text-ink-soft">{lab.description}</p>}
    {lab.stages && <ul aria-label="Stages" className="mt-5 flex flex-wrap gap-1.5">{lab.stages.map((s) => <li key={s.id}><Chip className={s.sizeCm > 0 ? '' : 'opacity-80'}>{s.label}</Chip></li>)}</ul>}
    <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-line pt-4 text-xs">
      <div><dt className="text-ink-soft">Stages</dt><dd className="mt-0.5 font-mono text-sm font-semibold">{lab.stages?.length ?? 0}</dd></div>
      <div><dt className="text-ink-soft">Views</dt><dd className="mt-0.5 font-mono text-sm font-semibold">{lab.cutaways?.length ?? 1}</dd></div>
      <div><dt className="text-ink-soft">Parts</dt><dd className="mt-0.5 font-mono text-sm font-semibold">{lab.parts?.length ?? 0}</dd></div>
    </dl>
    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-teal">Open lab<Icon name="arrow" className="h-4 w-4 transition group-hover:translate-x-0.5"/></span>
  </Link>
}

export default function Home() {
  const all = Object.values(labs).sort((a, b) => Number(!!a.comingSoon) - Number(!!b.comingSoon))   // available labs first
  const featured = all.find((l) => !l.comingSoon)
  // The hero canvas shows whatever lab the store holds (the last one opened), so label it from the store.
  const shownId = useLabStore((s) => s.labId)
  const shown = labs[shownId] && !labs[shownId].comingSoon ? labs[shownId] : featured
  return <div className={theme.page}><Header/>
    <main>
      <section className={`${theme.wrap} grid items-center gap-8 pb-10 pt-8 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14 lg:pb-16`}>
        <div>
          <p className={`${theme.tag} text-teal`}>Anatomy teaching models · print-ready</p>
          <h1 className="mt-4 text-[44px] font-bold leading-[0.95] tracking-[-0.045em] sm:text-7xl">TactileLab</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft sm:text-xl">Build the anatomical teaching model your session needs in 3D, then print it as a kit your students can hold.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            {featured && <Link to={`/lab/${featured.id}`} className={theme.primary}>Open the {featured.name.toLowerCase()} lab<Icon name="arrow" className="h-4 w-4"/></Link>}
            <a href="#labs" className={`${theme.secondary} min-h-12 px-5`}>All labs</a>
          </div>
          <ol className="mt-10 grid gap-4 border-t border-line pt-6 sm:grid-cols-3">
            {STEPS.map(([n, t, d]) => <li key={n}><span className={`${theme.tag} text-teal`}>{n}</span><p className="mt-1 text-sm font-bold">{t}</p><p className="mt-1 text-[13px] leading-snug text-ink-soft">{d}</p></li>)}
          </ol>
        </div>
        {featured && <div className="pointer-events-none" aria-hidden="true">
          <ViewerFrame className="h-[320px] sm:h-[440px] lg:h-[540px]"
            topRight={<Chip>Live model</Chip>}
            bottom={<><Chip><LesionDot/>{shown.name} · {shown.condition}</Chip></>}>
            <ModelCanvas/>
          </ViewerFrame>
        </div>}
      </section>

      <section id="labs" aria-labelledby="labs-title" className="border-t border-line bg-paper/60 py-10 sm:py-14">
        <div className={theme.wrap}>
          <div className="mb-6 flex items-end justify-between gap-4">
            <div><p className={`${theme.tag} text-teal`}>Collection</p><h2 id="labs-title" className="mt-1 text-2xl font-bold tracking-[-0.02em]">Labs</h2></div>
            <p className="font-mono text-xs text-ink-soft">{all.filter((l) => !l.comingSoon).length} available · {all.filter((l) => l.comingSoon).length} in development</p>
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
