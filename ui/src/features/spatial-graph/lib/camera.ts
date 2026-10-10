import type { Vec3 } from "./layout";

export const CAMERA_LIMITS = { minDistance: 8, maxDistance: 600 } as const;
/** Default viewing direction (from the target towards the camera). */
export const DEFAULT_DIRECTION: Vec3 = [0, 40, 60];

const EPS = 0.05;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l === 0 ? [0, 0, 1] : scale(a, 1 / l);
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface CameraPose {
  target: Vec3;
  position: Vec3;
}

/** Pose that frames all given points (bounding sphere) from the default direction. */
export function fitPose(points: readonly Vec3[], fovDegrees = 60): CameraPose {
  if (points.length === 0) {
    return { target: [0, 0, 0], position: scale(normalize(DEFAULT_DIRECTION), 60) };
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  }
  const target = scale(add(min, max), 0.5) as Vec3;
  let radius = 0;
  for (const p of points) radius = Math.max(radius, length(sub(p, target)));
  radius += 2; // node size
  const distance = clamp(
    (radius / Math.sin((fovDegrees * Math.PI) / 360)) * 1.1,
    CAMERA_LIMITS.minDistance * 2,
    CAMERA_LIMITS.maxDistance,
  );
  return { target, position: add(target, scale(normalize(DEFAULT_DIRECTION), distance)) };
}

/** Move the camera closer to / further from the target. factor < 1 zooms in. */
export function zoomPose(pose: CameraPose, factor: number): CameraPose {
  const offset = sub(pose.position, pose.target);
  const d = clamp(length(offset) * factor, CAMERA_LIMITS.minDistance, CAMERA_LIMITS.maxDistance);
  return { target: pose.target, position: add(pose.target, scale(normalize(offset), d)) };
}

/** Orbit around the target by azimuth / polar deltas (radians). Polar is clamped off the poles. */
export function orbitPose(pose: CameraPose, dAzimuth: number, dPolar: number): CameraPose {
  const o = sub(pose.position, pose.target);
  const r = length(o) || 1;
  const polar = clamp(Math.acos(clamp(o[1] / r, -1, 1)) + dPolar, EPS, Math.PI - EPS);
  const azimuth = Math.atan2(o[0], o[2]) + dAzimuth;
  const next: Vec3 = [
    r * Math.sin(polar) * Math.sin(azimuth),
    r * Math.cos(polar),
    r * Math.sin(polar) * Math.cos(azimuth),
  ];
  return { target: pose.target, position: add(pose.target, next) };
}

/** Pan camera and target together along the camera's right/up axes. */
export function panPose(pose: CameraPose, dx: number, dy: number): CameraPose {
  const forward = normalize(sub(pose.target, pose.position));
  let right = cross(forward, [0, 1, 0]);
  if (length(right) < 1e-6) right = [1, 0, 0];
  right = normalize(right);
  const up = normalize(cross(right, forward));
  const move = add(scale(right, dx), scale(up, dy));
  return { target: add(pose.target, move), position: add(pose.position, move) };
}

/** Centre on a point, keeping the current viewing direction and a comfortable distance. */
export function focusPose(pose: CameraPose, point: Vec3, distance = 28): CameraPose {
  const dir = normalize(sub(pose.position, pose.target));
  const d = clamp(distance, CAMERA_LIMITS.minDistance, CAMERA_LIMITS.maxDistance);
  return { target: point, position: add(point, scale(dir, d)) };
}

export type CameraCommandKind =
  | "fit"
  | "reset"
  | "focus"
  | "zoomIn"
  | "zoomOut"
  | "orbitLeft"
  | "orbitRight"
  | "orbitUp"
  | "orbitDown"
  | "panLeft"
  | "panRight"
  | "panUp"
  | "panDown";

export interface CameraCommand {
  /** Monotonic counter so repeating the same command re-triggers the rig. */
  seq: number;
  kind: CameraCommandKind;
  nodeId?: string;
}

const ORBIT_STEP = Math.PI / 12;

/** Resolve a command against the current pose. Pure; the caller decides snap vs. animate. */
export function resolveCommand(
  command: CameraCommand,
  pose: CameraPose,
  fit: CameraPose,
  positionOf: (id: string) => Vec3 | undefined,
): CameraPose {
  const panStep = Math.max(2, length(sub(pose.position, pose.target)) * 0.1);
  switch (command.kind) {
    case "fit":
    case "reset":
      return fit;
    case "focus": {
      const p = command.nodeId ? positionOf(command.nodeId) : undefined;
      return p ? focusPose(pose, p) : pose;
    }
    case "zoomIn":
      return zoomPose(pose, 0.8);
    case "zoomOut":
      return zoomPose(pose, 1.25);
    case "orbitLeft":
      return orbitPose(pose, -ORBIT_STEP, 0);
    case "orbitRight":
      return orbitPose(pose, ORBIT_STEP, 0);
    case "orbitUp":
      return orbitPose(pose, 0, -ORBIT_STEP);
    case "orbitDown":
      return orbitPose(pose, 0, ORBIT_STEP);
    case "panLeft":
      return panPose(pose, -panStep, 0);
    case "panRight":
      return panPose(pose, panStep, 0);
    case "panUp":
      return panPose(pose, 0, panStep);
    case "panDown":
      return panPose(pose, 0, -panStep);
  }
}

/** Maps a keyboard event on the 3D view to a camera command kind (or null). */
export function commandForKey(key: string, shift: boolean): CameraCommandKind | null {
  switch (key) {
    case "ArrowLeft":
      return shift ? "panLeft" : "orbitLeft";
    case "ArrowRight":
      return shift ? "panRight" : "orbitRight";
    case "ArrowUp":
      return shift ? "panUp" : "orbitUp";
    case "ArrowDown":
      return shift ? "panDown" : "orbitDown";
    case "+":
    case "=":
      return "zoomIn";
    case "-":
    case "_":
      return "zoomOut";
    case "f":
    case "F":
      return "fit";
    case "0":
      return "reset";
    default:
      return null;
  }
}
