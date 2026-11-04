import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { MapControls, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { boundsOf, centroid, polygonArea } from '../sim/geometry';
import type { Grid } from '../sim/grid';
import type { CatalogItem, Feature, Layout, Polygon, Sprinkler } from '../sim/types';
import { ZONE_COLORS } from './colors';

export interface SceneProps {
  grid: Grid;
  colors: Uint8Array;
  features: Feature[];
  layout: Layout;
  catalog: CatalogItem[];
  mode: 'edit' | 'view';
  selectedId: string | null;
  activeZoneId: string | null;
  placing: boolean;
  onSelect: (id: string | null) => void;
  onMoveHead: (id: string, x: number, y: number) => void;
  /** Tap on the ground (not on a head): place a head if placing, otherwise clear selection. */
  onPlace: (x: number, y: number) => void;
}

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Shape in the XY plane with y negated so that rotateX(-π/2) maps yard (x,y) → world (x,0,y). */
function shapeOf(poly: Polygon): THREE.Shape {
  const s = new THREE.Shape();
  poly.forEach((p, i) => (i ? s.lineTo(p.x, -p.y) : s.moveTo(p.x, -p.y)));
  s.closePath();
  return s;
}

function Slab({ poly, height, color, y = 0 }: { poly: Polygon; height: number; color: string; y?: number }) {
  const geo = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(shapeOf(poly), { depth: height, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [poly, height]);
  return (
    <mesh geometry={geo} position={[0, y, 0]}>
      <meshStandardMaterial color={color} flatShading />
    </mesh>
  );
}

const LAWN_H = 0.35;

function Lawn({ features, grid, colors }: { features: Feature[]; grid: Grid; colors: Uint8Array }) {
  const tex = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array(grid.cols * grid.rows * 4), grid.cols, grid.rows, THREE.RGBAFormat);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    const W = grid.cols * grid.cell;
    const H = grid.rows * grid.cell;
    // Extrude cap UVs are the shape coords (x, -y): map to grid texture coords.
    t.repeat.set(1 / W, -1 / H);
    t.offset.set(-grid.originX / W, -grid.originY / H);
    return t;
  }, [grid]);
  useEffect(() => {
    (tex.image.data as Uint8Array).set(colors);
    tex.needsUpdate = true;
  }, [colors, tex]);
  useEffect(() => () => tex.dispose(), [tex]);

  const lawns = features.filter((f) => f.kind === 'lawn');
  return (
    <>
      {lawns.map((f) => (
        <LawnPiece key={f.id} poly={f.polygon} tex={tex} />
      ))}
    </>
  );
}

function LawnPiece({ poly, tex }: { poly: Polygon; tex: THREE.Texture }) {
  const geo = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(shapeOf(poly), { depth: LAWN_H, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [poly]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial attach="material-0" map={tex} />
      <meshStandardMaterial attach="material-1" color="#6b4f2f" flatShading />
    </mesh>
  );
}

function Tree({ f }: { f: Feature }) {
  const c = centroid(f.polygon);
  const r = Math.max(2, Math.sqrt(polygonArea(f.polygon) / Math.PI));
  const h = r * 1.6;
  return (
    <group position={[c.x, 0, c.y]}>
      <mesh position={[0, h * 0.25, 0]}>
        <cylinderGeometry args={[r * 0.12, r * 0.16, h * 0.5, 6]} />
        <meshStandardMaterial color="#7a5230" flatShading />
      </mesh>
      <mesh position={[0, h * 0.75, 0]}>
        <coneGeometry args={[r, h * 0.7, 7]} />
        <meshStandardMaterial color="#2f7d3b" flatShading />
      </mesh>
      <mesh position={[0, h * 1.1, 0]}>
        <coneGeometry args={[r * 0.7, h * 0.55, 7]} />
        <meshStandardMaterial color="#3b9447" flatShading />
      </mesh>
    </group>
  );
}

function Shrub({ f }: { f: Feature }) {
  const c = centroid(f.polygon);
  const r = Math.max(1, Math.sqrt(polygonArea(f.polygon) / Math.PI));
  return (
    <mesh position={[c.x, r * 0.6, c.y]} scale={[1, 0.75, 1]}>
      <icosahedronGeometry args={[r, 0]} />
      <meshStandardMaterial color="#4c8f3a" flatShading />
    </mesh>
  );
}

function ArcFan({ h, color, selected }: { h: Sprinkler; color: string; selected: boolean }) {
  const geo = useMemo(() => {
    const arc = Math.min(360, h.arc);
    const start = -((h.rotation + arc / 2) * Math.PI) / 180;
    const g = new THREE.CircleGeometry(h.radius, Math.max(12, Math.round(arc / 6)), start, (arc * Math.PI) / 180);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [h.radius, h.arc, h.rotation]);
  return (
    <mesh geometry={geo} position={[h.x, LAWN_H + 0.06, h.y]} raycast={() => null}>
      <meshBasicMaterial color={color} transparent opacity={selected ? 0.3 : 0.07} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Head({ h, color, selected, onDown }: { h: Sprinkler; color: string; selected: boolean; onDown: (e: ThreeEvent<PointerEvent>) => void }) {
  return (
    <group position={[h.x, LAWN_H, h.y]}>
      <mesh onPointerDown={onDown}>
        <cylinderGeometry args={[2.2, 2.2, 0.4, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.7, 0.8, 0.7, 8]} />
        <meshStandardMaterial color="#37474f" flatShading />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.45, 0.6, 0.35, 8]} />
        <meshStandardMaterial color={color} flatShading emissive={selected ? color : '#000'} emissiveIntensity={selected ? 0.6 : 0} />
      </mesh>
      {selected && (
        <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.4, 1.9, 24]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      )}
    </group>
  );
}

const PARTICLES = 90;

function Water({ heads }: { heads: Sprinkler[] }) {
  const ref = useRef<THREE.Points>(null);
  const seeds = useMemo(
    () =>
      heads.flatMap((h) =>
        Array.from({ length: PARTICLES }, () => {
          const a = ((h.rotation + (Math.random() - 0.5) * Math.min(360, h.arc)) * Math.PI) / 180;
          return { h, a, d: h.radius * (0.25 + 0.75 * Math.sqrt(Math.random())), phase: Math.random() };
        }),
      ),
    [heads],
  );
  const positions = useMemo(() => new Float32Array(seeds.length * 3), [seeds]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    seeds.forEach((s, i) => {
      const f = (t * 0.9 + s.phase) % 1;
      positions[i * 3] = s.h.x + Math.cos(s.a) * s.d * f;
      positions[i * 3 + 1] = LAWN_H + 1 + Math.sin(f * Math.PI) * (2 + s.d * 0.12);
      positions[i * 3 + 2] = s.h.y + Math.sin(s.a) * s.d * f;
    });
    const g = ref.current?.geometry;
    if (g) (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });
  if (!heads.length) return null;
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#5ec8ff" size={1.1} transparent opacity={0.9} depthWrite={false} />
    </points>
  );
}

function Cameras({ mode, center, size }: { mode: 'edit' | 'view'; center: THREE.Vector3; size: number }) {
  const persp = useRef<THREE.PerspectiveCamera>(null);
  const ortho = useRef<THREE.OrthographicCamera>(null);
  const anim = useRef(0);
  const { size: vp } = useThree();

  useEffect(() => {
    anim.current = 0;
    if (mode === 'edit' && ortho.current) {
      // Straight down with a hair of tilt toward +z so screen-up is -z (yard y grows downward on screen).
      ortho.current.position.set(center.x, 200, center.z + 0.001);
      ortho.current.lookAt(center.x, 0, center.z);
      ortho.current.zoom = Math.min(vp.width, vp.height) / (size * 1.15);
      ortho.current.updateProjectionMatrix();
    }
  }, [mode, center, size, vp.width, vp.height]);

  useFrame((_, dt) => {
    if (mode !== 'view' || !persp.current || anim.current >= 1) return;
    anim.current = Math.min(1, anim.current + dt / 1.2);
    const e = 1 - Math.pow(1 - anim.current, 3);
    const from = new THREE.Vector3(center.x, size * 1.5, center.z + 0.01);
    const to = new THREE.Vector3(center.x, size * 0.6, center.z + size * 0.85);
    persp.current.position.lerpVectors(from, to, e);
    persp.current.lookAt(center);
  });

  return mode === 'edit' ? (
    <>
      <OrthographicCamera ref={ortho} makeDefault near={0.1} far={1000} />
      <MapControls makeDefault enableRotate={false} screenSpacePanning target={center} />
    </>
  ) : (
    <>
      <PerspectiveCamera ref={persp} makeDefault fov={45} near={0.5} far={2000} position={[center.x, size * 1.5, center.z + 0.01]} />
      <OrbitControls makeDefault target={center} maxPolarAngle={1.35} minDistance={10} maxDistance={size * 4} />
    </>
  );
}

function Interaction({ layout, mode, onSelect, onMoveHead, onPlace, center, size }: SceneProps & { center: THREE.Vector3; size: number }) {
  const dragging = useRef<string | null>(null);
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const hit = new THREE.Vector3();
  const toYard = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.ray.intersectPlane(GROUND, hit) ? { x: hit.x, y: hit.z } : null);

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[center.x, -0.02, center.z]}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const p = toYard(e);
          if (p) onMoveHead(dragging.current, Math.round(p.x * 2) / 2, Math.round(p.y * 2) / 2);
        }}
        onPointerUp={() => {
          dragging.current = null;
          if (controls) controls.enabled = true;
        }}
        onClick={(e) => {
          if (e.delta > 6) return; // was a pan
          const p = toYard(e);
          // The parent decides between placing a head and clearing selection (reads live store state).
          if (p) onPlace(Math.round(p.x * 2) / 2, Math.round(p.y * 2) / 2);
        }}
      >
        <planeGeometry args={[size * 6, size * 6]} />
        <meshStandardMaterial color="#8fb87a" />
      </mesh>
      {layout.sprinklers.map((h) => {
        const zi = Math.max(0, layout.zones.findIndex((z) => z.id === h.zoneId));
        return (
          <Head
            key={h.id}
            h={h}
            color={ZONE_COLORS[zi % ZONE_COLORS.length]}
            selected={false}
            onDown={(e) => {
              e.stopPropagation();
              onSelect(h.id);
              if (mode !== 'edit') return;
              dragging.current = h.id;
              if (controls) controls.enabled = false;
            }}
          />
        );
      })}
    </>
  );
}

export function YardScene(props: SceneProps) {
  const { grid, colors, features, layout, mode, selectedId, activeZoneId } = props;
  const { center, size } = useMemo(() => {
    const b = boundsOf(features.length ? features.map((f) => f.polygon) : [[{ x: 0, y: 0 }, { x: 40, y: 30 }]]);
    return { center: new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minY + b.maxY) / 2), size: Math.max(20, b.maxX - b.minX, b.maxY - b.minY) };
  }, [features]);
  const activeHeads = useMemo(() => layout.sprinklers.filter((h) => h.zoneId === activeZoneId), [layout.sprinklers, activeZoneId]);

  return (
    <Canvas dpr={[1, 2]} style={{ touchAction: 'none' }}>
      <color attach="background" args={[mode === 'edit' ? '#1d2a22' : '#cfe8f3']} />
      {mode === 'view' && <fog attach="fog" args={['#cfe8f3', size * 2.5, size * 6]} />}
      <hemisphereLight args={['#ffffff', '#5b7a4a', 1.1]} />
      <directionalLight position={[center.x - size, size * 1.5, center.z - size * 0.5]} intensity={1.6} />
      <Cameras mode={mode} center={center} size={size} />
      <Interaction {...props} center={center} size={size} />
      <Lawn features={features} grid={grid} colors={colors} />
      {features.map((f) => {
        if (f.kind === 'hardscape') return <Slab key={f.id} poly={f.polygon} height={0.2} color="#b9b2a6" />;
        if (f.kind === 'bed') return <Slab key={f.id} poly={f.polygon} height={0.45} color="#7b5a3c" />;
        if (f.kind === 'tree') return <Tree key={f.id} f={f} />;
        if (f.kind === 'shrub') return <Shrub key={f.id} f={f} />;
        return null;
      })}
      {mode === 'edit' &&
        layout.sprinklers.map((h) => {
          const zi = Math.max(0, layout.zones.findIndex((z) => z.id === h.zoneId));
          return <ArcFan key={h.id} h={h} color={ZONE_COLORS[zi % ZONE_COLORS.length]} selected={h.id === selectedId} />;
        })}
      {layout.sprinklers
        .filter((h) => h.id === selectedId)
        .map((h) => (
          <mesh key="sel" position={[h.x, LAWN_H + 0.1, h.y]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
            <ringGeometry args={[1.5, 2.1, 24]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        ))}
      <Water heads={activeHeads} />
    </Canvas>
  );
}
