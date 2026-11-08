import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, N8AO, SMAA, Bloom, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'

// Render quality tier. Phones, tablets and low-power machines get no post-processing and a lower
// pixel ratio; everything else gets ambient occlusion, SMAA and a faint bloom.
// ?fx=low / ?fx=high in the URL overrides the guess (demo and testing).
export function qualityTier() {
  try {
    const q = new URLSearchParams(window.location.search).get('fx')
    if (q === 'low' || q === 'high') return q
    const coarse = window.matchMedia?.('(pointer: coarse)').matches
    const small = Math.min(window.innerWidth, window.innerHeight) < 600 || window.innerWidth < 768
    const weak = (navigator.hardwareConcurrency ?? 8) <= 4 || (navigator.deviceMemory ?? 8) <= 4
    const saveData = navigator.connection?.saveData
    return coarse || small || weak || saveData ? 'low' : 'high'
  } catch { return 'low' }
}

// Dark radial-gradient backdrop drawn by the renderer, so it does not depend on the page behind
// the canvas.
export function Backdrop() {
  const scene = useThree((s) => s.scene)
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512
    const g = c.getContext('2d')
    const grd = g.createRadialGradient(256, 225, 10, 256, 256, 390)
    grd.addColorStop(0, '#454844'); grd.addColorStop(0.45, '#303533'); grd.addColorStop(1, '#171c1d')
    g.fillStyle = grd; g.fillRect(0, 0, 512, 512)
    // A little grain stops the gradient banding on 8-bit displays.
    const img = g.getImageData(0, 0, 512, 512)
    for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 4; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n }
    g.putImageData(img, 0, 0)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  useEffect(() => {
    const prev = scene.background
    scene.background = tex
    return () => { scene.background = prev; tex.dispose() }
  }, [scene, tex])
  return null
}

// Soft warm key, cool rim from behind, low hemisphere fill. The HDR environment adds reflections.
export function Lights({ shadows }) {
  return (
    <>
      <hemisphereLight args={['#f4f1ee', '#3a2f2c', 0.45]} />
      <directionalLight position={[9, 13, 14]} intensity={1.9} color="#fff1e4" castShadow={shadows}
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-radius={5}
        shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14} />
      <directionalLight position={[-10, 9, -16]} intensity={2.4} color="#a9cbff" />
      <directionalLight position={[-12, -2, 6]} intensity={0.35} color="#ffe6dc" />
    </>
  )
}

export function PostFX() {
  return (
    <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
      {/* halfRes is off: its downsampling target uses a multi-target API removed in three r16x. */}
      <N8AO aoRadius={1.1} distanceFalloff={0.6} intensity={2.2} aoSamples={10} denoiseSamples={6} denoiseRadius={10} halfRes={false} />
      <Bloom intensity={0.12} luminanceThreshold={0.92} luminanceSmoothing={0.1} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <SMAA />
    </EffectComposer>
  )
}

// Slow turntable while nobody is touching the model. Any pointer activity on the canvas stops it;
// it resumes after IDLE_MS without interaction. A new model (holdKey) holds the freshly fitted
// view still for HOLD_MS before turning.
const IDLE_MS = 20000
const HOLD_MS = 5000
export function IdleRotate({ holdKey }) {
  const controls = useThree((s) => s.controls)
  const gl = useThree((s) => s.gl)
  const last = useRef(0)
  useEffect(() => {
    last.current = Math.max(last.current, performance.now() - IDLE_MS + HOLD_MS)
    if (controls) controls.autoRotate = false
  }, [holdKey, controls])
  useEffect(() => {
    if (!controls) return
    const el = gl.domElement
    const poke = () => { last.current = performance.now(); controls.autoRotate = false }
    controls.addEventListener('start', poke)
    el.addEventListener('pointerdown', poke); el.addEventListener('pointermove', poke); el.addEventListener('wheel', poke, { passive: true })
    return () => {
      controls.removeEventListener('start', poke)
      el.removeEventListener('pointerdown', poke); el.removeEventListener('pointermove', poke); el.removeEventListener('wheel', poke)
    }
  }, [controls, gl])
  useFrame(() => {
    if (!controls) return
    const on = performance.now() - last.current > IDLE_MS
    if (controls.autoRotate !== on) { controls.autoRotate = on; controls.autoRotateSpeed = 0.55 }
  })
  return null
}
