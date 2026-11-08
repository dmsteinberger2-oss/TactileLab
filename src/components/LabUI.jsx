import { Link } from 'react-router-dom'

export const theme = {
  page: 'min-h-screen selection:bg-[#d9e9bd] bg-[#f4f5f0] text-[#183c3b] antialiased',
  card: 'rounded-2xl border border-[#dbe3dc] bg-[#ffffff] shadow-[0_3px_18px_rgba(27,60,43,0.025)]',
  primary: 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#176b61] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#10554e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176b61] disabled:cursor-not-allowed disabled:opacity-60',
  secondary: 'inline-flex items-center justify-center gap-2 rounded-xl border border-[#d8e1da] bg-[#ffffff] px-4 py-2.5 text-sm font-semibold text-[#234741] transition hover:bg-[#edf3ec] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176b61]',
  eyebrow: 'text-[11px] font-bold uppercase tracking-[0.14em] text-[#65766c]',
}

export function Icon({ name, className = 'h-5 w-5' }) {
  const paths = {
    mark: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></>,
    arrow: <><path d="M4 12h15M14 7l5 5-5 5"/></>,
    back: <><path d="M20 12H5M10 7l-5 5 5 5"/></>,
    cube: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z"/><path d="m3 7 9 5 9-5M12 12v10"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></>,
    tag: <><path d="M20 13 13 20 4 11V4h7l9 9Z"/><circle cx="8" cy="8" r="1"/></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3"/></>,
    book: <><path d="M12 6c-2-2-5-2-9-1v14c4-1 7-1 9 1 2-2 5-2 9-1V5c-4-1-7-1-9 1ZM12 6v14"/></>,
    chat: <path d="M4 4h16v12H9l-5 4V4Z"/>,
    send: <><path d="m3 11 18-8-7 18-3-7-8-3ZM11 14 21 3"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    print: <><path d="M6 9V3h12v6M6 17H4V9h16v8h-2M6 14h12v7H6z"/><path d="M17 11h1"/></>,
  }
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export function Header({ student = false }) {
  return <header className="border-b border-[#d8e1da] bg-[#f4f5f0]">
    <div className="mx-auto flex min-h-[80px] max-w-[1600px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
      <div className="flex min-w-0 items-center gap-3 sm:gap-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 text-xl font-bold tracking-[-0.04em] text-[#163d38] sm:text-2xl"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#173f38] text-[#e1ecba]"><Icon name="mark" className="h-6 w-6"/></span>TactileLab</Link>
        {student ? <span className="hidden rounded-full bg-[#e4eadf] sm:block px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#5c6b52]">Student view</span> : <span className="hidden border-l border-[#d8e1da] pl-6 text-sm text-[#6a7970] sm:block">The hands-on anatomy studio</span>}
      </div>
      <Link to="/" className="rounded-full border border-[#d8e1da] px-4 py-2 text-xs font-semibold text-[#5c6570] transition hover:text-[#176b61]">All labs</Link>
    </div>
  </header>
}

export function Segment({ label, options = [], value, onChange }) {
  return <div><div className="mb-2 text-sm font-bold text-[#26463e]">{label}</div><div role="group" aria-label={label} className="flex flex-wrap gap-2">{options.map(option => <button type="button" key={option.id} aria-pressed={value === option.id} onClick={() => onChange(option.id)} className={`min-h-11 flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176b61] ${value === option.id ? 'border-[#176b61] bg-[#176b61] text-white shadow-sm' : 'border-[#d8e1da] bg-[#ffffff] text-[#4c6258] hover:bg-[#edf3ec]'}`}>{option.label}</button>)}</div></div>
}

export function Toggle({ label, checked, onChange, icon }) {
  return <button type="button" aria-pressed={checked} onClick={() => onChange(!checked)} className={`${theme.secondary} ${checked ? '!border-[#176b61] !bg-[#e0eee5] !text-[#176b61]' : ''}`}>{icon && <Icon name={icon} className="h-4 w-4"/>}{label}<span aria-hidden="true" className={`ml-1 inline-flex h-5 w-9 items-center rounded-full p-0.5 transition ${checked ? 'bg-[#176b61]' : 'bg-[#cbd6ce]'}`}><span className={`h-4 w-4 rounded-full bg-white shadow-sm transition ${checked ? 'translate-x-4' : ''}`}/></span></button>
}

export function SectionTitle({ icon, children }) {
 return <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e8f0e5] text-[#176b61]"><Icon name={icon} className="h-[18px] w-[18px]"/></span><h2 className="text-base font-bold tracking-[-0.02em] text-[#193d35]">{children}</h2></div>
}
