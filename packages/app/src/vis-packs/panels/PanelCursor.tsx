import {
  DataToHtml,
  getValueToIndexScale,
  Html,
  useCanvasEvent,
  useVisCanvasContext,
} from '@h5web/lib';
import { formatTooltipVal } from '@h5web/shared/vis-utils';
import { useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { Vector3 } from 'three';

import { getPixelEdges, getPixelIndex } from '../view-hints/probe';
import { type CursorStore, useCursor } from './cursor';
import { type PanelKind, type PanelLayerData } from './models';
import styles from './Panels.module.css';

interface Props extends PanelLayerData {
  store: CursorStore;
  panelKey: string;
  panelTitle: string;
  linkKey: string;
  kind: PanelKind;
  showValue: boolean; // else crosshair only (e.g. small panels, with a readout of the hovered one)
}

/* Value of the panel at a point in data coordinates; for lines, at the nearest abscissa */
function useValueAt(
  kind: PanelKind,
  { dataArray, abscissas, ordinates }: PanelLayerData,
): (x: number, y: number) => { value: number; y: number } | undefined {
  const { abscissaConfig, ordinateConfig } = useVisCanvasContext();
  const [rows, cols] = dataArray.shape;
  const isHeatmap = kind === 'heatmap';
  const xEdges = useMemo(
    () =>
      isHeatmap
        ? getPixelEdges(abscissas, cols, abscissaConfig.scaleType)
        : undefined,
    [isHeatmap, abscissas, cols, abscissaConfig.scaleType],
  );
  const yEdges = useMemo(
    () =>
      isHeatmap
        ? getPixelEdges(ordinates, rows, ordinateConfig.scaleType)
        : undefined,
    [isHeatmap, ordinates, rows, ordinateConfig.scaleType],
  );
  const xToIndex = useMemo(
    () =>
      getValueToIndexScale(
        abscissas ?? Array.from({ length: rows }, (_, i) => i),
        true,
      ),
    [abscissas, rows],
  );

  return (x, y) => {
    if (xEdges && yEdges) {
      const xi = getPixelIndex(x, xEdges);
      const yi = getPixelIndex(y, yEdges);
      return xi === undefined || yi === undefined
        ? undefined
        : { value: dataArray.get(yi, xi), y };
    }
    const value = dataArray.get(xToIndex(x)); // nearest abscissa
    return { value, y: value };
  };
}

/* Crosshair at the cursor's coordinates, with the value of the panel there, in every panel with
 * the same axes as the one under the pointer */
function PanelCursor(props: Props) {
  const { store, panelKey, panelTitle, linkKey, kind, showValue, ...data } =
    props;
  const cursor = useCursor(store);
  const { canvasArea, htmlToData } = useVisCanvasContext();
  const camera = useThree((state) => state.camera);
  const valueAt = useValueAt(kind, data);

  // Client coordinates: `offsetX` is relative to the element under the pointer (e.g. tooltip)
  useCanvasEvent('pointermove', ({ sourceEvent }) => {
    if (sourceEvent.buttons !== 0) {
      return; // panning
    }
    const { left, top } = canvasArea.getBoundingClientRect();
    const htmlPt = new Vector3(
      sourceEvent.clientX - left,
      sourceEvent.clientY - top,
    );
    const { x, y } = htmlToData(camera, htmlPt);
    const value = valueAt(x, y)?.value;
    store.set({ x, y, linkKey, source: panelKey, title: panelTitle, value });
  });
  useCanvasEvent('pointerleave', () => {
    if (store.get()?.source === panelKey) {
      store.set(undefined);
    }
  });

  const isShown = cursor?.linkKey === linkKey;
  const found = isShown ? valueAt(cursor.x, cursor.y) : undefined;
  const points = useMemo(
    () => [new Vector3(cursor?.x ?? 0, found?.y ?? cursor?.y ?? 0)] as const,
    [cursor?.x, cursor?.y, found?.y],
  );

  if (!isShown) {
    return null;
  }

  return (
    <DataToHtml points={points as unknown as [Vector3]}>
      {(pt) => (
        <Html>
          <svg className={styles.cursor} data-testid="panel-cursor">
            <line x1={pt.x} x2={pt.x} y1="0" y2="100%" />
            {kind === 'heatmap' && (
              <line x1="0" x2="100%" y1={pt.y} y2={pt.y} />
            )}
            {kind === 'line' && found && <circle cx={pt.x} cy={pt.y} r={3} />}
          </svg>
          {showValue && found && Number.isFinite(found.value) && (
            <span
              className={styles.cursorValue}
              style={{ left: pt.x, top: pt.y }}
              data-testid="panel-cursor-value"
            >
              {formatTooltipVal(found.value)}
            </span>
          )}
        </Html>
      )}
    </DataToHtml>
  );
}

export default PanelCursor;
