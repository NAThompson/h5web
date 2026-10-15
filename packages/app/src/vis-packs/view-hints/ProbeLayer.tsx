import {
  DataToHtml,
  Html,
  useCanvasEvent,
  useVisCanvasContext,
} from '@h5web/lib';
import { type NumArray } from '@h5web/shared/vis-models';
import { useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Vector3 } from 'three';

import { getPixelEdges, getPixelIndex, type ProbePoint } from './probe';
import styles from './ViewHints.module.css';

const MAX_CLICK_MOVE = 4; // px: a longer move is a pan, not a click

interface Props {
  abscissas: NumArray | undefined;
  ordinates: NumArray | undefined;
  shape: number[]; // rows, cols
  axisDims: { x: number; y: number }; // dimensions of the dataset on the axes
  point: ProbePoint | undefined;
  onProbe: (point: ProbePoint) => void;
}

/* Probe a pixel of a heatmap by clicking it, and mark the probed pixel */
function ProbeLayer(props: Props) {
  const { abscissas, ordinates, shape, axisDims, point, onProbe } = props;
  const [rows, cols] = shape;

  const xEdges = useMemo(
    () => getPixelEdges(abscissas, cols),
    [abscissas, cols],
  );
  const yEdges = useMemo(
    () => getPixelEdges(ordinates, rows),
    [ordinates, rows],
  );

  // Position in the canvas area from client coordinates: `offsetX` is relative to the element
  // under the pointer, which may not be the canvas (e.g. tooltip)
  const { canvasArea, htmlToData } = useVisCanvasContext();
  const camera = useThree((state) => state.camera);
  function toHtml(evt: PointerEvent): Vector3 {
    const { left, top } = canvasArea.getBoundingClientRect();
    return new Vector3(evt.clientX - left, evt.clientY - top);
  }

  const downPt = useRef<Vector3>(undefined);
  useCanvasEvent('pointerdown', ({ sourceEvent }) => {
    downPt.current = toHtml(sourceEvent);
  });
  useCanvasEvent('pointerup', ({ sourceEvent }) => {
    const htmlPt = toHtml(sourceEvent);
    const start = downPt.current;
    downPt.current = undefined;
    if (
      !start ||
      sourceEvent.button !== 0 ||
      htmlPt.distanceTo(start) > MAX_CLICK_MOVE
    ) {
      return;
    }

    const dataPt = htmlToData(camera, htmlPt);
    const xi = getPixelIndex(dataPt.x, xEdges);
    const yi = getPixelIndex(dataPt.y, yEdges);
    if (xi !== undefined && yi !== undefined) {
      onProbe({ [axisDims.x]: xi, [axisDims.y]: yi });
    }
  });

  const xi = point?.[axisDims.x];
  const yi = point?.[axisDims.y];
  const points = useMemo((): [Vector3] | undefined => {
    if (xi === undefined || yi === undefined) {
      return undefined;
    }
    const x = (xEdges[xi] + xEdges[xi + 1]) / 2;
    const y = (yEdges[yi] + yEdges[yi + 1]) / 2;
    return [new Vector3(x, y)];
  }, [xi, yi, xEdges, yEdges]);

  if (!points) {
    return null;
  }

  return (
    <DataToHtml points={points}>
      {(pt) => (
        <Html>
          <svg className={styles.svg}>
            <circle
              data-testid="probe-marker"
              cx={pt.x}
              cy={pt.y}
              r={6}
              fill="none"
              stroke="black"
              strokeWidth={3}
            />
            <circle
              cx={pt.x}
              cy={pt.y}
              r={6}
              fill="none"
              stroke="white"
              strokeWidth={1.5}
            />
          </svg>
        </Html>
      )}
    </DataToHtml>
  );
}

export default ProbeLayer;
