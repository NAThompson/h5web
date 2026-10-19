import { type Domain, ScaleType } from '@h5web/shared/vis-models';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  BufferAttribute,
  Color,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
} from 'three';

import { type ColorMap } from '../heatmap/models';
import {
  getColorMapTexture,
  getInterpolator,
  getShaderScale,
  GLSL_LOG1P,
  GLSL_SCALE,
  scaleDomain,
} from '../heatmap/utils';
import { type VisScaleType } from '../models';
import { useVisCanvasContext } from '../shared/VisCanvasProvider';
import {
  createSvgElement,
  type Mvp,
  SVG_DRAWER_KEY,
} from '../snapshot/svgScene';
import { fmt } from '../snapshot/svgUtils';
import { createScale } from '../utils';
import {
  ARROW_SHAPE,
  getArrowGrid,
  getGlyphPolygon,
  getMaxGridSize,
  GLSL_GLYPH,
  GLYPH_INDICES,
  GLYPH_VERTICES,
} from './arrows';
import { sampleField, type Vec2, type VectorField2D } from './field';
import { GLSL_SAMPLE_FIELD } from './glsl';
import { useFieldTextures } from './textures';

export interface ArrowColorMap {
  colorMap: ColorMap;
  invertColorMap: boolean;
  domain: Domain; // of the magnitude
  scaleType?: VisScaleType; // as the colour bar (default: linear)
}

interface Props {
  field: VectorField2D;
  spacing: number; // between arrows, CSS pixels (cf. `getArrowGrid`)
  pxPerUnit: number; // arrow length in CSS pixels per unit of magnitude
  maxLength?: number; // CSS pixels: longer arrows are capped (e.g. near singularities)
  uniformLength?: number; // CSS pixels: all arrows this long (direction only), if given
  color: string | ArrowColorMap; // solid, or by magnitude
  halo?: string; // colour of an outline, if any
}

const HALO_WIDTH = 1;

// Magnitude to colour-map coordinate as in `HeatmapMaterial` (scale, then domain, then gamma)
function getVertexShader(scaleType: ScaleType): string {
  return /* glsl */ `
  ${GLSL_SAMPLE_FIELD}
  ${GLSL_LOG1P}
  ${GLSL_GLYPH}

  in vec4 glyph;
  in vec2 cell;
  uniform vec4 dataToWorld; // ax, bx, ay, by: world = a * data + b
  uniform vec2 gridOrigin;
  uniform vec2 gridStep;
  uniform vec2 worldPerPx;
  uniform float pxPerUnit;
  uniform float maxLength;
  uniform float uniformLength;
  uniform vec3 shape; // shaft width, head width, head length (px)
  uniform float outline;
  uniform vec2 magDomain; // scaled
  uniform float gammaExponent;
  uniform float symlogConstant;
  out float vParam;

  const float oneOverLog10 = 0.43429448190325176;
  float scale(float value) {
    return ${GLSL_SCALE[scaleType] ?? 'value'};
  }

  void main() {
    vec2 world = gridOrigin + cell * gridStep;
    vec2 data = (world - dataToWorld.yw) / dataToWorld.xz;
    vec2 uv;
    bool ok = sampleField(data, uv);
    float len = uniformLength > 0.0
      ? (length(uv) > 0.0 ? uniformLength : 0.0)
      : min(length(uv) * pxPerUnit, maxLength);
    vec2 screen = uv * dataToWorld.xz / worldPerPx; // direction on screen (world y up)

    if (!ok || len < 0.5 || length(screen) == 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // clipped
      return;
    }

    vec2 dir = normalize(screen);
    vec2 offset = glyphOffset(glyph, len, shape, outline);
    vec2 pos = world + (dir * offset.x + vec2(-dir.y, dir.x) * offset.y) * worldPerPx;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
    float t = clamp((scale(length(uv)) - magDomain.x) / (magDomain.y - magDomain.x), 0.0, 1.0);
    vParam = pow(isnan(t) ? 0.0 : t, gammaExponent);
  }
`;
}

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D colorMap;
  uniform int byMagnitude;
  uniform vec3 color;
  in float vParam;
  out vec4 fragColor;

  void main() {
    fragColor = byMagnitude == 1
      ? texture(colorMap, vec2(vParam, 0.5))
      : vec4(color, 1.0);
  }
`;

/* SVG path of an arrow at a world position, along a unit direction on screen */
function arrowPath(
  [world, [dx, dy]]: [Vec2, Vec2],
  len: number,
  [wx, wy]: Vec2, // world units per pixel
  outline: number,
  toPx: Mvp,
): string {
  const pts = getGlyphPolygon(len, ARROW_SHAPE, outline).map(([a, s]) =>
    toPx(
      world[0] + (dx * a - dy * s) * wx,
      world[1] + (dy * a + dx * s) * wy,
      0,
    ),
  );
  if (!pts.every((p) => p !== undefined)) {
    return '';
  }
  return `M${pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}Z`;
}

function createGeometry(cols: number, rows: number): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    'position', // unused, but gives the vertex count
    new BufferAttribute(new Float32Array(GLYPH_VERTICES.length * 3), 3),
  );
  geometry.setAttribute(
    'glyph',
    new BufferAttribute(Float32Array.from(GLYPH_VERTICES.flat()), 4),
  );
  geometry.setIndex(GLYPH_INDICES);

  const cells = new Float32Array(cols * rows * 2);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      cells.set([i, j], (j * cols + i) * 2);
    }
  }
  geometry.setAttribute('cell', new InstancedBufferAttribute(cells, 2));
  geometry.instanceCount = cols * rows;
  return geometry;
}

/*
 * Arrows of a 2D field on a grid of constant density on screen (cf. `getArrowGrid`), placed,
 * oriented and sized in the vertex shader from the field's textures: zooming and panning only
 * update a few uniforms. Arrows are centred on their grid point, along the field as shown on
 * screen (e.g. with unequal axis scales), with a length proportional to the magnitude.
 */
function ArrowGlyphs(props: Props) {
  const {
    field,
    spacing,
    pxPerUnit,
    maxLength = Infinity,
    uniformLength = 0,
    color,
    halo,
  } = props;

  const { abscissaScale, ordinateScale } = useVisCanvasContext();
  const size = useThree((state) => state.size);
  const camera = useThree((state) => state.camera);
  const textures = useFieldTextures(field);

  // World = a * data + b (linear axes)
  const [ax, bx] = [abscissaScale(1) - abscissaScale(0), abscissaScale(0)];
  const [ay, by] = [ordinateScale(1) - ordinateScale(0), ordinateScale(0)];

  const [maxCols, maxRows] = getMaxGridSize(size, spacing);
  const geometry = useMemo(
    () => createGeometry(maxCols, maxRows),
    [maxCols, maxRows],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Solid colour or colour map: materials don't depend on the magnitude domain (a uniform)
  const solidColor = typeof color === 'string' ? color : undefined;
  const colorMap = typeof color === 'string' ? undefined : color.colorMap;
  const invertColorMap = typeof color !== 'string' && color.invertColorMap;
  const visScaleType =
    typeof color === 'string'
      ? ScaleType.Linear
      : (color.scaleType ?? ScaleType.Linear);
  const [scaleType, gammaExponent, symlogConstant] =
    getShaderScale(visScaleType);
  const colorMapTexture = useMemo(
    () => colorMap && getColorMapTexture(colorMap, invertColorMap),
    [colorMap, invertColorMap],
  );
  useEffect(() => () => colorMapTexture?.dispose(), [colorMapTexture]);

  const materials = useMemo(() => {
    const shared = {
      ...textures,
      fieldSize: new Vector2(...textures.fieldSize),
      dataToWorld: new Vector4(),
      gridOrigin: new Vector2(),
      gridStep: new Vector2(),
      worldPerPx: new Vector2(),
      pxPerUnit: 1,
      maxLength: 1,
      uniformLength: 0,
      shape: new Vector3(
        ARROW_SHAPE.shaftWidth,
        ARROW_SHAPE.headWidth,
        ARROW_SHAPE.headLength,
      ),
      magDomain: new Vector2(0, 1),
      gammaExponent: 1,
      symlogConstant: 1,
    };
    function create(outline: number, solid: string | undefined) {
      const uniforms = Object.fromEntries(
        Object.entries({
          ...shared,
          outline,
          colorMap: colorMapTexture,
          byMagnitude: solid ? 0 : 1,
          color: new Color(solid ?? 'black'),
        }).map(([key, value]) => [key, { value }]),
      );
      return new ShaderMaterial({
        glslVersion: GLSL3,
        uniforms,
        vertexShader: getVertexShader(scaleType),
        fragmentShader: FRAGMENT_SHADER,
        depthTest: false,
      });
    }
    return {
      arrows: create(0, solidColor),
      halo: halo ? create(HALO_WIDTH, halo) : undefined,
    };
  }, [textures, colorMapTexture, solidColor, halo, scaleType]);
  useEffect(
    () => () => {
      materials.arrows.dispose();
      materials.halo?.dispose();
    },
    [materials],
  );

  // Uniforms only: no work per arrow on the CPU; render again when they change (on demand)
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [invalidate, pxPerUnit, maxLength, uniformLength, color, ax, bx, ay, by]);
  useFrame(() => {
    const grid = getArrowGrid(
      [camera.position.x, camera.position.y],
      [camera.scale.x, camera.scale.y],
      size,
      spacing,
    );
    for (const material of [materials.arrows, materials.halo]) {
      if (!material) {
        continue;
      }
      const { uniforms } = material;
      (uniforms.dataToWorld.value as Vector4).set(ax, bx, ay, by);
      (uniforms.gridOrigin.value as Vector2).set(...grid.origin);
      (uniforms.gridStep.value as Vector2).set(...grid.step);
      (uniforms.worldPerPx.value as Vector2).set(
        camera.scale.x,
        camera.scale.y,
      );
      uniforms.pxPerUnit.value = pxPerUnit;
      uniforms.maxLength.value = Math.min(maxLength, 1e6);
      uniforms.uniformLength.value = uniformLength;
      if (typeof color !== 'string') {
        (uniforms.magDomain.value as Vector2).set(
          ...scaleDomain(color.domain, scaleType, symlogConstant),
        );
        uniforms.gammaExponent.value = gammaExponent;
        uniforms.symlogConstant.value = symlogConstant;
      }
    }
  });

  // Same arrows as paths for SVG snapshots
  function toSvg(toPx: Mvp): SVGElement[] {
    const grid = getArrowGrid(
      [camera.position.x, camera.position.y],
      [camera.scale.x, camera.scale.y],
      size,
      spacing,
    );
    const interpolator =
      typeof color === 'string'
        ? undefined
        : getInterpolator(color.colorMap, color.invertColorMap);
    const colorScale =
      typeof color === 'string'
        ? undefined
        : createScale(visScaleType, {
            domain: color.domain,
            range: [0, 1],
            clamp: true,
          });
    const halos: string[] = [];
    const byColor = new Map<string, string[]>();
    const [wx, wy] = [camera.scale.x, camera.scale.y];

    for (let j = 0; j < grid.rows; j += 1) {
      for (let i = 0; i < grid.cols; i += 1) {
        const world: Vec2 = [
          grid.origin[0] + i * grid.step[0],
          grid.origin[1] + j * grid.step[1],
        ];
        const [u, v] = sampleField(
          field,
          (world[0] - bx) / ax,
          (world[1] - by) / ay,
        );
        const mag = Math.hypot(u, v);
        const len =
          uniformLength > 0
            ? mag > 0
              ? uniformLength
              : 0
            : Math.min(mag * pxPerUnit, maxLength);
        const [sx, sy] = [(u * ax) / wx, (v * ay) / wy];
        const norm = Math.hypot(sx, sy);
        if (!Number.isFinite(len) || len < 0.5 || norm === 0) {
          continue;
        }
        const [dx, dy] = [sx / norm, sy / norm];
        if (halo) {
          halos.push(
            arrowPath([world, [dx, dy]], len, [wx, wy], HALO_WIDTH, toPx),
          );
        }
        let css = typeof color === 'string' ? color : '';
        if (interpolator && colorScale) {
          const t = colorScale(mag) || 0; // e.g. 0 on a log scale: `NaN`
          css = interpolator(Math.round(t * 63) / 63); // a path per colour
        }
        const path = arrowPath([world, [dx, dy]], len, [wx, wy], 0, toPx);
        const parts = byColor.get(css);
        if (parts) {
          parts.push(path);
        } else {
          byColor.set(css, [path]);
        }
      }
    }

    return [
      ...(halos.length > 0
        ? [createSvgElement('path', { d: halos.join(''), fill: halo })]
        : []),
      ...[...byColor].map(([css, parts]) =>
        createSvgElement('path', { d: parts.join(''), fill: css }),
      ),
    ];
  }

  return (
    <group position={[0, 0, 1.5]}>
      {materials.halo && (
        <mesh
          geometry={geometry}
          material={materials.halo}
          frustumCulled={false}
          renderOrder={3}
          userData={{ [SVG_DRAWER_KEY]: () => [] }} // drawn with the arrows
        />
      )}
      <mesh
        geometry={geometry}
        material={materials.arrows}
        frustumCulled={false}
        renderOrder={4}
        userData={{ [SVG_DRAWER_KEY]: toSvg }}
      />
    </group>
  );
}

export type { Props as ArrowGlyphsProps };
export default ArrowGlyphs;
