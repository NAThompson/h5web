import {
  type ColorScaleType,
  createScale,
  DataToHtml,
  type Domain,
  Html,
  INTERPOLATORS,
} from '@h5web/lib';
import { useMemo } from 'react';
import { Vector3 } from 'three';

import { type ColorMap } from '../core/heatmap/models';
import { type OverlayShapes } from './overlays';
import styles from './ViewHints.module.css';

interface ColorParams {
  domain: Domain;
  scaleType: ColorScaleType;
  colorMap: ColorMap;
  invertColorMap: boolean;
}

function useFillColors(
  shapes: OverlayShapes,
  colorParams: ColorParams,
): string[][] {
  const { domain, scaleType, colorMap, invertColorMap } = colorParams;

  return useMemo(() => {
    const scale = createScale(scaleType, {
      domain,
      range: [0, 1],
      clamp: true,
    });
    const interpolator = INTERPOLATORS[colorMap];

    return shapes.points.map(({ x, values, fill }) =>
      x.map((_, i) => {
        const t = values ? scale(values[i]) : Number.NaN;
        if (!Number.isFinite(t)) {
          return fill;
        }
        return interpolator(invertColorMap ? 1 - t : t);
      }),
    );
  }, [shapes, domain, scaleType, colorMap, invertColorMap]);
}

interface Props {
  shapes: OverlayShapes;
  colorParams: ColorParams;
}

/* Overlays on a heatmap, drawn in SVG in the heatmap's data coordinates */
function OverlayLayer2D(props: Props) {
  const { shapes, colorParams } = props;
  const fills = useFillColors(shapes, colorParams);

  // All points to convert to HTML coordinates, followed by their offsets per shape
  const { vectors, lineOffsets, pointOffsets } = useMemo(() => {
    const vecs: Vector3[] = [];
    function addPoints(list: { x: number[]; y: number[] }[]): number[] {
      return list.map(({ x, y }) => {
        const start = vecs.length;
        for (const [i, xVal] of x.entries()) {
          vecs.push(new Vector3(xVal, y[i], 0));
        }
        return start;
      });
    }
    return {
      lineOffsets: addPoints(shapes.lines),
      pointOffsets: addPoints(shapes.points),
      vectors: vecs,
    };
  }, [shapes]);

  return (
    <DataToHtml points={vectors}>
      {(...htmlPts) => (
        // Not clipped by the canvas, so shapes on the edges of the domain are drawn whole
        <Html overflowCanvas>
          <svg className={styles.svg}>
            <g data-testid="overlays">
              {shapes.lines.map((line, i) => {
                const pts = htmlPts
                  .slice(lineOffsets[i], lineOffsets[i] + line.x.length)
                  .filter(
                    (pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y),
                  );
                const str = pts.map((pt) => `${pt.x},${pt.y}`).join(' ');
                const head = pts.at(-1);
                return (
                  // eslint-disable-next-line react/no-array-index-key
                  <g key={i} data-testid="overlay-line">
                    <polyline
                      points={str}
                      fill="none"
                      stroke="black"
                      strokeOpacity={0.4}
                      strokeWidth={3}
                      strokeLinejoin="round"
                    />
                    <polyline
                      points={str}
                      fill="none"
                      stroke={line.stroke}
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                    />
                    {line.head && head && (
                      <circle
                        cx={head.x}
                        cy={head.y}
                        r={4}
                        fill={line.stroke}
                        stroke="black"
                        strokeWidth={1.5}
                      />
                    )}
                  </g>
                );
              })}
              {shapes.points.map((points, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <g key={i} data-testid="overlay-points">
                  {points.x.map((_, j) => {
                    const pt = htmlPts[pointOffsets[i] + j];
                    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
                      return null;
                    }
                    return (
                      // eslint-disable-next-line react/no-array-index-key
                      <g key={j}>
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={points.size + 2.5}
                          fill={points.stroke}
                        />
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={points.size}
                          fill={fills[i][j]}
                          stroke="white"
                          strokeWidth={1.5}
                        />
                      </g>
                    );
                  })}
                </g>
              ))}
            </g>
          </svg>
        </Html>
      )}
    </DataToHtml>
  );
}

export type { ColorParams };
export default OverlayLayer2D;
