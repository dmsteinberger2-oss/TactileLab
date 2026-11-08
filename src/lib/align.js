// Rigid registration of a part's assembled geometry (from the GLB) onto its print-oriented STL.
// The generator rotates and re-centres every print STL on its own, so to fuse a fixed part into the
// base part we recover each STL's pose (print = R * assembled + t) and compose the two.
// Multi-start trimmed ICP: axis-aligned, principal-axis and random starting rotations, coarse then fine.

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// Area-weighted random points on a triangle soup (deterministic).
export function samplePoints(tri, n, seed = 1, normalsOut = null) {
  const m = tri.length / 9, cum = new Float64Array(m)
  let total = 0
  for (let i = 0; i < m; i++) {
    const p = i * 9
    const ux = tri[p + 3] - tri[p], uy = tri[p + 4] - tri[p + 1], uz = tri[p + 5] - tri[p + 2]
    const vx = tri[p + 6] - tri[p], vy = tri[p + 7] - tri[p + 1], vz = tri[p + 8] - tri[p + 2]
    total += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); cum[i] = total
  }
  const rnd = mulberry32(seed), out = new Float64Array(n * 3)
  for (let k = 0; k < n; k++) {
    const r = rnd() * total
    let lo = 0, hi = m - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid }
    let a = rnd(), b = rnd(); if (a + b > 1) { a = 1 - a; b = 1 - b }
    const p = lo * 9
    for (let c = 0; c < 3; c++) out[k * 3 + c] = tri[p + c] + a * (tri[p + 3 + c] - tri[p + c]) + b * (tri[p + 6 + c] - tri[p + c])
    if (normalsOut) {
      const ux = tri[p + 3] - tri[p], uy = tri[p + 4] - tri[p + 1], uz = tri[p + 5] - tri[p + 2]
      const vx = tri[p + 6] - tri[p], vy = tri[p + 7] - tri[p + 1], vz = tri[p + 8] - tri[p + 2]
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1
      normalsOut[k * 3] = nx / l; normalsOut[k * 3 + 1] = ny / l; normalsOut[k * 3 + 2] = nz / l
    }
  }
  return out
}

// Jacobi eigen-decomposition of a small symmetric matrix (array of rows). Eigenvectors are columns of `vectors`.
export function jacobi(A) {
  const n = A.length, a = A.map((r) => r.slice()), v = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j]
    if (off < 1e-22) break
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1), s = t * c
      for (let k = 0; k < n; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq }
      for (let k = 0; k < n; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk }
      for (let k = 0; k < n; k++) { const kp = v[k][p], kq = v[k][q]; v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq }
    }
  }
  return { values: a.map((r, i) => r[i]), vectors: v }
}

// Horn (1987) closed-form absolute orientation from paired points: b ≈ R a + t.
function horn(A, B, use, count) {
  const ca = [0, 0, 0], cb = [0, 0, 0]
  for (let i = 0; i < use.length; i++) { if (!use[i]) continue; for (let k = 0; k < 3; k++) { ca[k] += A[i * 3 + k]; cb[k] += B[i * 3 + k] } }
  for (let k = 0; k < 3; k++) { ca[k] /= count; cb[k] /= count }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < use.length; i++) {
    if (!use[i]) continue
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += (A[i * 3 + r] - ca[r]) * (B[i * 3 + c] - cb[c])
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ]
  const { values, vectors } = jacobi(N)
  const best = values.indexOf(Math.max(...values))
  const [w, x, y, z] = vectors.map((r) => r[best])
  const R = [
    w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (y * x + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
    2 * (z * x - w * y), 2 * (z * y + w * x), w * w - x * x - y * y + z * z,
  ]
  return { R, t: [0, 1, 2].map((k) => cb[k] - (R[k * 3] * ca[0] + R[k * 3 + 1] * ca[1] + R[k * 3 + 2] * ca[2])) }
}

// Uniform grid over P for nearest-neighbour queries; rings are searched outwards from the query cell
// and stop once no closer point can exist. Queries further than `maxRing` cells from any point miss.
function makeGrid(P, h) {
  const m = P.length / 3, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let j = 0; j < m; j++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[j * 3 + k]); hi[k] = Math.max(hi[k], P[j * 3 + k]) }
  const dim = lo.map((l, k) => Math.max(1, Math.ceil((hi[k] - l) / h) + 1))
  const cellOf = (j) => { let c = 0; for (let k = 2; k >= 0; k--) c = c * dim[k] + Math.min(dim[k] - 1, Math.floor((P[j * 3 + k] - lo[k]) / h)); return c }
  const start = new Int32Array(dim[0] * dim[1] * dim[2] + 1), cells = new Int32Array(m), order = new Int32Array(m)
  for (let j = 0; j < m; j++) { cells[j] = cellOf(j); start[cells[j] + 1]++ }
  for (let c = 0; c < start.length - 1; c++) start[c + 1] += start[c]
  const fill = start.slice(0, -1)
  for (let j = 0; j < m; j++) order[fill[cells[j]]++] = j
  return { P, h, lo, dim, start, order }
}
function nearest(grid, x, y, z, maxRing = 8) {
  const { P, h, lo, dim, start, order } = grid
  const fx = (x - lo[0]) / h, fy = (y - lo[1]) / h, fz = (z - lo[2]) / h
  const cx = Math.floor(fx), cy = Math.floor(fy), cz = Math.floor(fz)
  // Distance from the query to its own cell's walls; ring r+1 is at least edge + r*h away.
  const edge = Math.max(0, Math.min(fx - cx, cx + 1 - fx, fy - cy, cy + 1 - fy, fz - cz, cz + 1 - fz)) * h
  const nx = dim[0], ny = dim[1], nz = dim[2]
  let best = Infinity, bj = -1
  for (let r = 0; r <= maxRing; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const ix = cx + dx; if (ix < 0 || ix >= nx) continue
      const ax = dx < 0 ? -dx : dx
      for (let dy = -r; dy <= r; dy++) {
        const iy = cy + dy; if (iy < 0 || iy >= ny) continue
        const shell = ax === r || dy === r || dy === -r
        const step = shell ? 1 : 2 * r
        for (let dz = -r; dz <= r; dz += step) {
          const iz = cz + dz
          if (iz >= 0 && iz < nz) {
            const c = (iz * ny + iy) * nx + ix
            for (let k = start[c], e = start[c + 1]; k < e; k++) {
              const j = order[k] * 3, ex = P[j] - x, ey = P[j + 1] - y, ez = P[j + 2] - z
              const d = ex * ex + ey * ey + ez * ez
              if (d < best) { best = d; bj = j / 3 }
            }
          }
          if (step === 0) break
        }
      }
    }
    const reach = edge + r * h
    if (bj >= 0 && best <= reach * reach) break
  }
  return [bj, best]
}

// Trimmed point-to-point ICP from G (moving) to P (fixed), neighbours from the grid. Returns the pose and
// the trimmed RMS in mm. Points with no neighbour within `maxRing` cells score as that distance and
// are left out of the fit, so a bad start can't look good by losing its points.
function icp(G, P, R, t, iters, keep, grid, maxRing) {
  const n = G.length / 3, capSq = (maxRing * grid.h) ** 2
  const M = new Float64Array(n * 3), d2 = new Float64Array(n), use = new Uint8Array(n), hit = new Uint8Array(n)
  let rms = Infinity
  for (let it = 0; it <= iters; it++) {
    for (let i = 0; i < n; i++) {
      const gx = G[i * 3], gy = G[i * 3 + 1], gz = G[i * 3 + 2]
      const [j, d] = nearest(grid, R[0] * gx + R[1] * gy + R[2] * gz + t[0], R[3] * gx + R[4] * gy + R[5] * gz + t[1], R[6] * gx + R[7] * gy + R[8] * gz + t[2], maxRing)
      hit[i] = j >= 0 ? 1 : 0; d2[i] = j >= 0 ? Math.min(d, capSq) : capSq
      if (j >= 0) { M[i * 3] = P[j * 3]; M[i * 3 + 1] = P[j * 3 + 1]; M[i * 3 + 2] = P[j * 3 + 2] }
    }
    const thr = Float64Array.from(d2).sort()[Math.max(0, Math.floor(n * keep) - 1)]
    let count = 0, fit = 0, sum = 0
    for (let i = 0; i < n; i++) {
      if (d2[i] > thr) { use[i] = 0; continue }
      count++; sum += d2[i]; use[i] = hit[i]; fit += hit[i]
    }
    rms = Math.sqrt(sum / count)
    if (it === iters || fit < 3) break
    ;({ R, t } = horn(G, M, use, fit))
  }
  return { R, t, rms }
}

// Trimmed point-to-plane ICP (small-angle Gauss-Newton per iteration). Converges along shallow
// directions (e.g. spin of a near-round part about its axis) where point-to-point ICP stalls.
// Reported rms is still the trimmed point-to-point distance, comparable with icp().
function icpPlane(G, P, N, R, t, iters, keep, grid) {
  const n = G.length / 3
  const X = new Float64Array(n * 3), J = new Int32Array(n), d2 = new Float64Array(n)
  let rms = Infinity
  for (let it = 0; it <= iters; it++) {
    for (let i = 0; i < n; i++) {
      const gx = G[i * 3], gy = G[i * 3 + 1], gz = G[i * 3 + 2]
      X[i * 3] = R[0] * gx + R[1] * gy + R[2] * gz + t[0]; X[i * 3 + 1] = R[3] * gx + R[4] * gy + R[5] * gz + t[1]; X[i * 3 + 2] = R[6] * gx + R[7] * gy + R[8] * gz + t[2]
      const [j, d] = nearest(grid, X[i * 3], X[i * 3 + 1], X[i * 3 + 2]); J[i] = j; d2[i] = j < 0 ? Infinity : d
    }
    const thr = Float64Array.from(d2).sort()[Math.max(0, Math.floor(n * keep) - 1)]
    const AtA = Array.from({ length: 6 }, () => new Array(6).fill(0)), Atb = new Array(6).fill(0)
    let count = 0, sum = 0
    for (let i = 0; i < n; i++) {
      if (!(d2[i] <= thr && d2[i] < Infinity)) continue
      count++; sum += d2[i]
      const j = J[i], x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2], nx = N[j * 3], ny = N[j * 3 + 1], nz = N[j * 3 + 2]
      const a = [y * nz - z * ny, z * nx - x * nz, x * ny - y * nx, nx, ny, nz]
      const b = -((x - P[j * 3]) * nx + (y - P[j * 3 + 1]) * ny + (z - P[j * 3 + 2]) * nz)
      for (let r = 0; r < 6; r++) { Atb[r] += a[r] * b; for (let c = 0; c < 6; c++) AtA[r][c] += a[r] * a[c] }
    }
    if (count < 6) return { R, t, rms: Infinity }
    rms = Math.sqrt(sum / count)
    if (it === iters) break
    const dx = solve6(AtA, Atb)
    if (!dx) break
    const W = rodrigues(dx[0], dx[1], dx[2])
    R = mul3(W, R)
    t = [0, 1, 2].map((r) => W[r * 3] * t[0] + W[r * 3 + 1] * t[1] + W[r * 3 + 2] * t[2] + dx[3 + r])
  }
  return { R, t, rms }
}
function rodrigues(wx, wy, wz) {
  const th = Math.hypot(wx, wy, wz)
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const x = wx / th, y = wy / th, z = wz / th, c = Math.cos(th), s = Math.sin(th), C = 1 - c
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C]
}
function mul3(A, B) {
  const out = new Array(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c]
  return out
}
function solve6(A, b) {   // Gaussian elimination with partial pivoting
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < 6; c++) {
    let p = c
    for (let r = c + 1; r < 6; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < 6; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k < 7; k++) M[r][k] -= f * M[c][k] }
  }
  const x = new Array(6).fill(0)
  for (let r = 5; r >= 0; r--) { let v = M[r][6]; for (let k = r + 1; k < 6; k++) v -= M[r][k] * x[k]; x[r] = v / M[r][r] }
  return x
}

function cubeRotations() {
  const out = [], perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
  for (const p of perms) for (let s = 0; s < 8; s++) {
    const R = new Array(9).fill(0), sg = [s & 1 ? -1 : 1, s & 2 ? -1 : 1, s & 4 ? -1 : 1]
    for (let r = 0; r < 3; r++) R[r * 3 + p[r]] = sg[r]
    if (Math.abs(det(R) - 1) < 1e-9) out.push(R)
  }
  return out
}
const det = (R) => R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6])

function centroidAndAxes(pts) {
  const n = pts.length / 3, c = [0, 0, 0]
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += pts[i * 3 + k] / n
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) C[r][s] += (pts[i * 3 + r] - c[r]) * (pts[i * 3 + s] - c[s]) / n
  const { values, vectors } = jacobi(C)
  const order = [0, 1, 2].sort((a, b) => values[b] - values[a])
  return { c, E: order.map((j) => vectors.map((row) => row[j])) }   // E[k] = k-th principal axis
}

// R mapping G's principal axes onto P's, for each sign choice with det +1.
function pcaRotations(G, P) {
  const g = centroidAndAxes(G), p = centroidAndAxes(P), out = []
  for (let s = 0; s < 8; s++) {
    const sg = [s & 1 ? -1 : 1, s & 2 ? -1 : 1, s & 4 ? -1 : 1]
    const R = new Array(9).fill(0)
    for (let k = 0; k < 3; k++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[r * 3 + c] += sg[k] * p.E[k][r] * g.E[k][c]
    if (det(R) > 0) out.push(R)
  }
  return out
}

const centroid = (pts) => { const n = pts.length / 3, c = [0, 0, 0]; for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += pts[i * 3 + k] / n; return c }

function randomRotations(n, seed) {
  const rnd = mulberry32(seed), out = []
  for (let i = 0; i < n; i++) {
    const u1 = rnd(), u2 = rnd() * 2 * Math.PI, u3 = rnd() * 2 * Math.PI
    const w = Math.sqrt(1 - u1) * Math.sin(u2), x = Math.sqrt(1 - u1) * Math.cos(u2), y = Math.sqrt(u1) * Math.sin(u3), z = Math.sqrt(u1) * Math.cos(u3)
    out.push([
      w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
      2 * (y * x + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
      2 * (z * x - w * y), 2 * (z * y + w * x), w * w - x * x - y * y + z * z,
    ])
  }
  return out
}

// Find print ≈ R * assembled + t. `assembled` and `print` are triangle soups in mm.
// rms: trimmed (best 80%) RMS distance in mm; small (well under 1 mm) when the pose is right.
// Near-round parts (a tumour) have shallow rotational minima, hence many starts.
export function registerPart(assembled, print) {
  const Gc = samplePoints(assembled, 200, 11), Pc = samplePoints(print, 5000, 12)
  const { size } = boundsOfPoints(Pc), diag = Math.hypot(...size)
  const coarseGrid = makeGrid(Pc, Math.max(1, diag / 20))
  const cG = centroid(Gc), cP = centroid(Pc)
  const starts = [...cubeRotations(), ...pcaRotations(samplePoints(assembled, 3000, 13), samplePoints(print, 3000, 14)), ...randomRotations(96, 15)]
  const coarse = starts.map((R) => icp(Gc, Pc, R, [0, 1, 2].map((k) => cP[k] - (R[k * 3] * cG[0] + R[k * 3 + 1] * cG[1] + R[k * 3 + 2] * cG[2])), 10, 0.8, coarseGrid, 3))
    .sort((a, b) => a.rms - b.rms).slice(0, 6)
  // Fine: dense target so sampling noise (~half the point spacing) stays well under the 0.35 mm inflation.
  const Nf = new Float64Array(60000 * 3)
  const Gf = samplePoints(assembled, 2000, 21), Pf = samplePoints(print, 60000, 22, Nf)
  const grid = makeGrid(Pf, 1.5)
  return coarse.map((c) => icpPlane(Gf, Pf, Nf, c.R, c.t, 15, 0.8, grid)).sort((a, b) => a.rms - b.rms)[0]
}
function boundsOfPoints(pts) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pts.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pts[i + k]); hi[k] = Math.max(hi[k], pts[i + k]) }
  return { size: hi.map((h, k) => h - lo[k]) }
}

// Pose that carries points from the part's print frame into the base part's print frame:
// x_base = Rb * Rpᵀ * (x_part - tp) + tb.
export function composePoses(base, part) {
  const Rb = base.R, Rp = part.R, R = new Array(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) R[r * 3 + c] += Rb[r * 3 + k] * Rp[c * 3 + k]
  const t = [0, 1, 2].map((r) => base.t[r] - (R[r * 3] * part.t[0] + R[r * 3 + 1] * part.t[1] + R[r * 3 + 2] * part.t[2]))
  return { R, t }
}

// Surface index for contact tests: a nearest-neighbour grid over points sampled on a triangle soup.
export function surfaceIndex(tri, n = 30000) { return makeGrid(samplePoints(tri, n, 31), 1.5) }
// Share of a part's surface lying within `tol` mm of an indexed surface (same frame).
// ~0 means the part doesn't touch it: fusing would only add a floating shell.
export function contactFraction(index, partTri, tol = 0.6, n = 600) {
  const pts = samplePoints(partTri, n, 32)
  let near = 0
  for (let i = 0; i < pts.length; i += 3) { const [j, d] = nearest(index, pts[i], pts[i + 1], pts[i + 2], 1); if (j >= 0 && d <= tol * tol) near++ }
  return near / n
}
