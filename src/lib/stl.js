// Binary STL helpers on flat triangle-soup arrays: Float32Array [ax,ay,az, bx,by,bz, cx,cy,cz, ...] in mm.

export function readStl(buffer) {
  const dv = new DataView(buffer)
  const n = dv.getUint32(80, true)
  if (84 + n * 50 !== buffer.byteLength) throw new Error('Not a binary STL')
  const pos = new Float32Array(n * 9)
  for (let i = 0, o = 84 + 12; i < n; i++, o += 50) for (let k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(o + k * 4, true)
  return pos
}

export function writeStl(pos, header = 'TactileLab') {
  const n = pos.length / 9
  const buf = new ArrayBuffer(84 + n * 50)
  const dv = new DataView(buf)
  for (let i = 0; i < Math.min(header.length, 80); i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f)
  dv.setUint32(80, n, true)
  for (let i = 0, o = 84; i < n; i++, o += 50) {
    const p = i * 9
    const ux = pos[p + 3] - pos[p], uy = pos[p + 4] - pos[p + 1], uz = pos[p + 5] - pos[p + 2]
    const vx = pos[p + 6] - pos[p], vy = pos[p + 7] - pos[p + 1], vz = pos[p + 8] - pos[p + 2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true)
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, pos[p + k], true)
  }
  return buf
}

export function scalePositions(pos, s) {
  if (s === 1) return pos
  const out = new Float32Array(pos.length)
  for (let i = 0; i < pos.length; i++) out[i] = pos[i] * s
  return out
}

// x' = R x + t, R row-major 3x3.
export function transformPositions(pos, R, t) {
  const out = new Float32Array(pos.length)
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2]
    out[i] = R[0] * x + R[1] * y + R[2] * z + t[0]
    out[i + 1] = R[3] * x + R[4] * y + R[5] * z + t[1]
    out[i + 2] = R[6] * x + R[7] * y + R[8] * z + t[2]
  }
  return out
}

// Offset every vertex `d` mm along its area-weighted vertex normal. Vertices are welded by position
// first, so a closed (watertight) shell stays closed. Assumes outward-facing (CCW) triangles.
export function inflatePositions(pos, d) {
  const key = (i) => `${Math.round(pos[i] * 1e4)},${Math.round(pos[i + 1] * 1e4)},${Math.round(pos[i + 2] * 1e4)}`
  const ids = new Map(), vid = new Int32Array(pos.length / 3)
  for (let v = 0; v < vid.length; v++) {
    const k = key(v * 3)
    let id = ids.get(k)
    if (id === undefined) { id = ids.size; ids.set(k, id) }
    vid[v] = id
  }
  const nrm = new Float64Array(ids.size * 3)
  for (let p = 0; p < pos.length; p += 9) {
    const ux = pos[p + 3] - pos[p], uy = pos[p + 4] - pos[p + 1], uz = pos[p + 5] - pos[p + 2]
    const vx = pos[p + 6] - pos[p], vy = pos[p + 7] - pos[p + 1], vz = pos[p + 8] - pos[p + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx   // |n| = 2 x area
    for (let k = 0; k < 3; k++) { const j = vid[p / 3 + k] * 3; nrm[j] += nx; nrm[j + 1] += ny; nrm[j + 2] += nz }
  }
  const out = new Float32Array(pos.length)
  for (let v = 0; v < vid.length; v++) {
    const j = vid[v] * 3, l = Math.hypot(nrm[j], nrm[j + 1], nrm[j + 2]) || 1
    for (let k = 0; k < 3; k++) out[v * 3 + k] = pos[v * 3 + k] + (nrm[j + k] / l) * d
  }
  return out
}

export function concatPositions(list) {
  const out = new Float32Array(list.reduce((s, a) => s + a.length, 0))
  let o = 0
  for (const a of list) { out.set(a, o); o += a.length }
  return out
}

export function boundsOf(pos) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v }
  return { lo, hi, size: hi.map((h, k) => h - lo[k]) }
}
