import { type Domain, ScaleType } from '@h5web/shared/vis-models';
import { extend } from '@react-three/fiber';
import { type ReactNode, useEffect, useMemo } from 'react';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { LineMaterial as ThreeLineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 as ThreeLineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

import { type ColorMap } from '../heatmap/models';
import { type ClassStyleAttrs } from '../models';
import Axes3D from '../three-d/Axes3D';
import {
  getBoxSize,
  getColorParams,
  getLinearColorLut,
  getVertexColors,
  getWorldTransform,
} from '../three-d/utils';
import Vis3DLayout from '../three-d/Vis3DLayout';
import Arrows3D from './Arrows3D';
import {
  type Axis3D,
  getAxisExtent,
  getLatticeSeeds,
  getMagnitude,
  getReferenceMagnitude,
  getSeededStreamlines3D,
  sampleField3D,
  type VectorField3D,
} from './field';
import { VectorStyle } from './models';

const LineSegments2 = extend(ThreeLineSegments2);
const LineMaterial = extend(ThreeLineMaterial);

interface Props extends ClassStyleAttrs {
  field: VectorField3D;
  domain: Domain; // of the magnitude, for colours
  colorMap?: ColorMap;
  invertColorMap?: boolean;
  colorBarLabel?: ReactNode;
  title?: ReactNode;
  labels?: [string?, string?, string?]; // x, y, z
  keepRatio?: boolean;
  showAxes?: boolean;
  showGrid?: boolean;
  vectorStyle?: VectorStyle.Arrows | VectorStyle.Streamlines;
  arrowScale?: number; // length relative to the spacing of arrows, for the reference magnitude
  maxArrows?: number; // arrows are subsampled to this budget
  plane?: { axis: Axis3D; index: number }; // arrows (streamline seeds) on one plane of the grid
}

/* Every `stride`-th index, spread to the ends */
function subsample(n: number, stride: number): number[] {
  const count = Math.max(1, Math.round(n / stride));
  const offset = (n - 1 - (count - 1) * stride) / 2;
  return Array.from({ length: count }, (_, i) =>
    Math.min(n - 1, Math.max(0, Math.round(offset + i * stride))),
  );
}

/*
 * 3D vector field in a box (orbit camera): instanced arrows on the grid, subsampled to a budget
 * and coloured by magnitude (instance matrices are built once per field, not per frame), or
 * streamlines from a lattice of seeds. Either on a single plane of the grid if given.
 */
function VectorVis3D(props: Props) {
  const {
    field,
    domain,
    colorMap = 'Viridis',
    invertColorMap = false,
    colorBarLabel,
    title,
    labels = [],
    keepRatio = true,
    showAxes = true,
    showGrid = true,
    vectorStyle = VectorStyle.Arrows,
    arrowScale = 1,
    maxArrows = 4096,
    plane,
    className,
    style,
  } = props;

  const { xs, ys, zs, u, v, w } = field;
  const domains = useMemo(
    () => [xs, ys, zs].map(getAxisExtent) as [Domain, Domain, Domain],
    [xs, ys, zs],
  );
  const boxSize = getBoxSize(domains, keepRatio);
  const [bw, bh, bd] = boxSize;
  const toBox = useMemo(
    () => getWorldTransform(domains, [bw, bh, bd]),
    [domains, bw, bh, bd],
  );

  const magnitude = useMemo(() => getMagnitude(u, v, w), [u, v, w]);
  const refMagnitude = useMemo(
    () => getReferenceMagnitude(magnitude),
    [magnitude],
  );
  const lut = useMemo(
    () => getLinearColorLut(colorMap, invertColorMap),
    [colorMap, invertColorMap],
  );

  // Arrows: subsampled grid points (on the plane, if any)
  const arrows = useMemo(() => {
    if (vectorStyle !== VectorStyle.Arrows) {
      return undefined;
    }
    const dims = [xs.length, ys.length, zs.length];
    const planeDim = plane ? 'xyz'.indexOf(plane.axis) : -1;
    const freeCount = dims.reduce((p, n, c) => (c === planeDim ? p : p * n), 1);
    const freeDims = planeDim === -1 ? 3 : 2;
    const stride = Math.max(1, (freeCount / maxArrows) ** (1 / freeDims));
    const [ii, jj, kk] = dims.map((n, c) =>
      c === planeDim
        ? [Math.min(Math.max(plane?.index ?? 0, 0), n - 1)]
        : subsample(n, stride),
    );

    // Length: reference magnitude over the mean spacing of arrows in the box
    const spacing =
      [bw, bh, bd]
        .map((size, c) => (c === planeDim ? 0 : size / [ii, jj, kk][c].length))
        .reduce((a, b) => a + b, 0) / freeDims;
    const unit = (spacing * arrowScale) / refMagnitude;
    const [sx, sy, sz] = [
      toBox(1, 1, 1)[0] - toBox(0, 0, 0)[0],
      toBox(1, 1, 1)[1] - toBox(0, 0, 0)[1],
      toBox(1, 1, 1)[2] - toBox(0, 0, 0)[2],
    ];

    const matrices: number[] = [];
    const mags: number[] = [];
    const up = new Vector3(0, 1, 0);
    const [m, q, dir, pos, scale] = [
      new Matrix4(),
      new Quaternion(),
      new Vector3(),
      new Vector3(),
      new Vector3(),
    ];
    for (const k of kk) {
      for (const j of jj) {
        for (const i of ii) {
          const idx = (k * ys.length + j) * xs.length + i;
          const mag = magnitude[idx];
          dir.set(u[idx] * sx, v[idx] * sy, w[idx] * sz);
          if (!Number.isFinite(mag) || mag === 0 || dir.lengthSq() === 0) {
            continue;
          }
          q.setFromUnitVectors(up, dir.normalize());
          pos.set(...toBox(xs[i], ys[j], zs[k]));
          const len = mag * unit;
          m.compose(pos, q, scale.set(len, len, len));
          matrices.push(...m.elements);
          mags.push(mag);
        }
      }
    }
    const colors = getVertexColors(
      getColorParams(Float32Array.from(mags), domain, ScaleType.Linear),
      lut,
    );
    return {
      matrices: Float32Array.from(matrices),
      colors,
      count: mags.length,
    };
  }, [
    vectorStyle,
    xs,
    ys,
    zs,
    u,
    v,
    w,
    magnitude,
    refMagnitude,
    plane,
    maxArrows,
    arrowScale,
    bw,
    bh,
    bd,
    toBox,
    domain,
    lut,
  ]);

  // Streamlines: seeded on a lattice (or on the plane), coloured by magnitude along them
  const lines = useMemo(() => {
    if (vectorStyle !== VectorStyle.Streamlines) {
      return undefined;
    }
    const planeValue =
      plane && [xs, ys, zs]['xyz'.indexOf(plane.axis)][plane.index];
    const seeds = getLatticeSeeds(
      field,
      plane ? 14 : 6,
      plane && planeValue !== undefined
        ? { axis: plane.axis, value: planeValue }
        : undefined,
    );
    const polylines = getSeededStreamlines3D(field, toBox, {
      seeds,
      step: 0.01 * Math.max(bw, bh, bd),
      maxSteps: 250,
    });
    const positions: number[] = [];
    const values: number[] = [];
    const [ox, oy, oz] = toBox(0, 0, 0);
    const [ux, uy, uz] = toBox(1, 1, 1);
    for (const line of polylines) {
      for (let k = 0; k + 5 < line.length; k += 3) {
        positions.push(...line.slice(k, k + 6));
        for (const at of [k, k + 3]) {
          // Magnitude at the point, by sampling back in data space
          const [x, y, z] = [
            (line[at] - ox) / (ux - ox),
            (line[at + 1] - oy) / (uy - oy),
            (line[at + 2] - oz) / (uz - oz),
          ];
          values.push(Math.hypot(...sampleField3D(field, x, y, z)));
        }
      }
    }
    const geometry = new LineSegmentsGeometry();
    if (positions.length > 0) {
      geometry.setPositions(positions);
      geometry.setColors(
        getVertexColors(
          getColorParams(Float32Array.from(values), domain, ScaleType.Linear),
          lut,
        ),
      );
    }
    return { geometry, isEmpty: positions.length === 0 };
  }, [vectorStyle, field, plane, toBox, bw, bh, bd, domain, lut, xs, ys, zs]);
  useEffect(() => () => lines?.geometry.dispose(), [lines]);

  return (
    <Vis3DLayout
      className={className}
      style={style}
      title={title}
      boxSize={boxSize}
      domain={domain}
      scaleType={ScaleType.Linear}
      colorMap={colorMap}
      invertColorMap={invertColorMap}
      colorBarLabel={colorBarLabel}
      headlight
    >
      {arrows && arrows.count > 0 && <Arrows3D {...arrows} />}
      {lines && !lines.isEmpty && (
        <LineSegments2 geometry={lines.geometry}>
          <LineMaterial vertexColors linewidth={1.5} />
        </LineSegments2>
      )}
      {showAxes && (
        <Axes3D
          boxSize={boxSize}
          xConfig={{ domain: domains[0], label: labels[0] }}
          yConfig={{ domain: domains[1], label: labels[1] }}
          zConfig={{ domain: domains[2], label: labels[2] ?? 'z' }}
          showGrid={showGrid}
        />
      )}
    </Vis3DLayout>
  );
}

export type { Props as VectorVis3DProps };
export default VectorVis3D;
