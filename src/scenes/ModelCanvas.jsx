import { Component, Suspense, useMemo, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html, Environment, ContactShadows, useGLTF } from '@react-three/drei'
import { useSpring, a } from '@react-spring/three'
import * as THREE from 'three'
import { useLabStore } from '@/store/labStore'
import { getLab, getStage, getPart, KIDNEY_DIMS_CM } from '@/data/labs'
import { registerSceneRoot } from '@/lib/sceneRegistry'

// Scene units are cm. Long axis +Y, hilum facing -X, anterior +Z.
// Models come from tools/kidney_sdf.py: /models/<lab>_<stage>.glb (whole) and
// /models/<lab>_<stage>_coronal.glb (coronal section with inlays). Each mesh is named by part id.
// Placeholders render until a GLB exists, so the app never shows an empty canvas.

const BASE_PARTS = new Set(['kidney_body', 'renal_cortex'])
// drei's "studio" preset HDR (Poly Haven studio_small_03, CC0), served locally so lighting needs no network.
const STUDIO_HDR = '/hdri/studio_small_03_1k.hdr'

// Renders `fallback` (default: nothing) if anything below throws, e.g. the HDR failing to load.
// The directional and hemisphere lights live outside it, so the model stays lit.
class SilentBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err) { console.warn('[ModelCanvas] optional scene element failed, continuing without it:', err?.message ?? err) }
  render() { return this.state.failed ? (this.props.fallback ?? null) : this.props.children }
}
const L = KIDNEY_DIMS_CM.length / 2, W = KIDNEY_DIMS_CM.width / 2, T = KIDNEY_DIMS_CM.thickness / 2

function PartMesh({ partId, geometry, position = [0, 0, 0], rotation, explodeDir = [0, 0, 0], explodeDist = 3, clip, map = null, baked = false }) {
  const partColors = useLabStore((s) => s.partColors)
  const selectedPartId = useLabStore((s) => s.selectedPartId)
  const selectPart = useLabStore((s) => s.selectPart)
  const exploded = useLabStore((s) => s.exploded)
  const lifted0 = useLabStore((s) => !!s.liftedParts[partId])
  const toggleLift = useLabStore((s) => s.toggleLift)
  const labelsOn = useLabStore((s) => s.labelsOn)
  const labId = useLabStore((s) => s.labId)
  const part = getPart(labId, partId)
  const isBase = BASE_PARTS.has(partId)
  const lifted = !isBase && (exploded || lifted0)
  const selected = selectedPartId === partId
  const target = lifted ? position.map((p, i) => p + explodeDir[i] * explodeDist) : position
  const { p } = useSpring({ p: target, config: { tension: 170, friction: 24 } })
  const chosen = partColors[partId] ?? part?.defaultColor ?? '#999'
  // Baked GLBs carry their full colour in vertex colours/texture: tint relative to the default so the
  // default renders exactly as authored and the colour picker still works.
  const color = useMemo(() => {
    if (!baked) return new THREE.Color(chosen)
    const c = new THREE.Color(chosen), d = new THREE.Color(part?.defaultColor ?? chosen)
    return new THREE.Color(c.r / Math.max(d.r, 1e-3), c.g / Math.max(d.g, 1e-3), c.b / Math.max(d.b, 1e-3))
  }, [chosen, baked, part?.defaultColor])
  const useMap = map && geometry.attributes.uv ? map : null
  const hasVertexColors = !!geometry.attributes.color
  const matte = partId === 'renal_sinus' || partId === 'adrenal_gland'

  const labelPos = useMemo(() => {
    geometry.computeBoundingBox()
    const c = new THREE.Vector3(); geometry.boundingBox.getCenter(c)
    if (isBase) c.y += (geometry.boundingBox.max.y - c.y) * 0.55
    return c.toArray()
  }, [geometry, isBase])

  return (
    <a.group position={p} rotation={rotation}>
      <mesh
        name={partId}
        geometry={geometry}
        castShadow
        receiveShadow
        onClick={(e) => { e.stopPropagation(); selectPart(selected ? null : partId); if (part?.removable) toggleLift(partId) }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'auto' }}
      >
        <meshPhysicalMaterial
          key={useMap ? 'mapped' : 'plain'}
          color={color}
          map={useMap}
          vertexColors={hasVertexColors}
          roughness={matte ? 0.58 : 0.46}
          metalness={0}
          clearcoat={0.55}
          clearcoatRoughness={0.28}
          sheen={0.2}
          sheenRoughness={0.6}
          sheenColor={'#fff4ee'}
          envMapIntensity={0.7}
          emissive={selected ? '#0f766e' : '#000000'}
          emissiveIntensity={selected ? 0.28 : 0}
          clippingPlanes={clip ?? []}
          clipShadows
          side={clip ? THREE.DoubleSide : THREE.FrontSide}
        />
      </mesh>
      {labelsOn && (selected || lifted) && part && (
        <Html position={labelPos} center distanceFactor={14} style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
          <div className="rounded-md bg-[#16212b] px-2 py-1 text-xs font-medium text-white whitespace-nowrap shadow">{part.name}</div>
        </Html>
      )}
    </a.group>
  )
}

// ---------- GLB parts ----------
function GLTFParts({ url, clip, coronal, onReady }) {
  const { scene } = useGLTF(url)
  const meshes = useMemo(() => {
    const out = []
    scene.traverse((o) => { if (o.isMesh) out.push(o) })
    return out.map((m) => {
      const partId = m.name.replace(/\.\d+$/, '')
      m.geometry.computeBoundingBox()
      const c = new THREE.Vector3(); m.geometry.boundingBox.getCenter(c)
      let dir
      if (BASE_PARTS.has(partId)) dir = new THREE.Vector3()
      else if (coronal) dir = new THREE.Vector3(c.x * 0.06, c.y * 0.04, 1).normalize()   // inlays lift out of the cut face
      else dir = c.lengthSq() > 1e-6 ? c.clone().normalize() : new THREE.Vector3(0, 1, 0)
      const map = m.material?.map ?? null
      if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8; map.needsUpdate = true }
      return { partId, geometry: m.geometry, dir: dir.toArray(), map }
    })
  }, [scene, coronal])
  // Runs only once the GLB has loaded (this component suspends until then). Measures the parts at
  // rest from their geometry, so exploded/lifted offsets and labels never inflate the fit.
  useLayoutEffect(() => {
    const box = new THREE.Box3()
    meshes.forEach(({ geometry }) => { geometry.computeBoundingBox(); box.union(geometry.boundingBox) })
    onReady?.(box)
  }, [meshes, onReady])
  return (
    <group>
      {meshes.map(({ partId, geometry, dir, map }) => (
        <PartMesh key={partId} partId={partId} geometry={geometry} explodeDir={dir} explodeDist={coronal ? 2.2 : 3}
          clip={BASE_PARTS.has(partId) ? clip : undefined} map={map} baked />
      ))}
    </group>
  )
}

// ---------- placeholders (only until GLBs are present) ----------
function useKidneyGeometry() {
  return useMemo(() => {
    const g = new THREE.SphereGeometry(1, 64, 48)
    const pos = g.attributes.position; const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      v.x += Math.exp(-((v.y * 1.6) ** 2)) * Math.max(0, -v.x) * 0.55
      pos.setXYZ(i, v.x * W, v.y * L, v.z * T)
    }
    g.computeVertexNormals(); return g
  }, [])
}
function PlaceholderParts({ stage, clip, onReady }) {
  const kidneyGeo = useKidneyGeometry()
  const r = Math.max((stage.sizeCm ?? 0) / 2, 0.01)
  const tumorGeo = useMemo(() => new THREE.SphereGeometry(r, 48, 32), [r])
  const tube = useMemo(() => new THREE.CylinderGeometry(0.35, 0.35, 3.2, 24), [])
  // Placeholder parts sit at fixed offsets; the kidney plus the hilar tubes bound them.
  useLayoutEffect(() => {
    onReady?.(new THREE.Box3(new THREE.Vector3(-W - 2.8, -L, -T), new THREE.Vector3(W + r, L, T + 0.5)))
  }, [onReady, r])
  return (
    <group>
      <PartMesh partId="kidney_body" geometry={kidneyGeo} clip={clip} />
      <PartMesh partId="renal_vein" geometry={tube} position={[-W - 1.2, 0.3, 0.9]} rotation={[0, 0, Math.PI / 2]} explodeDir={[-1, 0, 0.3]} />
      <PartMesh partId="renal_artery" geometry={tube} position={[-W - 1.2, 0.9, 0]} rotation={[0, 0, Math.PI / 2]} explodeDir={[-1, 0, 0]} />
      {stage.parts.includes('tumor') && <PartMesh partId="tumor" geometry={tumorGeo} position={stage.position ?? [0, 0, 0]} explodeDir={[0.4, 1, 0.6]} />}
    </group>
  )
}

// ---------- camera fit ----------
// Frames the model's resting bounds so it fills FIT_FILL of the view in its limiting dimension
// (height on desktop, usually width on phones). Refits when a newly loaded model reports its
// bounds and when the canvas is resized; keeps the current viewing direction. Replaces drei
// <Bounds>, which fit while the GLB was still suspended: its box was empty, so it fell back to
// a cube sized by the camera distance and the camera moved further out on every switch.
const FIT_FILL = 0.8
const FIT_SECONDS = 0.6
function CameraFit({ box }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const anim = useRef(null)

  useEffect(() => {
    if (!box || box.isEmpty() || !controls || !size.width || !size.height) return
    const center = box.getCenter(new THREE.Vector3())
    const dir = camera.position.clone().sub(controls.target)
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1)
    dir.normalize()
    // Camera basis for looking at `center` from direction `dir`.
    const basis = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), camera.up)
    const right = new THREE.Vector3().setFromMatrixColumn(basis, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(basis, 1)
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const tanH = tanV * (size.width / size.height)
    // Smallest distance at which every box corner lands inside FIT_FILL of the frame.
    let dist = 0
    const p = new THREE.Vector3()
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center)
      const z = p.dot(dir)
      dist = Math.max(dist, z + Math.abs(p.dot(right)) / (FIT_FILL * tanH), z + Math.abs(p.dot(up)) / (FIT_FILL * tanV))
    }
    camera.near = Math.max(dist / 100, 0.01)
    camera.far = dist * 100
    camera.updateProjectionMatrix()
    controls.minDistance = Math.min(6, dist * 0.3)
    controls.maxDistance = Math.max(60, dist * 2.5)
    anim.current = {
      t: 0,
      fromPos: camera.position.clone(), toPos: center.clone().addScaledVector(dir, dist),
      fromTarget: controls.target.clone(), toTarget: center,
    }
    invalidate()
  }, [box, camera, controls, size.width, size.height, invalidate])

  // A drag cancels an in-flight fit so the user is never fought for the camera.
  useEffect(() => {
    if (!controls) return
    const stop = () => { anim.current = null }
    controls.addEventListener('start', stop)
    return () => controls.removeEventListener('start', stop)
  }, [controls])

  useFrame((_, delta) => {
    const a = anim.current
    if (!a) return
    a.t = Math.min(1, a.t + Math.min(delta, 0.05) / FIT_SECONDS)
    const k = 1 - (1 - a.t) ** 3
    camera.position.lerpVectors(a.fromPos, a.toPos, k)
    controls.target.lerpVectors(a.fromTarget, a.toTarget, k)
    controls.update()
    if (a.t >= 1) anim.current = null
    invalidate()
  })
  return null
}

// ---------- scene ----------
const glbCache = new Map()
function useGLBExists(url) {
  const [, force] = useReducer((x) => x + 1, 0)
  useEffect(() => {
    if (glbCache.has(url)) return
    let alive = true
    fetch(url, { method: 'HEAD' }).then((r) => {
      glbCache.set(url, r.ok && (r.headers.get('content-type') || '').includes('model'))
    }).catch(() => glbCache.set(url, false)).finally(() => { if (alive) force() })
    return () => { alive = false }
  }, [url])
  return glbCache.get(url)   // undefined while checking
}

function Scene() {
  const labId = useLabStore((s) => s.labId)
  const stageId = useLabStore((s) => s.stageId)
  const cutaway = useLabStore((s) => s.cutaway)
  const compareNormal = useLabStore((s) => s.compareNormal)
  const selectPart = useLabStore((s) => s.selectPart)
  const lab = getLab(labId)
  const stage = getStage(labId, stageId) ?? lab.stages[0]
  const { gl, scene } = useThree()
  const [fitBox, setFitBox] = useState(null)
  useEffect(() => { gl.localClippingEnabled = true; registerSceneRoot(scene) }, [gl, scene])

  const wantCoronal = cutaway === 'coronal'
  const fullUrl = `/models/${labId}_${stage.id}.glb`
  const coronalUrl = `/models/${labId}_${stage.id}_coronal.glb`
  const hasFull = useGLBExists(fullUrl)
  const hasCoronal = useGLBExists(coronalUrl)
  const url = wantCoronal && hasCoronal ? coronalUrl : hasFull ? fullUrl : null
  const coronal = url === coronalUrl
  const clip = useMemo(() => (wantCoronal && !coronal ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), -0.1)] : undefined), [wantCoronal, coronal])
  const checking = hasFull === undefined || (wantCoronal && hasCoronal === undefined)

  return (
    <>
      <hemisphereLight args={['#ffffff', '#c9bdb4', 0.55]} />
      <directionalLight position={[8, 14, 12]} intensity={1.7} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} />
      <directionalLight position={[-12, 4, -6]} intensity={0.6} color="#dfe8ff" />
      <directionalLight position={[0, -8, 10]} intensity={0.25} />
      <SilentBoundary>
        <Suspense fallback={null}>
          <Environment files={STUDIO_HDR} environmentIntensity={0.55} />
        </Suspense>
      </SilentBoundary>
      {!checking && (
        <group onPointerMissed={() => selectPart(null)}>
          {url ? (
            <Suspense fallback={null}>
              <GLTFParts key={url} url={url} clip={clip} coronal={coronal} onReady={setFitBox} />
            </Suspense>
          ) : (
            <PlaceholderParts stage={stage} clip={clip} onReady={setFitBox} />
          )}
          {compareNormal && stage.id !== 'normal' && hasFull && (
            <Suspense fallback={null}><GhostNormal labId={labId} coronal={coronal} /></Suspense>
          )}
        </group>
      )}
      <CameraFit box={fitBox} />
      <ContactShadows position={[0, -8.8, 0]} opacity={0.32} scale={34} blur={2.6} far={14} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={6} maxDistance={60} />
    </>
  )
}

function GhostNormal({ labId, coronal }) {
  const { scene } = useGLTF(`/models/${labId}_normal${coronal ? '_coronal' : ''}.glb`)
  const geo = useMemo(() => {
    let g = null
    scene.traverse((o) => { if (o.isMesh && BASE_PARTS.has(o.name.replace(/\.\d+$/, ''))) g = o.geometry })
    return g
  }, [scene])
  if (!geo) return null
  return (
    <mesh geometry={geo} raycast={() => null}>
      <meshStandardMaterial color="#0f766e" transparent opacity={0.16} depthWrite={false} />
    </mesh>
  )
}

// three r163+ renders with WebGL2 only.
function hasWebGL2() {
  try { return !!window.WebGL2RenderingContext && !!document.createElement('canvas').getContext('webgl2') } catch { return false }
}

function ViewerUnavailable() {
  return (
    <div role="status" className="flex h-full w-full items-center justify-center p-6 text-center text-sm font-medium text-[#5c7164]">
      3D view unavailable on this device
    </div>
  )
}

// Anything thrown inside the R3F tree (WebGL context creation, a model that fails to load, a
// render error) surfaces here, so only the viewer area is replaced and the rest of the page,
// including Download kit, keeps working.
class ViewerBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err) { console.error('[ModelCanvas] 3D view failed:', err) }
  render() { return this.state.failed ? <ViewerUnavailable /> : this.props.children }
}

export default function ModelCanvas({ className = '' }) {
  const [webgl] = useState(hasWebGL2)
  return (
    <div className={`relative h-full w-full ${className}`}>
      {webgl ? (
        <ViewerBoundary>
          <Canvas shadows="percentage" dpr={[1, 2]} camera={{ position: [5, 4, 30], fov: 32 }}
            gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0 }}>
            <Suspense fallback={null}>
              <Scene />
            </Suspense>
          </Canvas>
        </ViewerBoundary>
      ) : <ViewerUnavailable />}
    </div>
  )
}
