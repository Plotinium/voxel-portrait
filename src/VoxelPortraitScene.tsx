import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { VoxelCubeData } from './types/voxelPortrait';

type SceneEffects = {
  wave?: {
    enabled?: boolean;
    amplitude?: number;
    frequency?: number;
    speed?: number;
    axis?: 'x' | 'y' | 'z';
  };
  twist?: {
    enabled?: boolean;
    strength?: number;
    speed?: number;
  };
  pulse?: {
    enabled?: boolean;
    amplitude?: number;
    speed?: number;
  };
};

type VoxelPortraitSceneProps = {
  cubes: VoxelCubeData[];
  cubeSize: number;
  portraitScale: number;
  progress: number;
  hoverBoost: number;
  clickBoost: number;
  hoverInfluenceRadius: number;
  hoverInfluenceFalloff: number;
  clickInfluenceRadius: number;
  clickInfluenceFalloff: number;
  effects?: SceneEffects;
  imagePlaneEnabled?: boolean;
  imagePlaneProximityRadius?: number;
  imagePlaneTransitionRange?: number;
  imagePlaneSuppressGridArtifacts?: boolean;
  isHovering?: boolean;
};

const tempObject = new THREE.Object3D();
function uploadInstanceColors(mesh: THREE.InstancedMesh, colorArray: Float32Array): void {
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(colorArray), 3);
  attribute.needsUpdate = true;
  mesh.instanceColor = attribute;
}

export function VoxelPortraitScene({
  cubes,
  cubeSize,
  portraitScale,
  progress,
  hoverBoost,
  clickBoost,
  hoverInfluenceRadius,
  hoverInfluenceFalloff,
  clickInfluenceRadius,
  clickInfluenceFalloff,
  effects,
  imagePlaneEnabled = false,
  imagePlaneProximityRadius = 1,
  imagePlaneTransitionRange = 1,
  imagePlaneSuppressGridArtifacts = false,
  isHovering = false,
}: VoxelPortraitSceneProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const flatMeshRef = useRef<THREE.InstancedMesh>(null);
  const smoothedHoverBoostRef = useRef(0);
  const smoothedClickBoostRef = useRef(0);

  const dimmedColorArray = useMemo(() => {
    const colors = new Float32Array(cubes.length * 3);
    let minDepth = Number.POSITIVE_INFINITY;
    let maxDepth = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < cubes.length; i += 1) {
      const depth = cubes[i].initialPosition[2];
      if (depth < minDepth) { minDepth = depth; }
      if (depth > maxDepth) { maxDepth = depth; }
    }
    const depthRange = Math.max(0.0001, maxDepth - minDepth);
    for (let i = 0; i < cubes.length; i += 1) {
      const cube = cubes[i];
      const depth = cube.initialPosition[2];
      const depthT = (depth - minDepth) / depthRange;
      const centeredDepth = (depthT - 0.5) * 2;
      const nearAmount = Math.max(0, -centeredDepth);
      const farAmount = Math.max(0, centeredDepth);
      const baseSrgb = new THREE.Color(cube.color).convertLinearToSRGB();
      const hsl = { h: 0, s: 0, l: 0 };
      baseSrgb.getHSL(hsl);
      const saturationShift = nearAmount * 0.08 - farAmount * 0.03;
      const lightnessShift = nearAmount * 0.16 - farAmount * 0.2;
      const adjustedSrgb = new THREE.Color().setHSL(
        hsl.h,
        clamp01(hsl.s + saturationShift),
        clamp01(hsl.l + lightnessShift),
      );
      const adjustedLinear = adjustedSrgb.convertSRGBToLinear();
      const offset = i * 3;
      colors[offset] = adjustedLinear.r;
      colors[offset + 1] = adjustedLinear.g;
      colors[offset + 2] = adjustedLinear.b;
    }
    return colors;
  }, [cubes]);

  const pixelColorArray = useMemo(() => {
    const colors = new Float32Array(cubes.length * 3);
    for (let i = 0; i < cubes.length; i += 1) {
      const c = new THREE.Color(cubes[i].pixelColor).convertSRGBToLinear();
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return colors;
  }, [cubes]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) { return; }
    uploadInstanceColors(mesh, dimmedColorArray);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => { m.needsUpdate = true; });
  }, [cubes, dimmedColorArray]);

  useLayoutEffect(() => {
    if (!imagePlaneEnabled) return;
    const mesh = flatMeshRef.current;
    if (!mesh) return;
    uploadInstanceColors(mesh, pixelColorArray);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => { m.needsUpdate = true; });
  }, [cubes, pixelColorArray, imagePlaneEnabled]);

  const easedProgress = useMemo(() => {
    const t = Math.min(1, Math.max(0, progress));
    return 1 - Math.pow(1 - t, 3);
  }, [progress]);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) { return; }

    smoothedHoverBoostRef.current = THREE.MathUtils.damp(
      smoothedHoverBoostRef.current, hoverBoost, 12, delta,
    );
    smoothedClickBoostRef.current = THREE.MathUtils.damp(
      smoothedClickBoostRef.current, clickBoost, 10, delta,
    );

    const camera = state.camera as THREE.PerspectiveCamera;
    const depthFromCamera = Math.max(1, camera.position.z);
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depthFromCamera;
    const visibleWidth = visibleHeight * camera.aspect;
    const mouseWorldX = state.pointer.x * (visibleWidth / 2);
    const mouseWorldY = state.pointer.y * (visibleHeight / 2);
    const mouseLocalX = mouseWorldX / Math.max(0.0001, portraitScale);
    const mouseLocalY = mouseWorldY / Math.max(0.0001, portraitScale);

    const activationSigma = imagePlaneEnabled
      ? Math.max(0.0001, imagePlaneProximityRadius * imagePlaneTransitionRange)
      : 1;
    const flatMesh = flatMeshRef.current;

    const hoverSigma = Math.max(0.0001, hoverInfluenceRadius * hoverInfluenceFalloff);
    const clickSigma = Math.max(0.0001, clickInfluenceRadius * clickInfluenceFalloff);
    const elapsed = state.clock.getElapsedTime();

    const wave = effects?.wave;
    const waveEnabled = wave?.enabled === true;
    const waveAmplitude = wave?.amplitude ?? 0.18;
    const waveFrequency = wave?.frequency ?? 2.2;
    const waveSpeed = wave?.speed ?? 1.1;
    const waveAxis = wave?.axis ?? 'z';

    const twist = effects?.twist;
    const twistEnabled = twist?.enabled === true;
    const twistStrength = twist?.strength ?? 0.18;
    const twistSpeed = twist?.speed ?? 0.9;

    const pulse = effects?.pulse;
    const pulseEnabled = pulse?.enabled === true;
    const pulseAmplitude = pulse?.amplitude ?? 0.08;
    const pulseSpeed = pulse?.speed ?? 1.7;

    for (let i = 0; i < cubes.length; i += 1) {
      const cube = cubes[i];

      const dx = cube.initialPosition[0] - mouseLocalX;
      const dy = cube.initialPosition[1] - mouseLocalY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const hoverInfluence = Math.exp(-(distance * distance) / (2 * hoverSigma * hoverSigma));
      const clickInfluence = Math.exp(-(distance * distance) / (2 * clickSigma * clickSigma));
      const localProgress = clamp01(
        easedProgress
        + smoothedHoverBoostRef.current * hoverInfluence
        + smoothedClickBoostRef.current * clickInfluence,
      );

      const proximityActivation = (imagePlaneEnabled && isHovering)
        ? Math.exp(-(distance * distance) / (2 * activationSigma * activationSigma))
        : 0;
      const explodeActivation = imagePlaneEnabled
        ? easedProgress
        : 0;

      // localActivation: 0 = flat tile visible, 1 = sphere fully active.
      const localActivation = imagePlaneEnabled
        ? Math.max(proximityActivation, explodeActivation)
        : 1;

      if (imagePlaneEnabled && flatMesh) {
        tempObject.position.set(cube.initialPosition[0], cube.initialPosition[1], 0);
        tempObject.rotation.set(0, 0, 0);
        let flatScale = 0;
        if (imagePlaneSuppressGridArtifacts) {
          if (easedProgress > 0.001) {
            // During explode in suppress mode, use a binary dissolve to avoid partial tile sizes.
            const dissolveThreshold = 0.12 + seededUnit(i * 1.37 + 7.11) * 0.76;
            flatScale = explodeActivation >= dissolveThreshold ? 0 : cubeSize;
          } else {
            // On hover, keep hard switching to avoid checker/grid artifacts.
            flatScale = proximityActivation >= 0.22 ? 0 : cubeSize;
          }
        } else {
          flatScale = Math.max(0, cubeSize * (1 - localActivation));
        }
        tempObject.scale.setScalar(flatScale);
        tempObject.updateMatrix();
        flatMesh.setMatrixAt(i, tempObject.matrix);
      }

      const x = lerp(cube.initialPosition[0], cube.explodedPosition[0], localProgress);
      const y = lerp(cube.initialPosition[1], cube.explodedPosition[1], localProgress);
      // Sphere z rises from 0 (flat) to its 3-D depth as the voxel activates.
      const assembledZ = imagePlaneEnabled
        ? lerp(0, cube.initialPosition[2], localActivation)
        : cube.initialPosition[2];
      const z = lerp(assembledZ, cube.explodedPosition[2], localProgress);

      let fx = x;
      let fy = y;
      let fz = z;

      if (waveEnabled) {
        const phase = x * waveFrequency + y * waveFrequency * 0.72 + elapsed * waveSpeed;
        const waveOffset = Math.sin(phase) * waveAmplitude * (1 - localProgress * 0.25);
        if (waveAxis === 'x') { fx += waveOffset; }
        else if (waveAxis === 'y') { fy += waveOffset; }
        else { fz += waveOffset; }
      }

      tempObject.position.set(fx, fy, fz);

      const rx = lerp(cube.initialRotation[0], cube.explodedRotation[0], localProgress);
      const ry = lerp(cube.initialRotation[1], cube.explodedRotation[1], localProgress);
      let rz = lerp(cube.initialRotation[2], cube.explodedRotation[2], localProgress);

      if (twistEnabled) {
        const radial = Math.sqrt(x * x + y * y);
        rz += Math.sin(elapsed * twistSpeed + radial * 1.35) * twistStrength;
      }

      tempObject.rotation.set(rx, ry, rz);

      let scale = lerp(cube.initialScale, cube.explodedScale, localProgress);
      if (pulseEnabled) {
        scale *= 1 + Math.sin(elapsed * pulseSpeed + y * 0.65) * pulseAmplitude;
      }

      // Gate sphere visibility by activation (always 1 when imagePlane is off).
      tempObject.scale.setScalar(Math.max(0.0001, scale * localActivation));
      tempObject.updateMatrix();
      mesh.setMatrixAt(i, tempObject.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (!mesh.instanceColor || mesh.instanceColor.count !== cubes.length) {
      uploadInstanceColors(mesh, dimmedColorArray);
      const sphereMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      sphereMats.forEach((m) => { m.needsUpdate = true; });
    } else {
      mesh.instanceColor.needsUpdate = true;
    }

    if (imagePlaneEnabled && flatMesh) {
      flatMesh.instanceMatrix.needsUpdate = true;
      if (!flatMesh.instanceColor || flatMesh.instanceColor.count !== cubes.length) {
        uploadInstanceColors(flatMesh, pixelColorArray);
        const flatMats = Array.isArray(flatMesh.material) ? flatMesh.material : [flatMesh.material];
        flatMats.forEach((m) => { m.needsUpdate = true; });
      } else {
        flatMesh.instanceColor.needsUpdate = true;
      }
    }
  });

  return (
    <group scale={portraitScale}>
      {imagePlaneEnabled && (
        <instancedMesh
          ref={flatMeshRef}
          args={[undefined, undefined, cubes.length]}
          frustumCulled={false}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial toneMapped={false} side={THREE.DoubleSide} />
        </instancedMesh>
      )}
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, cubes.length]}
        frustumCulled={false}
      >
        <sphereGeometry args={[cubeSize * 0.6, 10, 10]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function seededUnit(value: number): number {
  const wave = Math.sin(value * 12.9898) * 43758.5453;
  return wave - Math.floor(wave);
}
