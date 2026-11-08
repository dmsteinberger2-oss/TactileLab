import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { useLabStore } from '@/store/labStore'
import { getPart } from '@/data/labs'

// Viewer-local hover state (not part of the shared lab config). The cursor position is updated
// transiently, without React renders, so the label follows the pointer smoothly.
export const useHover = create(() => ({ id: null, x: 0, y: 0 }))

export function setHover(id, x, y) { useHover.setState({ id, x, y }) }
export function moveHover(x, y) { useHover.setState({ x, y }) }
export function clearHover(id) { if (id === undefined || useHover.getState().id === id) useHover.setState({ id: null }) }

// Part name near the cursor. Lives in the DOM over the canvas; mouse/pen only (touch has no hover).
export function HoverLabel() {
  const id = useHover((s) => s.id)
  const labId = useLabStore((s) => s.labId)
  const labelsOn = useLabStore((s) => s.labelsOn)
  const selectedPartId = useLabStore((s) => s.selectedPartId)
  const ref = useRef(null)
  useEffect(() => useHover.subscribe((s) => {
    const el = ref.current; if (!el) return
    const box = el.parentElement?.getBoundingClientRect()
    if (!box) return
    const w = el.offsetWidth, h = el.offsetHeight, px = s.x - box.left, py = s.y - box.top
    // Below-right of the pointer (client coordinates); flipped near the right/bottom edges.
    const x = px + 16 + w > box.width - 8 ? px - 12 - w : px + 16
    const y = py + 18 + h > box.height - 8 ? py - 10 - h : py + 18
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
  }), [])
  const part = id ? getPart(labId, id) : null
  // The selected part already carries its own label.
  const show = labelsOn && part && id !== selectedPartId
  return (
    <div ref={ref} aria-hidden="true"
      className={`pointer-events-none absolute left-0 top-0 z-[25] rounded-md bg-[#16212b]/90 px-2 py-1 text-xs font-medium text-white whitespace-nowrap shadow transition-opacity duration-150 ${show ? 'opacity-100' : 'opacity-0'}`}>
      {part?.name ?? ''}
    </div>
  )
}
