import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { WorkforceGraphEdge, WorkforceGraphNode } from "../../../../../contracts/graph";
import { useSceneColors, type SceneColors } from "../hooks/useSceneColors";
import {
  CAMERA_LIMITS,
  DEFAULT_DIRECTION,
  fitPose,
  resolveCommand,
  type CameraCommand,
  type CameraPose,
} from "../lib/camera";
import type { Vec3 } from "../lib/layout";
import { stateStyle } from "../lib/stateStyle";

export interface SpatialGraphViewProps {
  nodes: readonly WorkforceGraphNode[];
  edges: readonly WorkforceGraphEdge[];
  positions: ReadonlyMap<string, Vec3>;
  selectedId: string | null;
  hoveredId: string | null;
  /** When set, nodes outside this set are dimmed. */
  emphasisIds: ReadonlySet<string> | null;
  cameraCommand: CameraCommand | null;
  reducedMotion: boolean;
  /** Localized tooltip text per node (built by the caller so the canvas needs no i18n context). */
  tooltipFor: (node: WorkforceGraphNode) => string;
  edgeLabelFor: (edge: WorkforceGraphEdge) => string;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

const TYPE_SCALE: Readonly<Record<string, number>> = { PROJECT: 1.6, CONTROL_PLANE: 1.4 };
const MAX_EDGE_LABELS = 12;
const ORIGIN: Vec3 = [0, 0, 0];

function NodeGeometry({ shape }: { shape: ReturnType<typeof stateStyle>["shape"] }) {
  switch (shape) {
    case "octahedron":
      return <octahedronGeometry args={[1.25]} />;
    case "box":
      return <boxGeometry args={[1.6, 1.6, 1.6]} />;
    case "tetrahedron":
      return <tetrahedronGeometry args={[1.45]} />;
    case "dodecahedron":
      return <dodecahedronGeometry args={[1.15]} />;
    case "icosahedron":
      return <icosahedronGeometry args={[1.15, 1]} />;
    default:
      return <sphereGeometry args={[1, 24, 24]} />;
  }
}

interface NodeMeshProps {
  node: WorkforceGraphNode;
  position: Vec3;
  colors: SceneColors;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
  tooltip: string;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

function GraphNodeMesh({ node, position, colors, selected, hovered, dimmed, tooltip, onHover, onSelect }: NodeMeshProps) {
  const style = stateStyle(node.state);
  const color = colors.states[node.state] ?? colors.states.unavailable;
  const scale = (TYPE_SCALE[node.type] ?? 1) * (hovered || selected ? 1.2 : 1);
  const opacity = dimmed ? 0.2 : style.wireframe ? 0.7 : 0.92;

  return (
    <group position={position} scale={scale}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(node.id);
        }}
        onPointerOut={() => onHover(null)}
      >
        <NodeGeometry shape={style.shape} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered || selected ? 1.1 : 0.55}
          transparent
          opacity={opacity}
          wireframe={style.wireframe}
        />
      </mesh>
      {style.ring && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.7, 0.09, 8, 40]} />
          <meshBasicMaterial color={color} transparent opacity={dimmed ? 0.2 : 0.95} />
        </mesh>
      )}
      {selected && (
        <mesh>
          <sphereGeometry args={[2.1, 16, 16]} />
          <meshBasicMaterial color={colors.selection} wireframe transparent opacity={0.6} />
        </mesh>
      )}
      {(hovered || selected) && (
        <Html distanceFactor={20} position={[0, 2.6, 0]} center>
          <div className="sg-canvas-tooltip">{tooltip}</div>
        </Html>
      )}
    </group>
  );
}

function segmentsGeometry(edges: readonly WorkforceGraphEdge[], positions: ReadonlyMap<string, Vec3>) {
  const pts: number[] = [];
  for (const e of edges) {
    const a = positions.get(e.source);
    const b = positions.get(e.target);
    if (a && b) pts.push(...a, ...b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function GraphEdges({
  edges,
  positions,
  colors,
  activeIds,
  edgeLabelFor,
  dimmedIds,
}: {
  edges: readonly WorkforceGraphEdge[];
  positions: ReadonlyMap<string, Vec3>;
  colors: SceneColors;
  activeIds: ReadonlySet<string>;
  edgeLabelFor: (edge: WorkforceGraphEdge) => string;
  dimmedIds: ReadonlySet<string> | null;
}) {
  const { base, active, blocking } = useMemo(() => {
    const isActive = (e: WorkforceGraphEdge) => activeIds.has(e.source) || activeIds.has(e.target);
    return {
      base: edges.filter((e) => !isActive(e) && e.status !== "blocking"),
      active: edges.filter(isActive),
      blocking: edges.filter((e) => !isActive(e) && e.status === "blocking"),
    };
  }, [edges, activeIds]);
  const baseGeometry = useMemo(() => segmentsGeometry(base, positions), [base, positions]);
  const activeGeometry = useMemo(() => segmentsGeometry(active, positions), [active, positions]);
  const blockingGeometry = useMemo(() => segmentsGeometry(blocking, positions), [blocking, positions]);
  useEffect(() => () => blockingGeometry.dispose(), [blockingGeometry]);
  useEffect(() => () => baseGeometry.dispose(), [baseGeometry]);
  useEffect(() => () => activeGeometry.dispose(), [activeGeometry]);

  const baseOpacity = dimmedIds ? 0.12 : 0.5;
  return (
    <group>
      <lineSegments geometry={baseGeometry}>
        <lineBasicMaterial color={colors.edge} transparent opacity={baseOpacity} />
      </lineSegments>
      <lineSegments geometry={blockingGeometry}>
        <lineBasicMaterial color={colors.blocking} transparent opacity={dimmedIds ? 0.25 : 0.9} />
      </lineSegments>
      <lineSegments geometry={activeGeometry}>
        <lineBasicMaterial color={colors.edgeActive} transparent opacity={0.95} />
      </lineSegments>
      {active.slice(0, MAX_EDGE_LABELS).map((e) => {
        const a = positions.get(e.source);
        const b = positions.get(e.target);
        if (!a || !b) return null;
        const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        return (
          <Html key={e.id} distanceFactor={20} position={mid} center>
            <div className="sg-canvas-edge-label">{edgeLabelFor(e)}</div>
          </Html>
        );
      })}
    </group>
  );
}

interface ControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

/** Applies camera commands to the orbit controls: snaps when reduced motion is on, eases otherwise. */
function CameraRig({
  command,
  positions,
  fitIds,
  reducedMotion,
}: {
  command: CameraCommand | null;
  positions: ReadonlyMap<string, Vec3>;
  fitIds: readonly string[];
  reducedMotion: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const goal = useRef<CameraPose | null>(null);
  const lastSeq = useRef<number | null>(null);

  const fit = useMemo(() => {
    const pts = fitIds.map((id) => positions.get(id)).filter((p): p is Vec3 => p !== undefined);
    return fitPose(pts.length > 0 ? pts : [ORIGIN], (camera as THREE.PerspectiveCamera).fov ?? 60);
  }, [fitIds, positions, camera]);

  const apply = (pose: CameraPose) => {
    camera.position.set(...pose.position);
    if (controls) {
      controls.target.set(...pose.target);
      controls.update();
    } else {
      camera.lookAt(...pose.target);
    }
  };

  useEffect(() => {
    if (!command || !controls || lastSeq.current === command.seq) return;
    lastSeq.current = command.seq;
    const current: CameraPose = {
      target: controls ? [controls.target.x, controls.target.y, controls.target.z] : ORIGIN,
      position: [camera.position.x, camera.position.y, camera.position.z],
    };
    const next = resolveCommand(command, current, fit, (id) => positions.get(id));
    if (reducedMotion) {
      goal.current = null;
      apply(next);
    } else {
      goal.current = next;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, controls]);

  useFrame((_, delta) => {
    const g = goal.current;
    if (!g) return;
    const k = 1 - Math.exp(-delta * 8);
    const pos = new THREE.Vector3(...g.position);
    const tgt = new THREE.Vector3(...g.target);
    camera.position.lerp(pos, k);
    if (controls) {
      controls.target.lerp(tgt, k);
      controls.update();
    }
    if (camera.position.distanceTo(pos) < 0.05) {
      apply(g);
      goal.current = null;
    }
  });

  return null;
}

export function SpatialGraphScene(props: SpatialGraphViewProps) {
  const { nodes, edges, positions, selectedId, hoveredId, emphasisIds, reducedMotion } = props;
  const colors = useSceneColors();
  const fitIds = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const activeIds = useMemo(() => {
    const s = new Set<string>();
    if (selectedId) s.add(selectedId);
    if (hoveredId) s.add(hoveredId);
    return s;
  }, [selectedId, hoveredId]);

  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <OrbitControls
        makeDefault
        minDistance={CAMERA_LIMITS.minDistance}
        maxDistance={CAMERA_LIMITS.maxDistance}
        enableDamping={!reducedMotion}
        enablePan
      />
      <CameraRig command={props.cameraCommand} positions={positions} fitIds={fitIds} reducedMotion={reducedMotion} />

      {nodes.map((node) => (
        <GraphNodeMesh
          key={node.id}
          node={node}
          position={positions.get(node.id) ?? ORIGIN}
          colors={colors}
          selected={node.id === selectedId}
          hovered={node.id === hoveredId}
          dimmed={emphasisIds !== null && !emphasisIds.has(node.id)}
          tooltip={props.tooltipFor(node)}
          onHover={props.onHover}
          onSelect={props.onSelect}
        />
      ))}
      <GraphEdges
        edges={edges}
        positions={positions}
        colors={colors}
        activeIds={activeIds}
        edgeLabelFor={props.edgeLabelFor}
        dimmedIds={emphasisIds}
      />
    </>
  );
}

const INITIAL_CAMERA_POSITION: Vec3 = [DEFAULT_DIRECTION[0], DEFAULT_DIRECTION[1], DEFAULT_DIRECTION[2]];

/** The WebGL canvas only. It is decorative for assistive tech: the node list carries the same information. */
export function SpatialGraphView(props: SpatialGraphViewProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <div className="sg-canvas" data-testid="spatial-graph-canvas">
      {ready && (
        <Canvas camera={{ position: INITIAL_CAMERA_POSITION, fov: 60 }} onPointerMissed={props.onDeselect}>
          <SpatialGraphScene {...props} />
        </Canvas>
      )}
    </div>
  );
}
