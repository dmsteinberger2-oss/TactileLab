import { QRCodeCanvas } from 'qrcode.react'
import { useLabStore } from '@/store/labStore'
import { viewUrl } from '@/lib/share'

// QR to the shareable /view page for the current config. id="kit-qr" lets the kit exporter
// read the canvas for the PDF.
export default function KitQR({ size = 160 }) {
  useLabStore((s) => s.stageId); useLabStore((s) => s.cutaway); useLabStore((s) => s.partColors); useLabStore((s) => s.labelsOn)
  useLabStore((s) => s.labId); useLabStore((s) => s.partModes); useLabStore((s) => s.partVisibility)
  return <QRCodeCanvas id="kit-qr" value={viewUrl()} size={size} level="M" includeMargin />
}
