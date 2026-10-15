import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { useMemo } from 'react';
import { Vector3 } from 'three';

import { useCameraState } from '../hooks';
import Html from '../shared/Html';
import { useVisCanvasContext } from '../shared/VisCanvasProvider';
import { type AuxiliaryParams } from './models';

const SIZE = 4; // half width of a mark, px

export interface MarkedCurve {
  ordinates: NumArray;
  color: string;
  ignoreValue?: IgnoreValue;
}

/* Visible curves, with their colours and ignored values */
export function getMarkedCurves(
  curve: { ordinates: NumArray; color: string } | false,
  auxiliaries: AuxiliaryParams[],
  auxColors: string[],
  ignoreValue: IgnoreValue | undefined,
): MarkedCurve[] {
  return [
    ...(curve ? [{ ...curve, ignoreValue }] : []),
    ...auxiliaries.flatMap((aux, index) =>
      aux.visible
        ? [
            {
              ordinates: aux.array.data,
              color: aux.color ?? auxColors[index % auxColors.length],
              ignoreValue: aux.ignoreValue ?? ignoreValue,
            },
          ]
        : [],
    ),
  ];
}

interface Props {
  abscissas: NumArray;
  curves: MarkedCurve[];
  color?: string; // fill of the marks (default: colour of their curve, then outlined by it)
}

/* Values that can't be drawn on the y axis (non-positive in log scale, ±∞), but are not missing
 * (`NaN`, ignored): small triangles on the bottom edge of the canvas (top edge for +∞), pointing
 * out, at most one per curve and pixel column */
function UnplottableMarks(props: Props) {
  const { abscissas, curves, color } = props;
  const { canvasSize, abscissaScale, ordinateScale, worldToHtml } =
    useVisCanvasContext();
  const { width, height } = canvasSize;

  // World abscissas of the values to mark, once per curve
  const unplottable = useMemo(
    () =>
      curves.map(({ ordinates, ignoreValue }) => {
        const list: { worldX: number; isTop: boolean }[] = [];
        for (const [i, val] of ordinates.entries()) {
          if (
            Number.isNaN(val) ||
            ignoreValue?.(val) ||
            Number.isFinite(ordinateScale(val))
          ) {
            continue;
          }
          const worldX = abscissaScale(abscissas[i]);
          if (Number.isFinite(worldX)) {
            list.push({ worldX, isTop: val > 0 }); // top: +∞
          }
        }
        return list;
      }),
    [curves, abscissas, abscissaScale, ordinateScale],
  );

  const marks = useCameraState(
    (camera) =>
      unplottable.map((list) => {
        const columns = new Map<string, { x: number; isTop: boolean }>();
        for (const { worldX, isTop } of list) {
          const { x } = worldToHtml(camera, new Vector3(worldX, 0));
          if (x >= -SIZE && x <= width + SIZE) {
            columns.set(`${Math.round(x)}${isTop}`, { x, isTop });
          }
        }
        return [...columns.values()];
      }),
    [unplottable, worldToHtml, width],
  );

  if (marks.every((list) => list.length === 0)) {
    return null;
  }

  return (
    <Html overflowCanvas>
      <svg
        data-testid="unplottable-marks"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        {marks.map((list, i) =>
          list.map(({ x, isTop }) => {
            const [edge, base] = isTop
              ? [0, 2 * SIZE]
              : [height, height - 2 * SIZE];
            return (
              <polygon
                key={`${i}-${x}-${isTop}`} // eslint-disable-line react/no-array-index-key -- curves don't move
                points={`${x - SIZE},${base} ${x + SIZE},${base} ${x},${edge}`}
                fill={color ?? curves[i].color}
                stroke={color ? curves[i].color : undefined}
                strokeWidth={1}
              />
            );
          }),
        )}
      </svg>
    </Html>
  );
}

export default UnplottableMarks;
