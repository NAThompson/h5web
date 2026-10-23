import { type NumArray } from '@h5web/shared/vis-models';
import {
  Box3,
  type BufferAttribute,
  type BufferGeometry,
  type Camera,
  Float32BufferAttribute,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  type Object3D,
  type Scene,
  Sphere,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry as ThreeLineGeometry } from 'three/addons/lines/LineGeometry.js';

import { type H5WebGeometry } from '../models';
import { createBufferAttr, Z_OUT } from '../utils';
import { type LineGeometryParams } from './lineGeometry';
import { getHermiteExtent, getPchipSlopes } from './utils';

export const MAX_SEGMENTS_PER_INTERVAL = 16;
const MAX_ERROR_PX = 1; // in CSS pixels

/*
 * Stores `x, y, z, slope` once per data point, and lets the vertex shader
 * evaluate the cubic Hermite interpolant between consecutive points.
 * Each interval is one instance of a template of `MAX_SEGMENTS_PER_INTERVAL`
 * line segments, of which only as many as the current zoom needs are drawn.
 * Since `xyz` are the data points themselves, three's raycasting sees the
 * chords between points, and bounds include any overshoot of the curve beyond them.
 */
class LinePchipGeometry extends ThreeLineGeometry implements H5WebGeometry {
  // Whether the interpolant may leave the box of its end points (cf. `getSegmentCount`)
  protected readonly overshoots: boolean = false;

  private readonly length: number;
  private readonly points: BufferAttribute;
  private maxStepX = 0; // largest `|dx|` of any interval
  private maxStepY = 0; // largest height of the curve over any interval
  private maxBend = 0; // largest `|d²y/dt²|` over any interval (`t` in [0, 1]), if it may overshoot
  private extentY = [Infinity, -Infinity]; // of the curve, with overshoot

  public constructor(private readonly params: LineGeometryParams) {
    super();

    this.tileSegmentTemplate();

    this.length = params.ordinates.length;
    this.points = createBufferAttr(this.length, 4); // `x, y, z, slope` per point

    const { array } = this.points;
    const instancedBuffer = new InstancedInterleavedBuffer(array, 4);
    this.setAttribute(
      'instanceStart',
      new InterleavedBufferAttribute(instancedBuffer, 4, 0),
    );
    this.setAttribute(
      'instanceEnd',
      new InterleavedBufferAttribute(instancedBuffer, 4, 4),
    );
    this.instanceCount = Math.max(this.length - 1, 0);
  }

  public update(): void {
    const { abscissas, ordinates, abscissaScale, ordinateScale, ignoreValue } =
      this.params;

    // Plain loops: `Float64Array.from` with a callback is ~8× slower in V8
    const xs = new Float64Array(this.length);
    const ys = new Float64Array(this.length);
    for (let index = 0; index < this.length; index++) {
      const value = ordinates[index];
      xs[index] = abscissaScale(abscissas[index]);
      ys[index] = ignoreValue?.(value) ? Number.NaN : ordinateScale(value);
    }

    const slopes = this.getSlopes(xs, ys);

    this.maxStepX = 0;
    this.maxStepY = 0;
    this.maxBend = 0;
    this.extentY = [Infinity, -Infinity];
    for (let index = 0; index < this.length; index++) {
      if (Number.isFinite(xs[index]) && Number.isFinite(ys[index])) {
        this.points.setXYZW(index, xs[index], ys[index], 0, slopes[index]);
      } else {
        this.points.setXYZW(index, 0, 0, Z_OUT, 0);
      }

      const dx = xs[index + 1] - xs[index];
      const [low, high] = getHermiteExtent(
        ys[index],
        ys[index + 1],
        slopes[index] * dx,
        slopes[index + 1] * dx,
      );
      if (Number.isFinite(dx) && Number.isFinite(high - low)) {
        this.maxStepX = Math.max(this.maxStepX, Math.abs(dx));
        this.maxStepY = Math.max(this.maxStepY, high - low);
        if (this.overshoots) {
          this.maxBend = Math.max(
            this.maxBend,
            getHermiteBend(
              ys[index + 1] - ys[index],
              slopes[index] * dx,
              slopes[index + 1] * dx,
            ),
          );
        }
        this.extentY = [
          Math.min(this.extentY[0], low),
          Math.max(this.extentY[1], high),
        ];
      }
    }
  }

  // Caps the segments drawn per interval: no interval needs more than this
  public setPixelsPerUnit(pixelsPerUnit: Vector2): number {
    const segments = getSegmentCount(
      this.maxStepX * pixelsPerUnit.x,
      this.maxStepY * pixelsPerUnit.y,
      this.maxBend * pixelsPerUnit.y,
    );
    this.setDrawRange(0, segments * TEMPLATE_INDEX_COUNT);
    return segments;
  }

  // three's versions read `instanceEnd` of the last point past the end of the buffer
  public override computeBoundingBox(): void {
    this.boundingBox = this.getBox();
  }

  public override computeBoundingSphere(): void {
    this.boundingSphere = this.getBox().getBoundingSphere(new Sphere());
  }

  // Slopes `dy/dx` of the interpolant at the points
  protected getSlopes(xs: NumArray, ys: NumArray): Float64Array {
    return getPchipSlopes(xs, ys);
  }

  private getBox(): Box3 {
    const box = new Box3().setFromBufferAttribute(this.points);
    const [low, high] = this.extentY;
    if (low <= high) {
      box.min.y = Math.min(box.min.y, low);
      box.max.y = Math.max(box.max.y, high);
    }
    return box;
  }

  // Repeats three's single-segment template, numbering the copies with `segment`
  private tileSegmentTemplate(): void {
    const { position, uv } = this.attributes;
    const index = this.getIndex();
    if (!index) {
      return;
    }

    const copies = Array.from(
      { length: MAX_SEGMENTS_PER_INTERVAL },
      (_, k) => k,
    );
    function tile(values: ArrayLike<number>, offset = 0): number[] {
      return copies.flatMap((k) => Array.from(values, (v) => v + k * offset));
    }

    this.setIndex(tile(index.array, position.count));
    this.setAttribute(
      'position',
      new Float32BufferAttribute(tile(position.array), 3),
    );
    this.setAttribute('uv', new Float32BufferAttribute(tile(uv.array), 2));
    this.setAttribute(
      'segment',
      new Float32BufferAttribute(
        tile(
          Array.from({ length: position.count }, () => 0),
          1,
        ),
        1,
      ),
    );
  }
}

/*
 * PCHIP is monotone on every interval, so each of `n` chords is the diagonal of
 * a box containing its piece of curve: the error is at most `min(width / n, height)`.
 * Splines may not be, so `height` is that of the curve over the interval, overshoot included,
 * and `n` is also enough for the error of chords of a curve that bends by `bend`, `bend / 8n²`.
 * Mirrored by `segmentsForInterval` in the shader.
 */
function getSegmentCount(
  widthPx: number,
  heightPx: number,
  bendPx = 0,
): number {
  if (heightPx <= MAX_ERROR_PX) {
    return 1;
  }
  const segments = Math.max(
    Math.ceil(widthPx / MAX_ERROR_PX),
    Math.ceil(Math.sqrt(bendPx / (8 * MAX_ERROR_PX))),
  );
  return Math.min(Math.max(segments, 1), MAX_SEGMENTS_PER_INTERVAL);
}

// Largest `|y''(t)|` of the cubic Hermite with that rise and derivatives (at `t = 0` or `1`)
function getHermiteBend(rise: number, d0: number, d1: number): number {
  return Math.max(
    Math.abs(6 * rise - 4 * d0 - 2 * d1),
    Math.abs(6 * rise - 2 * d0 - 4 * d1),
  );
}

const TEMPLATE_INDEX_COUNT = 18; // indices of three's single-segment template

// Patches three's `LineMaterial` to draw the segments of `LinePchipGeometry`
export function pchipOnBeforeCompile(shader: { vertexShader: string }): void {
  patchShader(shader, false);
}

// Same for `LineSplineGeometry`, whose curve may overshoot its points (distinct program in three's cache)
export function splineOnBeforeCompile(shader: { vertexShader: string }): void {
  patchShader(shader, true);
}

function patchShader(shader: { vertexShader: string }, overshoots: boolean) {
  let source = shader.vertexShader;
  source = replaceOrThrow(
    source,
    /attribute vec3 instanceStart;\s*attribute vec3 instanceEnd;/u,
    /* glsl */ `${overshoots ? '\n        #define PCHIP_OVERSHOOTS' : ''}
        attribute vec4 instanceStart; // x, y, z, slope at start of interval
        attribute vec4 instanceEnd; // x, y, z, slope at end of interval
        attribute float segment; // index of segment within interval
        uniform float maxSegments; // segments drawn per interval, set by \`setPixelsPerUnit\`

        vec2 toPixels(vec4 point) {
          vec4 clip = projectionMatrix * modelViewMatrix * vec4(point.xyz, 1.0);
          return 0.5 * resolution * clip.xy / clip.w;
        }

        // Cubic Hermite interpolant at fraction \`t\` of the interval
        float hermiteY(float t) {
          float width = instanceEnd.x - instanceStart.x;
          float rise = instanceEnd.y - instanceStart.y;
          float m0 = instanceStart.w * width;
          float m1 = instanceEnd.w * width;
          return instanceStart.y + t * (m0 + t * (3.0 * rise - 2.0 * m0 - m1 + t * (m0 + m1 - 2.0 * rise)));
        }

        #ifdef PCHIP_OVERSHOOTS
          // Lowest and highest \`y\` of the interpolant, as in \`getHermiteExtent\`
          vec2 hermiteExtent(float m0, float b, float c) {
            float disc = b * b - 3.0 * c * m0;
            vec2 extent = vec2(min(instanceStart.y, instanceEnd.y), max(instanceStart.y, instanceEnd.y));
            float q = -(b + (b < 0.0 ? -1.0 : 1.0) * sqrt(max(disc, 0.0)));
            vec2 roots = disc < 0.0 ? vec2(-1.0) : vec2(
              c != 0.0 ? q / (3.0 * c) : -1.0,
              q != 0.0 ? m0 / q : -1.0
            );
            for (int i = 0; i < 2; i++) {
              if (roots[i] > 0.0 && roots[i] < 1.0) {
                float y = hermiteY(roots[i]);
                extent = vec2(min(extent.x, y), max(extent.y, y));
              }
            }
            return extent;
          }
        #endif

        // Same rule as \`getSegmentCount\`, for this interval alone
        float segmentsForInterval() {
          vec2 size = abs(toPixels(instanceEnd) - toPixels(instanceStart));
          float segments = ceil(size.x / float(${MAX_ERROR_PX}));
          #ifdef PCHIP_OVERSHOOTS
            float width = instanceEnd.x - instanceStart.x;
            float rise = instanceEnd.y - instanceStart.y;
            float m0 = instanceStart.w * width;
            float m1 = instanceEnd.w * width;
            float b = 3.0 * rise - 2.0 * m0 - m1;
            float c = m0 + m1 - 2.0 * rise;
            vec2 extent = hermiteExtent(m0, b, c);
            float pxPerY = abs(toPixels(vec4(instanceStart.x, 1.0, 0.0, 0.0)).y - toPixels(vec4(instanceStart.x, 0.0, 0.0, 0.0)).y);
            size.y = (extent.y - extent.x) * pxPerY;
            float bend = 2.0 * max(abs(b), abs(b + 3.0 * c)) * pxPerY; // \`getHermiteBend\`
            segments = max(segments, ceil(sqrt(bend / float(${8 * MAX_ERROR_PX}))));
          #endif
          if (size.y <= float(${MAX_ERROR_PX})) {
            return 1.0;
          }
          return clamp(segments, 1.0, maxSegments);
        }

        float pchipSegments; // of this interval, set at the start of \`main\`

        // Fraction of the interval at fraction \`offset\` of current segment
        float pchipT(float offset) {
          return (segment + offset) / pchipSegments;
        }

        // Cubic Hermite interpolant at fraction \`offset\` of current segment
        vec3 pchipPoint(float offset) {
          float t = pchipT(offset);
          float width = instanceEnd.x - instanceStart.x;
          float y = hermiteY(t);

          // Segments this interval doesn't need are moved out of view, like invalid points
          float z = segment < pchipSegments ? min(instanceStart.z, instanceEnd.z) : float(${Z_OUT});
          return vec3(instanceStart.x + t * width, y, z);
        }
      `,
  );
  // Dash distances (cf. `setDashDistances`) of whole intervals, shared out by `t`
  source = replaceOrThrow(
    source,
    'dashScale * instanceDistanceStart;',
    'dashScale * mix( instanceDistanceStart, instanceDistanceEnd, pchipT( 0.0 ) );',
  );
  source = replaceOrThrow(
    source,
    'dashScale * instanceDistanceEnd;',
    'dashScale * mix( instanceDistanceStart, instanceDistanceEnd, pchipT( 1.0 ) );',
  );
  source = replaceOrThrow(
    source,
    'void main() {',
    'void main() {\n\t\t\tpchipSegments = segmentsForInterval();',
  );
  source = replaceOrThrow(
    source,
    'vec4( instanceStart, 1.0 )',
    'vec4( pchipPoint( 0.0 ), 1.0 )',
  );
  source = replaceOrThrow(
    source,
    'vec4( instanceEnd, 1.0 )',
    'vec4( pchipPoint( 1.0 ), 1.0 )',
  );

  // eslint-disable-next-line no-param-reassign -- `onBeforeCompile` works by mutation
  shader.vertexShader = source;
}

// Fails loudly if a three upgrade changes the `LineMaterial` code being patched
function replaceOrThrow(
  source: string,
  pattern: string | RegExp,
  replacement: string,
): string {
  const result = source.replace(pattern, replacement);
  if (result === source) {
    throw new Error(
      `Expected LineMaterial vertex shader to contain ${pattern}`,
    );
  }
  return result;
}

// Picks the number of segments per interval for the current zoom level
export function pchipOnBeforeRender(
  renderer: WebGLRenderer,
  _scene: Scene,
  camera: Camera,
  geometry: BufferGeometry,
  line: Object3D,
): void {
  if (!(geometry instanceof LinePchipGeometry && line instanceof Line2)) {
    return;
  }

  // Also runs before first compile, so that three knows to upload it
  // eslint-disable-next-line no-param-reassign -- uniforms are set by mutation
  line.material.uniforms.maxSegments = {
    value: geometry.setPixelsPerUnit(getPixelsPerUnit(renderer, camera)),
  };
}

// CSS pixels (like `LineMaterial`'s `resolution`) per world unit along x and y
export function getPixelsPerUnit(
  renderer: WebGLRenderer,
  camera: Camera,
): Vector2 {
  const { width, height } = renderer.getSize(new Vector2());
  const origin = new Vector3(0, 0, 0).project(camera);
  const unit = new Vector3(1, 1, 0).project(camera).sub(origin);
  return new Vector2(
    Math.abs((unit.x * width) / 2),
    Math.abs((unit.y * height) / 2),
  );
}

export default LinePchipGeometry;
