import { useLabStore } from '@/store/labStore'
import { labs } from '@/data/labs'

// Absolute URL to the shareable /view page encoding the current config. Colours are included only
// when they differ from defaults so the QR stays small. Commas in the part lists are left unescaped.
export function viewUrl(cfg = useLabStore.getState().config()) {
  const p = new URLSearchParams()
  p.set('lab', cfg.labId)
  p.set('stage', cfg.stageId)
  if (cfg.cutaway !== 'full') p.set('cutaway', cfg.cutaway)
  if (!cfg.labelsOn) p.set('labels', '0')
  const defaults = Object.fromEntries((labs[cfg.labId]?.parts ?? []).map((x) => [x.id, x.defaultColor]))
  const diff = Object.fromEntries(Object.entries(cfg.partColors).filter(([k, v]) => defaults[k] !== v))
  if (Object.keys(diff).length) p.set('colors', btoa(JSON.stringify(diff)))
  // Part settings as short comma lists of ids (only non-defaults), so students see what the educator built.
  const pick = (map, value) => Object.keys(map ?? {}).filter((id) => map[id] === value).sort().join(',')
  for (const [key, list] of [['fixed', pick(cfg.partModes, 'fixed')], ['hide', pick(cfg.partVisibility, 'hide')], ['xray', pick(cfg.partVisibility, 'xray')]])
    if (list) p.set(key, list)
  // On a laptop the page is localhost, which a phone can't open. Set VITE_PUBLIC_ORIGIN to the LAN or
  // deployed address (e.g. http://192.168.1.20:5173) so QR codes point somewhere reachable.
  const env = import.meta.env.VITE_PUBLIC_ORIGIN
  const origin = env ? env.replace(/\/$/, '') : typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/view?${p.toString().replace(/%2C/g, ',')}`
}

export const shareIsLocalOnly = () =>
  !import.meta.env.VITE_PUBLIC_ORIGIN && typeof window !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(window.location.hostname)
