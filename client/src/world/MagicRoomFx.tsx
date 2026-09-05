import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }

  void main() {
    vec3 n = normalize(vNormal);
    float t = uTime * 0.35;
    float bands = sin(vWorldPos.y * 0.35 + t * 2.0 + noise(vWorldPos * 0.15 + t) * 4.0);
    float veins = smoothstep(0.2, 0.85, noise(vWorldPos * 0.22 + vec3(t, -t * 0.4, t * 0.7)));
    float fres = pow(1.0 - max(0.0, abs(dot(n, normalize(cameraPosition - vWorldPos)))), 1.8);
    vec3 col = uColor * (0.28 + 0.5 * veins);
    col += vec3(0.15, 0.95, 0.55) * (0.2 + 0.4 * bands);
    col += vec3(0.95, 0.25, 1.0) * fres * 0.7;
    col += vec3(0.1, 0.85, 1.0) * pow(noise(vWorldPos * 0.08 - t), 3.0) * 0.8;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function MagicShaderShell({ color = "#c6ff00" }: { color?: string }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
    }),
    [color],
  );

  useFrame((state) => {
    if (mat.current) mat.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[20, 64, 48]} />
      <shaderMaterial
        ref={mat}
        side={THREE.BackSide}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        depthWrite={false}
      />
    </mesh>
  );
}
