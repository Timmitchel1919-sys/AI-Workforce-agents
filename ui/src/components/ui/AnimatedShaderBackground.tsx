import { useEffect, useRef, type CSSProperties } from "react";
import * as THREE from "three";

export type AnimatedShaderBackgroundProps = {
  className?: string;
  style?: CSSProperties;
};

/**
 * Platform-wide animated WebGL shader background.
 * Mesh-drift particle/noise field in the Obsidian cyan→violet palette.
 * Fixed layer, non-interactive, GPU-cheap.
 */
export function AnimatedShaderBackground({ className, style }: AnimatedShaderBackgroundProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    host.appendChild(canvas);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false });
    } catch {
      canvas.remove();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));

    const uniforms = {
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_mouse: { value: new THREE.Vector2(0.5, 0.5) },
      u_c1: { value: new THREE.Color("#06091a") },
      u_c2: { value: new THREE.Color("#0b1535") },
      u_c3: { value: new THREE.Color("#2bc8ff") },
      u_c4: { value: new THREE.Color("#7000ff") },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: "void main(){ gl_Position = vec4(position, 1.0); }",
      fragmentShader: `
        precision highp float;
        uniform float u_time;
        uniform vec2 u_resolution;
        uniform vec2 u_mouse;
        uniform vec3 u_c1;
        uniform vec3 u_c2;
        uniform vec3 u_c3;
        uniform vec3 u_c4;

        vec3 hash3(vec2 p){
          vec3 q = vec3(dot(p, vec2(127.1, 311.7)),
                        dot(p, vec2(269.5, 183.3)),
                        dot(p, vec2(419.2, 371.9)));
          return fract(sin(q) * 43758.5453);
        }

        float noise(vec2 p){
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash3(i).x;
          float b = hash3(i + vec2(1.0, 0.0)).x;
          float c = hash3(i + vec2(0.0, 1.0)).x;
          float d = hash3(i + vec2(1.0, 1.0)).x;
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        float fbm(vec2 p){
          float v = 0.0;
          float a = 0.5;
          for(int i = 0; i < 5; i++){
            v += a * noise(p);
            p *= 2.03;
            a *= 0.5;
          }
          return v;
        }

        void main(){
          vec2 uv = gl_FragCoord.xy / u_resolution.xy;
          vec2 p = uv - 0.5;
          p.x *= u_resolution.x / u_resolution.y;

          float t = u_time * 0.08;
          vec2 flow = vec2(fbm(p * 1.6 + t), fbm(p * 1.6 - t));
          float n = fbm(p * 2.2 + flow * 0.9 + t * 0.6);

          // Particle sparkle layer
          vec2 g = floor(p * 90.0);
          vec3 h = hash3(g);
          float sparkle = step(0.995, h.x) * smoothstep(0.0, 1.0, sin(u_time * (1.0 + h.y * 2.0) + h.z * 6.28) * 0.5 + 0.5);

          vec3 col = mix(u_c1, u_c2, smoothstep(0.1, 0.9, n));
          col = mix(col, u_c3, smoothstep(0.55, 0.95, n) * 0.55);
          col = mix(col, u_c4, smoothstep(0.65, 1.1, 1.0 - length(p) * 0.8) * 0.25);

          // Soft vignette
          float vig = smoothstep(1.4, 0.1, length(p));
          col *= 0.3 + 0.75 * vig;

          // Add sparkles
          col += vec3(sparkle) * vec3(0.5, 0.85, 1.0) * 0.6;

          // Tiny grain for depth
          float grain = (hash3(gl_FragCoord.xy + u_time).x - 0.5) * 0.025;
          col += grain;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    const camera = new THREE.Camera();

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      uniforms.u_resolution.value.set(w, h);
    };
    window.addEventListener("resize", resize);
    resize();

    const onMouse = (event: MouseEvent) => {
      uniforms.u_mouse.value.set(event.clientX / window.innerWidth, event.clientY / window.innerHeight);
    };
    window.addEventListener("mousemove", onMouse);

    const clock = new THREE.Clock();
    let frame = 0;
    let visible = true;
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) clock.start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const animate = () => {
      frame = requestAnimationFrame(animate);
      if (!visible) return;
      uniforms.u_time.value = clock.getElapsedTime();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouse);
      document.removeEventListener("visibilitychange", onVisibility);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={className}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        background: "#030408",
        ...style,
      }}
    />
  );
}

export default AnimatedShaderBackground;
