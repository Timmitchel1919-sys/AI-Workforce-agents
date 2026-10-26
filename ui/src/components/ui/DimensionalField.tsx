import { useEffect, useRef, type CSSProperties } from "react";
import * as THREE from "three";

export type DimensionalFieldProps = {
  className?: string;
  style?: CSSProperties;
};

const SNOISE_GLSL = `
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;

export function DimensionalField({ className, style }: DimensionalFieldProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement("canvas");
    canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;";
    host.appendChild(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 12;

    const uniforms = {
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector2(1, 1) },
      u_color1: { value: new THREE.Color(0.0, 0.8, 0.7) },
      u_color2: { value: new THREE.Color(0.4, 0.0, 0.9) },
    };

    const bgMaterial = new THREE.ShaderMaterial({
      vertexShader: "void main(){ gl_Position = vec4(position, 1.0); }",
      fragmentShader: `
        uniform float u_time;
        uniform vec2 u_resolution;
        uniform vec3 u_color1;
        uniform vec3 u_color2;
        ${SNOISE_GLSL}
        void main(){
          vec2 uv = gl_FragCoord.xy / u_resolution.xy;
          uv.x *= u_resolution.x / u_resolution.y;
          vec3 baseColor = vec3(0.02, 0.02, 0.03);
          vec2 st = uv * 0.5;
          st += vec2(snoise(st + u_time * 0.04), snoise(st - u_time * 0.04)) * 0.4;
          float beam = smoothstep(0.2, 0.9, snoise(vec2(st.x + st.y * 2.0 - u_time * 0.1, u_time * 0.03)));
          vec3 glow = mix(u_color1, u_color2, snoise(uv * 2.0 + u_time * 0.15) * 0.5 + 0.5);
          float dist = distance(gl_FragCoord.xy / u_resolution.xy, vec2(0.5));
          float vignette = smoothstep(1.5, 0.1, dist);
          vec3 edgeColor = vec3(0.01, 0.01, 0.015);
          vec3 colorGlow = mix(baseColor, glow, beam * 0.6);
          gl_FragColor = vec4(mix(edgeColor, colorGlow, vignette), 1.0);
        }
      `,
      uniforms,
      depthWrite: false,
      depthTest: false,
    });

    const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMaterial);
    bgMesh.position.z = -15;
    scene.add(bgMesh);

    const glassMaterial = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main(){
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float u_time;
        uniform vec2 u_resolution;
        uniform vec3 u_color1;
        uniform vec3 u_color2;
        varying vec3 vNormal;
        ${SNOISE_GLSL}
        void main(){
          vec2 uv = gl_FragCoord.xy / u_resolution.xy;
          uv += vNormal.xy * 0.2;
          uv.x *= u_resolution.x / u_resolution.y;
          vec3 baseColor = vec3(0.04, 0.04, 0.06);
          vec2 st = uv * 0.6;
          st += vec2(snoise(st + u_time * 0.06), snoise(st - u_time * 0.06)) * 0.35;
          float beam = smoothstep(0.1, 0.9, snoise(vec2(st.x + st.y * 1.8 - u_time * 0.12, u_time * 0.02)));
          vec3 glow = mix(u_color1, u_color2, snoise(uv * 1.8 + u_time * 0.12) * 0.5 + 0.5);
          float fresnel = clamp(1.0 - dot(vec3(0.0, 0.0, 1.0), vNormal), 0.0, 1.0);
          fresnel = pow(fresnel, 2.5);
          vec3 finalColor = mix(baseColor, glow, clamp((beam * 0.5) + (fresnel * 0.8), 0.0, 1.0));
          gl_FragColor = vec4(finalColor, 0.95);
        }
      `,
      uniforms,
      transparent: true,
    });

    const sphereGeo = new THREE.SphereGeometry(1, 48, 48);
    const sphereData = [
      { scale: 4.2, x: 6.5, y: -1.2, z: -1.5, speed: 0.002 },
      { scale: 1.8, x: -6.0, y: -4.0, z: 2.5, speed: 0.004 },
      { scale: 1.1, x: -4.5, y: 4.2, z: -2.0, speed: 0.005 },
      { scale: 0.75, x: 3.0, y: 5.5, z: 4.0, speed: 0.008 },
    ];
    const spheres = sphereData.map((data) => {
      const mesh = new THREE.Mesh(sphereGeo, glassMaterial);
      mesh.scale.setScalar(data.scale);
      mesh.position.set(data.x, data.y, data.z);
      scene.add(mesh);
      return { mesh, baseY: data.y, speed: data.speed, offset: Math.random() * Math.PI * 2 };
    });

    let mouseX = 0;
    let mouseY = 0;
    const onMouseMove = (event: MouseEvent) => {
      mouseX = event.clientX - window.innerWidth / 2;
      mouseY = event.clientY - window.innerHeight / 2;
    };
    window.addEventListener("mousemove", onMouseMove);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const dist = camera.position.z - bgMesh.position.z;
      const vFov = (camera.fov * Math.PI) / 180;
      const planeHeight = 2 * Math.tan(vFov / 2) * dist;
      bgMesh.scale.set((planeHeight * camera.aspect) / 2, planeHeight / 2, 1);
      uniforms.u_resolution.value.set(width, height);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const clock = new THREE.Clock();
    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const time = clock.getElapsedTime();
      uniforms.u_time.value = time;
      camera.position.x += (mouseX * 0.005 - camera.position.x) * 0.05;
      camera.position.y += (-mouseY * 0.005 - camera.position.y) * 0.05;
      camera.lookAt(scene.position);
      spheres.forEach((s) => {
        s.mesh.position.y = s.baseY + Math.sin(time * s.speed * 120 + s.offset) * 0.5;
        s.mesh.rotation.x = time * s.speed * 18;
        s.mesh.rotation.y = time * s.speed * 24;
      });
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      ro.disconnect();
      window.removeEventListener("mousemove", onMouseMove);
      sphereGeo.dispose();
      bgMaterial.dispose();
      glassMaterial.dispose();
      bgMesh.geometry.dispose();
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
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#050608",
        pointerEvents: "none",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.06,
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(255,255,255,0.8) 0, rgba(255,255,255,0.8) 1px, transparent 1px, transparent 56px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.15,
          mixBlendMode: "overlay",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}

export default DimensionalField;
