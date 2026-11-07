import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { useLabStore } from '@/store/labStore'
import { getLab, getStage, getPart, ajccTable, stageGrouping } from '@/data/labs'

const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.5-flash'
const key = import.meta.env.VITE_GEMINI_API_KEY
const genAI = key ? new GoogleGenerativeAI(key) : null

// Everything the model is allowed to reason from. Small enough to send whole; no retrieval needed.
function groundingContext() {
  const { labId, stageId, selectedPartId, goal, audience } = useLabStore.getState()
  const lab = getLab(labId), stage = getStage(labId, stageId), part = selectedPartId ? getPart(labId, selectedPartId) : null
  return {
    organ: lab.name, condition: lab.condition,
    currentStage: { id: stage.id, label: stage.label, sizeCm: stage.sizeCm, ajcc: stage.ajcc, readout: stage.readout, teaching: stage.teaching, partsPresent: stage.parts },
    selectedPart: part ? { name: part.name, tooltip: part.tooltip } : null,
    allStages: lab.stages.map((s) => ({ label: s.label, sizeCm: s.sizeCm, ajcc: s.ajcc, readout: s.readout })),
    parts: lab.parts.map((p) => ({ name: p.name, tooltip: p.tooltip })),
    ajccT: ajccTable, stageGrouping, facts: lab.facts, sources: lab.sources,
    goal: lab.goals.find((g) => g.id === goal)?.label, audience: lab.audiences.find((a) => a.id === audience)?.label,
  }
}

const SYSTEM = `You are the teaching assistant inside TactileLab, a tool that turns a 3D kidney model into a physical printed teaching kit. Answer only from the clinical context provided. Use AJCC 8th edition staging wording exactly as given. If the context does not cover a question, say what is not covered and do not guess. Match depth to the stated audience. Be concise; students read this next to a model they are holding.`

const lessonSchema = {
  type: SchemaType.OBJECT,
  properties: {
    caseStudy: { type: SchemaType.STRING, description: 'A short clinical vignette (120-180 words) matching the current stage and audience, ending with the question the student should answer using the model.' },
    vocab: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { term: { type: SchemaType.STRING }, definition: { type: SchemaType.STRING } }, required: ['term', 'definition'] } },
    exercises: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: '4-6 hands-on exercises that use the physical model or the 3D viewer, each one sentence.' },
    rubric: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: '3-5 observable criteria an instructor can grade.' },
  },
  required: ['caseStudy', 'vocab', 'exercises', 'rubric'],
}

const cacheKey = (prefix) => {
  const { labId, stageId, goal, audience } = useLabStore.getState()
  return `tl:${prefix}:${labId}:${stageId}:${goal}:${audience}`
}

export async function generateLesson({ force = false } = {}) {
  const k = cacheKey('lesson')
  if (!force) { try { const hit = localStorage.getItem(k); if (hit) return JSON.parse(hit) } catch {} }
  if (!genAI) return fallbackLesson()
  const model = genAI.getGenerativeModel({ model: MODEL, systemInstruction: SYSTEM, generationConfig: { responseMimeType: 'application/json', responseSchema: lessonSchema, temperature: 0.4 } })
  const ctx = groundingContext()
  const res = await model.generateContent(`Generate learning material for this configuration. Teaching goal: ${ctx.goal}. Audience: ${ctx.audience}.\n\nCONTEXT:\n${JSON.stringify(ctx)}`)
  const lesson = JSON.parse(res.response.text())
  try { localStorage.setItem(k, JSON.stringify(lesson)) } catch {}
  return lesson
}

export function suggestedQuestions() {
  const { labId, stageId } = useLabStore.getState()
  const stage = getStage(labId, stageId)
  if (!stage || stage.id === 'normal') return ['Which structures enter the hilum, and in what order?', 'Where do most renal cell carcinomas arise?', 'Why does the right kidney sit lower than the left?']
  return [
    `Why is this tumour ${stage.ajcc}?`,
    `What changes between ${stage.label} and the next stage?`,
    stage.id === 't3a' ? 'Why does renal vein involvement matter for surgery?' : 'Would this be treated with partial or radical nephrectomy?',
  ]
}

export async function askModel(question) {
  const k = `${cacheKey('qa')}:${question.trim().toLowerCase()}`
  try { const hit = localStorage.getItem(k); if (hit) return hit } catch {}
  if (!genAI) return 'AI is not configured. Add VITE_GEMINI_API_KEY to .env.local to enable questions.'
  const model = genAI.getGenerativeModel({ model: MODEL, systemInstruction: SYSTEM, generationConfig: { temperature: 0.3, maxOutputTokens: 400 } })
  const ctx = groundingContext()
  const res = await model.generateContent(`Student question about the model they are looking at: "${question}"\n\nCONTEXT:\n${JSON.stringify(ctx)}`)
  const text = res.response.text()
  try { localStorage.setItem(k, text) } catch {}
  return text
}

// Pre-warm the three suggested questions so the demo never waits on the network.
export async function prewarm() {
  for (const q of suggestedQuestions()) { try { await askModel(q) } catch {} }
  try { await generateLesson() } catch {}
}

function fallbackLesson() {
  const { labId, stageId } = useLabStore.getState()
  const stage = getStage(labId, stageId)
  return {
    caseStudy: `${stage.readout} ${stage.teaching} (Offline material: add a Gemini key for a generated case.)`,
    vocab: getLab(labId).parts.slice(0, 6).map((p) => ({ term: p.name, definition: p.tooltip })),
    exercises: ['Identify the hilar structures front to back.', 'Measure the tumour\u2019s greatest dimension and assign the AJCC T category.', 'Remove the tumour and describe what it displaces.', 'Compare with the normal kidney.'],
    rubric: ['Names hilar structures in order', 'Applies the 4 / 7 / 10 cm cutoffs correctly', 'Explains why staging becomes anatomical at T3'],
  }
}
