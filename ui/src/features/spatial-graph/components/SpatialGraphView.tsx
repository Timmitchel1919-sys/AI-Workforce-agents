import { useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import type { WorkforceGraphProjection, WorkforceGraphNode, WorkforceGraphEdge } from "../../../../../contracts/graph";
import * as THREE from "three";

interface SpatialGraphViewProps {
  graph: WorkforceGraphProjection;
  onNodeSelect?: (node: WorkforceGraphNode) => void;
}

const TYPE_COLORS: Record<string, string> = {
  PROJECT: "#ffffff",
  AGENT: "#00ffff",
  TASK: "#ff00ff",
  PROGRAM: "#ffff00",
  DEFAULT: "#888888",
};

function GraphNodeMesh({ node, position, onClick }: { node: WorkforceGraphNode; position: [number, number, number]; onClick: () => void }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const color = TYPE_COLORS[node.type] || TYPE_COLORS.DEFAULT;
  const [hovered, setHover] = useState(false);

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
      >
        <sphereGeometry args={[hovered ? 1.2 : 1, 32, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hovered ? 0.8 : 0.2} transparent opacity={0.9} />
      </mesh>
      {hovered && (
        <Html distanceFactor={20} position={[0, 1.5, 0]} center>
          <div style={{ background: "rgba(0,0,0,0.8)", color: "white", padding: "4px 8px", borderRadius: "4px", fontSize: "12px", whiteSpace: "nowrap" }}>
            <strong>{node.type}</strong><br />
            {node.label}
          </div>
        </Html>
      )}
    </group>
  );
}

function GraphEdges({ edges, nodePositions }: { edges: WorkforceGraphEdge[]; nodePositions: Map<string, [number, number, number]> }) {
  const lineMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: 0x4444ff, transparent: true, opacity: 0.5 }), []);
  
  return (
    <group>
      {edges.map((edge) => {
        const sourcePos = nodePositions.get(edge.source);
        const targetPos = nodePositions.get(edge.target);
        if (!sourcePos || !targetPos) return null;

        const points = [new THREE.Vector3(...sourcePos), new THREE.Vector3(...targetPos)];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return <primitive key={edge.id} object={new THREE.Line(geometry, lineMaterial)} />;
      })}
    </group>
  );
}

export function SpatialGraphScene({ graph, onNodeSelect }: SpatialGraphViewProps) {
  const nodePositions = useMemo(() => {
    const posMap = new Map<string, [number, number, number]>();
    const typeGroups: Record<string, WorkforceGraphNode[]> = {};
    
    graph.nodes.forEach(node => {
      if (!typeGroups[node.type]) typeGroups[node.type] = [];
      typeGroups[node.type].push(node);
    });

    const radii: Record<string, number> = {
      PROJECT: 0,
      PROGRAM: 10,
      AGENT: 20,
      TASK: 30,
    };

    let unknownRadius = 40;

    Object.entries(typeGroups).forEach(([type, nodes]) => {
      const r = radii[type] ?? unknownRadius;
      if (radii[type] === undefined) unknownRadius += 10;

      nodes.forEach((node, i) => {
        if (r === 0) {
          posMap.set(node.id, [0, 0, 0]);
        } else {
          const angle = (i / nodes.length) * Math.PI * 2;
          posMap.set(node.id, [
            Math.cos(angle) * r,
            (Math.random() - 0.5) * (r / 2),
            Math.sin(angle) * r
          ]);
        }
      });
    });

    return posMap;
  }, [graph]);

  return (
    <>
      <ambientLight intensity={0.2} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <OrbitControls makeDefault minDistance={10} maxDistance={200} />
      
      {graph.nodes.map(node => (
        <GraphNodeMesh 
          key={node.id} 
          node={node} 
          position={nodePositions.get(node.id) || [0,0,0]} 
          onClick={() => onNodeSelect?.(node)} 
        />
      ))}
      
      <GraphEdges edges={graph.edges} nodePositions={nodePositions} />
    </>
  );
}

export function SpatialGraphView(props: SpatialGraphViewProps) {
  return (
    <div style={{ width: "100%", height: "100%", minHeight: "600px", background: "#050510", borderRadius: "8px", overflow: "hidden" }}>
      <Canvas camera={{ position: [0, 40, 60], fov: 60 }}>
        <SpatialGraphScene {...props} />
      </Canvas>
    </div>
  );
}
