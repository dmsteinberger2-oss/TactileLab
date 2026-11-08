import { Component, Suspense, memo, useCallback, useMemo, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html, Environment, useGLTF } from '@react-three/drei'
import { useSpring, a } from '@react-spring/three'
import * as THREE from 'three'
import { useLabStore } from '@/store/labStore'
import { getLab, getStage, getPart, KIDNEY_DIMS_CM } from '@/data/labs'
import { registerSceneRoot } from '@/lib/sceneRegistry'
import { makeTissueHooks } from './tissue'
import { Backdrop, IdleRotate, Lights, PostFX, qualityTier } from './Atmosphere'
import { useHover, setHover, moveHover, clearHover, HoverLabel } from './hover'

// Scene units are cm. Long axis +Y, hilum facing -X, anterior +Z.
// Models come from tools/kidney_sdf.py: /models/<lab>_<stage>.glb (whole) and
// /models/<lab>_<stage>_coronal.glb (coronal section with inlays). Each mesh is named by part id.
// Placeholders render until a GLB exists, so the app never shows an empty canvas.

// Base parts never lift. Each lab names its own per view (labs[labId].basePart); this is the fallback.
const DEFAULT_BASE = new Set(['kidney_body', 'renal_cortex', 'l5_vertebra'])
const basePartsOf = (lab) => (lab?.basePart ? new Set(Object.values(lab.basePart)) : DEFAULT_BASE)
// Surgical implants are not tissue: no procedural detail, no wrap lighting, no wet clearcoat.
const TITANIUM = { metalness: 1, roughness: 0.3, clearcoat: 0, sheen: 0, envMapIntensity: 1.1 }
const PEEK = { metalness: 0, roughness: 0.65, clearcoat: 0, sheen: 0, envMapIntensity: 0.6 }
const FINISH = { pedicle_screws: TITANIUM, rods: TITANIUM, interbody_cage: PEEK }
const LITE = qualityTier() === 'low'
// drei's "studio" preset HDR (Poly Haven studio_small_03, CC0), served locally so lighting needs no network.
const STUDIO_HDR = '/hdri/studio_small_03_1k.hdr'
// EffectComposer rebuilds its passes (new shaders, render targets) whenever its children change, i.e. on
// every re-render. Memoised, a stage or view switch leaves post-processing alone.
const StablePostFX = memo(PostFX)

// Renders `fallback` (default: nothing) if anything below throws, e.g. the HDR failing to load.
// The directional and hemisphere lights live outside it, so the model stays lit.
class SilentBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err) { console.warn('[ModelCanvas] optional scene element failed, continuing without it:', err?.message ?? err) }
  render() { return this.state.failed ? (this.props.fallback ?? null) : this.props.children }
}
const L = KIDNEY_DIMS_CM.length / 2, W = KIDNEY_DIMS_CM.width / 2, T = KIDNEY_DIMS_CM.thickness / 2

const noRaycast = () => null
const meshRaycast = THREE.Mesh.prototype.raycast
// Shared-store contract fields may not exist yet; read them with their defaults.
const setOpenIn = (b) => { const s = useLabStore.getState(); if (s.setOpen) s.setOpen(b); else useLabStore.setState({ open: b }) }

function PartMesh({ partId, geometry, position = [0, 0, 0], rotation, explodeDir = [0, 0, 0], explodeDist = 3, clip, map = null, baked = false, coronal = false, isBase = DEFAULT_BASE.has(partId), hinge = null, opensSection = false }) {
  const partColors = useLabStore((s) => s.partColors)
  const selectedPartId = useLabStore((s) => s.selectedPartId)
  const selectPart = useLabStore((s) => s.selectPart)
  const exploded = useLabStore((s) => s.exploded)
  const lifted0 = useLabStore((s) => !!s.liftedParts[partId])
  const toggleLift = useLabStore((s) => s.toggleLift)
  const labelsOn = useLabStore((s) => s.labelsOn)
  const labId = useLabStore((s) => s.labId)
  const fixed = useLabStore((s) => (s.partModes?.[partId] ?? 'removable') === 'fixed')
  const visibility = useLabStore((s) => s.partVisibility?.[partId] ?? 'show')
  const open = useLabStore((s) => s.open ?? true)
  const hovered = useHover((s) => s.id === partId)
  const part = getPart(labId, partId)
  // Base parts, fixed parts and the hinged front half never lift.
  const lifted = !isBase && !fixed && !hinge && (exploded || lifted0)
  const selected = selectedPartId === partId
  const xray = visibility === 'xray'
  const target = lifted ? position.map((p, i) => p + explodeDir[i] * explodeDist) : position
  const { p } = useSpring({ p: target, config: { tension: 170, friction: 24 } })
  // Hinge: opens from closed on first show, eased, about a vertical axis on the lateral border.
  const { ang } = useSpring({ ang: hinge && open ? hinge.angle : 0, from: { ang: 0 }, config: { tension: 70, friction: 20 } })
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
  const finish = FINISH[partId]
  // Procedural tissue detail (see tissue.js). Uniform objects are shared with the compiled shader.
  const uniforms = useMemo(() => ({ tlCut: { value: 0 }, tlHover: { value: 0 } }), [])
  uniforms.tlCut.value = coronal && useMap ? 1 : 0
  const tissue = useMemo(() => makeTissueHooks(partId, uniforms, LITE), [partId, uniforms])
  // Hover highlight eases in and out.
  useFrame((_, dt) => {
    const u = uniforms.tlHover, t = hovered && !xray ? 1 : 0
    if (Math.abs(u.value - t) > 1e-3) u.value += (t - u.value) * Math.min(1, dt * 14)
    else u.value = t
  })
  useEffect(() => () => clearHover(partId), [partId])
  useEffect(() => { if (xray || visibility === 'hide') clearHover(partId) }, [xray, visibility, partId])

  const labelPos = useMemo(() => {
    geometry.computeBoundingBox()
    const c = new THREE.Vector3(); geometry.boundingBox.getCenter(c)
    if (isBase) c.y += (geometry.boundingBox.max.y - c.y) * 0.55
    return c.toArray()
  }, [geometry, isBase])

  if (visibility === 'hide') return null
  const pivot = hinge ? hinge.pivot : null
  const hoverAt = (e) => {
    if (e.pointerType === 'touch') return   // touch has no hover; a tap is a click
    e.stopPropagation()
    const s = useHover.getState()
    if (s.id !== partId) setHover(partId, e.nativeEvent.clientX, e.nativeEvent.clientY)
    else moveHover(e.nativeEvent.clientX, e.nativeEvent.clientY)
  }

  return (
    <a.group position={p} rotation={rotation}>
      <a.group position={pivot ?? [0, 0, 0]} rotation-y={ang}>
        <group position={pivot ? pivot.map((v) => -v) : [0, 0, 0]}>
          <mesh
            name={partId}
            geometry={geometry}
            castShadow={!xray}
            receiveShadow
            raycast={xray ? noRaycast : meshRaycast}
            renderOrder={xray ? 2 : 0}
            onClick={(e) => {
              e.stopPropagation()
              if (hinge) { setOpenIn(!open); return }
              if (opensSection) { useLabStore.getState().setCutaway('coronal'); setOpenIn(true); return }
              selectPart(selected ? null : partId)
              if (part?.removable && !fixed && !isBase) toggleLift(partId)
            }}
            onPointerOver={hoverAt}
            onPointerMove={hoverAt}
            onPointerOut={() => clearHover(partId)}
          >
            <meshPhysicalMaterial
              key={`${useMap ? 'mapped' : 'plain'}${xray ? '-xray' : ''}`}
              color={color}
              map={useMap}
              vertexColors={hasVertexColors}
              roughness={finish?.roughness ?? (matte ? 0.58 : 0.46)}
              metalness={finish?.metalness ?? 0}
              clearcoat={finish?.clearcoat ?? 0.55}
              clearcoatRoughness={0.28}
              sheen={finish?.sheen ?? 0.2}
              sheenRoughness={0.6}
              sheenColor={'#fff4ee'}
              envMapIntensity={finish?.envMapIntensity ?? 0.7}
              emissive={selected ? '#0f766e' : '#000000'}
              emissiveIntensity={selected ? 0.28 : 0}
              transparent={xray}
              opacity={xray ? 0.22 : 1}
              depthWrite={!xray}
              clippingPlanes={clip ?? []}
              clipShadows
              side={clip ? THREE.DoubleSide : THREE.FrontSide}
              {...tissue}
            />
          </mesh>
          {/* Exploded: only the selected part is labelled (every part is lifted, so labels would pile up).
              Otherwise: the selected part and any part lifted by tapping it. */}
          {labelsOn && part && (selected || (!exploded && lifted)) && (
            <Html position={labelPos} center distanceFactor={14} style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
              <div className="rounded-md bg-[#16212b] px-2 py-1 text-xs font-medium text-white whitespace-nowrap shadow">{part.name}</div>
            </Html>
          )}
        </group>
      </a.group>
    </a.group>
  )
}

// ---------- GLB parts ----------
// Coronal front half: opens about a vertical axis through its lateral (+X) border in the cut plane.
const HINGE_PART = 'anterior_half'
// ~115° was asked for; 150° shows the front half's painted face far better and still fits.
const HINGE_ANGLE = THREE.MathUtils.degToRad(150)
const hingeFor = (geometry) => {
  geometry.computeBoundingBox()
  return { pivot: [geometry.boundingBox.max.x, 0, 0], angle: HINGE_ANGLE }
}
// Bounds of the front half when fully open (its box corners rotated about the hinge).
function openedBounds(geometry, hinge) {
  const b = geometry.boundingBox, out = new THREE.Box3(), v = new THREE.Vector3()
  const piv = new THREE.Vector3(...hinge.pivot), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hinge.angle)
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(piv).applyQuaternion(q).add(piv)
    out.expandByPoint(v)
  }
  return out
}

function GLTFParts({ url, clip, coronal, onReady, baseParts, opensSectionPart }) {
  const { scene } = useGLTF(url)
  const open = useLabStore((s) => s.open ?? true)
  const meshes = useMemo(() => {
    const out = []
    scene.traverse((o) => { if (o.isMesh) out.push(o) })
    return out.map((m) => {
      const partId = m.name.replace(/\.\d+$/, '')
      m.geometry.computeBoundingBox()
      const c = new THREE.Vector3(); m.geometry.boundingBox.getCenter(c)
      const hinge = coronal && partId === HINGE_PART ? hingeFor(m.geometry) : null
      let dir
      if (baseParts.has(partId) || hinge) dir = new THREE.Vector3()
      else if (coronal) dir = new THREE.Vector3(c.x * 0.06, c.y * 0.04, 1).normalize()   // inlays lift out of the cut face
      else dir = c.lengthSq() > 1e-6 ? c.clone().normalize() : new THREE.Vector3(0, 1, 0)
      const map = m.material?.map ?? null
      // Once per texture: needsUpdate re-uploads it to the GPU, which should not happen on every view switch.
      if (map && !map.userData.tlPrepared) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8; map.needsUpdate = true; map.userData.tlPrepared = true }
      return { partId, geometry: m.geometry, dir: dir.toArray(), map, hinge }
    })
  }, [scene, coronal, baseParts])
  // Runs only once the GLB has loaded (this component suspends until then). Measures the parts at
  // rest from their geometry, so exploded/lifted offsets and labels never inflate the fit. With the
  // front half open, its opened pose is included so the open model stays in frame.
  useLayoutEffect(() => {
    const box = new THREE.Box3()
    meshes.forEach(({ geometry, hinge }) => {
      geometry.computeBoundingBox(); box.union(geometry.boundingBox)
      if (hinge && open) box.union(openedBounds(geometry, hinge))
    })
    onReady?.(box)
  }, [meshes, onReady, open])
  return (
    <group>
      {meshes.map(({ partId, geometry, dir, map, hinge }) => (
        <PartMesh key={partId} partId={partId} geometry={geometry} explodeDir={dir} explodeDist={coronal ? 2.2 : 3}
          clip={baseParts.has(partId) ? clip : undefined} map={map} baked coronal={coronal}
          isBase={baseParts.has(partId)} hinge={hinge} opensSection={!coronal && partId === opensSectionPart} />
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
    // That bound is conservative for deep boxes (near corners project larger than far ones, so the
    // projected box is off-centre and smaller than FIT_FILL). Refine with the real projection:
    // re-centre the projected box and rescale the distance until its larger span is FIT_FILL.
    const probe = camera.clone(); probe.aspect = size.width / size.height; probe.updateProjectionMatrix()
    const target = center.clone()
    for (let it = 0; it < 4; it++) {
      probe.position.copy(target).addScaledVector(dir, dist); probe.lookAt(target); probe.updateMatrixWorld()
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      for (let i = 0; i < 8; i++) {
        p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(probe)
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y)
      }
      const span = Math.max((x1 - x0) / 2, (y1 - y0) / 2)
      target.addScaledVector(right, ((x0 + x1) / 2) * tanH * dist).addScaledVector(up, ((y0 + y1) / 2) * tanV * dist)
      dist *= span / FIT_FILL
    }
    camera.near = Math.max(dist / 100, 0.01)
    camera.far = dist * 100
    camera.updateProjectionMatrix()
    controls.minDistance = Math.min(6, dist * 0.3)
    controls.maxDistance = Math.max(60, dist * 2.5)
    anim.current = {
      t: 0,
      fromPos: camera.position.clone(), toPos: target.clone().addScaledVector(dir, dist),
      fromTarget: controls.target.clone(), toTarget: target,
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
// Loads a GLB without showing it (suspends in its own boundary), then reports it ready.
function LoadGLB({ url, onLoaded }) {
  useGLTF(url)
  useEffect(() => { onLoaded(url) }, [url, onLoaded])
  return null
}

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

function Scene({ tier }) {
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
  const baseParts = useMemo(() => basePartsOf(lab), [lab])
  // Whole view: clicking the kidney opens the coronal section (labs with a coronal view only).
  const opensSectionPart = lab.cutaways?.some((c) => c.id === 'coronal') ? (lab.basePart?.full ?? 'kidney_body') : null
  // Pointer cursor only while over a part.
  useEffect(() => useHover.subscribe((s, prev) => { if (s.id !== prev.id) gl.domElement.style.cursor = s.id ? 'pointer' : '' }), [gl])

  const wantCoronal = cutaway === 'coronal'
  const fullUrl = `/models/${labId}_${stage.id}.glb`
  const coronalUrl = `/models/${labId}_${stage.id}_coronal.glb`
  const hasFull = useGLBExists(fullUrl)
  const hasCoronal = useGLBExists(coronalUrl)
  const checking = hasFull === undefined || (wantCoronal && hasCoronal === undefined)
  // The GLB this stage and view want: undefined while checking, null when there is none (placeholder).
  const target = checking ? undefined : wantCoronal && hasCoronal ? coronalUrl : hasFull ? fullUrl : null
  // The GLB on screen. A newly wanted one loads offscreen and replaces it only once ready, so switching
  // view or stage keeps the previous model up instead of showing an empty frame.
  const [shownUrl, setShownUrl] = useState(null)
  const coronal = !!shownUrl?.endsWith('_coronal.glb')
  // No coronal GLB for this stage: clip the whole model instead.
  const coronalMissing = wantCoronal && hasCoronal === false
  const clip = useMemo(() => (coronalMissing && !coronal ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), -0.1)] : undefined), [coronalMissing, coronal])
  // Fetch the current stage's coronal section as soon as it is known to exist, so the first switch is instant.
  useEffect(() => { if (hasCoronal) useGLTF.preload(coronalUrl) }, [hasCoronal, coronalUrl])

  return (
    <>
      <Backdrop />
      <Lights shadows={tier === 'high'} />
      <SilentBoundary>
        <Suspense fallback={null}>
          <Environment files={STUDIO_HDR} environmentIntensity={0.55} />
        </Suspense>
      </SilentBoundary>
      <group onPointerMissed={() => selectPart(null)}>
        {target === null ? (
          <PlaceholderParts stage={stage} clip={clip} onReady={setFitBox} />
        ) : shownUrl && (
          <Suspense fallback={null}>
            <GLTFParts key={shownUrl} url={shownUrl} clip={clip} coronal={coronal} onReady={setFitBox} baseParts={baseParts} opensSectionPart={opensSectionPart} />
          </Suspense>
        )}
        {target && target !== shownUrl && (
          <Suspense fallback={null}><LoadGLB url={target} onLoaded={setShownUrl} /></Suspense>
        )}
        {!checking && compareNormal && stage.id !== 'normal' && hasFull && lab.stages.some((s) => s.id === 'normal') && (
          <Suspense fallback={null}><GhostNormal labId={labId} coronal={coronal} baseParts={baseParts} /></Suspense>
        )}
      </group>
      <CameraFit box={fitBox} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={6} maxDistance={60} />
      <IdleRotate holdKey={shownUrl ?? stage.id} />
      {tier === 'high' && <StablePostFX />}
    </>
  )
}

function GhostNormal({ labId, coronal, baseParts }) {
  const { scene } = useGLTF(`/models/${labId}_normal${coronal ? '_coronal' : ''}.glb`)
  const geo = useMemo(() => {
    let g = null
    scene.traverse((o) => { if (o.isMesh && baseParts.has(o.name.replace(/\.\d+$/, ''))) g = o.geometry })
    return g
  }, [scene, baseParts])
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
// Keyed on stage + view via `resetKey`: switching clears a failure and retries. Unlike a React
// `key`, this does not remount a healthy canvas (and recreate its WebGL context) on every switch.
class ViewerBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err) { console.error('[ModelCanvas] 3D view failed:', err) }
  componentDidUpdate(prev) { if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false }) }
  render() { return this.state.failed ? <ViewerUnavailable /> : this.props.children }
}

export default function ModelCanvas({ className = '' }) {
  const [webgl] = useState(hasWebGL2)
  const [tier] = useState(qualityTier)
  const stageId = useLabStore((s) => s.stageId)
  const cutaway = useLabStore((s) => s.cutaway)
  // The GPU can drop the WebGL context (memory pressure, driver reset). preventDefault on loss lets the
  // browser restore it. Rendering pauses meanwhile; on restore the scene is rebuilt in the same canvas
  // (environment map and render targets re-created), never a new canvas.
  const [contextLost, setContextLost] = useState(false)
  const [restores, setRestores] = useState(0)
  const onCreated = useCallback(({ gl }) => {
    const el = gl.domElement
    if (el.dataset.tlContext) return
    el.dataset.tlContext = '1'
    el.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setContextLost(true) })
    el.addEventListener('webglcontextrestored', () => { setContextLost(false); setRestores((n) => n + 1) })
  }, [])
  return (
    <div className={`relative h-full w-full ${className}`}>
      {webgl ? (
        <ViewerBoundary resetKey={`${stageId}:${cutaway}`}>
          {/* One persistent canvas: stage and view switches change only the model inside it. dpr is capped at 2. */}
          <Canvas shadows={tier === 'high' ? 'percentage' : false} dpr={tier === 'high' ? [1, 2] : [1, 1.5]} camera={{ position: [5, 4, 30], fov: 32 }}
            frameloop={contextLost ? 'never' : 'always'} onCreated={onCreated}
            gl={{ antialias: tier !== 'high', preserveDrawingBuffer: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0 }}>
            <Suspense fallback={null}>
              <Scene key={restores} tier={tier} />
            </Suspense>
          </Canvas>
          <HoverLabel />
        </ViewerBoundary>
      ) : <ViewerUnavailable />}
    </div>
  )
}
