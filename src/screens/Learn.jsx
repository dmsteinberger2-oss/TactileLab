import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLabStore } from '@/store/labStore'
import { labs } from '@/data/labs'
import ModelCanvas from '@/scenes/ModelCanvas'
import { generateLesson, askModel, suggestedQuestions, prewarm } from '@/ai/gemini'
import { Header, Icon, SectionTitle, Segment, Toggle, theme } from '@/components/LabUI'

function Lesson({ configKey }) {
  const [state, setState] = useState({ status: 'loading', lesson: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setState({ status: 'loading', lesson: null })
    Promise.resolve().then(() => generateLesson()).then(lesson => { if (active) setState({ status: 'ready', lesson }) }, error => { if (active) setState({ status: 'error', error: error?.message }) })
    return () => { active = false }
  }, [configKey, attempt])
  return <section className={`${theme.card} p-5 sm:p-6`}><SectionTitle icon="book">Lesson</SectionTitle>
    {state.status === 'loading' && <p role="status" className="mt-5 text-sm text-[#77716d]">Preparing your lesson…</p>}
    {state.status === 'error' && <div role="alert" className="mt-5 rounded-xl bg-[#f9ebe6] p-4 text-sm text-[#914a40]"><p>We couldn’t load this lesson. {state.error || ''}</p><button type="button" onClick={() => setAttempt(n => n + 1)} className="mt-2 font-bold underline">Try again</button></div>}
    {state.status === 'ready' && state.lesson && <div className="mt-5 space-y-6 text-sm leading-relaxed text-[#4a505a]">
      {state.lesson.caseStudy && <section><h3 className="mb-2 font-bold text-[#1c293b]">Case study</h3><p className="whitespace-pre-wrap">{state.lesson.caseStudy}</p></section>}
      {state.lesson.vocab?.length > 0 && <section className="border-t border-[#ebe5df] pt-5"><h3 className="mb-3 font-bold text-[#1c293b]">Vocabulary</h3><dl className="space-y-3">{state.lesson.vocab.map((item, index) => <div key={`${item.term}-${index}`}><dt className="inline font-bold text-[#a95547]">{item.term}</dt>{' '}<dd className="inline">{item.definition}</dd></div>)}</dl></section>}
      {state.lesson.exercises?.length > 0 && <section className="border-t border-[#ebe5df] pt-5"><h3 className="mb-3 font-bold text-[#1c293b]">Exercises</h3><ol className="list-decimal space-y-2 pl-5">{state.lesson.exercises.map((item, index) => <li key={index}>{item}</li>)}</ol></section>}
      {state.lesson.rubric?.length > 0 && <section className="border-t border-[#ebe5df] pt-5"><h3 className="mb-3 font-bold text-[#1c293b]">Rubric</h3><ul className="list-disc space-y-2 pl-5">{state.lesson.rubric.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
    </div>}
  </section>
}
function Questions({ configKey }) {
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState([])
  const counter = useRef(0), currentConfig = useRef(configKey)
  currentConfig.current = configKey
  useEffect(() => { setAnswers([]); setQuestion('') }, [configKey])
  let suggestions = []
  try { suggestions = suggestedQuestions() || [] } catch { /* Free-text questions remain available. */ }
  function submitQuestion(raw) {
    const text = raw.trim()
    if (!text) return
    const id = ++counter.current, requestConfig = configKey
    setAnswers(items => [...items, { id, question: text, status: 'pending' }]); setQuestion('')
    Promise.resolve().then(() => askModel(text)).then(answer => {
      if (currentConfig.current === requestConfig) setAnswers(items => items.map(item => item.id === id ? { ...item, answer, status: 'ready' } : item))
    }, error => {
      if (currentConfig.current === requestConfig) setAnswers(items => items.map(item => item.id === id ? { ...item, answer: error?.message || 'Please try asking again.', status: 'error' } : item))
    })
  }
  return <section className={`${theme.card} p-5 sm:p-6`}><SectionTitle icon="chat">Ask about this model</SectionTitle>
    {suggestions.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{suggestions.map((item, index) => <button type="button" key={`${item}-${index}`} onClick={() => submitQuestion(item)} className="rounded-full border border-[#cfdacb] bg-[#f6f9f4] px-3 py-2 text-left text-xs font-medium text-[#465d49] transition hover:bg-[#eaf1e7]">{item}</button>)}</div>}
    <form className="mt-4 flex gap-2" onSubmit={event => { event.preventDefault(); submitQuestion(question) }}><label htmlFor="model-question" className="sr-only">Ask a question about this model</label><input id="model-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask a question about this model…" className="min-w-0 flex-1 rounded-xl border border-[#ded6d0] bg-white px-3 py-3 text-sm outline-none focus:border-[#c96a59] focus:ring-2 focus:ring-[#f3d5cc]"/><button type="submit" disabled={!question.trim()} className={theme.primary}><Icon name="send" className="h-4 w-4"/><span className="hidden sm:inline">Send</span><span className="sr-only sm:hidden">Send question</span></button></form>
    <div aria-live="polite" className="mt-4 space-y-3">{answers.map(item => <div key={item.id} className="space-y-2"><p className="rounded-xl bg-[#f4f1ee] px-4 py-3 text-sm font-semibold text-[#354052]">{item.question}</p><p className={`whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-relaxed ${item.status === 'error' ? 'bg-[#faece8] text-[#a34c3e]' : 'bg-[#fbefea] text-[#4d4d53]'}`}>{item.status === 'pending' ? 'Thinking…' : item.answer}</p></div>)}</div>
  </section>
}
export default function Learn() {
  const [searchParams] = useSearchParams()
  const hydrate = useLabStore(s => s.hydrateFromSearchParams)
  const labId = useLabStore(s => s.labId), stageId = useLabStore(s => s.stageId), setStage = useLabStore(s => s.setStage)
  const selectedPartId = useLabStore(s => s.selectedPartId), exploded = useLabStore(s => s.exploded), setExploded = useLabStore(s => s.setExploded)
  const cutaway = useLabStore(s => s.cutaway), colors = useLabStore(s => s.partColors), goal = useLabStore(s => s.goal), audience = useLabStore(s => s.audience), labelsOn = useLabStore(s => s.labelsOn)
  const search = searchParams.toString()
  const [hydratedSearch, setHydratedSearch] = useState(null)
  useLayoutEffect(() => { hydrate(new URLSearchParams(search)); setHydratedSearch(search) }, [hydrate, search])
  useEffect(() => { if (hydratedSearch === search) prewarm().catch(() => {}) }, [hydratedSearch, search, stageId, goal, audience])
  const lab = labs[labId]
  const selectedPart = lab?.parts?.find(part => part.id === selectedPartId)
  const configKey = JSON.stringify([labId, stageId, cutaway, colors, goal, audience, labelsOn])
  return <div className={theme.page}><Header student/><main className="mx-auto max-w-[1500px] px-4 pb-12 pt-8 sm:px-8 lg:px-10">
    {hydratedSearch !== search ? <p role="status" className="py-12 text-sm text-[#77716d]">Loading model…</p> : !lab ? <div className="py-12"><h1 className="text-2xl font-bold">Lab unavailable</h1><p className="mt-2 text-sm text-[#77716d]">This shared model could not be found.</p></div> : <>
      <div className="mb-7"><p className={`${theme.eyebrow} mb-2 text-[#c36756]`}>Interactive lesson</p><h1 className="text-3xl font-bold tracking-[-0.045em] sm:text-4xl">Explore the {lab.name.toLowerCase()}</h1>{lab.condition && <p className="mt-2 text-sm text-[#77716d]">{lab.condition} · Interactive lesson</p>}</div>
      <div className="grid items-start gap-4 lg:grid-cols-2 xl:gap-6"><div className="space-y-4"><section aria-label="Interactive anatomy model" className={`${theme.card} overflow-hidden p-3 sm:p-4`}><div className="flex flex-wrap items-end justify-between gap-3"><div className="min-w-0 flex-1"><Segment label="Stage" options={lab.stages} value={stageId} onChange={setStage}/></div><Toggle label="Explode" icon="layers" checked={exploded} onChange={setExploded}/></div><div className="relative mt-3 overflow-hidden rounded-xl bg-[#f1ece8]"><div className="h-[360px] sm:h-[470px] lg:h-[520px]"><ModelCanvas/></div><p className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-[#fffcfa]/90 px-3 py-1.5 text-xs text-[#706c68]">Drag to rotate · Tap a part to explore</p></div>{selectedPart && <div className="mt-3 rounded-xl bg-[#f9eae5] p-4"><p className={`${theme.eyebrow} text-[#a76255]`}>Selected structure</p><h2 className="mt-1 text-lg font-bold tracking-[-0.025em]">{selectedPart.name}</h2><p className="mt-1 text-sm leading-relaxed text-[#685951]">{selectedPart.tooltip}</p></div>}</section></div>
      <div className="space-y-4"><Lesson configKey={configKey}/><Questions configKey={configKey}/></div></div>
    </>}
  </main></div>
}
