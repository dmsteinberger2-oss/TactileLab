import { useEffect, useRef, useState } from 'react'
import { useLabStore } from '@/store/labStore'
import { getPrintReport } from '@/lib/kit'

// Print estimate for the current configuration, kept fresh: recalculates when the lab, stage, view,
// part modes, part visibility or print scale change. null while the first estimate for a stage/view is
// calculating (the previous numbers stay up while only part settings change); { parts: [] } if nothing
// loads. Retries for ~10 s while the scene is still loading (labs without print files).
export function usePrintReport() {
  const labId = useLabStore((s) => s.labId), stageId = useLabStore((s) => s.stageId), cutaway = useLabStore((s) => s.cutaway)
  const partModes = useLabStore((s) => s.partModes), partVisibility = useLabStore((s) => s.partVisibility), printScale = useLabStore((s) => s.printScale)
  const [report, setReport] = useState(null)
  const variant = useRef('')
  useEffect(() => {
    let tries = 0, timer, alive = true
    const key = `${labId}_${stageId}_${cutaway}`
    if (variant.current !== key) { variant.current = key; setReport(null) }
    const tick = async () => {
      try { const r = await getPrintReport(); if (!alive) return; setReport(r); if (r.parts.length === 0 && tries++ < 40) timer = setTimeout(tick, 250) }
      catch { if (alive && tries++ < 40) timer = setTimeout(tick, 250); else if (alive) setReport({ parts: [] }) }
    }
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [labId, stageId, cutaway, partModes, partVisibility, printScale])
  return report
}
