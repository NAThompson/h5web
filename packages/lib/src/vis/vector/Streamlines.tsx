import { extend, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { LineMaterial as ThreeLineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 as ThreeLineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

import { useCameraState } from '../hooks';
import { useVisCanvasContext } from '../shared/VisCanvasProvider';
import {
  getEvenlySpacedStreamlines,
  getStreamlineArrows,
  type VectorField2D,
} from './field';

const LineSegments2 = extend(ThreeLineSegments2);
const LineMaterial = extend(ThreeLineMaterial);

interface Props {
  field: VectorField2D;
  separation: number; // between streamlines, CSS pixels
  color: string;
  halo?: string; // colour of an outline, if any
  lineWidth?: number;
  arrowSpacing?: number; // between arrowheads along lines, CSS pixels
  maxPoints?: number; // budget over all lines
}

const TILE = 256; // px: computed region snapped to tiles, so panning a little reuses lines
const HEAD = { length: 5, width: 3.5 }; // px

interface View {
  key: string;
  level: [number, number]; // world units per pixel of the spacing (powers of 2)
  region: [[number, number], [number, number]]; // in pixels at that level
}

function getLevel(worldPerPx: number): number {
  return 2 ** Math.round(Math.log2(worldPerPx));
}

/*
 * Evenly-spaced streamlines (cf. `getEvenlySpacedStreamlines`) of the part of the field in and
 * around view, with arrowheads along them. Computed on the CPU, once per zoom level (powers of
 * 2) and region (tiles around the view), within a budget of points; drawn as wide lines, which
 * snapshots export as vector paths.
 */
function Streamlines(props: Props) {
  const {
    field,
    separation,
    color,
    halo,
    lineWidth = 1.25,
    arrowSpacing = 4 * separation,
    maxPoints = 80_000,
  } = props;

  const { abscissaScale, ordinateScale } = useVisCanvasContext();
  const size = useThree((state) => state.size);
  const [ax, bx] = [abscissaScale(1) - abscissaScale(0), abscissaScale(0)];
  const [ay, by] = [ordinateScale(1) - ordinateScale(0), ordinateScale(0)];

  const view = useCameraState<View>(
    (camera) => {
      const level: [number, number] = [
        getLevel(camera.scale.x),
        getLevel(camera.scale.y),
      ];
      // View extended by half its size on each side, in pixels at the level, snapped to tiles
      const [hw, hh] = [
        size.width * camera.scale.x,
        size.height * camera.scale.y,
      ];
      const lo = [
        Math.floor((camera.position.x - hw) / level[0] / TILE) * TILE,
        Math.floor((camera.position.y - hh) / level[1] / TILE) * TILE,
      ];
      const hi = [
        Math.ceil((camera.position.x + hw) / level[0] / TILE) * TILE,
        Math.ceil((camera.position.y + hh) / level[1] / TILE) * TILE,
      ];
      return {
        key: [...level, ...lo, ...hi].join(','),
        level,
        region: [
          [lo[0], lo[1]],
          [hi[0], hi[1]],
        ],
      };
    },
    [size],
    (prev, next) => prev.key === next.key,
  );

  const { key, level, region } = view;
  const geometry = useMemo(() => {
    const [lx, ly] = level;
    const map = { ax: ax / lx, bx: bx / lx, ay: ay / ly, by: by / ly };
    const lines = getEvenlySpacedStreamlines(field, {
      map,
      separation,
      region,
      maxPoints,
    });

    const positions: number[] = [];
    for (const line of lines) {
      for (let k = 0; k + 3 < line.length; k += 2) {
        positions.push(
          line[k] * lx,
          line[k + 1] * ly,
          0,
          line[k + 2] * lx,
          line[k + 3] * ly,
          0,
        );
      }
    }
    // Arrowheads: two strokes back from each tip
    for (const { x, y, dx, dy } of getStreamlineArrows(lines, arrowSpacing)) {
      const tip = [x + (dx * HEAD.length) / 2, y + (dy * HEAD.length) / 2];
      for (const side of [-1, 1]) {
        positions.push(
          tip[0] * lx,
          tip[1] * ly,
          0,
          (tip[0] - dx * HEAD.length - side * dy * HEAD.width) * lx,
          (tip[1] - dy * HEAD.length + side * dx * HEAD.width) * ly,
          0,
        );
      }
    }

    const geom = new LineSegmentsGeometry();
    if (positions.length > 0) {
      geom.setPositions(positions);
    }
    return { geom, isEmpty: positions.length === 0 };
  }, [field, separation, arrowSpacing, maxPoints, ax, bx, ay, by, key]); // eslint-disable-line react-hooks/exhaustive-deps -- `level` and `region` change with `key`

  useEffect(() => () => geometry.geom.dispose(), [geometry]);

  if (geometry.isEmpty) {
    return null;
  }

  return (
    <group position={[0, 0, 1.5]}>
      {halo && (
        <LineSegments2 geometry={geometry.geom} renderOrder={3}>
          <LineMaterial
            color={halo}
            linewidth={lineWidth + 1.5}
            depthTest={false}
          />
        </LineSegments2>
      )}
      <LineSegments2 geometry={geometry.geom} renderOrder={4}>
        <LineMaterial color={color} linewidth={lineWidth} depthTest={false} />
      </LineSegments2>
    </group>
  );
}

export type { Props as StreamlinesProps };
export default Streamlines;
