import { Link } from 'react-router-dom'

// Shared UI for the screens. Colours come from the @theme tokens in index.css:
// bench (page ground), paper (panels), ink / ink-soft (text), line (hairlines),
// teal (anything interactive), lesion (pathology only).
// The 3D canvas is never imported here; screens pass it in as children.

export const theme = {
  page: 'min-h-screen bg-bench text-ink antialiased selection:bg-teal-soft',
  wrap: 'mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8',
  panel: 'rounded-2xl border border-line bg-paper',
  primary: 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-teal px-5 text-sm font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_1px_2px_rgba(15,118,110,0.35)] transition hover:bg-[#0b5f58] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal disabled:cursor-progress disabled:opacity-80',
  secondary: 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-paper px-3.5 text-sm font-semibold text-ink transition hover:border-teal hover:text-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal',
  link: 'inline-flex items-center gap-1 font-semibold text-teal underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal rounded',
  tag: 'font-mono text-[11px] uppercase tracking-[0.12em]',
  prose: 'text-[15px] leading-relaxed text-ink',
}

export function Icon({ name, className = 'h-5 w-5' }) {
  const paths = {
    mark: <><path d="M12 3 3 7.5 12 12l9-4.5L12 3Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    back: <path d="M19 12H5m5-5-5 5 5 5"/>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></>,
    tag: <><path d="M20 13 13 20 4 11V4h7l9 9Z"/><circle cx="8" cy="8" r="1.2"/></>,
    download: <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M4 19h16"/>,
    check: <path d="m5 12.5 4.5 4.5L19 7.5"/>,
    alert: <><path d="M12 8v5m0 3.5v.01"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></>,
    print: <><path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/></>,
    share: <><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4m-7.6 6.8 7.6 4.4"/></>,
    phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></>,
    reset: <><path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4.5h4.5"/></>,
    rotate: <><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></>,
    cube: <><path d="m12 2.5 8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5L12 2.5Z"/><path d="m3.5 7.25 8.5 4.75 8.5-4.75M12 12v9.5"/></>,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>,
    external: <><path d="M14 4h6v6m0-6-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></>,
  }
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export function Spinner({ className = 'h-4 w-4' }) {
  return <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3"/><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
}

export function Wordmark() {
  return <span className="flex items-center gap-2.5">
    <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-ink text-teal-soft"><Icon name="mark" className="h-5 w-5"/></span>
    <span className="text-[19px] font-bold tracking-[-0.03em] text-ink">TactileLab</span>
  </span>
}

// Every page: wordmark links home; `badge` names the page's role (e.g. "Shared model").
export function Header({ badge }) {
  return <header className="sticky top-0 z-30 border-b border-line bg-bench/85 backdrop-blur supports-[backdrop-filter]:bg-bench/75">
    <div className={`${theme.wrap} flex h-16 items-center justify-between gap-4`}>
      <div className="flex min-w-0 items-center gap-3">
        <Link to="/" aria-label="TactileLab home" className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal"><Wordmark/></Link>
        {badge && <span className={`${theme.tag} hidden truncate rounded-md border border-line bg-paper px-2 py-1 text-ink-soft sm:inline`}>{badge}</span>}
      </div>
      <nav aria-label="Primary"><Link to="/" className={theme.secondary}><Icon name="cube" className="h-4 w-4"/>Labs</Link></nav>
    </div>
  </header>
}

// Numbered section of a control column.
export function Panel({ step, title, aside, children, className = '', id }) {
  const headingId = id ? `${id}-title` : undefined
  return <section id={id} aria-labelledby={headingId} className={`${theme.panel} p-5 sm:p-6 ${className}`}>
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 id={headingId} className="flex items-baseline gap-2.5 text-[15px] font-bold tracking-[-0.01em]">
        {step && <span className={`${theme.tag} text-teal`}>{step}</span>}{title}
      </h2>
      {aside}
    </div>
    {children}
  </section>
}

// Single-choice segmented control. Options: { id, label, sub?, marker? }.
export function Segmented({ label, options = [], value, onChange, columns }) {
  const cols = columns ?? Math.min(options.length, 5)
  // Long labels (e.g. "Microdiscectomy") don't fit side by side on a phone: stack them below sm.
  const stack = options.length > 1 && options.some((o) => String(o.label).length > 12)
  return <fieldset className="min-w-0">
    <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-soft">{label}</legend>
    <div role="radiogroup" aria-label={label} className={`grid grid-cols-[repeat(var(--cols),minmax(0,1fr))] gap-1.5 rounded-xl bg-bench p-1.5 ${stack ? 'max-sm:grid-cols-1' : ''}`} style={{ '--cols': cols }}>
      {options.map((o) => {
        const on = value === o.id
        return <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.id)}
          className={`relative flex min-h-11 min-w-0 flex-col items-center justify-center rounded-lg px-1.5 py-1.5 text-center transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal ${on ? 'bg-paper text-ink shadow-[0_1px_3px_rgba(22,33,43,0.12),0_0_0_1px_rgba(15,118,110,0.55)]' : 'text-ink-soft hover:bg-paper/60 hover:text-ink'}`}>
          <span className="flex items-center gap-1.5 text-sm font-semibold leading-tight">{o.marker}{o.label}</span>
          {o.sub && <span className={`mt-0.5 whitespace-nowrap font-mono text-[10.5px] leading-none tracking-tight ${on ? 'text-teal' : 'text-ink-soft/80'}`}>{o.sub}</span>}
        </button>
      })}
    </div>
  </fieldset>
}

export function Toggle({ label, checked, onChange, icon }) {
  return <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
    className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold shadow-sm backdrop-blur transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal ${checked ? 'border-teal bg-teal-soft/90 text-teal' : 'border-line bg-paper/90 text-ink hover:border-teal'}`}>
    {icon && <Icon name={icon} className="h-4 w-4"/>}{label}
    <span aria-hidden="true" className={`ml-0.5 inline-flex h-[18px] w-8 items-center rounded-full p-0.5 transition ${checked ? 'bg-teal' : 'bg-line'}`}><span className={`h-3.5 w-3.5 rounded-full bg-white shadow transition ${checked ? 'translate-x-3.5' : ''}`}/></span>
  </button>
}

// Frame around the 3D viewport: specimen-plate background, overlay slots. The canvas is `children`.
export function ViewerFrame({ children, topLeft, topRight, bottom, className = '' }) {
  return <div className={`relative overflow-hidden rounded-2xl border border-line bg-[#f6f8f9] ${className}`}>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_42%,#ffffff_0%,#f3f6f7_45%,#e6ebee_100%)]"/>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.55] [background-image:linear-gradient(#dfe5e9_1px,transparent_1px),linear-gradient(90deg,#dfe5e9_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"/>
    <div className="absolute inset-0">{children}</div>
    {topLeft && <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2 sm:left-4 sm:top-4">{topLeft}</div>}
    {topRight && <div className="pointer-events-none absolute right-3 top-3 z-10 sm:right-4 sm:top-4">{topRight}</div>}
    {bottom && <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-between gap-2 sm:inset-x-4 sm:bottom-4">{bottom}</div>}
  </div>
}

// Small mono chip used for configuration and status labels.
export function Chip({ children, tone = 'plain', className = '' }) {
  const tones = { plain: 'border-line bg-paper/90 text-ink-soft', teal: 'border-teal/30 bg-teal-soft text-teal', lesion: 'border-lesion/25 bg-lesion-soft text-lesion' }
  return <span className={`${theme.tag} inline-flex items-center gap-1.5 rounded-md border px-2 py-1 ${tones[tone]} ${className}`}>{children}</span>
}

// Pathology marker: lesion red is used for nothing else.
export function LesionDot({ className = '' }) {
  return <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full bg-lesion ${className}`}/>
}

export function Hint({ children }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-paper/90 px-3 py-1.5 text-xs font-medium text-ink-soft shadow-sm"><Icon name="rotate" className="h-3.5 w-3.5"/>{children}</span>
}

// Stage options carry the tumour size, so the selector doubles as a size scale.
// Labs without tumour sizes (e.g. the spine) get plain labels.
export const hasSizes = (stages) => stages.some((s) => s.sizeCm > 0)
// A stage shows the pathology marker when it has a lesion: a sized tumour, or `lesion: true`.
export const isLesion = (s) => !!(s && (s.lesion ?? s.sizeCm > 0))
export const stageOptions = (stages) => {
  const sized = hasSizes(stages)
  return stages.map((s) => ({
    id: s.id, label: s.label,
    sub: s.sub ?? (sized ? (s.sizeCm > 0 ? `${s.sizeCm.toFixed(1)} cm` : 'no mass') : undefined),
    marker: isLesion(s) ? <LesionDot/> : null,
  }))
}

// Stage selector. Stages with a `group` (e.g. RCC, Bosniak cysts) get one labelled row per group,
// in the order the groups first appear; labs without groups keep the single selector.
export function StagePicker({ stages, value, onChange }) {
  const groups = []
  for (const s of stages) {
    const name = s.group ?? ''
    let g = groups.find((x) => x.name === name)
    if (!g) groups.push(g = { name, stages: [] })
    g.stages.push(s)
  }
  const row = (label, list) => <Segmented key={label} label={label} options={stageOptions(list)} value={value} onChange={onChange} columns={list.length > 3 ? undefined : list.length}/>
  if (groups.length < 2) return row(hasSizes(stages) ? 'Tumour stage' : 'Stage', stages)
  return <div className="space-y-4">{groups.map((g) => row(g.name || 'Stage', g.stages))}</div>
}
