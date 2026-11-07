import { QRCodeCanvas } from 'qrcode.react'
import { useLabStore } from '@/store/labStore'
import { learnUrl } from '@/lib/share'

// QR to the student view for the current config. id="kit-qr" lets the kit exporter
// read the canvas for the PDF.
export default function KitQR({ size = 160 }) {
  useLabStore((s) => s.stageId); useLabStore((s) => s.goal)
  useLabStore((s) => s.audience); useLabStore((s) => s.cutaway); useLabStore((s) => s.partColors)
  return <QRCodeCanvas id="kit-qr" value={learnUrl()} size={size} level="M" includeMargin />
}
