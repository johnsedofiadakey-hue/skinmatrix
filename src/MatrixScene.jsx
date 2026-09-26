import { Canvas, useFrame } from '@react-three/fiber'
import { Float, MeshTransmissionMaterial, Sparkles } from '@react-three/drei'
import { Component, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

function Orb({ position, scale, color, speed = 1 }) {
  const ref = useRef()
  useFrame((state) => {
    ref.current.rotation.y = state.clock.elapsedTime * 0.22 * speed
    ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.25 * speed) * 0.2
  })
  return <Float speed={speed} rotationIntensity={0.55} floatIntensity={0.9}>
    <mesh ref={ref} position={position} scale={scale}>
      <icosahedronGeometry args={[1, 5]} />
      <MeshTransmissionMaterial thickness={0.45} roughness={0.08} transmission={1} ior={1.14} color={color} chromaticAberration={0.09} />
    </mesh>
  </Float>
}

function Filaments() {
  const lines = useMemo(() => Array.from({ length: 10 }, (_, index) => {
    const radius = 1.4 + (index % 3) * 0.36
    const points = Array.from({ length: 70 }, (_, i) => {
      const t = (i / 69) * Math.PI * 2
      return new THREE.Vector3(
        Math.cos(t) * radius,
        Math.sin(t * 2.1 + index) * (0.55 + (index % 2) * 0.18),
        Math.sin(t) * radius * 0.34,
      )
    })
    return new THREE.CatmullRomCurve3(points, true)
  }), [])
  return <group rotation={[0.2, 0.25, 0]}>{lines.map((curve, index) => <mesh key={index}>
    <tubeGeometry args={[curve, 150, 0.007 + (index % 3) * 0.004, 8, true]} />
    <meshBasicMaterial color={index % 2 ? '#9376ba' : '#cf7c99'} transparent opacity={0.26} />
  </mesh>)}</group>
}

function MatrixObject() {
  const group = useRef()
  useFrame((state) => {
    group.current.rotation.y = state.clock.elapsedTime * 0.08
    group.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.15) * 0.08
  })
  return <group ref={group} scale={1.12}>
    <Filaments />
    <Orb position={[0, 0, 0]} scale={1.03} color="#a48ac7" speed={0.6} />
    <Orb position={[-1.2, 0.52, 0.24]} scale={0.25} color="#cf7c99" speed={1.1} />
    <Orb position={[1.35, -0.34, 0.08]} scale={0.18} color="#f4d7bc" speed={1.4} />
    <Orb position={[0.65, 1.06, -0.15]} scale={0.12} color="#5b589e" speed={1.7} />
  </group>
}

function MatrixFallback() {
  return <div className="matrix-fallback" aria-hidden="true">
    <i className="fallback-orb orb-one" /><i className="fallback-orb orb-two" /><i className="fallback-orb orb-three" />
    <i className="fallback-ring ring-one" /><i className="fallback-ring ring-two" /><i className="fallback-line line-one" /><i className="fallback-line line-two" />
  </div>
}

class CanvasErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <MatrixFallback /> : this.props.children }
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export default function MatrixScene({ compact = false }) {
  const [webglAvailable] = useState(supportsWebGL)
  if (!webglAvailable) return <MatrixFallback />
  return <CanvasErrorBoundary><Canvas dpr={[1, 1.75]} camera={{ position: [0, 0, compact ? 7.4 : 6.25], fov: 37 }} gl={{ alpha: true, antialias: true }}>
    <ambientLight intensity={1.7} />
    <directionalLight position={[3, 4, 4]} intensity={3.4} color="#e8d9f6" />
    <pointLight position={[-4, -2, 3]} intensity={2} color="#cf7c99" />
    <MatrixObject />
    <Sparkles count={compact ? 36 : 60} size={1.3} scale={5} speed={0.22} color="#bba4d5" />
  </Canvas></CanvasErrorBoundary>
}
