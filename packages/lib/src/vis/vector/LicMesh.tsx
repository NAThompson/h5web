import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  CustomBlending,
  DataTexture,
  DstColorFactor,
  GLSL3,
  NearestFilter,
  NormalBlending,
  RedFormat,
  RepeatWrapping,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector4,
  ZeroFactor,
} from 'three';

import { useVisCanvasContext } from '../shared/VisCanvasProvider';
import { getAxisExtent, type VectorField2D } from './field';
import { GLSL_SAMPLE_FIELD } from './glsl';
import { useFieldTextures } from './textures';

interface Props {
  field: VectorField2D;
  length?: number; // of the convolution kernel on each side, CSS pixels
  multiply?: boolean; // darken what is drawn below (e.g. a colour map), else draw grey levels
}

const NOISE_SIZE = 256;
const STEP = 1; // px

/* White noise, the same on every render (e.g. for snapshots) */
function createNoiseTexture(): DataTexture {
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE);
  let seed = 12_345;
  for (let i = 0; i < data.length; i += 1) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; // LCG
    data[i] = Math.floor(seed / 8_388_608); // top 8 bits
  }
  const texture = new DataTexture(
    data,
    NOISE_SIZE,
    NOISE_SIZE,
    RedFormat,
    UnsignedByteType,
  );
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

const VERTEX_SHADER = /* glsl */ `
  out vec2 vWorld;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  ${GLSL_SAMPLE_FIELD}

  uniform sampler2D noiseTex;
  uniform vec4 dataToWorld;
  uniform vec2 worldPerPx;
  uniform int steps;
  uniform int multiply;
  in vec2 vWorld;
  out vec4 fragColor;

  // Noise attached to the pixels of the zoom level, so it moves with the data when panning
  float noiseAt(vec2 world) {
    return texture(noiseTex, floor(world / worldPerPx) / ${NOISE_SIZE}.0).r;
  }

  vec2 toData(vec2 world) {
    return (world - dataToWorld.yw) / dataToWorld.xz;
  }

  void main() {
    vec2 uv;
    if (!sampleField(toData(vWorld), uv)) {
      discard;
    }
    float sum = noiseAt(vWorld);
    float count = 1.0;
    for (int side = -1; side <= 1; side += 2) {
      vec2 p = vWorld;
      for (int i = 0; i < 64; i++) {
        if (i >= steps || !sampleField(toData(p), uv)) {
          break;
        }
        vec2 screen = uv * dataToWorld.xz / worldPerPx;
        if (length(screen) == 0.0) {
          break;
        }
        // Midpoint step along the field on screen
        vec2 mid = p + float(side) * normalize(screen) * ${(STEP / 2).toFixed(1)} * worldPerPx;
        if (!sampleField(toData(mid), uv)) {
          break;
        }
        screen = uv * dataToWorld.xz / worldPerPx;
        if (length(screen) == 0.0) {
          break;
        }
        p += float(side) * normalize(screen) * ${STEP.toFixed(1)} * worldPerPx;
        sum += noiseAt(p);
        count += 1.0;
      }
    }

    // Averaging flattens the noise (std 0.29 / √n): stretch the contrast back
    float val = clamp(0.5 + (sum / count - 0.5) * 0.6 * sqrt(count), 0.0, 1.0);
    fragColor = multiply == 1
      ? vec4(vec3(mix(0.3, 1.0, val)), 1.0)
      : vec4(vec3(val), 1.0);
  }
`;

/*
 * Line integral convolution (Cabral & Leedom, 1993) in screen space: each fragment averages
 * white noise along the streamline through it, traced both ways in the fragment shader (midpoint
 * steps of 1 px on the field as shown on screen), so streaks follow the flow at any zoom level.
 */
function LicMesh(props: Props) {
  const { field, length = 20, multiply = true } = props;

  const { abscissaScale, ordinateScale } = useVisCanvasContext();
  const camera = useThree((state) => state.camera);
  const textures = useFieldTextures(field);
  const noiseTex = useMemo(createNoiseTexture, []);
  useEffect(() => () => noiseTex.dispose(), [noiseTex]);

  const [ax, bx] = [abscissaScale(1) - abscissaScale(0), abscissaScale(0)];
  const [ay, by] = [ordinateScale(1) - ordinateScale(0), ordinateScale(0)];

  const material = useMemo(
    () =>
      new ShaderMaterial({
        glslVersion: GLSL3,
        uniforms: {
          ...Object.fromEntries(
            Object.entries(textures).map(([key, value]) => [key, { value }]),
          ),
          fieldSize: { value: new Vector2(...textures.fieldSize) },
          noiseTex: { value: noiseTex },
          dataToWorld: { value: new Vector4() },
          worldPerPx: { value: new Vector2(1, 1) },
          steps: { value: Math.round(length / STEP) },
          multiply: { value: multiply ? 1 : 0 },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        depthTest: false,
        transparent: multiply,
        ...(multiply
          ? {
              blending: CustomBlending,
              blendSrc: DstColorFactor,
              blendDst: ZeroFactor,
            }
          : { blending: NormalBlending }),
      }),
    [textures, noiseTex, length, multiply],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    (material.uniforms.dataToWorld.value as Vector4).set(ax, bx, ay, by);
    (material.uniforms.worldPerPx.value as Vector2).set(
      camera.scale.x,
      camera.scale.y,
    );
  });

  // Quad over the grid
  const [x0, x1] = getAxisExtent(field.xs).map(abscissaScale);
  const [y0, y1] = getAxisExtent(field.ys).map(ordinateScale);

  return (
    <mesh
      position={[(x0 + x1) / 2, (y0 + y1) / 2, 0.5]}
      scale={[Math.abs(x1 - x0), Math.abs(y1 - y0), 1]}
      material={material}
      renderOrder={1}
    >
      <planeGeometry />
    </mesh>
  );
}

export type { Props as LicMeshProps };
export default LicMesh;
