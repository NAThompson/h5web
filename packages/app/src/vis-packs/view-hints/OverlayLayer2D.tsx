import {
  type ColorScaleType,
  createScale,
  DataToHtml,
  type Domain,
  Html,
  INTERPOLATORS,
} from '@h5web/lib';
import { type SVGProps, useMemo } from 'react';
import { Color, Vector3 } from 'three';

import { type ColorMap } from '../core/heatmap/models';
import { type TextAnchor } from './models';
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

const DASH = '6 4';
const TEXT_GAP = 8; // px between a position and the text placed next to it

/* Text placed on the given side of its position */
const TEXT_PLACEMENT: Record<TextAnchor, SVGProps<SVGTextElement>> = {
  top: { textAnchor: 'middle', dy: -TEXT_GAP },
  bottom: { textAnchor: 'middle', dominantBaseline: 'hanging', dy: TEXT_GAP },
  left: { textAnchor: 'end', dominantBaseline: 'central', dx: -TEXT_GAP },
  right: { textAnchor: 'start', dominantBaseline: 'central', dx: TEXT_GAP },
  center: { textAnchor: 'middle', dominantBaseline: 'central' },
};

function isFinitePoint(pt: Vector3): boolean {
  return Number.isFinite(pt.x) && Number.isFinite(pt.y);
}

/* SVG path through the points, broken at non-finite points (e.g. a NaN row of a curve) */
function getPathData(pts: Vector3[]): string {
  let isPenDown = false;
  return pts
    .map((pt) => {
      if (!isFinitePoint(pt)) {
        isPenDown = false;
        return '';
      }
      const cmd = isPenDown ? 'L' : 'M';
      isPenDown = true;
      return `${cmd}${pt.x},${pt.y}`;
    })
    .join('');
}

/* Halo contrasting with a colour, so lines and text stand out on any background */
function getHaloColor(color: string): string {
  const hsl = { h: 0, s: 0, l: 0 };
  new Color(color).getHSL(hsl);
  return hsl.l < 0.4 ? 'white' : 'black';
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
  const { vectors, lineOffsets, pointOffsets, textOffset } = useMemo(() => {
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
      textOffset: addPoints([
        { x: shapes.texts.map((t) => t.x), y: shapes.texts.map((t) => t.y) },
      ])[0],
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
                const pts = htmlPts.slice(
                  lineOffsets[i],
                  lineOffsets[i] + line.x.length,
                );
                const d = getPathData(pts); // non-finite points break the line
                const head = pts.findLast(isFinitePoint);
                const halo = getHaloColor(line.stroke);
                return (
                  // eslint-disable-next-line react/no-array-index-key
                  <g key={i} data-testid="overlay-line">
                    {line.label && <title>{line.label}</title>}
                    <path
                      d={d}
                      fill="none"
                      stroke={halo}
                      strokeOpacity={0.4}
                      strokeWidth={line.width + 1.5}
                      strokeLinejoin="round"
                      strokeDasharray={line.dash ? DASH : undefined}
                    />
                    <path
                      d={d}
                      fill="none"
                      stroke={line.stroke}
                      strokeWidth={line.width}
                      strokeLinejoin="round"
                      strokeDasharray={line.dash ? DASH : undefined}
                    />
                    {line.head && head && (
                      <circle
                        cx={head.x}
                        cy={head.y}
                        r={4}
                        fill={line.stroke}
                        stroke={halo}
                        strokeWidth={1.5}
                      />
                    )}
                  </g>
                );
              })}
              {shapes.points.map((points, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <g key={i} data-testid="overlay-points">
                  {points.label && <title>{points.label}</title>}
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
              {shapes.texts.map((text, i) => {
                const pt = htmlPts[textOffset + i];
                if (!isFinitePoint(pt)) {
                  return null;
                }
                return (
                  <text
                    // eslint-disable-next-line react/no-array-index-key
                    key={i}
                    x={pt.x}
                    y={pt.y}
                    fill={text.color}
                    stroke={getHaloColor(text.color)}
                    strokeOpacity={0.6}
                    strokeWidth={3}
                    paintOrder="stroke"
                    fontSize={13}
                    {...TEXT_PLACEMENT[text.anchor]}
                  >
                    {text.text}
                  </text>
                );
              })}
            </g>
          </svg>
        </Html>
      )}
    </DataToHtml>
  );
}

export type { ColorParams };
export default OverlayLayer2D;
