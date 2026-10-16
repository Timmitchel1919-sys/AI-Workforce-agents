/**
 * UI Layer 9 — non-destructive image edit specification and its geometry.
 * The source image is never modified; rendering applies the spec to a canvas.
 */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_OUTPUT_WIDTH = 8192;

export interface EditSpec {
  rotation: 0 | 90 | 180 | 270;
  flip: boolean;
  /** Output width in px; height follows the aspect. */
  width: number;
  brightness: number;
  contrast: number;
  grayscale: boolean;
  /** Center-crop to this aspect (w/h), or null. */
  cropAspect: number | null;
}

export const DEFAULT_SPEC = (naturalWidth: number): EditSpec => ({
  rotation: 0,
  flip: false,
  width: Math.min(naturalWidth, 2048),
  brightness: 100,
  contrast: 100,
  grayscale: false,
  cropAspect: null,
});

export interface Geometry {
  /** Source crop rect (in source pixels, before rotation). */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Output canvas size. */
  outW: number;
  outH: number;
}

export function geometry(srcW: number, srcH: number, spec: EditSpec): Geometry {
  const rotated = spec.rotation === 90 || spec.rotation === 270;
  // Crop is expressed in the ROTATED frame; map back to source.
  let vw = rotated ? srcH : srcW;
  let vh = rotated ? srcW : srcH;
  if (spec.cropAspect) {
    if (vw / vh > spec.cropAspect) vw = Math.round(vh * spec.cropAspect);
    else vh = Math.round(vw / spec.cropAspect);
  }
  const sw = rotated ? vh : vw;
  const sh = rotated ? vw : vh;
  const outW = Math.max(1, Math.min(MAX_OUTPUT_WIDTH, Math.round(spec.width)));
  const outH = Math.max(1, Math.round((outW * vh) / vw));
  return { sx: Math.round((srcW - sw) / 2), sy: Math.round((srcH - sh) / 2), sw, sh, outW, outH };
}

export function filterString(spec: EditSpec): string {
  const clamp = (n: number) => Math.max(0, Math.min(300, Math.round(n)));
  return `brightness(${clamp(spec.brightness)}%) contrast(${clamp(spec.contrast)}%)${spec.grayscale ? " grayscale(100%)" : ""}`;
}

/** Draw `img` onto `canvas` according to `spec`. Returns the canvas size. */
export function render(canvas: HTMLCanvasElement, img: CanvasImageSource, srcW: number, srcH: number, spec: EditSpec) {
  const g = geometry(srcW, srcH, spec);
  canvas.width = g.outW;
  canvas.height = g.outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return g;
  ctx.save();
  ctx.filter = filterString(spec);
  ctx.translate(g.outW / 2, g.outH / 2);
  if (spec.flip) ctx.scale(-1, 1);
  ctx.rotate((spec.rotation * Math.PI) / 180);
  const rotated = spec.rotation === 90 || spec.rotation === 270;
  const dw = rotated ? g.outH : g.outW;
  const dh = rotated ? g.outW : g.outH;
  ctx.drawImage(img, g.sx, g.sy, g.sw, g.sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  return g;
}
