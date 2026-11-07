import { Suspense, useMemo, useEffect, useReducer } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Html, Bounds, Environment, ContactShadows, useGLTF } from '@react-three/drei'
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
const L = KIDNEY_DIMS_CM.length / 2, W = KIDNEY_DIMS_CM.width / 2, T = KIDNEY_DIMS_CM.thickness / 2

function PartMesh({ partId, geometry, position = [0, 0, 0], rotation, explodeDir = [0, 0, 0], explodeDist = 3, clip }) {
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
  const color = partColors[partId] ?? part?.defaultColor ?? '#999'
  const hasVertexColors = !!geometry.attributes.color

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
          color={color}
          vertexColors={hasVertexColors}
          roughness={partId === 'renal_sinus' ? 0.55 : 0.42}
          metalness={0}
          clearcoat={0.35}
          clearcoatRoughness={0.4}
          sheen={0.25}
          sheenRoughness={0.6}
          sheenColor={'#ffffff'}
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
function GLTFParts({ url, clip, coronal }) {
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
      return { partId, geometry: m.geometry, dir: dir.toArray() }
    })
  }, [scene, coronal])
  return (
    <group>
      {meshes.map(({ partId, geometry, dir }) => (
        <PartMesh key={partId} partId={partId} geometry={geometry} explodeDir={dir} explodeDist={coronal ? 2.2 : 3}
          clip={BASE_PARTS.has(partId) ? clip : undefined} />
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
function PlaceholderParts({ stage, clip }) {
  const kidneyGeo = useKidneyGeometry()
  const r = Math.max((stage.sizeCm ?? 0) / 2, 0.01)
  const tumorGeo = useMemo(() => new THREE.SphereGeometry(r, 48, 32), [r])
  const tube = useMemo(() => new THREE.CylinderGeometry(0.35, 0.35, 3.2, 24), [])
  return (
    <group>
      <PartMesh partId="kidney_body" geometry={kidneyGeo} clip={clip} />
      <PartMesh partId="renal_vein" geometry={tube} position={[-W - 1.2, 0.3, 0.9]} rotation={[0, 0, Math.PI / 2]} explodeDir={[-1, 0, 0.3]} />
      <PartMesh partId="renal_artery" geometry={tube} position={[-W - 1.2, 0.9, 0]} rotation={[0, 0, Math.PI / 2]} explodeDir={[-1, 0, 0]} />
      {stage.parts.includes('tumor') && <PartMesh partId="tumor" geometry={tumorGeo} position={stage.position ?? [0, 0, 0]} explodeDir={[0.4, 1, 0.6]} />}
    </group>
  )
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
      <Environment preset="studio" environmentIntensity={0.55} />
      {!checking && (
        <Bounds key={url ?? 'placeholder'} fit clip observe margin={1.18}>
          <group onPointerMissed={() => selectPart(null)}>
            {url ? (
              <Suspense fallback={null}>
                <GLTFParts url={url} clip={clip} coronal={coronal} />
              </Suspense>
            ) : (
              <PlaceholderParts stage={stage} clip={clip} />
            )}
            {compareNormal && stage.id !== 'normal' && hasFull && <GhostNormal labId={labId} coronal={coronal} />}
          </group>
        </Bounds>
      )}
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

export default function ModelCanvas({ className = '' }) {
  return (
    <div className={`relative h-full w-full ${className}`}>
      <Canvas shadows="percentage" dpr={[1, 2]} camera={{ position: [5, 4, 30], fov: 32 }}
        gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}>
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
    </div>
  )
}
