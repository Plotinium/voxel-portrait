import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { VoxelCubeData } from './types/voxelPortrait';
import { getTransitionField } from './lib/transitions';
import { seededUnit } from './lib/transitions/seed';

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

/** A periodic performance sample emitted to the consumer via `onPerfSample`. */
export type PerfSample = {
  /** Frames per second over the sample window. */
  fps: number;
  /** Frames in the window slower than ~1.5× the target budget. */
  dropped: number;
  /** Renderer device-pixel-ratio at sample time (reflects adaptive throttling). */
  dpr: number;
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
  /** Stable instance-buffer size; never changes between image swaps. */
  capacity: number;
  /** Sphere geometry segment count (driven by the quality profile). */
  sphereSegments?: number;
  /** Active particle-storm style. */
  transitionStyle?: string;
  transitionParams?: Record<string, number>;
  /** Incremented to start a storm (disperse → hold). */
  transitionToken?: number;
  /** Incremented when new cubes are ready (storm → converge). */
  convergeToken?: number;
  disperseDuration?: number;
  convergeDuration?: number;
  minHold?: number;
  /** Fired on every storm phase change (idle/disperse/hold/converge). */
  onStormPhaseChange?: (phase: 'idle' | 'disperse' | 'hold' | 'converge') => void;
  /** Fired roughly once per second with FPS / dropped-frame / dpr telemetry. */
  onPerfSample?: (sample: PerfSample) => void;
};

const tempObject = new THREE.Object3D();
const stormOut: [number, number, number] = [0, 0, 0];
const stormCtx = {
  index: 0,
  count: 0,
  elapsed: 0,
  stormTime: 0,
  bx: 0,
  by: 0,
  bz: 0,
  params: {} as Record<string, number>,
};

const EMPTY_PARAMS: Record<string, number> = {};

// Reused scratch objects for the per-cube colour math — hoisted so the dimming
// loop allocates nothing (the GC spike used to land mid-storm).
const colorScratch = new THREE.Color();
const hslScratch = { h: 0, s: 0, l: 0 };

/**
 * Point a mesh's `instanceColor` at `array` without ever reallocating the GPU
 * buffer across image swaps: the attribute wraps the *same* persistent
 * Float32Array (stable while capacity is stable), so a swap just flips
 * `needsUpdate`. A new attribute is created only when the backing array changes
 * (i.e. capacity changed, which already reallocates the matrix buffer too).
 */
function bindInstanceColor(mesh: THREE.InstancedMesh, array: Float32Array): void {
  if (!mesh.instanceColor || mesh.instanceColor.array !== array) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(array, 3);
  }
  mesh.instanceColor.needsUpdate = true;
}

/** Depth-cued, linear-RGB colours written in place — no per-cube allocation. */
function fillDimmedColors(cubes: VoxelCubeData[], out: Float32Array): void {
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
    const depthT = (cube.initialPosition[2] - minDepth) / depthRange;
    const centeredDepth = (depthT - 0.5) * 2;
    const nearAmount = Math.max(0, -centeredDepth);
    const farAmount = Math.max(0, centeredDepth);
    colorScratch.set(cube.color).convertLinearToSRGB();
    colorScratch.getHSL(hslScratch);
    const saturationShift = nearAmount * 0.08 - farAmount * 0.03;
    const lightnessShift = nearAmount * 0.16 - farAmount * 0.2;
    colorScratch
      .setHSL(
        hslScratch.h,
        clamp01(hslScratch.s + saturationShift),
        clamp01(hslScratch.l + lightnessShift),
      )
      .convertSRGBToLinear();
    const offset = i * 3;
    out[offset] = colorScratch.r;
    out[offset + 1] = colorScratch.g;
    out[offset + 2] = colorScratch.b;
  }
}

/** Raw sampled pixel colours in linear RGB, written in place. */
function fillPixelColors(cubes: VoxelCubeData[], out: Float32Array): void {
  for (let i = 0; i < cubes.length; i += 1) {
    colorScratch.set(cubes[i].pixelColor).convertSRGBToLinear();
    const offset = i * 3;
    out[offset] = colorScratch.r;
    out[offset + 1] = colorScratch.g;
    out[offset + 2] = colorScratch.b;
  }
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
  capacity,
  sphereSegments = 10,
  transitionStyle = 'vortex',
  transitionParams = EMPTY_PARAMS,
  transitionToken = 0,
  convergeToken = 0,
  disperseDuration = 0.6,
  convergeDuration = 0.7,
  minHold = 0.25,
  onStormPhaseChange,
  onPerfSample,
}: VoxelPortraitSceneProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const flatMeshRef = useRef<THREE.InstancedMesh>(null);
  // Kept in a ref so the render-loop emitter always sees the latest callback
  // without making it a useFrame dependency.
  const onStormPhaseChangeRef = useRef(onStormPhaseChange);
  onStormPhaseChangeRef.current = onStormPhaseChange;
  // Same ref pattern for the perf callback so it never enters the render loop.
  const onPerfSampleRef = useRef(onPerfSample);
  onPerfSampleRef.current = onPerfSample;
  // Perf-sample accumulators (frames/time/dropped over the current ~1s window).
  const perfFramesRef = useRef(0);
  const perfDroppedRef = useRef(0);
  const perfElapsedRef = useRef(0);
  const smoothedHoverBoostRef = useRef(0);
  const smoothedClickBoostRef = useRef(0);

  // Stable buffer size — the mesh is never re-created on image swap, only its
  // `count` changes, so GPU buffers are not re-allocated.
  const instanceCapacity = Math.max(1, capacity, cubes.length);

  // Transition state machine (lives in refs so it never triggers re-renders).
  const phaseRef = useRef<'idle' | 'disperse' | 'hold' | 'converge'>('idle');
  const phaseStartRef = useRef(0);
  const holdStartRef = useRef(0);
  const stormStartRef = useRef(0);
  const stormBlendRef = useRef(0);
  const convergeRequestedRef = useRef(false);
  const lastTransitionTokenRef = useRef(transitionToken);
  const lastConvergeTokenRef = useRef(convergeToken);
  const lastEmittedPhaseRef = useRef(phaseRef.current);

  // Idle-skip bookkeeping.
  const lastEasedProgressRef = useRef(Number.NaN);
  const lastCubesRef = useRef<VoxelCubeData[] | null>(null);

  // Persistent colour buffers sized to the stable instance capacity. They are
  // allocated once (re-allocated only if capacity changes) and the attribute
  // wraps them directly, so an image swap reuses the same GPU buffer instead of
  // reallocating it mid-storm.
  const dimmedColorArray = useMemo(
    () => new Float32Array(instanceCapacity * 3),
    [instanceCapacity],
  );
  const pixelColorArray = useMemo(
    () => new Float32Array(instanceCapacity * 3),
    [instanceCapacity],
  );

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) { return; }
    mesh.count = cubes.length;
    fillDimmedColors(cubes, dimmedColorArray);
    bindInstanceColor(mesh, dimmedColorArray);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => { m.needsUpdate = true; });
  }, [cubes, dimmedColorArray]);

  useLayoutEffect(() => {
    if (!imagePlaneEnabled) return;
    const mesh = flatMeshRef.current;
    if (!mesh) return;
    mesh.count = cubes.length;
    fillPixelColors(cubes, pixelColorArray);
    bindInstanceColor(mesh, pixelColorArray);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => { m.needsUpdate = true; });
  }, [cubes, pixelColorArray, imagePlaneEnabled]);

  // Dispose GPU resources on unmount to avoid memory growth across SPA routes.
  useEffect(() => () => {
    for (const mesh of [meshRef.current, flatMeshRef.current]) {
      if (!mesh) { continue; }
      mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => m.dispose());
      mesh.dispose();
    }
  }, []);

  const easedProgress = useMemo(() => {
    const t = Math.min(1, Math.max(0, progress));
    return 1 - Math.pow(1 - t, 3);
  }, [progress]);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) { return; }

    const elapsed = state.clock.getElapsedTime();

    // --- Transition state machine -----------------------------------------
    const transitionTokenChanged = transitionToken !== lastTransitionTokenRef.current;
    const convergeTokenChanged = convergeToken !== lastConvergeTokenRef.current;

    if (transitionTokenChanged) {
      lastTransitionTokenRef.current = transitionToken;
      phaseRef.current = 'disperse';
      phaseStartRef.current = elapsed;
      stormStartRef.current = elapsed;
      convergeRequestedRef.current = false;
    }
    if (convergeTokenChanged) {
      lastConvergeTokenRef.current = convergeToken;
      convergeRequestedRef.current = true;
    }

    let stormBlend = stormBlendRef.current;
    if (phaseRef.current === 'disperse') {
      const t = (elapsed - phaseStartRef.current) / Math.max(0.0001, disperseDuration);
      if (t >= 1) {
        stormBlend = 1;
        phaseRef.current = 'hold';
        holdStartRef.current = elapsed;
      } else {
        stormBlend = easeInOut(t);
      }
    }
    if (phaseRef.current === 'hold') {
      stormBlend = 1;
      if (convergeRequestedRef.current && (elapsed - holdStartRef.current) >= minHold) {
        phaseRef.current = 'converge';
        phaseStartRef.current = elapsed;
      }
    }
    if (phaseRef.current === 'converge') {
      const t = (elapsed - phaseStartRef.current) / Math.max(0.0001, convergeDuration);
      if (t >= 1) {
        stormBlend = 0;
        phaseRef.current = 'idle';
        convergeRequestedRef.current = false;
      } else {
        stormBlend = 1 - easeInOut(t);
      }
    }
    stormBlendRef.current = stormBlend;
    const stormActive = stormBlend > 0.0001 || phaseRef.current !== 'idle';
    const stormTime = elapsed - stormStartRef.current;

    // Emit phase changes here — before the idle-skip early-return below — so the
    // final `→ idle` still fires even though that frame renders nothing.
    if (phaseRef.current !== lastEmittedPhaseRef.current) {
      lastEmittedPhaseRef.current = phaseRef.current;
      onStormPhaseChangeRef.current?.(phaseRef.current);
    }

    // --- Perf sampling (emitted ~1×/sec) ----------------------------------
    // Placed before the idle-skip return so telemetry keeps flowing while the
    // portrait is static. `delta` is the real frame interval even on skipped
    // frames, so dropped-frame detection stays accurate.
    if (onPerfSampleRef.current) {
      perfFramesRef.current += 1;
      perfElapsedRef.current += delta;
      // A frame is "dropped" when it took >1.5× a 60fps budget (~25ms).
      if (delta > 0.025) { perfDroppedRef.current += 1; }
      if (perfElapsedRef.current >= 1) {
        onPerfSampleRef.current({
          fps: perfFramesRef.current / perfElapsedRef.current,
          dropped: perfDroppedRef.current,
          dpr: state.gl.getPixelRatio(),
        });
        perfFramesRef.current = 0;
        perfDroppedRef.current = 0;
        perfElapsedRef.current = 0;
      }
    }

    // --- Idle frame-skipping ----------------------------------------------
    smoothedHoverBoostRef.current = THREE.MathUtils.damp(
      smoothedHoverBoostRef.current, hoverBoost, 12, delta,
    );
    smoothedClickBoostRef.current = THREE.MathUtils.damp(
      smoothedClickBoostRef.current, clickBoost, 10, delta,
    );

    const wave = effects?.wave;
    const waveEnabled = wave?.enabled === true;
    const twist = effects?.twist;
    const twistEnabled = twist?.enabled === true;
    const pulse = effects?.pulse;
    const pulseEnabled = pulse?.enabled === true;

    const needInfluence = smoothedHoverBoostRef.current > 1e-4
      || smoothedClickBoostRef.current > 1e-4;
    const needProximity = imagePlaneEnabled && isHovering;
    const progressChanged = Math.abs(easedProgress - lastEasedProgressRef.current) > 1e-5;
    const cubesChanged = cubes !== lastCubesRef.current;

    const needsRender = stormActive
      || progressChanged
      || cubesChanged
      || needInfluence
      || needProximity
      || waveEnabled
      || twistEnabled
      || pulseEnabled;

    if (!needsRender) {
      return;
    }
    lastEasedProgressRef.current = easedProgress;
    lastCubesRef.current = cubes;

    mesh.count = cubes.length;
    const flatMesh = flatMeshRef.current;

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
    const hoverSigma = Math.max(0.0001, hoverInfluenceRadius * hoverInfluenceFalloff);
    const clickSigma = Math.max(0.0001, clickInfluenceRadius * clickInfluenceFalloff);
    const needDistance = needInfluence || needProximity;

    const waveAmplitude = wave?.amplitude ?? 0.18;
    const waveFrequency = wave?.frequency ?? 2.2;
    const waveSpeed = wave?.speed ?? 1.1;
    const waveAxis = wave?.axis ?? 'z';

    const twistStrength = twist?.strength ?? 0.18;
    const twistSpeed = twist?.speed ?? 0.9;

    const pulseAmplitude = pulse?.amplitude ?? 0.08;
    const pulseSpeed = pulse?.speed ?? 1.7;

    const field = getTransitionField(transitionStyle);
    const count = cubes.length;
    if (stormActive) {
      stormCtx.count = count;
      stormCtx.elapsed = elapsed;
      stormCtx.stormTime = stormTime;
      stormCtx.params = transitionParams;
    }

    for (let i = 0; i < count; i += 1) {
      const cube = cubes[i];

      let localProgress = easedProgress;
      let proximityActivation = 0;

      if (needDistance) {
        const dx = cube.initialPosition[0] - mouseLocalX;
        const dy = cube.initialPosition[1] - mouseLocalY;
        const distSq = dx * dx + dy * dy;
        if (needInfluence) {
          const hoverInfluence = Math.exp(-distSq / (2 * hoverSigma * hoverSigma));
          const clickInfluence = Math.exp(-distSq / (2 * clickSigma * clickSigma));
          localProgress = clamp01(
            easedProgress
            + smoothedHoverBoostRef.current * hoverInfluence
            + smoothedClickBoostRef.current * clickInfluence,
          );
        }
        if (needProximity) {
          proximityActivation = Math.exp(-distSq / (2 * activationSigma * activationSigma));
        }
      }

      const explodeActivation = imagePlaneEnabled ? easedProgress : 0;

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
        // Tiles dissolve into the storm as it ramps up.
        if (stormBlend > 0.0001) {
          flatScale *= 1 - stormBlend;
        }
        tempObject.scale.setScalar(flatScale);
        tempObject.updateMatrix();
        flatMesh.setMatrixAt(i, tempObject.matrix);
      }

      let x = lerp(cube.initialPosition[0], cube.explodedPosition[0], localProgress);
      let y = lerp(cube.initialPosition[1], cube.explodedPosition[1], localProgress);
      // Sphere z rises from 0 (flat) to its 3-D depth as the voxel activates.
      const assembledZ = imagePlaneEnabled
        ? lerp(0, cube.initialPosition[2], localActivation)
        : cube.initialPosition[2];
      let z = lerp(assembledZ, cube.explodedPosition[2], localProgress);

      // Blend toward the particle-storm position while a transition is active.
      if (stormBlend > 0.0001) {
        stormCtx.index = i;
        stormCtx.bx = cube.initialPosition[0];
        stormCtx.by = cube.initialPosition[1];
        stormCtx.bz = cube.initialPosition[2];
        field(stormCtx, stormOut);
        x = lerp(x, stormOut[0], stormBlend);
        y = lerp(y, stormOut[1], stormBlend);
        z = lerp(z, stormOut[2], stormBlend);
      }

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
      if (stormBlend > 0.0001) {
        // Tumble the particles while they swirl.
        rz += stormBlend * Math.sin(stormTime * 1.6 + i * 0.37) * 1.2;
      }

      tempObject.rotation.set(rx, ry, rz);

      let scale = lerp(cube.initialScale, cube.explodedScale, localProgress);
      if (pulseEnabled) {
        scale *= 1 + Math.sin(elapsed * pulseSpeed + y * 0.65) * pulseAmplitude;
      }
      // Shrink slightly at the storm peak — masks the colour swap mid-storm.
      if (stormBlend > 0.0001) {
        scale *= 1 - 0.15 * stormBlend;
      }

      // Gate sphere visibility by activation (always 1 when imagePlane is off).
      tempObject.scale.setScalar(Math.max(0.0001, scale * localActivation));
      tempObject.updateMatrix();
      mesh.setMatrixAt(i, tempObject.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (imagePlaneEnabled && flatMesh) {
      flatMesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group scale={portraitScale}>
      {imagePlaneEnabled && (
        <instancedMesh
          ref={flatMeshRef}
          args={[undefined, undefined, instanceCapacity]}
          frustumCulled={false}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial toneMapped={false} side={THREE.DoubleSide} />
        </instancedMesh>
      )}
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, instanceCapacity]}
        frustumCulled={false}
      >
        <sphereGeometry args={[cubeSize * 0.6, sphereSegments, sphereSegments]} />
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

function easeInOut(t: number): number {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}
