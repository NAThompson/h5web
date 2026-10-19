/* eslint-disable no-param-reassign -- objects are hidden while the raster is rendered */
import { _roots, type RootState } from '@react-three/fiber';
import {
  type BufferAttribute,
  Color,
  type InterleavedBufferAttribute,
  type Material,
  Matrix4,
  NearestFilter,
  type Object3D,
  type Points,
  type ShaderMaterial,
  type Texture,
  Vector2,
  Vector3,
} from 'three';
import { type LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import LinePchipGeometry from '../line/linePchipGeometry';
import { GlyphType } from '../line/models';
import { getHermiteExtent } from '../line/utils';
import { ScaledOrthographicCamera } from '../shared/ScaledOrthographicCamera';
import { type CanvasPanels, renderPanel } from './panels';
import {
  chainSegments,
  decimate,
  fmt,
  getHermiteControls,
  type Point,
  type Subpath,
  toPathData,
} from './svgUtils';
import { getSafeScale, redraw } from './utils';

export const SVG_NS = 'http://www.w3.org/2000/svg';

export type Attrs = Record<string, string | number | undefined>;

export function createSvgElement(tag: string, attrs: Attrs = {}): SVGElement {
  const elem = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== undefined) {
      elem.setAttribute(name, typeof value === 'number' ? fmt(value) : value);
    }
  }
  return elem;
}

export interface SceneContext {
  /* Adds a definition (clip path, gradient...) and returns its `url(#id)` */
  define: (elem: SVGElement) => string;
  /* Light-theme colour of a colour (cf. dark-mode line colours) */
  mapColor: (color: string) => string;
  /* Output pixels per CSS pixel of the raster parts */
  rasterScale: number;
}

interface Drawable {
  object: Object3D;
  material: Material;
  groupOrder: number;
  z: number;
  isVector: boolean;
}

type Mvp = (x: number, y: number, z: number) => Point | undefined;

/* Scene drawn in an area of a canvas: the whole canvas or a panel of it */
type SceneState = Pick<RootState, 'scene' | 'camera' | 'size' | 'gl'>;

const GLYPH_TYPE_KEY = 'glyphType'; // in `userData` of `GlyphMaterial`
const MAX_VECTOR_GLYPHS = 200_000; // more glyphs (e.g. point clouds) are drawn in the raster

function isLineSegments2(obj: Object3D): obj is LineSegments2 {
  return 'isLineSegments2' in obj && obj.isLineSegments2 === true;
}

function getGlyphType(material: Material): GlyphType | undefined {
  const type: unknown = material.userData[GLYPH_TYPE_KEY];
  return Object.values(GlyphType).find((t) => t === type);
}

function isVectorizable(obj: Object3D, material: Material): boolean {
  return (
    isLineSegments2(obj) ||
    ('isLineSegments' in obj && obj.isLineSegments === true) ||
    ('isPoints' in obj &&
      obj.isPoints === true &&
      !!getGlyphType(material) &&
      (obj as Points).geometry.getAttribute('position').count <=
        MAX_VECTOR_GLYPHS)
  );
}

function getSortKey(d: Drawable): number[] {
  const { transparent } = d.material;
  const materialId = (d.material as { id?: number }).id ?? 0;
  return [
    transparent ? 1 : 0,
    d.groupOrder,
    d.object.renderOrder,
    transparent ? 0 : materialId,
    transparent ? -d.z : d.z,
    d.object.id,
  ];
}

/* Visible objects in the order three draws them (cf. `painterSortStable`) */
function getDrawables(state: SceneState): Drawable[] {
  const { scene, camera } = state;
  const drawables: Drawable[] = [];
  const viewProj = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const pos = new Vector3();

  function visit(obj: Object3D, groupOrder: number) {
    if (!obj.visible) {
      return;
    }
    const order =
      'isGroup' in obj && obj.isGroup ? obj.renderOrder : groupOrder;
    if ('material' in obj && 'geometry' in obj) {
      const materials = [obj.material].flat() as Material[];
      for (const material of materials) {
        if (material.visible) {
          pos.setFromMatrixPosition(obj.matrixWorld).applyMatrix4(viewProj);
          drawables.push({
            object: obj,
            material,
            groupOrder: order,
            z: pos.z,
            isVector: isVectorizable(obj, material),
          });
        }
      }
    }
    obj.children.forEach((child) => {
      visit(child, order);
    });
  }
  visit(scene, 0);

  return drawables.toSorted((a, b) => {
    const [ka, kb] = [getSortKey(a), getSortKey(b)];
    const index = ka.findIndex((val, i) => val !== kb[i]);
    return index === -1 ? 0 : ka[index] - kb[index];
  });
}

/* World to canvas CSS pixels; `undefined` beyond the near/far planes (invalid points) */
function getMvp(state: SceneState, obj: Object3D): Mvp {
  const { camera, size } = state;
  const m = new Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(obj.matrixWorld).elements;
  const [halfW, halfH] = [size.width / 2, size.height / 2];

  return (x, y, z) => {
    const nz = m[2] * x + m[6] * y + m[10] * z + m[14];
    if (!Number.isFinite(nz) || nz < -1 || nz > 1) {
      return undefined;
    }
    const nx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const ny = m[1] * x + m[5] * y + m[9] * z + m[13];
    return [(nx + 1) * halfW, (1 - ny) * halfH];
  };
}

function to255(val: number): number {
  return Math.round(Math.min(Math.max(val, 0), 1) * 255);
}

function getCssColor(color: Color, ctx: SceneContext, raw = false): string {
  // Light-mode colour (cf. dark-mode line colours) of the CSS colour of the material
  const mapped = new Color(ctx.mapColor(color.getStyle()));

  // Custom shaders output colour uniforms as is, i.e. without linear-to-sRGB conversion
  return raw
    ? `rgb(${to255(mapped.r)}, ${to255(mapped.g)}, ${to255(mapped.b)})`
    : mapped.getStyle();
}

/* Is segment outside canvas (both ends beyond the same edge)? */
function isCulled(a: Point, b: Point, width: number, height: number): boolean {
  const margin = 10;
  return (
    (a[0] < -margin && b[0] < -margin) ||
    (a[1] < -margin && b[1] < -margin) ||
    (a[0] > width + margin && b[0] > width + margin) ||
    (a[1] > height + margin && b[1] > height + margin)
  );
}

// Box of a cubic Hermite's curve in pixels, which splines may bulge out of, unless out of view
function getVisibleBox(
  toPx: Mvp,
  z: number,
  [x0, y0]: Point,
  [x1, y1]: Point,
  [slope0, slope1]: [number, number],
  [width, height]: [number, number],
): [Point, Point] | undefined {
  const [low, high] = getHermiteExtent(
    y0,
    y1,
    slope0 * (x1 - x0),
    slope1 * (x1 - x0),
  );
  const lo = toPx(x0, low, z);
  const hi = toPx(x1, high, z);
  return lo && hi && !isCulled(lo, hi, width, height) ? [lo, hi] : undefined;
}

function lineToSvg(
  obj: LineSegments2,
  state: SceneState,
  ctx: SceneContext,
): SVGElement | undefined {
  const { geometry } = obj;
  const { material } = obj;
  const starts = geometry.getAttribute('instanceStart') as
    InterleavedBufferAttribute | undefined;
  const ends = geometry.getAttribute('instanceEnd') as
    InterleavedBufferAttribute | undefined;
  if (!starts || !ends) {
    return undefined;
  }

  const toPx = getMvp(state, obj);
  const { width, height } = state.size;
  const count = Math.min(starts.count, ends.count, geometry.instanceCount);
  const isPchip = geometry instanceof LinePchipGeometry;

  let pathData = '';
  if (isPchip) {
    // Cubic Hermite interpolant between each pair of valid points, as Bézier curves
    const parts: string[] = [];
    let last: Point | undefined;
    for (let i = 0; i < count; i++) {
      const [x0, y0, z0, x1, y1, z1] = [
        starts.getX(i),
        starts.getY(i),
        starts.getZ(i),
        ends.getX(i),
        ends.getY(i),
        ends.getZ(i),
      ];
      const z = Math.min(z0, z1);
      const a = toPx(x0, y0, z);
      const b = toPx(x1, y1, z);
      const box = getVisibleBox(
        toPx,
        z,
        [x0, y0],
        [x1, y1],
        [starts.getW(i), ends.getW(i)],
        [width, height],
      );
      if (!a || !b || !box) {
        last = undefined;
        continue;
      }
      const [c0, c1] = getHermiteControls(
        [x0, y0],
        [x1, y1],
        [starts.getW(i), ends.getW(i)],
      ).map(([x, y]) => toPx(x, y, z) ?? a);
      const start =
        last && Math.hypot(last[0] - a[0], last[1] - a[1]) < 0.01
          ? ''
          : `M${fmt(a[0])} ${fmt(a[1])}`;
      const isShort =
        Math.abs(b[0] - a[0]) < 1 && Math.abs(box[1][1] - box[0][1]) < 1;
      parts.push(
        isShort
          ? `${start}L${fmt(b[0])} ${fmt(b[1])}`
          : `${start}C${[c0, c1, b].map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(' ')}`,
      );
      last = b;
    }
    pathData = parts.join('');
  } else {
    const segments = new Float64Array(count * 4);
    let n = 0;
    for (let i = 0; i < count; i++) {
      const a = toPx(starts.getX(i), starts.getY(i), starts.getZ(i));
      const b = toPx(ends.getX(i), ends.getY(i), ends.getZ(i));
      if (a && b && !isCulled(a, b, width, height)) {
        segments.set([...a, ...b], n * 4);
        n += 1;
      }
    }
    const subpaths = chainSegments(segments.subarray(0, n * 4));
    pathData = toPathData(subpaths.map((subpath) => decimate(subpath)));
  }

  if (!pathData) {
    return undefined;
  }

  return createSvgElement('path', {
    d: pathData,
    fill: 'none',
    stroke: getCssColor(material.color, ctx),
    'stroke-width': material.linewidth,
    'stroke-opacity': material.opacity < 1 ? material.opacity : undefined,
    'stroke-dasharray': material.dashed
      ? `${fmt(material.dashSize)} ${fmt(material.gapSize)}`
      : undefined,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
}

/* `GL_LINES` (e.g. error bars): one device pixel wide */
function lineSegmentsToSvg(
  obj: Object3D & { geometry: { getAttribute: (name: string) => unknown } },
  material: Material & { color?: Color },
  state: SceneState,
  ctx: SceneContext,
): SVGElement | undefined {
  const positions = obj.geometry.getAttribute('position') as
    BufferAttribute | undefined;
  if (!positions || !material.color) {
    return undefined;
  }

  const toPx = getMvp(state, obj);
  const subpaths: Subpath[] = [];
  for (let i = 0; i + 1 < positions.count; i += 2) {
    const a = toPx(positions.getX(i), positions.getY(i), positions.getZ(i));
    const b = toPx(
      positions.getX(i + 1),
      positions.getY(i + 1),
      positions.getZ(i + 1),
    );
    if (a && b && !isCulled(a, b, state.size.width, state.size.height)) {
      subpaths.push([a, b]);
    }
  }

  return subpaths.length > 0
    ? createSvgElement('path', {
        d: toPathData(subpaths),
        fill: 'none',
        stroke: getCssColor(material.color, ctx),
        'stroke-width': 1 / state.gl.getPixelRatio(),
      })
    : undefined;
}

/* Opacity of translucent glyphs (cf. `PointCloud`); `undefined` if opaque */
function getOpacity({ uniforms }: ShaderMaterial): number | undefined {
  const opacity = Number(uniforms.opacity?.value ?? 1); // eslint-disable-line @typescript-eslint/no-unnecessary-condition
  return opacity < 1 ? opacity : undefined;
}

function getGlyphSize(
  index: number,
  size: number,
  pointSizes: BufferAttribute | undefined,
  dpr: number,
): number {
  return pointSizes ? pointSizes.getX(index) * size * dpr : size;
}

/* Glyphs of `GlyphMaterial`, one path per colour; sizes are in device pixels, or per point in CSS
 * pixels (`pointSize` attribute, scaled by `size`, cf. `PointCloud`; `0` hides a point) */
function glyphsToSvg(
  obj: Points,
  material: ShaderMaterial,
  state: SceneState,
  ctx: SceneContext,
): SVGElement[] {
  const glyphType = getGlyphType(material);
  const positions = obj.geometry.getAttribute('position') as
    BufferAttribute | undefined;
  if (!glyphType || !positions) {
    return [];
  }

  const dpr = state.gl.getPixelRatio();
  const { uniforms } = material;
  const size = Number(uniforms.size?.value ?? 1) / dpr; // eslint-disable-line @typescript-eslint/no-unnecessary-condition -- vertex-coloured glyphs
  const colorUniform = material.vertexColors
    ? undefined
    : (uniforms.color?.value as Color | undefined); // eslint-disable-line @typescript-eslint/no-unnecessary-condition
  const colors = material.vertexColors
    ? (obj.geometry.getAttribute('color') as BufferAttribute | undefined)
    : undefined;

  const pointSizes = obj.geometry.getAttribute('pointSize') as
    BufferAttribute | undefined;
  const opacity = getOpacity(material);

  const toPx = getMvp(state, obj);
  const { width, height } = state.size;
  const byColor = new Map<string, string[]>();
  const color = new Vector3();

  for (let i = 0; i < positions.count; i++) {
    const glyphSize = getGlyphSize(i, size, pointSizes, dpr);
    const half = glyphSize / 2;
    const p = toPx(positions.getX(i), positions.getY(i), positions.getZ(i));
    if (
      !p ||
      glyphSize <= 0 ||
      p[0] < -half ||
      p[1] < -half ||
      p[0] > width + half ||
      p[1] > height + half
    ) {
      continue;
    }

    let css = 'black';
    if (colors) {
      color.fromBufferAttribute(colors, i);
      css = `rgb(${to255(color.x)}, ${to255(color.y)}, ${to255(color.z)})`; // colour maps
    } else if (colorUniform) {
      css = getCssColor(colorUniform, ctx, true);
    }

    const y = fmt(p[1]);
    const [l, t, s] = [fmt(p[0] - half), fmt(p[1] - half), fmt(glyphSize)];
    const d = {
      [GlyphType.Circle]: `M${l} ${y}a${fmt(half)} ${fmt(half)} 0 1 0 ${s} 0a${fmt(half)} ${fmt(half)} 0 1 0 -${s} 0z`,
      [GlyphType.Square]: `M${l} ${t}h${s}v${s}h-${s}z`,
      [GlyphType.Cross]: `M${l} ${t}l${s} ${s}M${l} ${fmt(p[1] + half)}l${s} -${s}`,
      [GlyphType.Cap]: `M${l} ${y}h${s}`,
    }[glyphType];

    const list = byColor.get(css);
    if (list) {
      list.push(d);
    } else {
      byColor.set(css, [d]);
    }
  }

  const isStroked =
    glyphType === GlyphType.Cross || glyphType === GlyphType.Cap;
  return [...byColor].map(([css, parts]) =>
    createSvgElement('path', {
      d: parts.join(''),
      ...(isStroked
        ? { fill: 'none', stroke: css, 'stroke-width': 1 / dpr }
        : { fill: css }),
      'fill-opacity': opacity,
    }),
  );
}

function hasNearestTexture(material: Material): boolean {
  const uniforms = (material as Partial<ShaderMaterial>).uniforms ?? {};
  return Object.values(uniforms).some((uniform) => {
    const value = (uniform as { value?: Partial<Texture> } | undefined)?.value;
    return value?.isTexture === true && value.magFilter === NearestFilter;
  });
}

function hasInk(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return false;
  }
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) {
      return true;
    }
  }
  return false;
}

function copyCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  redraw(canvas);
  copy.getContext('2d')?.drawImage(canvas, 0, 0);
  return copy;
}

/* Render the scene without its vector objects at the raster scale */
function renderRaster(
  state: RootState,
  hidden: Object3D[],
  scale: number,
): HTMLCanvasElement {
  const { gl, scene, camera } = state;
  const visibility = hidden.map((obj) => obj.visible);
  const pixelRatio = gl.getPixelRatio();
  const { width, height } = gl.getSize(new Vector2());

  try {
    hidden.forEach((obj) => {
      obj.visible = false;
    });
    gl.setPixelRatio(getSafeScale(width, height, scale));
    gl.render(scene, camera);
    return copyCanvas(gl.domElement);
  } finally {
    hidden.forEach((obj, i) => {
      obj.visible = visibility[i];
    });
    gl.setPixelRatio(pixelRatio);
    gl.render(scene, camera); // repaint before the browser does
    state.invalidate();
  }
}

function imageElem(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  pixelated: boolean,
): SVGElement {
  return createSvgElement('image', {
    width,
    height,
    preserveAspectRatio: 'none',
    href: canvas.toDataURL('image/png'),
    style: pixelated ? 'image-rendering:pixelated' : undefined,
  });
}

/* Scene in `size` CSS pixels (drawn in `width` by `height`, e.g. CSS transform scale): vector
 * paths (lines, glyphs, error bars, contours) over a raster of anything else (e.g. heatmap
 * meshes), drawn by `rasterize` without the given objects */
function sceneToSvg(
  state: SceneState,
  [width, height]: [number, number],
  ctx: SceneContext,
  rasterize: (hidden: Object3D[]) => HTMLCanvasElement,
): SVGElement {
  const group = createSvgElement('g');
  state.scene.updateMatrixWorld();
  state.camera.updateMatrixWorld();
  const drawables = getDrawables(state);
  const vectors = drawables.filter((d) => d.isVector);
  const rasters = drawables.filter((d) => !d.isVector);

  if (rasters.length > 0) {
    const raster = rasterize(vectors.map((d) => d.object));
    if (hasInk(raster)) {
      const pixelated = rasters.some((d) => hasNearestTexture(d.material));
      group.append(imageElem(raster, width, height, pixelated));
    }
  }

  // Paths are in canvas CSS pixels, before any CSS transform scale of the page
  const { size } = state;
  const [sx, sy] = [width / size.width, height / size.height];
  const isScaled = Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3;
  const clip = createSvgElement('clipPath');
  clip.append(
    createSvgElement('rect', { width: size.width, height: size.height }),
  );
  const vectorGroup = createSvgElement('g', {
    'clip-path': ctx.define(clip),
    transform: isScaled ? `scale(${fmt(sx)} ${fmt(sy)})` : undefined,
  });

  for (const { object, material } of vectors) {
    if (isLineSegments2(object)) {
      const path = lineToSvg(object, state, ctx);
      if (path) {
        vectorGroup.append(path);
      }
    } else if ('isPoints' in object && object.isPoints) {
      vectorGroup.append(
        ...glyphsToSvg(
          object as Points,
          material as ShaderMaterial,
          state,
          ctx,
        ),
      );
    } else {
      const path = lineSegmentsToSvg(object as Points, material, state, ctx);
      if (path) {
        vectorGroup.append(path);
      }
    }
  }

  if (vectorGroup.childElementCount > 0) {
    group.append(vectorGroup);
  }
  return group;
}

/* Content of a WebGL canvas, in its CSS pixels: 2D scenes as vector paths over a raster
 * (cf. `sceneToSvg`); other scenes (3D) as a copy of the canvas */
export function canvasToSvg(
  canvas: HTMLCanvasElement,
  ctx: SceneContext,
): SVGElement {
  const { width, height } = canvas.getBoundingClientRect();
  const state = _roots.get(canvas)?.store.getState();

  if (!state || !(state.camera instanceof ScaledOrthographicCamera)) {
    const group = createSvgElement('g');
    group.append(imageElem(copyCanvas(canvas), width, height, false));
    return group;
  }

  return sceneToSvg(state, [width, height], ctx, (hidden) =>
    renderRaster(state, hidden, ctx.rasterScale),
  );
}

/* Panels of a `MultiVisCanvas` (also those out of view), each as `sceneToSvg` in its area
 * relative to `origin` and clipped to it */
export function panelsToSvg(
  { gl, entries }: CanvasPanels,
  origin: DOMRect,
  ctx: SceneContext,
): SVGElement[] {
  return entries.map((entry) => {
    const { scene, camera, element } = entry;
    const rect = element.getBoundingClientRect();
    const size = { width: entry.width, height: entry.height, top: 0, left: 0 };
    const state = { scene, camera, size, gl };
    const scale = getSafeScale(entry.width, entry.height, ctx.rasterScale);

    const group = sceneToSvg(state, [rect.width, rect.height], ctx, (hidden) =>
      renderPanel(gl, entry, scale, hidden),
    );
    const clip = createSvgElement('clipPath');
    clip.append(
      createSvgElement('rect', { width: rect.width, height: rect.height }),
    );
    group.setAttribute(
      'transform',
      `translate(${fmt(rect.x - origin.x)} ${fmt(rect.y - origin.y)})`,
    );
    group.setAttribute('clip-path', ctx.define(clip));
    return group;
  });
}
