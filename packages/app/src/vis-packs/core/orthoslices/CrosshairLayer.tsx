import {
  DataToHtml,
  Html,
  useCanvasEvent,
  useVisCanvasContext,
} from '@h5web/lib';
import { type NumArray } from '@h5web/shared/vis-models';
import { useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { Vector3 } from 'three';

import {
  getPixelEdges,
  getPixelIndex,
  getPixelMiddle,
} from '../../view-hints/probe';
import styles from './Orthoslices.module.css';

interface Props {
  abscissas: NumArray | undefined;
  ordinates: NumArray | undefined;
  shape: number[]; // rows, cols
  index: [x: number, y: number]; // pixel of the crosshair
  colors: [x: string, y: string]; // of the vertical and horizontal lines
  onMove: (xi: number, yi: number) => void;
}

/* Modifier keys are left to zooming (e.g. Ctrl+drag selects to zoom) */
function hasModifier(evt: PointerEvent): boolean {
  return evt.ctrlKey || evt.shiftKey || evt.altKey || evt.metaKey;
}

/* Crosshair at a pixel of a heatmap, moved by clicking or dragging (with the left button) */
function CrosshairLayer(props: Props) {
  const { abscissas, ordinates, shape, index, colors, onMove } = props;
  const [rows, cols] = shape;
  const [xi, yi] = index;

  // Pixels on the axes' scales (e.g. log axes, cf. `getHeatmapAxis`)
  const { canvasArea, htmlToData, abscissaConfig, ordinateConfig } =
    useVisCanvasContext();
  const { scaleType: xScaleType } = abscissaConfig;
  const { scaleType: yScaleType } = ordinateConfig;
  const xEdges = useMemo(
    () => getPixelEdges(abscissas, cols, xScaleType),
    [abscissas, cols, xScaleType],
  );
  const yEdges = useMemo(
    () => getPixelEdges(ordinates, rows, yScaleType),
    [ordinates, rows, yScaleType],
  );

  // Position in the canvas area from client coordinates: `offsetX` is relative to the element
  // under the pointer, which may not be the canvas (e.g. tooltip)
  const camera = useThree((state) => state.camera);
  function moveTo(evt: PointerEvent) {
    const { left, top } = canvasArea.getBoundingClientRect();
    const htmlPt = new Vector3(evt.clientX - left, evt.clientY - top);
    const dataPt = htmlToData(camera, htmlPt);
    const x = getPixelIndex(dataPt.x, xEdges);
    const y = getPixelIndex(dataPt.y, yEdges);
    if (x !== undefined && y !== undefined && (x !== xi || y !== yi)) {
      onMove(x, y);
    }
  }

  useCanvasEvent('pointerdown', ({ sourceEvent }) => {
    if (sourceEvent.button === 0 && !hasModifier(sourceEvent)) {
      moveTo(sourceEvent);
    }
  });
  useCanvasEvent('pointermove', ({ sourceEvent }) => {
    if (sourceEvent.buttons === 1 && !hasModifier(sourceEvent)) {
      moveTo(sourceEvent); // dragged with the left button
    }
  });

  const points = useMemo(
    (): [Vector3] => [
      new Vector3(
        getPixelMiddle(xEdges, xi, xScaleType),
        getPixelMiddle(yEdges, yi, yScaleType),
      ),
    ],
    [xi, yi, xEdges, yEdges, xScaleType, yScaleType],
  );

  return (
    <DataToHtml points={points}>
      {(pt) => (
        <Html>
          <svg
            className={styles.crosshair}
            data-keep-colors
            data-testid="ortho-crosshair"
          >
            <line x1={pt.x} x2={pt.x} y1="0" y2="100%" stroke={colors[0]} />
            <line x1="0" x2="100%" y1={pt.y} y2={pt.y} stroke={colors[1]} />
          </svg>
        </Html>
      )}
    </DataToHtml>
  );
}

export default CrosshairLayer;
