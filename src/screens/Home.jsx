import { Link } from 'react-router-dom'
import { labs } from '@/data/labs'
import ModelCanvas from '@/scenes/ModelCanvas'
import { Header, Icon, theme } from '@/components/LabUI'

export default function Home() {
  const allLabs = Object.values(labs)
  return <div className={theme.page}><Header/><main className="mx-auto max-w-[1440px] px-5 pb-10 sm:px-8 lg:px-12">
    <section className="grid gap-8 border-b border-[#d8e1da] py-12 sm:py-16 lg:grid-cols-[1.5fr_1fr] lg:items-end">
      <div><p className={`${theme.eyebrow} mb-6 !text-[#176b61]`}>A new dimension in anatomy education</p><h1 className="max-w-3xl font-serif text-5xl leading-[1.02] tracking-[-0.05em] text-[#173f38] sm:text-7xl lg:text-[88px]">Learn by seeing.<br/>Understand by <em className="font-normal text-[#648065]">holding.</em></h1></div>
      <div className="lg:pb-2"><p className="max-w-sm text-lg leading-relaxed text-[#5c7164]">Turn complex anatomy into something tangible. Explore, customize, and print your next teaching model.</p><div className="mt-7 flex items-center gap-3 text-xs font-medium text-[#3d5b4c]"><span className="h-2 w-2 rounded-full bg-[#648065]"/>Built for educators. Made for discovery.</div></div>
    </section>
    <div className="flex items-center justify-between gap-4 pb-6 pt-9"><h2 className="text-xl font-semibold tracking-tight">The lab collection</h2><span className={`${theme.eyebrow} !text-[#6a7970]`}>{String(allLabs.length).padStart(2, '0')} anatomy labs</span></div>
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{allLabs.map((lab, index) => {
      const featured = !lab.comingSoon
      const content = <><div className={`relative overflow-hidden ${featured ? 'min-h-[320px] bg-[#e3ebdc] sm:min-h-[370px]' : 'h-36 bg-[#edf0e9]'}`}>
        <div className="absolute inset-x-5 top-5 z-10 flex items-center justify-between"><span className="font-mono text-xs tracking-widest text-[#60745e]">{String(index + 1).padStart(2, '0')} / {lab.name.toUpperCase()}</span><span className={`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${featured ? 'bg-[#173f38] text-[#e1ecba]' : 'border border-[#d5decf] text-[#65765e]'}`}>{featured ? 'Ready to explore' : 'Coming soon'}</span></div>
        {lab.id === 'kidney' && featured ? <div aria-hidden="true" className="absolute inset-0 pt-10"><ModelCanvas/></div> : <div aria-hidden="true" className="absolute -bottom-5 right-7 flex h-32 w-32 rotate-[-18deg] items-center justify-center rounded-[36px] border border-[#d1dbc9] text-[#b5c4aa]"><Icon name="layers" className="h-20 w-20"/></div>}
        {featured && <span className="absolute bottom-5 left-5 rounded-full bg-white/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#3c5f47]">Interactive 3D · Print-ready</span>}
      </div><div className="flex flex-1 flex-col p-6 sm:p-7"><div className="flex items-start justify-between gap-5"><div><h3 className="font-serif text-3xl tracking-tight text-[#173f38]">{lab.name}</h3>{lab.condition && <p className="mt-2 text-sm leading-relaxed text-[#5d7063]">{lab.condition}</p>}</div>{featured && <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#173f38] text-white transition group-hover:bg-[#176b61]"><Icon name="arrow"/></span>}</div>{lab.description && <p className="mt-4 max-w-lg text-sm leading-relaxed text-[#6a7970]">{lab.description}</p>}{featured && <div className="mt-6 flex items-center justify-between border-t border-[#e0e7db] pt-4 text-xs font-semibold text-[#176b61]"><span>Open lab</span><span>{lab.stages?.length} stages to explore</span></div>}</div></>
      const cls = `${theme.card} group flex flex-col overflow-hidden ${featured ? 'md:row-span-2 transition duration-300 hover:border-[#95ac88] hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#176b61]' : ''}`
      return lab.comingSoon ? <article key={lab.id} className={cls} aria-label={`${lab.name}, coming soon`}>{content}</article> : <Link key={lab.id} to={`/lab/${encodeURIComponent(lab.id)}`} className={cls}>{content}</Link>
    })}</div>
    <footer className="mt-12 flex flex-wrap items-center justify-between gap-5 border-t border-[#d8e1da] pt-6 text-xs text-[#6a7970]"><span className="font-semibold text-[#173f38]">TactileLab / Anatomy, made tangible.</span><div className="flex flex-wrap gap-6"><span className="flex items-center gap-2"><Icon name="cube" className="h-4 w-4"/>Explore</span><span className="flex items-center gap-2"><Icon name="layers" className="h-4 w-4"/>Customize</span><span className="flex items-center gap-2"><Icon name="print" className="h-4 w-4"/>Print & teach</span></div></footer>
  </main></div>
}
