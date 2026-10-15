import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { formatTooltipVal } from '@h5web/shared/vis-utils';
import { extend } from '@react-three/fiber';
import { rgb } from 'd3-color';
import { type NdArray } from 'ndarray';
import { Fragment, useEffect, useMemo } from 'react';
import { Vector3 } from 'three';
import { LineMaterial as ThreeLineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 as ThreeLineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

import { useCameraState } from '../hooks';
import { type VisScaleType } from '../models';
import Html from '../shared/Html';
import { useVisCanvasContext } from '../shared/VisCanvasProvider';
import styles from './ContourLines.module.css';
import { useContours } from './hooks';

const LineSegments2 = extend(ThreeLineSegments2);
const LineMaterial = extend(ThreeLineMaterial);

interface Props {
  dataArray: NdArray<NumArray>;
  levels: number[];
  scaleType?: VisScaleType;
  ignoreValue?: IgnoreValue;
  /* Single colour, or one colour per level */
  color?: string | string[];
  opacity?: number;
  flipXAxis?: boolean;
  flipYAxis?: boolean;
  showLabels?: boolean;
  /* Line width in CSS pixels */
  lineWidth?: number;
  /* Outline lines with a darker shade to make them stand out (e.g. when coloured with the colour map) */
  withHalo?: boolean;
  /* Colour of the halo (default: darker shade of each line's colour) */
  haloColor?: string;
  formatLabel?: (level: number) => string;
}

interface LabelPosition {
  key: string;
  x: number;
  y: number;
  angle: number; // degrees, on screen
  text: string;
  color: string;
}

function ContourLines(props: Props) {
  const {
    dataArray,
    levels,
    scaleType,
    ignoreValue,
    color = 'white',
    opacity = 1,
    flipXAxis = false,
    flipYAxis = false,
    showLabels = false,
    lineWidth = 1.5,
    withHalo = false,
    haloColor,
    formatLabel = formatTooltipVal,
  } = props;

  const [rows, cols] = dataArray.shape;
  const { visSize, worldToHtml } = useVisCanvasContext();

  const { contours, error } = useContours(dataArray, levels, {
    scaleType,
    ignoreValue,
    withLabels: showLabels,
  });

  // Vertices are normalized to [-0.5, 0.5] so the geometry doesn't depend on the canvas size
  const geometries = useMemo(
    () =>
      contours?.map(({ vertices, segments }) => {
        // Wide lines need each segment's end points (no indexing)
        const positions = new Float32Array(segments.length * 3);
        segments.forEach((vertex, i) => {
          positions[i * 3] = vertices[vertex * 2] / cols - 0.5;
          positions[i * 3 + 1] = vertices[vertex * 2 + 1] / rows - 0.5;
        });
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(positions);
        return geometry;
      }),
    [contours, rows, cols],
  );

  useEffect(
    () => () => {
      geometries?.forEach((geometry) => {
        geometry.dispose();
      });
    },
    [geometries],
  );

  const scaleX = visSize.width * (flipXAxis ? -1 : 1);
  const scaleY = visSize.height * (flipYAxis ? -1 : 1);
  // Contours may lag behind levels while being computed, so look colours up by level
  const colorByLevel = new Map(
    levels.map((level, i) => [
      level,
      (Array.isArray(color) ? color[i] : color) ?? 'white', // eslint-disable-line @typescript-eslint/no-unnecessary-condition -- array may be too short
    ]),
  );
  function colorOf(level: number): string {
    return colorByLevel.get(level) ?? 'white';
  }
  const colorsKey = [...colorByLevel.values()].join(',');

  const labels = useCameraState(
    (camera) => {
      if (!showLabels || !contours) {
        return [];
      }

      const frame = { rows, cols, scaleX, scaleY };
      return contours.flatMap(({ level, labels: anchors }, i) =>
        anchors.map(({ x, y, angle }, j): LabelPosition => {
          const html = worldToHtml(camera, toWorld(x, y, frame));
          const ahead = worldToHtml(
            camera,
            toWorld(x + Math.cos(angle), y + Math.sin(angle), frame),
          );

          // Keep text upright whatever the flips, aspect ratio and zoom
          let screenAngle = Math.atan2(ahead.y - html.y, ahead.x - html.x);
          if (screenAngle > Math.PI / 2) {
            screenAngle -= Math.PI;
          } else if (screenAngle < -Math.PI / 2) {
            screenAngle += Math.PI;
          }

          return {
            key: `${i}-${j}`,
            x: html.x,
            y: html.y,
            angle: (screenAngle * 180) / Math.PI,
            text: formatLabel(level),
            color: colorOf(level),
          };
        }),
      );
    },
    [showLabels, contours, rows, cols, scaleX, scaleY, worldToHtml, colorsKey], // eslint-disable-line react-hooks/exhaustive-deps
    areLabelsEqual,
  );

  const errorNote = error && (
    <Html>
      <p className={styles.error} role="note">
        Contours unavailable: {error.message}
      </p>
    </Html>
  );

  if (!contours || !geometries) {
    return errorNote ?? null;
  }

  return (
    <>
      {errorNote}
      <group scale={[scaleX, scaleY, 1]} position={[0, 0, 1]}>
        {geometries.map((geometry, i) => {
          const { level } = contours[i];
          return (
            <Fragment key={level}>
              {withHalo && (
                <LineSegments2 geometry={geometry} renderOrder={1}>
                  {/* Opaque, so overlapping segment ends don't look dotted */}
                  <LineMaterial
                    color={
                      haloColor ?? rgb(colorOf(level)).darker(2).formatHex()
                    }
                    linewidth={lineWidth + 1.5}
                    transparent={opacity < 1}
                    opacity={opacity}
                    depthTest={false}
                  />
                </LineSegments2>
              )}
              <LineSegments2 geometry={geometry} renderOrder={2}>
                <LineMaterial
                  color={colorOf(level)}
                  linewidth={lineWidth}
                  transparent={opacity < 1}
                  opacity={opacity}
                  depthTest={false}
                />
              </LineSegments2>
            </Fragment>
          );
        })}
      </group>

      {labels.length > 0 && (
        <Html>
          {labels.map(({ key, x, y, angle, text, color: labelColor }) => (
            <span
              key={key}
              className={styles.label}
              style={{
                transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${angle}deg)`,
                color: labelColor,
              }}
            >
              {text}
            </span>
          ))}
        </Html>
      )}
    </>
  );
}

/* Pixel-edge index coordinates to world coordinates of the canvas */
function toWorld(
  u: number,
  v: number,
  frame: { rows: number; cols: number; scaleX: number; scaleY: number },
): Vector3 {
  const { rows, cols, scaleX, scaleY } = frame;
  return new Vector3((u / cols - 0.5) * scaleX, (v / rows - 0.5) * scaleY, 0);
}

function areLabelsEqual(prev: LabelPosition[], next: LabelPosition[]): boolean {
  return (
    prev.length === next.length &&
    prev.every(
      (label, i) =>
        label.key === next[i].key &&
        label.text === next[i].text &&
        label.color === next[i].color &&
        Math.abs(label.x - next[i].x) < 0.5 &&
        Math.abs(label.y - next[i].y) < 0.5 &&
        Math.abs(label.angle - next[i].angle) < 0.5,
    )
  );
}

export type { Props as ContourLinesProps };
export default ContourLines;
