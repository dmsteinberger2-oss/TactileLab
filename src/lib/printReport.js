import * as THREE from 'three'

// Signed tetrahedron volume sum; geometry in cm -> cm^3. Works for closed meshes.
export function meshVolumeCm3(mesh) {
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
  const pos = g.attributes.position
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const m = mesh.matrixWorld
  let vol = 0
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i).applyMatrix4(m)
    b.fromBufferAttribute(pos, i + 1).applyMatrix4(m)
    c.fromBufferAttribute(pos, i + 2).applyMatrix4(m)
    vol += a.dot(b.clone().cross(c)) / 6
  }
  return Math.abs(vol)
}

// Rough desktop-FDM assumptions, stated on the kit card: PLA 1.24 g/cm^3, 3 perimeters +
// 20% infill ≈ 0.38 effective density, ~2.2 min per gram at 0.2 mm layers, PLA $20/kg.
export const PRINT_ASSUMPTIONS = { material: 'PLA', layerMm: 0.2, infillPct: 20, effDensity: 0.38, plaDensity: 1.24, minPerGram: 2.2, usdPerKg: 20 }

// Volume of a binary STL in millimetres (the print files) -> cm^3.
export function stlVolumeCm3(buffer) {
  const dv = new DataView(buffer)
  const n = dv.getUint32(80, true)
  let vol = 0
  for (let i = 0, o = 84 + 12; i < n; i++, o += 50) {
    const f = (k) => dv.getFloat32(o + k * 4, true)
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [f(0), f(1), f(2), f(3), f(4), f(5), f(6), f(7), f(8)]
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  return Math.abs(vol) / 1000
}

export function partReport(mesh, name) {
  return volumeReport(mesh.name, name, meshVolumeCm3(mesh))
}

export function volumeReport(id, name, cm3) {
  const grams = cm3 * PRINT_ASSUMPTIONS.plaDensity * PRINT_ASSUMPTIONS.effDensity
  return { id, name, cm3: round(cm3), grams: round(grams), minutes: Math.round(grams * PRINT_ASSUMPTIONS.minPerGram) }
}

export function summarise(parts) {
  const totalGrams = round(parts.reduce((s, p) => s + p.grams, 0))
  const totalMinutes = parts.reduce((s, p) => s + p.minutes, 0)
  return { parts, totalGrams, totalMinutes, costUsd: round(totalGrams / 1000 * PRINT_ASSUMPTIONS.usdPerKg, 2) }
}
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d
